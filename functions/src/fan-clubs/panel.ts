import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { artistRecord, isPublished } from '../centrals/model';
import { artistRef } from '../centrals/service';
import { dayKey } from '../day';
import { MISSING_FAN_PHOTO_FILES, type FanPhotoFiles } from '../fan-profile/files';
import { isContentId } from '../page-cursor';
import { adjustDailyMaxFor, adjustMaxFor } from '../points/adjust';
import {
  applyAwards,
  ledgerRef,
  planAwards,
  requireFan,
  retryOnAlreadyExists,
  walletRef,
  type AwardContext,
} from '../points/award';
import type { ConfigSource } from '../points/config';
import { ledgerId, NO_GAME, type AwardEntry, type PointsConfig } from '../points/model';
import { pickShard } from '../points/stats';
import { rewardPanelError } from '../rewards/errors';
import { drawRedemptionCode, prizeRewardProblem, redemptionRecord } from '../rewards/model';
import { grantPrize } from '../rewards/service';
import { redemptionsRef, rewardOf, rewardRef } from '../rewards/store';
import { addStaffLimit, checkStaffLimit, parseStaffLimit, staffLimitRef } from '../staff/limits';
import { requestFields, type SectionId, type StaffRole } from '../staff/model';
import {
  directRead,
  panelAccessError,
  readPanelActor,
  transactionRead,
  type PanelActor,
} from '../staff/panel-actor';
import { aboveLimitError, dailyLimitError, panelError, targetFanUid } from '../staff/panel-errors';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import { readCommentScene, writeStaffStatus } from './comment-queue';
import {
  APPLICATION_REJECT_REASONS,
  applicationRecord,
  checkClubName,
  CLOSE_REASONS,
  COMMENT_DECISIONS,
  commentQueueRecord,
  FAN_CLUB_COMMENT_STATUSES,
  FAN_CLUB_POST_STATUSES,
  FAN_CLUB_REAPPLY_MS,
  FAN_CLUB_STATUSES,
  FEATURED_PER_ARTIST_MAX,
  fanClubBoxes,
  fanClubCommentRecord,
  fanClubPostRecord,
  fanClubPrizeRecord,
  fanClubRecord,
  isFeaturedNow,
  millisOf,
  parseFeaturedUntil,
  parseRewardGrant,
  POST_REJECT_REASONS,
  postMediaPaths,
  prizeBlock,
  reapplyAfterRejection,
  sameRewardGrant,
  withHistory,
  type ApplicationRecord,
  type ApplicationRejectReason,
  type CloseReason,
  type CommentDecision,
  type FanClubCommentStatus,
  type FanClubPostStatus,
  type FanClubRecord,
  type FanClubStatus,
  type PostMedia,
  type PostRejectReason,
  type RewardGrantInput,
} from './model';
import { NO_FILE_WORK, runFanClubFileWork, type FanClubFileWork } from './posts';
import {
  applicationPrivateRef,
  applicationRef,
  FEATURE_OFF,
  fanClubCommentQueueRef,
  fanClubCommentRef,
  fanClubPostRef,
  fanClubPrizeRef,
  fanClubRef,
  fanClubReportQueueRef,
  fanClubsOf,
  OFFICIAL_OFF,
  ownerCopiesOf,
} from './store';

// A callable do painel do fã-clube (docs/arquitetura-api.md, seção 34, 34.3 e
// 34.5): `decideFanClub`, uma só para todos os assuntos (decisão 6), com a
// seção fanClubs e edição, lida direto e de novo na transação (o Leitor não
// decide), e a auditoria na mesma transação. O molde é o do
// `resolveProfileReport`: o estado que a tela mostrou (`expected`) diferente
// do de agora é `stale-decision`; nada a mudar, `ok` sem gravar nem auditar.
// A etapa 1 de 34.14 decide a candidatura e o fã-clube (com o Destaque); a
// etapa 2, as publicações e as denúncias delas, com os arquivos apagados e os
// tokens trocados depois da transação; a etapa 5, o Recompensar (os pontos só
// no saldo e o prêmio, que vira pedido da loja). Desde 34.23, o Oficializar e
// o Tirar a oficialização, só do admin, como o Encerrar. Desde a Fase 2 (seção
// 37, 37.6; a etapa 3 de 37.13), o assunto `comment`: manter, ocultar e
// reexibir um comentário de fã-clube, com a fila `fanClubCommentQueue`.

/** Os assuntos que a callable decide. */
export const DECISION_SUBJECTS = ['application', 'club', 'post', 'report', 'comment'] as const;
export type DecisionSubject = (typeof DECISION_SUBJECTS)[number];

export type DecisionInput =
  | {
      subject: 'application';
      id: string;
      decision: 'approve';
      /** A rodada que a tela mostrou. */
      expected: number;
      /**
       * O `submittedAt` que a tela mostrou, em ms, ou null sem ele: a rodada
       * fica a mesma depois de desistir e mandar de novo, e só a data separa
       * uma candidatura da outra.
       */
      submittedAt: number | null;
      /** O nome confirmado ou ajustado pela equipe; null fica o proposto. */
      name: string | null;
    }
  | {
      subject: 'application';
      id: string;
      decision: 'reject';
      expected: number;
      submittedAt: number | null;
      reason: ApplicationRejectReason;
    }
  | {
      subject: 'club';
      id: string;
      /** `officialize` e `unofficialize`: o selo do fã-clube oficial, só do admin (34.23). */
      decision: 'pause' | 'resume' | 'unfeature' | 'officialize' | 'unofficialize';
      /** O status que a tela mostrou. */
      expected: FanClubStatus;
    }
  | { subject: 'club'; id: string; decision: 'close'; expected: FanClubStatus; reason: CloseReason }
  | {
      subject: 'club';
      id: string;
      decision: 'feature';
      expected: FanClubStatus;
      /** `AAAA-MM-DD`, de amanhã a 31 dias. */
      featuredUntil: string;
    }
  | {
      subject: 'club';
      id: string;
      /** O Recompensar (etapa 5): os pontos, o prêmio ou os dois (decisões 44 a 46). */
      decision: 'reward';
      expected: FanClubStatus;
      grant: RewardGrantInput;
    }
  | {
      subject: 'post';
      id: string;
      decision: 'approve' | 'hide' | 'restore';
      /** O status da publicação que a tela mostrou. */
      expected: FanClubPostStatus;
    }
  | {
      subject: 'post';
      id: string;
      decision: 'reject';
      expected: FanClubPostStatus;
      reason: PostRejectReason;
    }
  | {
      subject: 'report';
      /** O id da publicação, que é o do item da `fanClubReportQueue`. */
      id: string;
      decision: 'keep' | 'action';
      /** A rodada do item que a tela mostrou. */
      expected: number;
    }
  | {
      subject: 'comment';
      /** O id do comentário, que é o do item da `fanClubCommentQueue`. */
      id: string;
      decision: CommentDecision;
      /** O status do comentário que a tela mostrou. */
      expected: FanClubCommentStatus;
      /**
       * A rodada do item que a tela mostrou (a aba Comentários), obrigatória no
       * `keep`; null no Ocultar e no Reexibir do diálogo da ficha, sem o item.
       */
      round: number | null;
    };

export type DecisionResult = {
  ok: true;
  subject: DecisionSubject;
  id: string;
  /**
   * O status do assunto depois da decisão: da candidatura, do fã-clube, da
   * publicação, do item da fila de denúncias (`resolved`) ou do comentário.
   */
  status: string;
};

/**
 * A saída do Recompensar (34.3): a de sempre, com o status do fã-clube, mais
 * o `grantId`, o código do pedido de prêmio (null sem prêmio) e os pontos
 * (null sem pontos).
 */
export type RewardDecisionResult = DecisionResult & {
  grantId: string;
  code: string | null;
  points: number | null;
};

/** A decisão tomada e o que fica para depois da transação (os arquivos da publicação). */
export type Decided = { result: DecisionResult; files: FanClubFileWork };

/** As decisões do fã-clube, menos o Recompensar, que tem caminho próprio. */
type ClubDecisionInput = Exclude<
  Extract<DecisionInput, { subject: 'club' }>,
  { decision: 'reward' }
>;

type RewardDecisionInput = Extract<DecisionInput, { decision: 'reward' }>;

const invalid = (field: string, extra: Record<string, unknown> = {}) =>
  panelError('invalid-request', { field, ...extra });

const CLUB_DECISIONS = [
  'pause',
  'resume',
  'close',
  'feature',
  'unfeature',
  'officialize',
  'unofficialize',
  'reward',
] as const;

/** As decisões só do admin (decisão 7 e 34.23): encerrar e o selo de oficial. */
const ADMIN_DECISIONS: readonly string[] = ['close', 'officialize', 'unofficialize'];
const POST_DECISIONS = ['approve', 'reject', 'hide', 'restore'] as const;
const REPORT_DECISIONS = ['keep', 'action'] as const;

/**
 * O corpo da callable depois do assunto e do id (puro): a decisão da lista do
 * assunto, o `expected` (a rodada, inteiro de 0 em diante, na candidatura; o
 * status, no fã-clube, na publicação e no comentário; a rodada, inteiro de 1
 * em diante, na denúncia) e os campos de cada decisão (34.3); senão
 * `invalid-request` com o campo. Na candidatura, o `submittedAt` opcional (o
 * da tela, em ms). O nome da aprovação passa pelas regras da candidatura
 * (`checkClubName`), com o motivo no `details.problem`. No comentário (seção
 * 37, 37.6), a `round` (inteiro de 1 em diante; ausente ou null vale null),
 * obrigatória no `keep`.
 */
export function parseDecision(
  subject: DecisionSubject,
  id: string,
  fields: Record<string, unknown>,
  now: number,
): DecisionInput {
  const { decision, expected } = fields;
  if (subject === 'comment') {
    if (!(COMMENT_DECISIONS as readonly unknown[]).includes(decision)) throw invalid('decision');
    if (!(FAN_CLUB_COMMENT_STATUSES as readonly unknown[]).includes(expected)) {
      throw invalid('expected');
    }
    const shown = fields.round;
    if (
      shown !== undefined &&
      shown !== null &&
      (typeof shown !== 'number' || !Number.isSafeInteger(shown) || shown < 1)
    ) {
      throw invalid('round');
    }
    const round = typeof shown === 'number' ? shown : null;
    if (decision === 'keep' && round === null) throw invalid('round');
    return {
      subject,
      id,
      decision: decision as CommentDecision,
      expected: expected as FanClubCommentStatus,
      round,
    };
  }
  if (subject === 'application') {
    if (decision !== 'approve' && decision !== 'reject') throw invalid('decision');
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) {
      throw invalid('expected');
    }
    const shown = fields.submittedAt;
    if (
      shown !== undefined &&
      shown !== null &&
      (typeof shown !== 'number' || !Number.isSafeInteger(shown) || shown < 0)
    ) {
      throw invalid('submittedAt');
    }
    const submittedAt = typeof shown === 'number' ? shown : null;
    if (decision === 'reject') {
      if (!(APPLICATION_REJECT_REASONS as readonly unknown[]).includes(fields.reason)) {
        throw invalid('reason');
      }
      return {
        subject,
        id,
        decision,
        expected,
        submittedAt,
        reason: fields.reason as ApplicationRejectReason,
      };
    }
    let name: string | null = null;
    if (fields.name !== undefined && fields.name !== null) {
      if (typeof fields.name !== 'string') throw invalid('name');
      const checked = checkClubName(fields.name);
      if (!checked.ok) throw invalid('name', { problem: checked.reason });
      name = checked.name;
    }
    return { subject, id, decision, expected, submittedAt, name };
  }
  if (subject === 'post') {
    if (!(POST_DECISIONS as readonly unknown[]).includes(decision)) throw invalid('decision');
    if (!(FAN_CLUB_POST_STATUSES as readonly unknown[]).includes(expected)) {
      throw invalid('expected');
    }
    const shown = expected as FanClubPostStatus;
    if (decision === 'reject') {
      if (!(POST_REJECT_REASONS as readonly unknown[]).includes(fields.reason)) {
        throw invalid('reason');
      }
      return {
        subject,
        id,
        decision,
        expected: shown,
        reason: fields.reason as PostRejectReason,
      };
    }
    return {
      subject,
      id,
      decision: decision as 'approve' | 'hide' | 'restore',
      expected: shown,
    };
  }
  if (subject === 'report') {
    if (!(REPORT_DECISIONS as readonly unknown[]).includes(decision)) throw invalid('decision');
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1) {
      throw invalid('expected');
    }
    return { subject, id, decision: decision as 'keep' | 'action', expected };
  }
  if (!(CLUB_DECISIONS as readonly unknown[]).includes(decision)) throw invalid('decision');
  if (!(FAN_CLUB_STATUSES as readonly unknown[]).includes(expected)) throw invalid('expected');
  const status = expected as FanClubStatus;
  if (decision === 'close') {
    const reason = fields.reason === undefined || fields.reason === null ? 'staff' : fields.reason;
    if (!(CLOSE_REASONS as readonly unknown[]).includes(reason)) throw invalid('reason');
    return { subject, id, decision, expected: status, reason: reason as CloseReason };
  }
  if (decision === 'feature') {
    const featuredUntil = parseFeaturedUntil(fields.featuredUntil, now);
    if (featuredUntil === null) throw invalid('featuredUntil');
    return { subject, id, decision, expected: status, featuredUntil };
  }
  if (decision === 'reward') {
    const grant = parseRewardGrant(fields);
    if (!grant.ok) throw invalid(grant.field);
    return { subject, id, decision, expected: status, grant: grant.value };
  }
  return {
    subject,
    id,
    decision: decision as 'pause' | 'resume' | 'unfeature' | 'officialize' | 'unofficialize',
    expected: status,
  };
}

export type FanClubPanelDeps = {
  db: Firestore;
  /**
   * O Storage das fotos das publicações (etapa 2): a URL nova no `restore`, e,
   * depois da transação, os arquivos apagados na recusa e os tokens trocados
   * ao ocultar. Sem ele, só as decisões de publicação com foto falham.
   */
  files?: FanPhotoFiles;
  /**
   * Os valores dos pontos (só a versão entra no lançamento do Recompensar), com
   * o cache de sempre. Sem ele, só o Recompensar falha.
   */
  config?: ConfigSource;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** Sorteio do shard dos agregados; os testes fixam. */
  random?: () => number;
  /** O sorteio do código do pedido de prêmio; só o teste da colisão troca. */
  drawCode?: () => string;
};

type Actor = Pick<PanelActor, 'uid' | 'name'>;

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

/** A auditoria do fã-clube: sem `targetUid` (o gestor vai em `fanUid`) e nunca texto do fã. */
function audit(
  tx: Transaction,
  db: Firestore,
  action: AuditAction,
  actor: Actor,
  details: Record<string, unknown>,
  at: Timestamp,
): void {
  writeAudit(
    tx,
    db,
    {
      action,
      actorUid: actor.uid,
      actorName: actor.name,
      targetEmail: '',
      targetUid: null,
      details,
    },
    at,
  );
}

const isSuspended = (profile: DocumentSnapshot): boolean => {
  const at = profile.get('suspendedAt');
  return at !== undefined && at !== null;
};

/**
 * O artista no ar e com o fã-clube aberto para ele (`artist-not-open`). Com
 * `since` (o `submittedAt` da candidatura, em ms), também a central criada
 * depois dela: o @ de uma central apagada pode voltar em outra, e a
 * candidatura que sobrou não vira fã-clube da nova.
 */
async function requireOpenArtist(
  tx: Transaction,
  db: Firestore,
  artistId: string,
  since: number | null = null,
) {
  const [artist, privateDoc] = await tx.getAll(
    artistRef(db, artistId),
    db.collection('artistPrivate').doc(artistId),
  );
  const record = artist!.exists ? artistRecord(artist!.id, artist!.data() ?? {}) : null;
  if (!isPublished(record) || !fanClubBoxes(privateDoc!.data()).enabled) {
    throw panelError('artist-not-open');
  }
  const createdAt = millisOf(artist!.get('createdAt'));
  if (since !== null && createdAt !== null && createdAt > since) {
    throw panelError('artist-not-open');
  }
  return record;
}

const historyField = (record: ApplicationRecord) =>
  record.history.map((item) => ({ ...item, at: tsOf(item.at) }));

// --- A candidatura -----------------------------------------------------------------

/**
 * Aprovar ou recusar a candidatura (34.5), na transação de quem chama: a
 * candidatura e o privado (`application-not-found`); a rodada ou o
 * `submittedAt` diferentes dos da tela, `stale-decision`; já decidida do
 * mesmo jeito (a recusa com o mesmo motivo), `ok` sem gravar; a que não está
 * pendente (decidida de outro jeito ou retirada), também `stale-decision`. Aprovar lê também o perfil (o suspenso,
 * `owner-suspended`), o artista e o `artistPrivate` (`artist-not-open`), cria
 * o fã-clube ativo com as cópias do gestor, `counts` zerado e o destaque fora,
 * grava a candidatura aprovada com o `clubId` e tira o texto de divulgação do
 * privado. Recusar grava o motivo e o `canReapplyAt` e apaga o privado.
 */
async function decideApplication(
  tx: Transaction,
  db: Firestore,
  input: Extract<DecisionInput, { subject: 'application' }>,
  options: { actor: Actor; now: number },
): Promise<DecisionResult> {
  const { actor, now } = options;
  const appRef = applicationRef(db, input.id);
  const privateRef = applicationPrivateRef(db, input.id);
  const reads: DocumentReference[] = [appRef, privateRef];
  if (input.decision === 'approve') reads.push(db.collection('users').doc(input.id));
  const [application, privateDoc, profile] = await tx.getAll(...reads);
  if (!application!.exists) throw panelError('application-not-found');
  const record = applicationRecord(input.id, application!.data() ?? {});
  if (record.round !== input.expected) throw panelError('stale-decision');
  if (input.submittedAt !== null && record.submittedAt !== input.submittedAt) {
    throw panelError('stale-decision');
  }
  const target = input.decision === 'approve' ? 'approved' : 'rejected';
  const done = { ok: true, subject: 'application', id: input.id, status: target } as const;
  // Já decidida do mesmo jeito (a recusa, com o mesmo motivo): a repetição.
  if (
    record.status === target &&
    (input.decision === 'approve' || record.rejectReason === input.reason)
  ) {
    return done;
  }
  if (record.status !== 'pending') throw panelError('stale-decision');
  const at = tsOf(now);
  const decidedBy = { uid: actor.uid, name: actor.name };

  if (input.decision === 'reject') {
    const canReapplyAt = reapplyAfterRejection(record.round, now);
    tx.update(appRef, {
      status: 'rejected',
      rejectReason: input.reason,
      decidedAt: at,
      decidedBy,
      canReapplyAt: canReapplyAt === null ? null : tsOf(canReapplyAt),
      history: historyField({
        ...record,
        history: withHistory(record.history, {
          round: record.round,
          decision: 'rejected',
          reason: input.reason,
          at: now,
        }),
      }),
    });
    if (privateDoc!.exists) tx.delete(privateRef);
    audit(
      tx,
      db,
      'fanClub.application.rejected',
      actor,
      { artistId: record.artistId, fanUid: input.id, round: record.round, reason: input.reason },
      at,
    );
    return done;
  }

  if (!profile!.exists) throw panelError('application-not-found');
  if (isSuspended(profile!)) throw panelError('owner-suspended');
  const artist = await requireOpenArtist(tx, db, record.artistId, record.submittedAt);
  const proposed = checkClubName(record.proposedName);
  const name = input.name ?? (proposed.ok ? proposed.name : null);
  if (name === null) throw invalid('name', { problem: proposed.ok ? null : proposed.reason });
  const copies = ownerCopiesOf(profile!.data() ?? {});
  const clubDoc = fanClubsOf(db).doc();
  tx.create(clubDoc, {
    artistId: artist.id,
    artistName: artist.name,
    ownerUid: input.id,
    ownerName: copies.name,
    ownerUsername: copies.username,
    ownerPhotoURL: copies.photoURL,
    name,
    status: 'active',
    statusReason: null,
    accountDeleted: false,
    applicationRound: record.round,
    approvedAt: at,
    approvedBy: decidedBy,
    pausedAt: null,
    closedAt: null,
    closedBy: null,
    postCount: 0,
    pendingPosts: 0,
    lastPostAt: null,
    counts: {
      followers: 0,
      followers30d: 0,
      newAccounts: 0,
      automaticUsername: 0,
      byOwnerCode: 0,
      joins: 0,
      retained: 0,
      signups: 0,
      visits: 0,
      links: 0,
      at: null,
    },
    monthStart: null,
    lastMonth: null,
    ...FEATURE_OFF,
    ...OFFICIAL_OFF,
    lastReward: null,
    createdAt: at,
    updatedAt: at,
    schemaVersion: 1,
  });
  tx.update(appRef, {
    status: 'approved',
    decidedAt: at,
    decidedBy,
    rejectReason: null,
    canReapplyAt: null,
    clubId: clubDoc.id,
    history: historyField({
      ...record,
      history: withHistory(record.history, {
        round: record.round,
        decision: 'approved',
        reason: null,
        at: now,
      }),
    }),
  });
  // O texto de divulgação cumpriu a finalidade (decisão 14); as redes ficam.
  if (privateDoc!.exists) tx.update(privateRef, { pitch: null });
  audit(
    tx,
    db,
    'fanClub.application.approved',
    actor,
    {
      clubId: clubDoc.id,
      artistId: artist.id,
      fanUid: input.id,
      round: record.round,
      nameChanged: name !== record.proposedName,
    },
    at,
  );
  return done;
}

// --- O fã-clube ----------------------------------------------------------------------

/** A decisão que não cabe no status de agora (Pausar um encerrado, por exemplo). */
const notInStatus = () => invalid('decision');

/** Os destacados de um artista com o prazo em dia, sem o próprio (o teto de 3, decisão 35). */
async function featuredOthers(
  tx: Transaction,
  db: Firestore,
  club: FanClubRecord,
  now: number,
): Promise<number> {
  const snap = await tx.get(
    fanClubsOf(db)
      .where('artistId', '==', club.artistId)
      .where('status', '==', 'active')
      .where('featured', '==', true),
  );
  return snap.docs.filter(
    (doc) => doc.id !== club.id && isFeaturedNow(fanClubRecord(doc.id, doc.data()), now),
  ).length;
}

/**
 * Pausar, reativar, encerrar, destacar, tirar o destaque, oficializar e tirar
 * a oficialização (34.5 e 34.23), na transação de quem chama: o fã-clube
 * (`fan-club-not-found`); o gestor é quem chama, `self`; a mesma decisão já
 * tomada (pausado pela equipe, reativado, encerrado com o mesmo motivo, o
 * mesmo prazo do destaque, sem destaque, oficial, sem o selo), `ok` sem
 * gravar; o status diferente do da tela, `stale-decision`; a decisão que não
 * cabe no status, `invalid-request` com `field: 'decision'`. Pausar e
 * encerrar tiram o destaque, e encerrar também o selo; reativar só do
 * pausado, com o gestor sem suspensão (`owner-suspended`) e o artista aberto
 * (`artist-not-open`); encerrar apaga o privado e marca a candidatura:
 * `closedByStaff` com `staff`, ou o `canReapplyAt` de 30 dias e a rodada 0
 * com `owner_request`. Oficializar só o ativo; tirar o selo, em qualquer
 * status.
 */
async function decideClub(
  tx: Transaction,
  db: Firestore,
  input: ClubDecisionInput,
  options: { actor: Actor; now: number },
): Promise<DecisionResult> {
  const { actor, now } = options;
  const ref = fanClubRef(db, input.id);
  const snap = await tx.get(ref);
  if (!snap.exists) throw panelError('fan-club-not-found');
  const club = fanClubRecord(snap.id, snap.data() ?? {});
  if (club.ownerUid !== null && club.ownerUid === actor.uid) throw panelError('self');
  const result = (status: FanClubStatus): DecisionResult => ({
    ok: true,
    subject: 'club',
    id: input.id,
    status,
  });
  // A repetição da mesma decisão (a nova tentativa do painel depois de uma
  // falha incerta): pausar, reativar e encerrar mudam o status que o
  // `expected` diz, e a mesma chamada de novo seria `stale-decision`. Vale só a
  // mesma decisão: pausado pela equipe, e encerrado com o mesmo motivo; a
  // pausa pela suspensão e o encerramento com outro motivo são outra decisão.
  const target =
    input.decision === 'pause'
      ? 'paused'
      : input.decision === 'resume'
        ? 'active'
        : input.decision === 'close'
          ? 'closed'
          : null;
  if (
    target !== null &&
    club.status === target &&
    (input.decision === 'pause'
      ? club.statusReason === 'staff'
      : input.decision === 'close'
        ? club.statusReason === input.reason
        : true)
  ) {
    return result(target);
  }
  if (club.status !== input.expected) throw panelError('stale-decision');
  const at = tsOf(now);
  const details = { clubId: club.id, artistId: club.artistId, fanUid: club.ownerUid };

  switch (input.decision) {
    case 'pause': {
      if (club.status !== 'active') throw notInStatus();
      tx.update(ref, {
        status: 'paused',
        statusReason: 'staff',
        pausedAt: at,
        ...FEATURE_OFF,
        updatedAt: at,
      });
      audit(tx, db, 'fanClub.paused', actor, details, at);
      return result('paused');
    }
    case 'resume': {
      if (club.status !== 'paused' || club.ownerUid === null) throw notInStatus();
      const profile = await tx.get(db.collection('users').doc(club.ownerUid));
      if (!profile.exists) throw notInStatus();
      if (isSuspended(profile)) throw panelError('owner-suspended');
      await requireOpenArtist(tx, db, club.artistId);
      tx.update(ref, { status: 'active', statusReason: null, pausedAt: null, updatedAt: at });
      audit(tx, db, 'fanClub.resumed', actor, details, at);
      return result('active');
    }
    case 'close': {
      if (club.status === 'closed') throw notInStatus();
      const owner = club.ownerUid;
      const application = owner ? await tx.get(applicationRef(db, owner)) : null;
      tx.update(ref, {
        status: 'closed',
        statusReason: input.reason,
        closedAt: at,
        closedBy: { uid: actor.uid, name: actor.name },
        ...FEATURE_OFF,
        ...OFFICIAL_OFF,
        updatedAt: at,
      });
      if (owner && application?.exists) {
        const record = applicationRecord(owner, application.data() ?? {});
        // Só a candidatura deste fã-clube: o privado de outra (uma pendente
        // nova) não é deste encerramento.
        if (record.clubId === club.id) {
          tx.update(
            application.ref,
            input.reason === 'staff'
              ? { closedByStaff: true }
              : { canReapplyAt: tsOf(now + FAN_CLUB_REAPPLY_MS), round: 0 },
          );
          tx.delete(applicationPrivateRef(db, owner));
        }
      }
      audit(tx, db, 'fanClub.closed', actor, { ...details, reason: input.reason }, at);
      return result('closed');
    }
    case 'feature': {
      if (club.status !== 'active') throw notInStatus();
      if (club.featured && club.featuredUntil === input.featuredUntil) return result('active');
      if ((await featuredOthers(tx, db, club, now)) >= FEATURED_PER_ARTIST_MAX) {
        throw panelError('feature-limit');
      }
      tx.update(ref, {
        featured: true,
        featuredAt: at,
        featuredUntil: input.featuredUntil,
        featuredBy: { uid: actor.uid, name: actor.name },
        updatedAt: at,
      });
      audit(
        tx,
        db,
        'fanClub.featured',
        actor,
        { ...details, featuredUntil: input.featuredUntil },
        at,
      );
      return result('active');
    }
    case 'unfeature': {
      if (!club.featured && club.featuredUntil === null) return result(club.status);
      tx.update(ref, { ...FEATURE_OFF, updatedAt: at });
      audit(tx, db, 'fanClub.unfeatured', actor, details, at);
      return result(club.status);
    }
    case 'officialize': {
      if (club.status !== 'active') throw notInStatus();
      if (club.official) return result('active');
      tx.update(ref, {
        official: true,
        officialAt: at,
        officialBy: { uid: actor.uid, name: actor.name },
        updatedAt: at,
      });
      audit(tx, db, 'fanClub.officialized', actor, details, at);
      return result('active');
    }
    case 'unofficialize': {
      if (!club.official) return result(club.status);
      tx.update(ref, { ...OFFICIAL_OFF, updatedAt: at });
      audit(tx, db, 'fanClub.unofficialized', actor, details, at);
      return result(club.status);
    }
  }
}

// --- O Recompensar -------------------------------------------------------------------

/** O contexto do Recompensar: quem dá (com o papel, para o orçamento do dia), os valores e o shard. */
export type RewardContext = {
  actor: Actor & { role: StaffRole };
  now: number;
  config: PointsConfig;
  shard: number;
  /** O sorteio do código do pedido de prêmio (`drawRedemptionCode`, fora do teste da colisão). */
  drawCode?: () => string;
};

/** As seções a mais do Recompensar (decisão 7): `fans` com pontos e `rewards` com prêmio. */
export function rewardSections(grant: RewardGrantInput): SectionId[] {
  return [
    ...(grant.points !== null ? (['fans'] as const) : []),
    ...(grant.prize !== null ? (['rewards'] as const) : []),
  ];
}

/**
 * O teto do papel nos pontos do Recompensar, o mesmo do Ajuste por lançamento
 * (decisão 45): `adjust-above-limit`, com o teto em `details.max`.
 */
export function assertGrantCap(grant: RewardGrantInput, role: StaffRole): void {
  if (grant.points !== null && grant.points > adjustMaxFor(role)) {
    throw aboveLimitError(adjustMaxFor(role));
  }
}

/**
 * O Recompensar (34.5), na transação de quem chama, com todas as leituras
 * antes das gravações. Primeiro o fã-clube (`fan-club-not-found`; o gestor é
 * quem chama, `self`); depois, num `getAll`, o registro
 * `fanClubs/{clubId}/prizes/{grantId}`, a candidatura, o perfil e a carteira
 * do gestor, com pontos o lançamento `fanclub_prize:<grantId>` e o
 * `staffLimits` de quem dá, e com prêmio a recompensa. O registro que já
 * existe com os mesmos campos (o cupom e a mensagem conferidos no pedido,
 * achado pelo `grantId`) responde o que foi feito, sem gravar; com outros, ou
 * o `grantId` já usado noutro fã-clube (o lançamento sem o registro, ou, com
 * prêmio, um pedido com ele), `grant-id-reused`. Depois, nesta ordem: o
 * status diferente do da tela, `stale-decision`; as três travas
 * (`prize-not-allowed`, com a que falhou em `details.problem`); a recompensa
 * (`reward-not-found`, `reward-not-prize`, `sold-out`); o orçamento do dia
 * do Ajuste (`adjust-daily-limit`); o plano com o `adjust` de origem
 * `fanclub_prize`, só no saldo. Grava o pedido de prêmio (`grantPrize`), o
 * registro, o `lastReward`, a soma no orçamento e a auditoria
 * `fanClub.rewarded`, nunca com o cupom nem a mensagem.
 */
export async function applyRewardDecision(
  tx: Transaction,
  db: Firestore,
  input: RewardDecisionInput,
  ctx: RewardContext,
): Promise<RewardDecisionResult> {
  const { actor, now, config } = ctx;
  const { grant } = input;
  const clubSnap = await tx.get(fanClubRef(db, input.id));
  if (!clubSnap.exists) throw panelError('fan-club-not-found');
  const club = fanClubRecord(clubSnap.id, clubSnap.data() ?? {});
  if (club.ownerUid !== null && club.ownerUid === actor.uid) throw panelError('self');
  const owner = club.ownerUid;
  const entryId = ledgerId({ source: 'fanclub_prize', eventId: grant.grantId });

  // Os lugares do getAll: o registro sempre; o resto só com o que ele pede.
  const refs: DocumentReference[] = [fanClubPrizeRef(db, club.id, grant.grantId)];
  const at = (ref: DocumentReference) => refs.push(ref) - 1;
  const appAt = owner ? at(applicationRef(db, owner)) : -1;
  const profileAt = owner ? at(db.collection('users').doc(owner)) : -1;
  const walletAt = owner ? at(walletRef(db, owner)) : -1;
  const ledgerAt = owner && grant.points !== null ? at(ledgerRef(db, owner, entryId)) : -1;
  const limitAt = grant.points !== null ? at(staffLimitRef(db, actor.uid, now)) : -1;
  const rewardAt = grant.prize !== null ? at(rewardRef(db, grant.prize.rewardId)) : -1;
  const snaps = await tx.getAll(...refs);
  const snap = (index: number) => (index >= 0 ? snaps[index]! : null);

  const result = (code: string | null, points: number | null): RewardDecisionResult => ({
    ok: true,
    subject: 'club',
    id: club.id,
    status: club.status,
    grantId: grant.grantId,
    code,
    points,
  });

  // A repetição (a nova tentativa do painel): o registro já gravado.
  const stored = snaps[0]!;
  if (stored.exists) {
    const record = fanClubPrizeRecord(stored.id, stored.data() ?? {});
    const orders = record.prize
      ? await tx.get(redemptionsRef(db).where('grantId', '==', grant.grantId).limit(1))
      : null;
    const order = orders?.docs[0]
      ? redemptionRecord(orders.docs[0].id, orders.docs[0].data())
      : null;
    const kept = order && !order.accountDeleted ? order : null;
    if (!sameRewardGrant(record, grant, kept)) throw panelError('grant-id-reused');
    return result(order?.code ?? null, record.points);
  }
  // O mesmo `grantId` noutro fã-clube: o lançamento do mesmo gestor, ou um
  // pedido de prêmio de outro. O painel com `rewards` acha o pedido só pelo
  // `grantId`, e a repetição acima também: ele tem de ser único entre os pedidos.
  if (snap(ledgerAt)?.exists) throw panelError('grant-id-reused');
  if (grant.prize !== null) {
    const taken = await tx.get(redemptionsRef(db).where('grantId', '==', grant.grantId).limit(1));
    if (!taken.empty) throw panelError('grant-id-reused');
  }

  if (club.status !== input.expected) throw panelError('stale-decision');
  const profile = snap(profileAt);
  const application = snap(appAt);
  const block = prizeBlock({
    club,
    adultDeclared:
      application?.exists === true &&
      applicationRecord(owner!, application.data() ?? {}).adultDeclared,
    ownerSuspended: profile?.exists === true && isSuspended(profile),
  });
  if (block) throw panelError('prize-not-allowed', { problem: block });
  if (!profile?.exists) throw panelError('fan-not-found');

  const rewardSnap = snap(rewardAt);
  const reward = rewardSnap ? rewardOf(rewardSnap) : null;
  if (grant.prize !== null) {
    const problem = prizeRewardProblem(reward);
    if (problem === 'reward-not-prize') throw panelError('reward-not-prize');
    if (problem) throw rewardPanelError(problem);
  }

  const limit =
    grant.points !== null
      ? checkStaffLimit(parseStaffLimit(snap(limitAt)!.data(), dayKey(now)), {
          kind: 'adjust',
          deltas: { balance: grant.points },
          dailyMax: adjustDailyMaxFor(actor.role),
        })
      : null;
  if (limit && !limit.ok) {
    if (limit.reason === 'adjust-daily-limit')
      throw dailyLimitError(limit.counter, limit.remaining);
    throw panelError('invalid-request');
  }

  const fan = await requireFan(tx, db, owner!, profile, snap(walletAt)!, now, {
    markActivity: false,
  });
  const award: AwardContext = {
    now,
    config,
    shard: ctx.shard,
    actor: { type: 'staff', uid: actor.uid, name: actor.name },
    game: NO_GAME,
  };
  const entries: AwardEntry[] =
    grant.points !== null
      ? [
          {
            kind: 'adjust',
            source: 'fanclub_prize',
            eventId: grant.grantId,
            balance: grant.points,
            note: grant.note,
          },
        ]
      : [];
  const plan = await planAwards(
    tx,
    db,
    entries.length > 0 ? [{ uid: owner!, fan, entries }] : [],
    award,
  );
  if (grant.points !== null) {
    const applied = plan.results.find((item) => item.entryId === entryId);
    if (applied?.status !== 'applied') {
      // A leitura do extrato acima vem da mesma transação: não acontece.
      throw new Error(
        `O prêmio ${entryId} não foi aplicado: ${applied?.status ?? 'sem resultado'}.`,
      );
    }
  }

  // As gravações, depois de todas as leituras.
  const stamp = tsOf(now);
  const by = { uid: actor.uid, name: actor.name };
  const code = grant.prize !== null ? (ctx.drawCode ?? drawRedemptionCode)() : null;
  if (grant.prize !== null && reward && code !== null) {
    const copies = ownerCopiesOf(profile.data() ?? {});
    grantPrize(tx, db, plan, {
      reward,
      owner: { uid: owner!, name: copies.name, username: copies.username },
      clubId: club.id,
      grantId: grant.grantId,
      delivered: grant.prize.delivered,
      coupon: grant.prize.coupon,
      message: grant.prize.message,
      by,
      now,
      code,
    });
  }
  tx.create(fanClubPrizeRef(db, club.id, grant.grantId), {
    grantId: grant.grantId,
    clubId: club.id,
    artistId: club.artistId,
    points: grant.points,
    ledgerId: grant.points !== null ? entryId : null,
    prize:
      grant.prize !== null && reward
        ? {
            rewardId: reward.id,
            rewardTitle: reward.title,
            rewardKind: reward.kind,
            delivered: grant.prize.delivered,
          }
        : null,
    note: grant.note,
    by,
    at: stamp,
    schemaVersion: 1,
  });
  tx.update(clubSnap.ref, {
    lastReward: { at: stamp, points: grant.points, prize: grant.prize !== null },
    updatedAt: stamp,
  });
  if (limit?.ok) addStaffLimit(tx, db, actor.uid, now, limit.next);
  audit(
    tx,
    db,
    'fanClub.rewarded',
    actor,
    {
      clubId: club.id,
      artistId: club.artistId,
      fanUid: owner,
      grantId: grant.grantId,
      points: grant.points,
      rewardId: grant.prize?.rewardId ?? null,
      code,
      note: grant.note,
    },
    stamp,
  );
  applyAwards(tx, db, plan);
  return result(code, grant.points);
}

// --- A publicação --------------------------------------------------------------------

/**
 * O que a mesma decisão de novo refaz depois da transação: recusar apaga os
 * arquivos de novo, ocultar troca o token de novo e relê, reexibir relê.
 * Apagar o que já saiu e trocar de novo o token de uma oculta não fazem mal.
 */
function repeatedPostWork(
  decision: (typeof POST_DECISIONS)[number],
  postId: string,
  paths: string[],
): FanClubFileWork {
  switch (decision) {
    case 'reject':
      return { ...NO_FILE_WORK, remove: paths };
    case 'hide':
      return { ...NO_FILE_WORK, rotate: paths, refresh: [postId] };
    case 'restore':
      return { ...NO_FILE_WORK, refresh: [postId] };
    case 'approve':
      return NO_FILE_WORK;
  }
}

/** O status que cada decisão da publicação deixa, e de onde ela sai (34.5). */
const POST_TARGET = {
  approve: 'published',
  reject: 'rejected',
  hide: 'hidden',
  restore: 'published',
} as const satisfies Record<(typeof POST_DECISIONS)[number], FanClubPostStatus>;

const POST_FROM = {
  approve: 'pending',
  reject: 'pending',
  hide: 'published',
  restore: 'hidden',
} as const satisfies Record<(typeof POST_DECISIONS)[number], FanClubPostStatus>;

const POST_AUDIT = {
  approve: 'fanClub.post.approved',
  reject: 'fanClub.post.rejected',
  hide: 'fanClub.post.hidden',
  restore: 'fanClub.post.restored',
} as const satisfies Record<(typeof POST_DECISIONS)[number], AuditAction>;

/**
 * A mídia com as URLs de agora, lidas no Storage (o `restore`: o ocultar
 * trocou o token, e a URL guardada não abre mais). Leituras, antes de
 * qualquer gravação da transação.
 */
async function freshMedia(files: FanPhotoFiles, media: PostMedia): Promise<PostMedia> {
  const [photo, thumb] = await Promise.all([
    files.downloadUrl(media.photo.path),
    files.downloadUrl(media.thumb.path),
  ]);
  return { photo: { ...media.photo, url: photo }, thumb: { ...media.thumb, url: thumb } };
}

/**
 * Aprovar, recusar, ocultar e reexibir a publicação (34.5), na transação de
 * quem chama: a publicação (`fan-club-post-not-found`); o autor é quem chama,
 * `self`; a mesma decisão já tomada (a recusa com o mesmo motivo), `ok` sem
 * gravar; o status diferente do da tela, `stale-decision`; a decisão que não
 * cabe no status, `invalid-request` com `field: 'decision'`. Aprovar:
 * `published`, o `pendingPosts` menos 1, o `postCount` mais 1 e o
 * `lastPostAt`. Recusar: `rejected` com o motivo, o `pendingPosts` menos 1 e
 * os arquivos apagados depois da transação. Ocultar: `hidden`, o `postCount`
 * menos 1 e os tokens trocados depois da transação. Reexibir: `published`, o
 * `postCount` mais 1 e as URLs novas na `media`. A auditoria leva o id da
 * publicação em `fanClubPostId` (nunca em `postId`, que é o do Mural) e nunca
 * o texto.
 */
async function decidePost(
  tx: Transaction,
  db: Firestore,
  input: Extract<DecisionInput, { subject: 'post' }>,
  options: { actor: Actor; now: number; files: FanPhotoFiles },
): Promise<Decided> {
  const { actor, now, files } = options;
  const ref = fanClubPostRef(db, input.id);
  const snap = await tx.get(ref);
  if (!snap.exists) throw panelError('fan-club-post-not-found');
  const post = fanClubPostRecord(snap.id, snap.data() ?? {});
  if (post.authorUid === actor.uid) throw panelError('self');
  const target = POST_TARGET[input.decision];
  const done: Decided = {
    result: { ok: true, subject: 'post', id: input.id, status: target },
    files: NO_FILE_WORK,
  };
  const paths = postMediaPaths(post);
  if (
    post.status === target &&
    (input.decision !== 'reject' || post.rejectReason === input.reason)
  ) {
    // A repetição (a nova tentativa do painel) refaz o que fica para depois da
    // transação, sem gravar: a troca do token ou a remoção que pode ter
    // falhado, e a releitura das URLs da reexibida.
    return { ...done, files: repeatedPostWork(input.decision, post.id, paths) };
  }
  if (post.status !== input.expected) throw panelError('stale-decision');
  if (post.status !== POST_FROM[input.decision]) throw notInStatus();
  const clubSnap = await tx.get(fanClubRef(db, post.clubId));
  const club = clubSnap.exists ? fanClubRecord(clubSnap.id, clubSnap.data() ?? {}) : null;
  const media =
    input.decision === 'restore' && post.media ? await freshMedia(files, post.media) : null;

  const at = tsOf(now);
  const reviewed = { reviewedAt: at, reviewedBy: { uid: actor.uid, name: actor.name } };
  let work: FanClubFileWork = NO_FILE_WORK;
  switch (input.decision) {
    case 'approve':
      tx.update(ref, { status: 'published', publishedAt: at, ...reviewed });
      if (club) {
        tx.update(clubSnap.ref, {
          pendingPosts: Math.max(0, club.pendingPosts - 1),
          postCount: club.postCount + 1,
          lastPostAt: at,
          updatedAt: at,
        });
      }
      break;
    case 'reject':
      tx.update(ref, { status: 'rejected', rejectReason: input.reason, ...reviewed });
      if (club) {
        tx.update(clubSnap.ref, {
          pendingPosts: Math.max(0, club.pendingPosts - 1),
          updatedAt: at,
        });
      }
      work = { ...NO_FILE_WORK, remove: paths };
      break;
    case 'hide':
      tx.update(ref, { status: 'hidden', ...reviewed });
      if (club) {
        tx.update(clubSnap.ref, { postCount: Math.max(0, club.postCount - 1), updatedAt: at });
      }
      // Relida depois da troca: alguém pode reexibir antes de ela terminar.
      work = { ...NO_FILE_WORK, rotate: paths, refresh: [post.id] };
      break;
    case 'restore':
      tx.update(ref, { status: 'published', ...(media ? { media } : {}), ...reviewed });
      if (club) tx.update(clubSnap.ref, { postCount: club.postCount + 1, updatedAt: at });
      // Relida depois da transação: um ocultar de antes pode trocar o token depois desta leitura.
      work = { ...NO_FILE_WORK, refresh: [post.id] };
      break;
  }
  audit(
    tx,
    db,
    POST_AUDIT[input.decision],
    actor,
    {
      fanClubPostId: post.id,
      clubId: post.clubId,
      artistId: post.artistId,
      authorUid: post.authorUid,
      reason: input.decision === 'reject' ? input.reason : null,
    },
    at,
  );
  return { ...done, files: work };
}

// --- A denúncia ----------------------------------------------------------------------

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * Manter ou Ocultar a publicação denunciada (34.5), na transação de quem
 * chama: o item da `fanClubReportQueue` e a publicação num `getAll`. Sem o
 * item, ou resolvido com `withdrawn` ou `author_deleted` (não há o que a
 * equipe decidir): `fan-club-report-not-found`. O autor é quem chama, `self`.
 * A rodada diferente da do item: `stale-decision`. Já resolvido com a mesma
 * resolução: `ok` sem gravar nem auditar. `keep` resolve com `kept`; `action`
 * resolve com `actioned` e, com a publicação ainda no ar, a oculta na mesma
 * transação (o `postCount` menos 1 e os tokens trocados depois); em outro
 * status, só resolve. Trocar `kept` por `actioned`, ou o contrário, na mesma
 * rodada vale, como na denúncia de perfil (29.6). A auditoria
 * `fanClub.report.resolved` leva a resolução, a contagem, a rodada e se a
 * publicação foi ocultada agora, nunca o texto.
 */
async function decideReport(
  tx: Transaction,
  db: Firestore,
  input: Extract<DecisionInput, { subject: 'report' }>,
  options: { actor: Actor; now: number },
): Promise<Decided> {
  const { actor, now } = options;
  const postRef = fanClubPostRef(db, input.id);
  const [item, postSnap] = await tx.getAll(fanClubReportQueueRef(db, input.id), postRef);
  if (!item!.exists) throw panelError('fan-club-report-not-found');
  const status = item!.get('status');
  const current = item!.get('resolution');
  if (status !== 'open' && (current === 'withdrawn' || current === 'author_deleted')) {
    throw panelError('fan-club-report-not-found');
  }
  const post = postSnap!.exists ? fanClubPostRecord(postSnap!.id, postSnap!.data() ?? {}) : null;
  const authorUid = post?.authorUid ?? item!.get('authorUid');
  if (authorUid === actor.uid) throw panelError('self');
  if (item!.get('round') !== input.expected) throw panelError('stale-decision');
  const resolution = input.decision === 'keep' ? 'kept' : 'actioned';
  const done: Decided = {
    result: { ok: true, subject: 'report', id: input.id, status: 'resolved' },
    files: NO_FILE_WORK,
  };
  if (status === 'resolved' && current === resolution) {
    // A repetição do Ocultar refaz a troca do token da publicação oculta.
    return resolution === 'actioned' && post?.status === 'hidden'
      ? { ...done, files: { ...NO_FILE_WORK, rotate: postMediaPaths(post), refresh: [post.id] } }
      : done;
  }

  const hide = resolution === 'actioned' && post?.status === 'published';
  const clubSnap = hide && post ? await tx.get(fanClubRef(db, post.clubId)) : null;
  const at = tsOf(now);
  const by = { uid: actor.uid, name: actor.name };
  let work: FanClubFileWork = NO_FILE_WORK;
  if (hide && post) {
    tx.update(postRef, { status: 'hidden', reviewedAt: at, reviewedBy: by });
    if (clubSnap?.exists) {
      const club = fanClubRecord(clubSnap.id, clubSnap.data() ?? {});
      tx.update(clubSnap.ref, { postCount: Math.max(0, club.postCount - 1), updatedAt: at });
    }
    work = { ...NO_FILE_WORK, rotate: postMediaPaths(post), refresh: [post.id] };
  }
  tx.update(item!.ref, { status: 'resolved', resolution, resolvedAt: at, resolvedBy: by });
  audit(
    tx,
    db,
    'fanClub.report.resolved',
    actor,
    {
      fanClubPostId: input.id,
      clubId: post?.clubId ?? item!.get('clubId') ?? null,
      resolution,
      reportCount: countOf(item!.get('reportCount')),
      round: input.expected,
      postHidden: hide,
    },
    at,
  );
  return { ...done, files: work };
}

// --- O comentário (seção 37, 37.6) -----------------------------------------------------

/** A auditoria de cada decisão do comentário. */
const COMMENT_AUDIT = {
  keep: 'fanClub.comment.kept',
  hide: 'fanClub.comment.hidden',
  restore: 'fanClub.comment.restored',
} as const satisfies Record<CommentDecision, AuditAction>;

/**
 * Manter, ocultar e reexibir um comentário de fã-clube (37.6, a tabela das
 * decisões), na transação de quem chama: o comentário e o item da fila num
 * `getAll` (sem o comentário, `fan-club-comment-not-found`); depois, noutro, o
 * fã-clube, a publicação e o de cima da resposta (os contadores). O autor e o
 * gestor do fã-clube, que é parte do ocultar, são quem chama: `self`. A
 * repetição (ocultar o oculto pela equipe e reexibir o visível) responde `ok`
 * sem gravar nem auditar. O status diferente do da tela e, com a `round`, a
 * rodada diferente da do item (o `keep` não muda o status: só a rodada barra
 * o Manter de uma tela velha sobre uma rodada aberta depois da leitura), dão
 * `stale-decision`. O `keep` sem item aberto também responde `ok` sem gravar;
 * com ele, resolve o item com `kept` e, no `manager_hidden`, grava o
 * `reviewOutcome: 'kept'` ("A equipe manteve oculto"). O `hide` leva o
 * `visible` e o `manager_hidden` a `staff_hidden`, e o `restore` leva os dois
 * ocultos a `visible`, com o `restoredByStaffAt` (o gestor não oculta de novo,
 * decisão 21); os dois com os contadores e o item aberto resolvido (`hidden`
 * ou `restored`; com a `round`, também o resolvido naquela rodada troca de
 * resolução, como na denúncia de publicação). A auditoria vai na mesma
 * transação, com o comentário em `fanClubCommentId` e a publicação em
 * `fanClubPostId` (nunca em `commentId` nem em `postId`, os alvos do Mural), o
 * gestor em `fanUid`, o status de antes e a rodada do item resolvido; nunca o
 * texto.
 */
async function decideComment(
  tx: Transaction,
  db: Firestore,
  input: Extract<DecisionInput, { subject: 'comment' }>,
  options: { actor: Actor; now: number },
): Promise<DecisionResult> {
  const { actor, now } = options;
  const itemRef = fanClubCommentQueueRef(db, input.id);
  const [commentSnap, itemSnap] = await tx.getAll(fanClubCommentRef(db, input.id), itemRef);
  if (!commentSnap!.exists) throw panelError('fan-club-comment-not-found');
  const comment = fanClubCommentRecord(commentSnap!.id, commentSnap!.data() ?? {});
  const scene = await readCommentScene(
    tx,
    db,
    [comment],
    isContentId(comment.clubId) ? [fanClubRef(db, comment.clubId)] : [],
  );
  const clubSnap = scene.extra[0];
  const ownerUid = clubSnap?.exists
    ? fanClubRecord(clubSnap.id, clubSnap.data() ?? {}).ownerUid
    : null;
  if (comment.authorUid === actor.uid || (ownerUid !== null && ownerUid === actor.uid)) {
    throw panelError('self');
  }
  const target: FanClubCommentStatus =
    input.decision === 'keep'
      ? comment.status
      : input.decision === 'hide'
        ? 'staff_hidden'
        : 'visible';
  const done: DecisionResult = { ok: true, subject: 'comment', id: input.id, status: target };
  // A repetição (a nova tentativa do painel): o status que a decisão deixa já está lá.
  if (input.decision !== 'keep' && comment.status === target) return done;
  if (comment.status !== input.expected) throw panelError('stale-decision');
  const item = itemSnap!.exists ? commentQueueRecord(itemSnap!.data() ?? {}) : null;
  if (input.round !== null && item?.round !== input.round) throw panelError('stale-decision');
  const open = item?.status === 'open';
  if (input.decision === 'keep' && !open) return done;
  // Com a rodada da tela, o item daquela rodada recebe a resolução, aberto ou já resolvido.
  const resolves = item !== null && (open || input.round !== null);
  const at = tsOf(now);
  if (input.decision === 'keep') {
    tx.update(itemRef, {
      status: 'resolved',
      resolution: 'kept',
      resolvedAt: at,
      resolvedBy: { uid: actor.uid, name: actor.name },
    });
    if (comment.status === 'manager_hidden') {
      tx.update(commentSnap!.ref, { reviewOutcome: 'kept' });
    }
  } else {
    writeStaffStatus(tx, db, [{ comment, item, itemRef, resolve: resolves }], scene, {
      to: input.decision === 'hide' ? 'staff_hidden' : 'visible',
      actor,
      now,
    });
  }
  audit(
    tx,
    db,
    COMMENT_AUDIT[input.decision],
    actor,
    {
      fanClubCommentId: comment.id,
      fanClubPostId: comment.postId || null,
      clubId: comment.clubId || null,
      authorUid: comment.authorUid || null,
      fanUid: ownerUid,
      from: comment.status,
      round: resolves ? item.round : null,
    },
    at,
  );
  return done;
}

/**
 * O núcleo, na transação de quem chama (a callable, o seed e os testes): a
 * decisão e o que fica para depois da transação (só as publicações mexem em
 * arquivo). Sem o Storage (`files`), as decisões que leem uma foto falham; sem
 * o `reward` (o papel de quem dá, os valores e o shard), o Recompensar falha.
 */
export async function applyFanClubDecision(
  tx: Transaction,
  db: Firestore,
  input: DecisionInput,
  options: {
    actor: Actor;
    now: number;
    files?: FanPhotoFiles;
    reward?: Omit<RewardContext, 'actor' | 'now'> & { role: StaffRole };
  },
): Promise<Decided> {
  const { actor, now } = options;
  switch (input.subject) {
    case 'application':
      return {
        result: await decideApplication(tx, db, input, { actor, now }),
        files: NO_FILE_WORK,
      };
    case 'club':
      if (input.decision === 'reward') {
        if (!options.reward) throw new Error('O Recompensar pede o papel, os valores e o shard.');
        const { role, ...reward } = options.reward;
        return {
          result: await applyRewardDecision(tx, db, input, {
            ...reward,
            actor: { ...actor, role },
            now,
          }),
          files: NO_FILE_WORK,
        };
      }
      return { result: await decideClub(tx, db, input, { actor, now }), files: NO_FILE_WORK };
    case 'post':
      return decidePost(tx, db, input, {
        actor,
        now,
        files: options.files ?? MISSING_FAN_PHOTO_FILES,
      });
    case 'report':
      return decideReport(tx, db, input, { actor, now });
    case 'comment':
      return { result: await decideComment(tx, db, input, { actor, now }), files: NO_FILE_WORK };
  }
}

/**
 * decideFanClub (34.3): `{ subject, id, decision, expected, ... }`, com a
 * seção `fanClubs` e edição, lida direto e de novo na transação. Sem login,
 * `unauthenticated`; o assunto fora da lista, `invalid-request` com
 * `field: 'subject'`; o id fora do formato, com `field: 'id'`; a própria
 * candidatura, `self` (o próprio fã-clube, a própria publicação e a denúncia
 * dela, e o comentário do qual quem chama é o autor ou o gestor, na
 * transação). Encerrar, oficializar e tirar a oficialização pedem o
 * papel admin (`admin-only`, 34.23). O
 * Recompensar pede também, fora e de novo na transação, a seção `fans` com
 * pontos e a `rewards` com prêmio, e confere o teto do papel nos pontos
 * (`adjust-above-limit`), com a transação dentro do `retryOnAlreadyExists`: o
 * código sorteado que já existe dá `ALREADY_EXISTS`, e a nova tentativa
 * sorteia outro (34.19). Depois da transação, os arquivos da publicação
 * recusada saem e os tokens da ocultada mudam (a falha vai ao log: a decisão
 * já valeu). Saída `{ ok: true, subject, id, status }`, e no Recompensar com o
 * `grantId`, o `code` e os `points`.
 */
export async function decideFanClub(
  deps: FanClubPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<DecisionResult> {
  const { db } = deps;
  if (!caller) throw panelAccessError('unauthenticated');
  const fields = requestFields(data);
  const subject = fields.subject;
  if (!(DECISION_SUBJECTS as readonly unknown[]).includes(subject)) throw invalid('subject');
  let id: string;
  if (subject === 'application') {
    try {
      id = targetFanUid(caller, fields.id);
    } catch (error) {
      // O `targetFanUid` diz `field: 'uid'`; aqui o campo é o `id`.
      if ((error as { details?: { reason?: unknown } }).details?.reason === 'invalid-request') {
        throw invalid('id');
      }
      throw error;
    }
  } else {
    if (!isContentId(fields.id)) throw invalid('id');
    id = fields.id;
  }
  const direct = await readPanelActor(directRead, db, caller, 'fanClubs', 'edit');
  const now = (deps.now ?? Date.now)();
  const input = parseDecision(subject as DecisionSubject, id, fields, now);
  const adminOnly = ADMIN_DECISIONS.includes(input.decision);
  if (adminOnly && direct.role !== 'admin') throw panelAccessError('admin-only');
  if (input.decision === 'reward') return rewardFanClub(deps, caller, input, direct, now);
  const decided = await db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'fanClubs', 'edit');
    if (adminOnly && actor.role !== 'admin') throw panelAccessError('admin-only');
    return applyFanClubDecision(tx, db, input, {
      actor,
      now,
      ...(deps.files ? { files: deps.files } : {}),
    });
  });
  await runFanClubFileWork(db, deps.files ?? MISSING_FAN_PHOTO_FILES, decided.files);
  return decided.result;
}

/**
 * O Recompensar da callable: as seções a mais e o teto do papel, fora e de
 * novo na transação, os valores dos pontos (só a versão entra no lançamento)
 * e a transação no `retryOnAlreadyExists`, com o shard sorteado de novo a cada
 * tentativa.
 */
async function rewardFanClub(
  deps: FanClubPanelDeps,
  caller: CallerAuth | undefined,
  input: RewardDecisionInput,
  direct: PanelActor,
  now: number,
): Promise<RewardDecisionResult> {
  const { db } = deps;
  const sections = rewardSections(input.grant);
  for (const section of sections) await readPanelActor(directRead, db, caller, section, 'edit');
  assertGrantCap(input.grant, direct.role);
  if (!deps.config) throw new Error('O Recompensar pede os valores dos pontos (config).');
  const { points: config } = await deps.config.get();
  const random = deps.random ?? Math.random;
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx) => {
      const actor = await readPanelActor(transactionRead(tx), db, caller, 'fanClubs', 'edit');
      for (const section of sections) {
        await readPanelActor(transactionRead(tx), db, caller, section, 'edit');
      }
      assertGrantCap(input.grant, actor.role);
      return applyRewardDecision(tx, db, input, {
        actor,
        now,
        config,
        shard: pickShard(random),
        ...(deps.drawCode ? { drawCode: deps.drawCode } : {}),
      });
    }),
  );
}

/**
 * A decisão fora do painel, com um ator dado (o seed dos emuladores). Sem
 * conferir o acesso nem o teto do papel. Com `files`, os arquivos mudam
 * depois da transação, como na callable. O Recompensar pede o `config` (os
 * valores dos pontos) e usa o papel dado (o admin do seed, sem orçamento do
 * dia), dentro do `retryOnAlreadyExists`, como na callable.
 */
export async function runFanClubDecision(
  db: Firestore,
  input: DecisionInput,
  options: {
    actor: Actor;
    now?: number;
    files?: FanPhotoFiles;
    config?: PointsConfig;
    role?: StaffRole;
    random?: () => number;
  },
): Promise<DecisionResult> {
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  const decided = await retryOnAlreadyExists(() =>
    db.runTransaction((tx) =>
      applyFanClubDecision(tx, db, input, {
        actor: options.actor,
        now,
        ...(options.files ? { files: options.files } : {}),
        ...(options.config
          ? {
              reward: {
                role: options.role ?? 'admin',
                config: options.config,
                shard: pickShard(random),
              },
            }
          : {}),
      }),
    ),
  );
  if (options.files) await runFanClubFileWork(db, options.files, decided.files);
  return decided.result;
}
