import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { artistRecord, isPublished } from '../centrals/model';
import { artistRef } from '../centrals/service';
import { isContentId } from '../page-cursor';
import { requestFields } from '../staff/model';
import {
  directRead,
  panelAccessError,
  readPanelActor,
  transactionRead,
  type PanelActor,
} from '../staff/panel-actor';
import { panelError, targetFanUid } from '../staff/panel-errors';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import {
  APPLICATION_REJECT_REASONS,
  applicationRecord,
  checkClubName,
  CLOSE_REASONS,
  FAN_CLUB_REAPPLY_MS,
  FAN_CLUB_STATUSES,
  FEATURED_PER_ARTIST_MAX,
  fanClubBoxes,
  fanClubRecord,
  isFeaturedNow,
  millisOf,
  parseFeaturedUntil,
  reapplyAfterRejection,
  withHistory,
  type ApplicationRecord,
  type ApplicationRejectReason,
  type CloseReason,
  type FanClubRecord,
  type FanClubStatus,
} from './model';
import {
  applicationPrivateRef,
  applicationRef,
  FEATURE_OFF,
  fanClubRef,
  fanClubsOf,
  ownerCopiesOf,
} from './store';

// A callable do painel do fã-clube (docs/arquitetura-api.md, seção 34, 34.3 e
// 34.5): `decideFanClub`, uma só para todos os assuntos (decisão 6), com a
// seção fanClubs e edição, lida direto e de novo na transação (o Leitor não
// decide), e a auditoria na mesma transação. O molde é o do
// `resolveProfileReport`: o estado que a tela mostrou (`expected`) diferente
// do de agora é `stale-decision`; nada a mudar, `ok` sem gravar nem auditar.
// Esta etapa (34.14, etapa 1) decide a candidatura e o fã-clube; as
// publicações, as denúncias e o Recompensar chegam nas etapas 2 e 5.

/** Os assuntos que esta etapa decide. */
export const DECISION_SUBJECTS = ['application', 'club'] as const;
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
      decision: 'pause' | 'resume' | 'unfeature';
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
    };

export type DecisionResult = {
  ok: true;
  subject: DecisionSubject;
  id: string;
  /** O status do assunto depois da decisão (da candidatura ou do fã-clube). */
  status: string;
};

const invalid = (field: string, extra: Record<string, unknown> = {}) =>
  panelError('invalid-request', { field, ...extra });

const CLUB_DECISIONS = ['pause', 'resume', 'close', 'feature', 'unfeature'] as const;

/**
 * O corpo da callable depois do assunto e do id (puro): a decisão da lista do
 * assunto, o `expected` (a rodada, inteiro de 0 em diante, na candidatura; o
 * status, no fã-clube) e os campos de cada decisão (34.3); senão
 * `invalid-request` com o campo. Na candidatura, o `submittedAt` opcional (o
 * da tela, em ms). O nome da aprovação passa pelas regras da candidatura
 * (`checkClubName`), com o motivo no `details.problem`.
 */
export function parseDecision(
  subject: DecisionSubject,
  id: string,
  fields: Record<string, unknown>,
  now: number,
): DecisionInput {
  const { decision, expected } = fields;
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
  return {
    subject,
    id,
    decision: decision as 'pause' | 'resume' | 'unfeature',
    expected: status,
  };
}

export type FanClubPanelDeps = {
  db: Firestore;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
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
 * Pausar, reativar, encerrar, destacar e tirar o destaque (34.5), na
 * transação de quem chama: o fã-clube (`fan-club-not-found`); o gestor é quem
 * chama, `self`; a mesma decisão já tomada (pausado pela equipe, reativado,
 * encerrado com o mesmo motivo, o mesmo prazo do destaque, sem destaque),
 * `ok` sem gravar; o status diferente do da tela, `stale-decision`; a decisão
 * que não cabe no status, `invalid-request` com `field: 'decision'`. Pausar e encerrar tiram o
 * destaque; reativar só do pausado, com o gestor sem suspensão
 * (`owner-suspended`) e o artista aberto (`artist-not-open`); encerrar apaga
 * o privado e marca a candidatura: `closedByStaff` com `staff`, ou o
 * `canReapplyAt` de 30 dias e a rodada 0 com `owner_request`.
 */
async function decideClub(
  tx: Transaction,
  db: Firestore,
  input: Extract<DecisionInput, { subject: 'club' }>,
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
  }
}

/** O núcleo, na transação de quem chama (a callable, o seed e os testes). */
export function applyFanClubDecision(
  tx: Transaction,
  db: Firestore,
  input: DecisionInput,
  options: { actor: Actor; now: number },
): Promise<DecisionResult> {
  return input.subject === 'application'
    ? decideApplication(tx, db, input, options)
    : decideClub(tx, db, input, options);
}

/**
 * decideFanClub (34.3): `{ subject, id, decision, expected, ... }`, com a
 * seção `fanClubs` e edição, lida direto e de novo na transação. Sem login,
 * `unauthenticated`; o assunto fora da lista, `invalid-request` com
 * `field: 'subject'`; o id fora do formato, com `field: 'id'`; a própria
 * candidatura, `self` (o próprio fã-clube, na transação). Encerrar pede o
 * papel admin (`admin-only`). Saída `{ ok: true, subject, id, status }`.
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
  if (input.decision === 'close' && direct.role !== 'admin') throw panelAccessError('admin-only');
  return db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'fanClubs', 'edit');
    if (input.decision === 'close' && actor.role !== 'admin') {
      throw panelAccessError('admin-only');
    }
    return applyFanClubDecision(tx, db, input, { actor, now });
  });
}

/** A decisão fora do painel, com um ator dado (o seed dos emuladores). Sem conferir o acesso. */
export function runFanClubDecision(
  db: Firestore,
  input: DecisionInput,
  options: { actor: Actor; now?: number },
): Promise<DecisionResult> {
  return db.runTransaction((tx) =>
    applyFanClubDecision(tx, db, input, { actor: options.actor, now: options.now ?? Date.now() }),
  );
}
