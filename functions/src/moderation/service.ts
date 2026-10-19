import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import type { BlockedFansPage } from '../api/contract';
import { readFollowOfOwner } from '../fan-clubs/store';
import { blockedFanOf, profileDigest } from '../fan-profile/details';
import {
  addEngagementCounts,
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { commentRecord } from '../posts/model';
import { commentRef, readVisiblePost } from '../posts/store';
import { countDailyAction, enforceDailyCap } from './caps';
import {
  BLOCK_LIST_MAX,
  blockedOf,
  blockedPage,
  emptyReasons,
  formatBlockCursor,
  ModerationError,
  reasonKey,
  type BlockCursor,
  type ReportReason,
} from './model';
import {
  blockListRef,
  profileQueueItemRef,
  profileReportRef,
  queueItemRef,
  reportRef,
} from './store';

// Moderação mínima do bloco 6 no Firestore (provisória, UP-48): denunciar o
// comentário de outro fã, com a fila da seção Moderação, e bloquear um fã
// (os comentários dele somem para quem bloqueou). A ordem de uma rota que
// grava é a de sempre. docs/arquitetura-api.md, 21.4 e 21.8. Desde as
// exigências das lojas (seção 29, 29.4): denunciar um perfil, na fila
// separada `profileReportQueue`, e ler a lista de bloqueados.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

export type ReportOutcome = { plan: AwardPlan; status: 'reported' | 'already_reported' };

/**
 * Denunciar (`POST /posts/:postId/comments/:commentId/report`): post
 * invisível, comentário que não existe ou oculto é 404; o próprio comentário
 * é 400 (`own_comment`); a segunda denúncia do mesmo fã não muda nada
 * (`already_reported`); o teto do dia (30 denúncias); a denúncia nasce e o
 * item da fila do comentário nasce (com a cópia do texto) ou soma 1, e o item
 * resolvido como mantido (`kept`) ou retirado (`withdrawn`) volta a `open`.
 * A denúncia não esconde o comentário de ninguém.
 */
export async function reportComment(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    postId: string;
    commentId: string;
    reason: ReportReason | null;
  },
): Promise<ReportOutcome> {
  const { fan, award, postId, commentId, reason } = options;
  const report = reportRef(db, commentId, fan.uid);
  const item = queueItemRef(db, commentId);
  const { visible, extra } = await readVisiblePost(tx, db, postId, [
    commentRef(db, postId, commentId),
    report,
    item,
  ]);
  const [commentSnap, reportSnap, itemSnap] = extra as [
    (typeof extra)[number],
    (typeof extra)[number],
    (typeof extra)[number],
  ];
  if (!visible || !commentSnap.exists) throw new ModerationError('comment_not_found');
  const comment = commentRecord(commentSnap.id, commentSnap.data() ?? {});
  if (comment.status !== 'visible') throw new ModerationError('comment_not_found');
  if (comment.authorUid === fan.uid) throw new ModerationError('own_comment');
  if (reportSnap.exists) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      status: 'already_reported',
    };
  }
  enforceDailyCap(fan, award, 'report');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  const at = tsOf(award.now);
  const key = reasonKey(reason);
  const { artistId } = visible.post;
  tx.create(report, {
    commentId,
    postId,
    artistId,
    commentAuthorUid: comment.authorUid,
    reporterUid: fan.uid,
    reason,
    day: plan.day,
    createdAt: at,
    schemaVersion: 1,
  });
  if (!itemSnap.exists) {
    tx.create(item, {
      commentId,
      postId,
      artistId,
      authorUid: comment.authorUid,
      commentText: comment.text,
      commentCreatedAt: tsOf(comment.createdAt),
      reportCount: 1,
      reasons: { ...emptyReasons(), [key]: 1 },
      status: 'open',
      resolution: null,
      firstReportedAt: at,
      lastReportedAt: at,
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
  } else {
    const reopen = itemSnap.get('status') !== 'open';
    tx.update(item, {
      reportCount: FieldValue.increment(1),
      [`reasons.${key}`]: FieldValue.increment(1),
      lastReportedAt: at,
      ...(reopen ? { status: 'open', resolution: null, resolvedAt: null, resolvedBy: null } : {}),
    });
  }
  addEngagementCounts(plan, [{ kind: 'reports', artistIds: [artistId] }]);
  countDailyAction(plan, fan, award, 'report');
  return { plan, status: 'reported' };
}

export type ReportFanOutcome = { plan: AwardPlan; status: 'reported' | 'already_reported' };

/** A rodada guardada (inteiro de 1 em diante), ou 0 quando falta ou está torta. */
const roundOf = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 0;

/**
 * Denunciar um perfil (`POST /fans/:fanId/report`, seção 29, 29.4), na
 * transação do runIdempotent: o próprio uid é 400 (`own_profile`, sem ler);
 * um `getAll` do perfil do alvo, da denúncia de quem pede e do item da fila
 * (`profileReportQueue/{fanId}`, separada da `moderationQueue`); sem o perfil,
 * 404. A mesma pessoa na mesma rodada (o `round` do item na denúncia) responde
 * `already_reported` sem contar no teto: com o item aberto, sempre; com o
 * item resolvido, só se o perfil não mudou desde a resolução (o
 * `profileDigest` de agora igual ao `resolvedDigest`). Senão, o teto do dia
 * (`report`, somando comentário e perfil); o item nasce com a rodada 1, soma
 * 1, ou reabre com a rodada seguinte, a contagem do zero e o `openedAt` novo
 * (o `firstReportedAt` fica); a denúncia é regravada com a rodada em que
 * contou. A rodada é sempre o inteiro, nunca o `reportedAt` comparado com o
 * `openedAt` (relógios de instâncias diferentes). A denúncia não olha a conta
 * privada, a suspensão nem a lista de bloqueios do alvo: a resposta é a mesma
 * (o bloqueado não fica sabendo).
 */
export async function reportFan(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; fanId: string; reason: ReportReason | null },
): Promise<ReportFanOutcome> {
  const { fan, award, fanId, reason } = options;
  if (fanId === fan.uid) throw new ModerationError('own_profile');
  const reportDoc = profileReportRef(db, fanId, fan.uid);
  const itemDoc = profileQueueItemRef(db, fanId);
  const [target, report, item] = await tx.getAll(
    db.collection('users').doc(fanId),
    reportDoc,
    itemDoc,
  );
  if (!target!.exists) throw new ModerationError('fan_not_found');
  const round = item!.exists ? roundOf(item!.get('round')) : 0;
  const open = item!.exists && item!.get('status') === 'open';
  const sameRound = report!.exists && round > 0 && roundOf(report!.get('round')) === round;
  const unchanged =
    item!.exists &&
    !open &&
    item!.get('resolvedDigest') === profileDigest(target!.data() as Record<string, unknown>);
  if (sameRound && (open || unchanged)) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      status: 'already_reported',
    };
  }
  enforceDailyCap(fan, award, 'report');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  const at = tsOf(award.now);
  const key = reasonKey(reason);
  let reportRound: number;
  if (!item!.exists) {
    reportRound = 1;
    tx.create(itemDoc, {
      uid: fanId,
      reportCount: 1,
      reasons: { ...emptyReasons(), [key]: 1 },
      status: 'open',
      resolution: null,
      round: reportRound,
      openedAt: at,
      firstReportedAt: at,
      lastReportedAt: at,
      resolvedAt: null,
      resolvedBy: null,
      resolvedDigest: null,
      schemaVersion: 1,
    });
  } else if (open) {
    reportRound = round;
    tx.update(itemDoc, {
      reportCount: FieldValue.increment(1),
      [`reasons.${key}`]: FieldValue.increment(1),
      lastReportedAt: at,
    });
  } else {
    // Resolvido (qualquer resolução): reabre na rodada seguinte, com a contagem do zero.
    reportRound = round + 1;
    tx.update(itemDoc, {
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      resolvedDigest: null,
      round: reportRound,
      reportCount: 1,
      reasons: { ...emptyReasons(), [key]: 1 },
      openedAt: at,
      lastReportedAt: at,
    });
  }
  tx.set(reportDoc, {
    targetUid: fanId,
    reporterUid: fan.uid,
    reason,
    round: reportRound,
    reportedAt: at,
    day: plan.day,
    schemaVersion: 1,
  });
  addEngagementCounts(plan, [{ kind: 'reports', artistIds: [] }]);
  countDailyAction(plan, fan, award, 'report');
  return { plan, status: 'reported' };
}

export type BlockOutcome = { plan: AwardPlan; blocked: boolean };

/**
 * Bloquear (`PUT /me/blocks/:fanId`): o próprio uid é 400 (`self`); fã sem
 * perfil é 404; quem já está na lista, nada além da atividade; lista cheia
 * (1.000) é 409; o teto do dia (30 bloqueios); a lista é gravada inteira (a
 * transação já a leu), com o fluxo `blocks` e o contador do teto. O bloqueado
 * não fica sabendo. Desde o fã-clube (seção 34, decisão 32), bloquear o
 * gestor deixa de seguir o fã-clube dele: a candidatura do bloqueado e, com o
 * `clubId`, o vínculo de quem bloqueia são lidos antes de gravar, e o vínculo
 * sai (também com ele já na lista). O bloqueio feito pelo gestor só grava a
 * lista dele: ninguém deixa de seguir.
 */
export async function blockFan(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; fanId: string },
): Promise<BlockOutcome> {
  const { fan, award, fanId } = options;
  if (fanId === fan.uid) throw new ModerationError('self');
  const listRef = blockListRef(db, fan.uid);
  const [list, other] = await tx.getAll(listRef, db.collection('users').doc(fanId));
  if (!other!.exists) throw new ModerationError('fan_not_found');
  const follow = await readFollowOfOwner(tx, db, fan.uid, fanId);
  const blocked = blockedOf(list!.get('blocked'));
  if (blocked.includes(fanId)) {
    const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
    if (follow) tx.delete(follow);
    return { plan, blocked: true };
  }
  if (blocked.length >= BLOCK_LIST_MAX) throw new ModerationError('block_list_full');
  enforceDailyCap(fan, award, 'block');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  if (follow) tx.delete(follow);
  tx.set(listRef, {
    uid: fan.uid,
    blocked: [...blocked, fanId],
    updatedAt: tsOf(award.now),
    schemaVersion: 1,
  });
  addEngagementCounts(plan, [{ kind: 'blocks', artistIds: [] }]);
  countDailyAction(plan, fan, award, 'block');
  return { plan, blocked: true };
}

/**
 * Desbloquear (`DELETE /me/blocks/:fanId`): sem teto e sem fluxo, e sem
 * conferir o perfil do outro (para tirar da lista uma conta excluída). Quem
 * não está na lista: sucesso sem efeito.
 */
export async function unblockFan(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; fanId: string },
): Promise<BlockOutcome> {
  const { fan, award, fanId } = options;
  if (fanId === fan.uid) throw new ModerationError('self');
  const listRef = blockListRef(db, fan.uid);
  const list = await tx.get(listRef);
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  const blocked = blockedOf(list.get('blocked'));
  if (!blocked.includes(fanId)) return { plan, blocked: false };
  tx.set(listRef, {
    uid: fan.uid,
    blocked: blocked.filter((id) => id !== fanId),
    updatedAt: tsOf(award.now),
    schemaVersion: 1,
  });
  return { plan, blocked: false };
}

/**
 * A lista de bloqueados (`GET /me/blocks`, seção 29, 29.4), fora de transação:
 * a lista de quem pede (sem ela, a página vazia: nunca bloqueou, ou a conta é
 * só da equipe), a página pelo `blockedPage` (do mais novo ao mais antigo,
 * com o cursor pela posição na ordem da inclusão) e um `getAll` dos perfis da
 * página. O fã sem perfil sai (a exclusão já tira o uid das listas; sobra só
 * numa corrida), e a página pode vir menor, com o cursor. Cada item traz só o
 * uid, o nome, o @ e a foto.
 */
export async function readBlockedFans(
  db: Firestore,
  uid: string,
  query: { cursor: BlockCursor | null; limit: number },
): Promise<BlockedFansPage> {
  const list = await blockListRef(db, uid).get();
  if (!list.exists) return { items: [], nextCursor: null };
  const { uids, next } = blockedPage(blockedOf(list.get('blocked')), query.cursor, query.limit);
  const profiles =
    uids.length > 0 ? await db.getAll(...uids.map((id) => db.collection('users').doc(id))) : [];
  const items = profiles.flatMap((profile) =>
    profile.exists
      ? [blockedFanOf(profile.id, (profile.data() ?? {}) as Record<string, unknown>)]
      : [],
  );
  return { items, nextCursor: next ? formatBlockCursor(next) : null };
}

/** Denunciar fora da API (seed). Rodar de novo responde `already_reported`. */
export function runReport(
  db: Firestore,
  uid: string,
  input: { postId: string; commentId: string; reason: ReportReason | null },
  options: RunOptions,
): Promise<ReportOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    reportComment(tx, db, { fan, award, ...input }),
  );
}

/** Denunciar um perfil fora da API (seed, 29.10). Na mesma rodada, `already_reported`. */
export function runReportFan(
  db: Firestore,
  uid: string,
  input: { fanId: string; reason: ReportReason | null },
  options: RunOptions,
): Promise<ReportFanOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    reportFan(tx, db, { fan, award, ...input }),
  );
}

/** Bloquear fora da API (seed, 29.10). Quem já está na lista fica, sem efeito. */
export function runBlockFan(
  db: Firestore,
  uid: string,
  input: { fanId: string },
  options: RunOptions,
): Promise<BlockOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) => blockFan(tx, db, { fan, award, ...input }));
}
