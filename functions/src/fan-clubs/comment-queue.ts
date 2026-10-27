import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';

import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import {
  emptyReasons,
  ModerationError,
  reasonKey,
  reasonsOf,
  REPORT_REASONS,
  type ReasonCounts,
  type ReportReason,
} from '../moderation/model';
import { isContentId } from '../page-cursor';
import {
  addEngagementCounts,
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import {
  addStatusChange,
  commentCountStates,
  commentQueueRecord,
  emptyCountChanges,
  FanClubError,
  fanClubCommentNotFound,
  fanClubCommentRecord,
  fanClubRecord,
  fanClubRefused,
  millisOf,
  removalCountChanges,
  reviewTaken,
  type CommentCountChanges,
  type CommentCountState,
  type CommentQueueRecord,
  type CommentQueueResolution,
  type FanClubCommentRecord,
  type FanClubCommentStatus,
  type FanClubRecord,
} from './model';
import { readActionPost, type ActionPost } from './posts';
import {
  fanClubCommentQueueRef,
  fanClubCommentRef,
  fanClubCommentReportRef,
  fanClubCommentReportsOf,
  fanClubCommentsToHide,
  fanClubHideLogOf,
  fanClubPostRef,
  fanClubRef,
} from './store';

// A moderação dos comentários de fã-clube (docs/arquitetura-api.md, seção 37,
// 37.2, 37.3 e 37.6; a etapa 3 de 37.13): a denúncia de quem vê, o pedido de
// revisão do autor do oculto pelo gestor, o ocultar e o reexibir do gestor no
// próprio fã-clube, com o registro `fanClubHideLog`, e a fila da equipe
// `fanClubCommentQueue/{commentId}`, com o tipo (o que abriu a rodada) e a
// rodada, no molde da `fanClubReportQueue`. A decisão da equipe (a
// `decideFanClub` com o assunto `comment`) mora no panel.ts, e o ocultar em
// lote da Moderação (o `hideFanComments`), no moderation/fans.ts; os dois
// usam daqui as leituras e as gravações dos contadores (37.6). O comentário
// vai ao ar pelo filtro: nada some sozinho pelo número de denúncias. Desde a
// etapa 4 (37.8), os passos da exclusão de conta que mexem na fila e no
// registro: a gravação da saída dos comentários com os contadores (que o
// comments.ts usa), as denúncias que o fã fez e as linhas do registro com ele
// como autor (desligadas) e como gestor (apagadas).

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const commentOf = (snap: DocumentSnapshot | undefined): FanClubCommentRecord | null =>
  snap?.exists ? fanClubCommentRecord(snap.id, snap.data() ?? {}) : null;

const queueOf = (snap: DocumentSnapshot | undefined): CommentQueueRecord | null =>
  snap?.exists ? commentQueueRecord(snap.data() ?? {}) : null;

/** O plano sem lançamento das rotas que não rendem ponto (o `runIdempotent` aplica). */
const noAwards = (tx: Transaction, db: Firestore, fan: FanContext, award: AwardContext) =>
  planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);

// --- Os contadores (37.6) -------------------------------------------------------------------

/** O que mudar o status de comentários pede, lido na transação. */
export type CommentScene = {
  /** O estado de agora dos comentários lidos (os que mudam e os de cima deles), pelo id. */
  states: Map<string, CommentCountState>;
  /** As publicações que existem: o `commentCount` só vai a elas. */
  posts: Set<string>;
  /** O que quem chama pediu a mais, lido junto, na mesma ordem. */
  extra: DocumentSnapshot[];
};

/**
 * Lê, na transação de quem chama, o que os contadores pedem para mudar o
 * status dos comentários já lidos: num `getAll`, o `extra` de quem chama, os
 * comentários de cima que não vieram junto e as publicações. Só lê.
 */
export async function readCommentScene(
  tx: Transaction,
  db: Firestore,
  comments: readonly FanClubCommentRecord[],
  extra: DocumentReference[] = [],
): Promise<CommentScene> {
  const ids = new Set(comments.map((comment) => comment.id));
  const topIds = [
    ...new Set(
      comments.flatMap((comment) =>
        comment.replyToId !== null && !ids.has(comment.replyToId) && isContentId(comment.replyToId)
          ? [comment.replyToId]
          : [],
      ),
    ),
  ];
  const postIds = [
    ...new Set(comments.map((comment) => comment.postId).filter((id) => isContentId(id))),
  ];
  const refs = [
    ...extra,
    ...topIds.map((id) => fanClubCommentRef(db, id)),
    ...postIds.map((id) => fanClubPostRef(db, id)),
  ];
  const snaps = refs.length > 0 ? await tx.getAll(...refs) : [];
  const tops = topIds.flatMap((_id, index) => {
    const top = commentOf(snaps[extra.length + index]);
    return top ? [top] : [];
  });
  const posts = new Set(
    postIds.filter((_id, index) => snaps[extra.length + topIds.length + index]?.exists === true),
  );
  return {
    states: commentCountStates([...comments, ...tops]),
    posts,
    extra: snaps.slice(0, extra.length),
  };
}

/** As gravações da transação, uma por documento, com os campos juntos (o de cima pode mudar duas vezes). */
type Pending = Map<string, { ref: DocumentReference; data: DocumentData }>;

function pend(pending: Pending, ref: DocumentReference, data: DocumentData): void {
  const current = pending.get(ref.path);
  if (current) Object.assign(current.data, data);
  else pending.set(ref.path, { ref, data: { ...data } });
}

/** Os `increment` dos contadores: o `commentCount` das publicações que existem e os dos comentários de cima. */
function pendCounts(
  db: Firestore,
  pending: Pending,
  changes: CommentCountChanges,
  scene: CommentScene,
): void {
  for (const [postId, delta] of changes.posts) {
    if (delta !== 0 && scene.posts.has(postId)) {
      pend(pending, fanClubPostRef(db, postId), { commentCount: FieldValue.increment(delta) });
    }
  }
  for (const [topId, sums] of changes.tops) {
    const data: DocumentData = {};
    if (sums.replyCount !== 0) data.replyCount = FieldValue.increment(sums.replyCount);
    if (sums.managerHiddenReplyCount !== 0) {
      data.managerHiddenReplyCount = FieldValue.increment(sums.managerHiddenReplyCount);
    }
    if (Object.keys(data).length > 0) pend(pending, fanClubCommentRef(db, topId), data);
  }
}

function flush(tx: Transaction, pending: Pending): void {
  for (const { ref, data } of pending.values()) tx.update(ref, data);
}

/**
 * Muda o status de um comentário do gestor (o ocultar e o reexibir), com os
 * contadores (37.6), numa gravação por documento. Só grava.
 */
function writeManagerStatus(
  tx: Transaction,
  db: Firestore,
  comment: FanClubCommentRecord,
  scene: CommentScene,
  fields: DocumentData & { status: FanClubCommentStatus },
): void {
  const changes = emptyCountChanges();
  addStatusChange(changes, scene.states, comment, fields.status);
  const pending: Pending = new Map();
  pend(pending, fanClubCommentRef(db, comment.id), fields);
  pendCounts(db, pending, changes, scene);
  flush(tx, pending);
}

/** Um comentário que a equipe muda: o comentário e o item da fila dele, lidos na transação. */
export type StaffCommentTarget = {
  comment: FanClubCommentRecord;
  item: CommentQueueRecord | null;
  itemRef: DocumentReference;
  /**
   * Grava a resolução no item. Sem ele, só o item aberto; a `decideFanClub`
   * com a rodada também troca a resolução do item resolvido naquela rodada.
   */
  resolve?: boolean;
};

/**
 * A equipe oculta (`staff_hidden`) ou reexibe (`visible`, com o
 * `restoredByStaffAt`) comentários já lidos, na transação de quem chama (a
 * `decideFanClub` e o ocultar em lote), depois de todas as leituras: o status
 * com quem e quando, os contadores (37.6), juntos numa gravação por documento
 * (a resposta e o de cima dela na mesma página descontam uma vez), e o item
 * aberto da fila de cada um resolvido (`hidden` ou `restored`). Só grava.
 */
export function writeStaffStatus(
  tx: Transaction,
  db: Firestore,
  targets: readonly StaffCommentTarget[],
  scene: CommentScene,
  options: { to: 'staff_hidden' | 'visible'; actor: { uid: string; name: string }; now: number },
): void {
  const at = tsOf(options.now);
  const by = { uid: options.actor.uid, name: options.actor.name };
  const resolution: CommentQueueResolution = options.to === 'visible' ? 'restored' : 'hidden';
  const changes = emptyCountChanges();
  const pending: Pending = new Map();
  for (const { comment, item, itemRef, resolve } of targets) {
    addStatusChange(changes, scene.states, comment, options.to);
    pend(
      pending,
      fanClubCommentRef(db, comment.id),
      options.to === 'visible'
        ? { status: 'visible', hiddenAt: null, hiddenBy: null, restoredByStaffAt: at }
        : { status: 'staff_hidden', hiddenAt: at, hiddenBy: options.actor.uid },
    );
    if (item !== null && (resolve ?? item.status === 'open')) {
      pend(pending, itemRef, { status: 'resolved', resolution, resolvedAt: at, resolvedBy: by });
    }
  }
  pendCounts(db, pending, changes, scene);
  flush(tx, pending);
}

/** Um comentário que sai na exclusão de conta (37.8), lido na transação, com o item da fila dele. */
export type RemovedCommentTarget = {
  comment: FanClubCommentRecord;
  item: CommentQueueRecord | null;
  itemRef: DocumentReference;
  /** `author_deleted` no do fã que saiu; `removed` na resposta de outro fã que sai com o de cima. */
  resolution: Extract<CommentQueueResolution, 'author_deleted' | 'removed'>;
};

/**
 * Apaga comentários já lidos, na transação de quem chama (a exclusão de
 * conta, 37.8), depois de todas as leituras: cada comentário sai; os
 * contadores descontam o que sai da vista, cada um uma vez, pelo estado lido
 * (`removalCountChanges`: a resposta que sai com o de cima não desconta à
 * parte, e o de cima que sai não recebe gravação), numa gravação por
 * documento; e o item aberto da fila de cada um vai a `resolved` com a
 * resolução dele, sem quem resolveu. O item já resolvido fica como a equipe
 * deixou. Só grava.
 */
export function writeCommentRemoval(
  tx: Transaction,
  db: Firestore,
  targets: readonly RemovedCommentTarget[],
  scene: CommentScene,
  now: number,
): void {
  const at = tsOf(now);
  const changes = removalCountChanges(
    scene.states,
    targets.map((target) => target.comment),
  );
  const pending: Pending = new Map();
  pendCounts(db, pending, changes, scene);
  for (const { comment, item, itemRef, resolution } of targets) {
    tx.delete(fanClubCommentRef(db, comment.id));
    if (item?.status === 'open') {
      pend(pending, itemRef, { status: 'resolved', resolution, resolvedAt: at, resolvedBy: null });
    }
  }
  flush(tx, pending);
}

// --- A denúncia de quem vê (37.3 e 37.6) ------------------------------------------------------

export type ReportCommentOutcome = { plan: AwardPlan; status: 'reported' | 'already_reported' };

/**
 * A publicação do comentário como quem pede a vê, sem exigir seguir (ler e
 * denunciar são de quem vê, 37.6): o `readActionPost` com o `follow: false`.
 * A publicação fora do ar e o fã-clube que ele não vê dão o 404 do
 * comentário, para ninguém descobrir o estado de um comentário alheio.
 */
async function readSeenPost(
  tx: Transaction,
  db: Firestore,
  uid: string,
  comment: FanClubCommentRecord,
  extra: DocumentReference[],
): Promise<ActionPost> {
  try {
    const action = await readActionPost(tx, db, uid, comment.postId, extra, { follow: false });
    if (action.club.id !== comment.clubId) throw fanClubCommentNotFound();
    return action;
  } catch (error) {
    if (error instanceof FanClubError && error.reason === 'fan_club_post_not_found') {
      throw fanClubCommentNotFound();
    }
    throw error;
  }
}

/**
 * `POST /fan-club-comments/:commentId/report` (37.3), na transação do
 * runIdempotent, com o motivo já conferido (`parseReportReason`: os 4 de
 * sempre ou null, sem o `image_misuse`, que é de imagem). Não exige seguir.
 * Nesta ordem: o comentário, a denúncia de quem pede e o item da fila num
 * `getAll`; o comentário tem de estar visível para quem denuncia (o
 * `visible`, a publicação no ar, o fã-clube visível, um autor que ele não
 * bloqueou e, na resposta, o de cima à vista dele; o gestor vê todos no
 * próprio fã-clube, 37.8), senão 404 `fan_club_comment_not_found`; o próprio,
 * 400 `own_comment`, como no Mural. A mesma pessoa na mesma rodada do item (o
 * `round` da denúncia igual ao do item, aberto ou resolvido) responde
 * `already_reported` sem contar no teto. Senão, o teto `report` de sempre; o
 * item nasce na rodada 1 com o `kind: 'report'`, soma 1 no aberto (o tipo de
 * quem abriu a rodada fica, e o `firstReportedAt` entra se faltava), ou reabre
 * o resolvido na rodada seguinte, aberto por esta denúncia, com a contagem do
 * zero; a denúncia é regravada com a rodada em que contou; e o `reports` do
 * dia sem central, como a denúncia de publicação. A denúncia não esconde o
 * comentário de ninguém.
 */
export async function reportFanClubComment(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    commentId: string;
    reason: ReportReason | null;
  },
): Promise<ReportCommentOutcome> {
  const { fan, award, commentId, reason } = options;
  const reportDoc = fanClubCommentReportRef(db, fan.uid, commentId);
  const itemDoc = fanClubCommentQueueRef(db, commentId);
  const [commentSnap, report, itemSnap] = await tx.getAll(
    fanClubCommentRef(db, commentId),
    reportDoc,
    itemDoc,
  );
  const comment = commentOf(commentSnap);
  if (comment === null || comment.status !== 'visible' || !isContentId(comment.postId)) {
    throw fanClubCommentNotFound();
  }
  const topId = comment.replyToId;
  if (topId !== null && !isContentId(topId)) throw fanClubCommentNotFound();
  const { isOwner, blocked, extra } = await readSeenPost(
    tx,
    db,
    fan.uid,
    comment,
    topId === null ? [] : [fanClubCommentRef(db, topId)],
  );
  const hidden = new Set(isOwner ? [] : blocked);
  if (hidden.has(comment.authorUid)) throw fanClubCommentNotFound();
  if (topId !== null) {
    const top = commentOf(extra[0]);
    const shown: readonly FanClubCommentStatus[] = isOwner
      ? ['visible', 'manager_hidden']
      : ['visible'];
    if (
      top === null ||
      top.postId !== comment.postId ||
      top.replyToId !== null ||
      !shown.includes(top.status) ||
      hidden.has(top.authorUid)
    ) {
      throw fanClubCommentNotFound();
    }
  }
  if (comment.authorUid === fan.uid) throw new ModerationError('own_comment');
  const item = queueOf(itemSnap);
  const round = item?.round ?? 0;
  const reportRoundOf = report!.exists ? report!.get('round') : null;
  if (round > 0 && reportRoundOf === round) {
    return { plan: await noAwards(tx, db, fan, award), status: 'already_reported' };
  }
  enforceDailyCap(fan, award, 'report');
  const plan = await noAwards(tx, db, fan, award);
  const at = tsOf(award.now);
  const key = reasonKey(reason);
  // O item aberto só pelo pedido de revisão ganha agora a primeira denúncia.
  const first = item !== null && item.firstReportedAt === null ? { firstReportedAt: at } : {};
  let reportRound: number;
  if (item === null) {
    reportRound = 1;
    tx.create(itemDoc, {
      commentId,
      postId: comment.postId,
      clubId: comment.clubId,
      artistId: comment.artistId,
      authorUid: comment.authorUid,
      kind: 'report',
      reportCount: 1,
      reasons: { ...emptyReasons(), [key]: 1 },
      reviewRequested: false,
      status: 'open',
      resolution: null,
      round: reportRound,
      openedAt: at,
      firstReportedAt: at,
      lastReportedAt: at,
      reviewRequestedAt: null,
      lastActivityAt: at,
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
  } else if (item.status === 'open') {
    reportRound = Math.max(round, 1);
    tx.update(itemDoc, {
      reportCount: FieldValue.increment(1),
      [`reasons.${key}`]: FieldValue.increment(1),
      lastReportedAt: at,
      lastActivityAt: at,
      ...first,
    });
  } else {
    // Resolvido e o comentário de novo à vista: reabre na rodada seguinte, com a contagem do zero.
    reportRound = round + 1;
    tx.update(itemDoc, {
      kind: 'report',
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      round: reportRound,
      reportCount: 1,
      reasons: { ...emptyReasons(), [key]: 1 },
      reviewRequested: false,
      reviewRequestedAt: null,
      openedAt: at,
      lastReportedAt: at,
      lastActivityAt: at,
      ...first,
    });
  }
  tx.set(reportDoc, {
    commentId,
    postId: comment.postId,
    clubId: comment.clubId,
    reporterUid: fan.uid,
    reason,
    round: reportRound,
    reportedAt: at,
    day: plan.day,
    schemaVersion: 1,
  });
  // No total do dia, sem central: o conteúdo de fã não é o da central oficial (decisão 17 de 34.1).
  addEngagementCounts(plan, [{ kind: 'reports', artistIds: [] }]);
  countDailyAction(plan, fan, award, 'report');
  return { plan, status: 'reported' };
}

/** Denunciar fora da API (o seed dos emuladores). Na mesma rodada, `already_reported`. */
export function runReportFanClubComment(
  db: Firestore,
  uid: string,
  input: { commentId: string; reason: ReportReason | null },
  options: RunOptions,
): Promise<ReportCommentOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    reportFanClubComment(tx, db, { fan, award, ...input }),
  );
}

// --- O pedido de revisão do autor (37.3 e 37.6) ----------------------------------------------

export type ReviewCommentOutcome = { plan: AwardPlan; status: 'requested' | 'already_requested' };

/**
 * `POST /fan-club-comments/:commentId/review` (37.3), na transação do
 * runIdempotent, sem corpo: o comentário e o item da fila num `getAll`. Só o
 * autor e só no `manager_hidden`; senão, 404 `fan_club_comment_not_found`
 * (ninguém descobre o estado de um comentário alheio). Já pedido neste
 * ocultar, ou já mantido oculto pela equipe neste ocultar (o "Manter" de uma
 * denúncia grava o `reviewOutcome: 'kept'`): `already_requested`, sem teto.
 * Senão, o teto `report` (o pedido vai à mesma fila que as denúncias), o
 * `reviewRequestedAt` no comentário e o item: nasce na rodada 1 com o
 * `kind: 'review'` e nenhuma denúncia, marca o `reviewRequested` no aberto
 * por denúncia, ou reabre o resolvido na rodada seguinte, aberto pelo pedido.
 * Não soma no `reports` do dia. O suspenso recebe o 403 do runIdempotent: a
 * suspensão já é decisão da equipe (o contato da seção 29).
 */
export async function requestFanClubCommentReview(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; commentId: string },
): Promise<ReviewCommentOutcome> {
  const { fan, award, commentId } = options;
  const itemDoc = fanClubCommentQueueRef(db, commentId);
  const [commentSnap, itemSnap] = await tx.getAll(fanClubCommentRef(db, commentId), itemDoc);
  const comment = commentOf(commentSnap);
  if (comment === null || comment.authorUid !== fan.uid || comment.status !== 'manager_hidden') {
    throw fanClubCommentNotFound();
  }
  if (reviewTaken(comment)) {
    return { plan: await noAwards(tx, db, fan, award), status: 'already_requested' };
  }
  enforceDailyCap(fan, award, 'report');
  const plan = await noAwards(tx, db, fan, award);
  const at = tsOf(award.now);
  tx.update(commentSnap!.ref, { reviewRequestedAt: at });
  const item = queueOf(itemSnap);
  if (item === null) {
    tx.create(itemDoc, {
      commentId,
      postId: comment.postId,
      clubId: comment.clubId,
      artistId: comment.artistId,
      authorUid: comment.authorUid,
      kind: 'review',
      reportCount: 0,
      reasons: emptyReasons(),
      reviewRequested: true,
      status: 'open',
      resolution: null,
      round: 1,
      openedAt: at,
      firstReportedAt: null,
      lastReportedAt: null,
      reviewRequestedAt: at,
      lastActivityAt: at,
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
  } else if (item.status === 'open') {
    tx.update(itemDoc, { reviewRequested: true, reviewRequestedAt: at, lastActivityAt: at });
  } else {
    tx.update(itemDoc, {
      kind: 'review',
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      round: item.round + 1,
      reportCount: 0,
      reasons: emptyReasons(),
      reviewRequested: true,
      reviewRequestedAt: at,
      openedAt: at,
      lastActivityAt: at,
    });
  }
  countDailyAction(plan, fan, award, 'report');
  return { plan, status: 'requested' };
}

/** Pedir revisão fora da API (o seed dos emuladores). Já pedido, `already_requested`. */
export function runRequestFanClubCommentReview(
  db: Firestore,
  uid: string,
  commentId: string,
  options: RunOptions,
): Promise<ReviewCommentOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    requestFanClubCommentReview(tx, db, { fan, award, commentId }),
  );
}

// --- O ocultar e o reexibir do gestor (37.3 e 37.6) ------------------------------------------

export type ManagerHideOutcome = { plan: AwardPlan; hidden: boolean };

/** O comentário que o gestor oculta ou reexibe, com o fã-clube dele, o que os contadores pedem e o item. */
type Managed = {
  comment: FanClubCommentRecord;
  club: FanClubRecord;
  scene: CommentScene;
  item: CommentQueueRecord | null;
  itemRef: DocumentReference;
};

/**
 * O comentário de uma publicação do fã-clube de quem pede, na transação: o
 * comentário e o item da fila num `getAll`; depois, noutro, o fã-clube, a
 * publicação e o de cima da resposta (os contadores). O que não existe e o de
 * outro fã-clube dão 404 `fan_club_comment_not_found`. Só lê.
 */
async function readManaged(
  tx: Transaction,
  db: Firestore,
  uid: string,
  commentId: string,
): Promise<Managed> {
  const itemRef = fanClubCommentQueueRef(db, commentId);
  const [commentSnap, itemSnap] = await tx.getAll(fanClubCommentRef(db, commentId), itemRef);
  const comment = commentOf(commentSnap);
  if (comment === null || !isContentId(comment.clubId) || !isContentId(comment.postId)) {
    throw fanClubCommentNotFound();
  }
  const scene = await readCommentScene(tx, db, [comment], [fanClubRef(db, comment.clubId)]);
  const clubSnap = scene.extra[0];
  const club = clubSnap?.exists ? fanClubRecord(clubSnap.id, clubSnap.data() ?? {}) : null;
  if (club === null || club.ownerUid === null || club.ownerUid !== uid) {
    throw fanClubCommentNotFound();
  }
  return { comment, club, scene, item: queueOf(itemSnap), itemRef };
}

/** A linha do registro do ocultar do gestor (decisão 11 de 36.1): nunca o texto. */
function writeHideLog(
  tx: Transaction,
  db: Firestore,
  comment: FanClubCommentRecord,
  managerUid: string,
  action: 'hidden' | 'restored',
  at: Timestamp,
): void {
  tx.create(fanClubHideLogOf(db).doc(), {
    clubId: comment.clubId,
    postId: comment.postId,
    commentId: comment.id,
    authorUid: comment.authorUid,
    managerUid,
    action,
    at,
    schemaVersion: 1,
  });
}

/**
 * `PUT /me/fan-club/hidden-comments/:commentId` (37.3), na transação do
 * runIdempotent: o gestor oculta, sem teto (ele só alcança o próprio
 * fã-clube). Vale o comentário de uma publicação do fã-clube dele (o
 * `readManaged`; de outro fã-clube, 404), com o fã-clube ativo (senão, 409
 * `club_not_active`). Já oculto pela equipe: 404, como para o autor (decisão
 * 22). O dele: 400 `own_comment` (o fã não apaga o que escreveu, decisão 21).
 * Já oculto por ele: responde sem gravar. Reexibido pela equipe: 409
 * `staff_decided` (a palavra dela vale; o "Manter" dela não trava o gestor).
 * Senão: o `manager_hidden`, com o `hiddenAt`, o `hiddenBy` e o
 * `reviewRequestedAt` e o `reviewOutcome` zerados (cada ocultar abre um pedido
 * de revisão novo); os contadores (37.6); e a linha `hidden` no
 * `fanClubHideLog`. O item aberto da fila continua aberto: a equipe ainda
 * decide.
 */
export async function hideFanClubComment(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; commentId: string },
): Promise<ManagerHideOutcome> {
  const { fan, award, commentId } = options;
  const { comment, club, scene } = await readManaged(tx, db, fan.uid, commentId);
  if (comment.status === 'staff_hidden') throw fanClubCommentNotFound();
  if (club.status !== 'active') throw fanClubRefused('club_not_active');
  if (comment.authorUid === fan.uid) throw new ModerationError('own_comment');
  if (comment.status === 'visible' && comment.restoredByStaffAt !== null) {
    throw fanClubRefused('staff_decided');
  }
  const plan = await noAwards(tx, db, fan, award);
  if (comment.status === 'manager_hidden') return { plan, hidden: true };
  const at = tsOf(award.now);
  writeManagerStatus(tx, db, comment, scene, {
    status: 'manager_hidden',
    hiddenAt: at,
    hiddenBy: fan.uid,
    reviewRequestedAt: null,
    reviewOutcome: null,
  });
  writeHideLog(tx, db, comment, fan.uid, 'hidden', at);
  return { plan, hidden: true };
}

/**
 * `DELETE /me/fan-club/hidden-comments/:commentId` (37.3), na transação do
 * runIdempotent: o gestor reexibe só o que ele ocultou (o `manager_hidden` com
 * o `hiddenBy` dele); o resto, 404. O fã-clube que não está ativo: 409
 * `club_not_active`, como no ocultar. Volta a `visible`, com os contadores
 * (37.6) e a linha `restored` no `fanClubHideLog`. O item aberto só pelo
 * pedido de revisão (sem denúncia) vai a `resolved` com `withdrawn`; o que tem
 * denúncia continua aberto, sem o pedido (o aberto pelo pedido passa ao
 * `kind: 'report'`, e a última atividade volta à última denúncia).
 */
export async function unhideFanClubComment(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; commentId: string },
): Promise<ManagerHideOutcome> {
  const { fan, award, commentId } = options;
  const { comment, club, scene, item, itemRef } = await readManaged(tx, db, fan.uid, commentId);
  if (comment.status !== 'manager_hidden' || comment.hiddenBy !== fan.uid) {
    throw fanClubCommentNotFound();
  }
  if (club.status !== 'active') throw fanClubRefused('club_not_active');
  const plan = await noAwards(tx, db, fan, award);
  const at = tsOf(award.now);
  writeManagerStatus(tx, db, comment, scene, { status: 'visible', hiddenAt: null, hiddenBy: null });
  writeHideLog(tx, db, comment, fan.uid, 'restored', at);
  if (item?.status === 'open') {
    if (item.reportCount === 0) {
      tx.update(itemRef, {
        status: 'resolved',
        resolution: 'withdrawn',
        resolvedAt: at,
        resolvedBy: null,
      });
    } else if (item.reviewRequested || item.kind === 'review') {
      tx.update(itemRef, {
        kind: 'report',
        reviewRequested: false,
        reviewRequestedAt: null,
        lastActivityAt: item.lastReportedAt === null ? at : tsOf(item.lastReportedAt),
      });
    }
  }
  return { plan, hidden: false };
}

/** O gestor oculta fora da API (o seed dos emuladores). Já oculto, sem efeito. */
export function runHideFanClubComment(
  db: Firestore,
  uid: string,
  commentId: string,
  options: RunOptions,
): Promise<ManagerHideOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    hideFanClubComment(tx, db, { fan, award, commentId }),
  );
}

// --- O ocultar em lote da Moderação (37.6) ---------------------------------------------------

/** A página do fã-clube no `hideFanComments`: os comentários do fã que saem da vista de todos. */
export const fanClubCommentsToHideOf = (db: Firestore, uid: string, limit: number): Query =>
  fanClubCommentsToHide(db, uid).limit(limit);

/** Ainda há comentário do fã nos fã-clubes para o ocultar em lote levar (uma leitura). */
export async function hasFanClubCommentsToHide(db: Firestore, uid: string): Promise<boolean> {
  return !(await fanClubCommentsToHideOf(db, uid, 1).get()).empty;
}

export type HiddenFanClubPage = { commentIds: string[]; postIds: string[] };

/**
 * A etapa do fã-clube do ocultar em lote (o `hideFanComments`, 37.6), na
 * transação de quem chama, depois de reler quem chama: relê os comentários da
 * página e os itens da fila num `getAll`, e depois os de cima e as
 * publicações (os contadores). O que sumiu (a exclusão da conta), não é mais
 * do fã ou já está oculto pela equipe fica de fora, sem gravar nada. O resto
 * vai a `staff_hidden` pela equipe, com os contadores numa gravação por
 * documento e o item aberto de cada um em `hidden` (o `writeStaffStatus`),
 * inclusive o oculto pelo gestor, que o autor ainda via. Devolve os
 * comentários ocultos e as publicações deles, para a auditoria de quem chama.
 */
export async function hideFanClubCommentsPage(
  tx: Transaction,
  db: Firestore,
  uid: string,
  refs: readonly DocumentReference[],
  options: { actor: { uid: string; name: string }; now: number },
): Promise<HiddenFanClubPage> {
  if (refs.length === 0) return { commentIds: [], postIds: [] };
  const itemRefs = refs.map((ref) => fanClubCommentQueueRef(db, ref.id));
  const snaps = await tx.getAll(...refs, ...itemRefs);
  const targets = refs.flatMap((_ref, index): StaffCommentTarget[] => {
    const comment = commentOf(snaps[index]);
    if (comment === null || comment.authorUid !== uid || comment.status === 'staff_hidden') {
      return [];
    }
    return [{ comment, item: queueOf(snaps[refs.length + index]), itemRef: itemRefs[index]! }];
  });
  if (targets.length === 0) return { commentIds: [], postIds: [] };
  const scene = await readCommentScene(
    tx,
    db,
    targets.map((target) => target.comment),
  );
  writeStaffStatus(tx, db, targets, scene, { ...options, to: 'staff_hidden' });
  return {
    commentIds: targets.map((target) => target.comment.id),
    postIds: [...new Set(targets.map((target) => target.comment.postId))],
  };
}

// --- A exclusão de conta (37.8) -----------------------------------------------------------------

/** Documentos por página (e por transação) nos passos da exclusão de conta. */
export const COMMENT_QUEUE_DELETE_PAGE = 100;

/** A chave da contagem por motivo de uma denúncia guardada (o motivo estranho vale `none`). */
const storedReasonKey = (reason: unknown) =>
  reasonKey(
    (REPORT_REASONS as readonly unknown[]).includes(reason) ? (reason as ReportReason) : null,
  );

const storedCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * As denúncias que o fã fez em comentários de fã-clube, na exclusão de conta
 * (37.8, passo 3), como as de publicação (o `removeFanClubReportsOf`): em
 * páginas de 100, cada uma numa transação que relê as denúncias e os itens;
 * cada denúncia sai, e a da rodada aberta do item (o mesmo `round`) desconta
 * dele (nunca abaixo de 0). O item que chega a 0 vai a `resolved` com
 * `withdrawn`, menos o que tem o pedido de revisão do autor (o
 * `reviewRequested`): esse continua aberto, agora com o `kind: 'review'` e a
 * última atividade no pedido. A de uma rodada antiga sai sem mexer no item.
 * Devolve quantas saíram.
 */
export async function removeFanClubCommentReportsOf(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<number> {
  const query = fanClubCommentReportsOf(db)
    .where('reporterUid', '==', uid)
    .limit(COMMENT_QUEUE_DELETE_PAGE);
  let removed = 0;
  for (;;) {
    const snap = await query.get();
    if (snap.empty) return removed;
    const refs = snap.docs.map((doc) => doc.ref);
    const count = await db.runTransaction(async (tx) => {
      const reports = await tx.getAll(...refs);
      const commentIds = [
        ...new Set(
          reports
            .filter((report) => report.exists)
            .map((report) => report.get('commentId'))
            .filter((id): id is string => isContentId(id)),
        ),
      ];
      const itemSnaps =
        commentIds.length > 0
          ? await tx.getAll(...commentIds.map((id) => fanClubCommentQueueRef(db, id)))
          : [];
      const items = new Map(commentIds.map((id, index) => [id, itemSnaps[index]!]));
      const updates = new Map<
        string,
        { item: DocumentSnapshot; reportCount: number; reasons: ReasonCounts }
      >();
      let deleted = 0;
      for (const report of reports) {
        if (!report.exists) continue;
        tx.delete(report.ref);
        deleted += 1;
        const commentId = report.get('commentId');
        const item = typeof commentId === 'string' ? items.get(commentId) : undefined;
        // Só a denúncia da rodada aberta conta no item; a de uma rodada antiga sai sem mexer nele.
        if (!item?.exists || item.get('status') !== 'open') continue;
        if (item.get('round') !== report.get('round')) continue;
        const current = updates.get(item.id) ?? {
          item,
          reportCount: storedCount(item.get('reportCount')),
          reasons: reasonsOf(item.get('reasons')),
        };
        const key = storedReasonKey(report.get('reason'));
        current.reportCount = Math.max(0, current.reportCount - 1);
        current.reasons[key] = Math.max(0, current.reasons[key] - 1);
        updates.set(item.id, current);
      }
      const at = tsOf(now);
      for (const [id, { item, reportCount, reasons }] of updates) {
        let end: DocumentData = {};
        if (reportCount === 0) {
          // O pedido de revisão do autor ainda espera a equipe: o item fica aberto, pelo pedido.
          const requested = millisOf(item.get('reviewRequestedAt'));
          end =
            item.get('reviewRequested') === true
              ? { kind: 'review', lastActivityAt: requested === null ? at : tsOf(requested) }
              : { status: 'resolved', resolution: 'withdrawn', resolvedAt: at, resolvedBy: null };
        }
        tx.update(fanClubCommentQueueRef(db, id), { reportCount, reasons, ...end });
      }
      return deleted;
    });
    removed += count;
    // Nada saiu (outra entrega da exclusão levou tudo no meio): a seguinte vê vazio.
    if (count === 0 && snap.size < COMMENT_QUEUE_DELETE_PAGE) return removed;
  }
}

/**
 * As linhas do registro do ocultar do gestor com o fã como autor do
 * comentário, na exclusão de conta (37.8, passo 1): ficam, desligadas (o
 * `authorUid` em null, como o `inviterUid` dos convidados), para a equipe
 * continuar vendo quantas vezes o gestor ocultou (decisões 11 e 13 de 36.1).
 * Em páginas de 100, cada uma numa transação que relê. Devolve quantas
 * mudaram.
 */
export async function detachFanClubHideLogOf(db: Firestore, uid: string): Promise<number> {
  const query = fanClubHideLogOf(db).where('authorUid', '==', uid).limit(COMMENT_QUEUE_DELETE_PAGE);
  let detached = 0;
  for (;;) {
    const page = await query.get();
    if (page.empty) return detached;
    const count = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...page.docs.map((doc) => doc.ref));
      let changed = 0;
      for (const snap of snaps) {
        if (!snap.exists || snap.get('authorUid') !== uid) continue;
        tx.update(snap.ref, { authorUid: null });
        changed += 1;
      }
      return changed;
    });
    detached += count;
    if (count === 0 && page.size < COMMENT_QUEUE_DELETE_PAGE) return detached;
  }
}

/**
 * As linhas do registro do ocultar com o fã como gestor, na exclusão de conta
 * (37.8, passo 5): saem, em páginas de 100, cada uma numa transação que relê.
 * Devolve quantas saíram.
 */
export async function removeFanClubHideLogOf(db: Firestore, uid: string): Promise<number> {
  const query = fanClubHideLogOf(db)
    .where('managerUid', '==', uid)
    .limit(COMMENT_QUEUE_DELETE_PAGE);
  let removed = 0;
  for (;;) {
    const page = await query.get();
    if (page.empty) return removed;
    const count = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...page.docs.map((doc) => doc.ref));
      let deleted = 0;
      for (const snap of snaps) {
        if (!snap.exists) continue;
        tx.delete(snap.ref);
        deleted += 1;
      }
      return deleted;
    });
    removed += count;
    if (count === 0 && page.size < COMMENT_QUEUE_DELETE_PAGE) return removed;
  }
}
