import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import {
  addEngagementCounts,
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
} from '../points/award';
import type { Actor, PointsConfig } from '../points/model';
import { commentRecord } from '../posts/model';
import { commentRef, readVisiblePost } from '../posts/store';
import { countDailyAction, enforceDailyCap } from './caps';
import {
  BLOCK_LIST_MAX,
  blockedOf,
  emptyReasons,
  ModerationError,
  reasonKey,
  type ReportReason,
} from './model';
import { blockListRef, queueItemRef, reportRef } from './store';

// Moderação mínima do bloco 6 no Firestore (provisória, UP-48): denunciar o
// comentário de outro fã, com a fila da seção Moderação, e bloquear um fã
// (os comentários dele somem para quem bloqueou). A ordem de uma rota que
// grava é a de sempre. docs/arquitetura-api.md, 21.4 e 21.8.

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

export type BlockOutcome = { plan: AwardPlan; blocked: boolean };

/**
 * Bloquear (`PUT /me/blocks/:fanId`): o próprio uid é 400 (`self`); fã sem
 * perfil é 404; quem já está na lista, nada além da atividade; lista cheia
 * (1.000) é 409; o teto do dia (30 bloqueios); a lista é gravada inteira (a
 * transação já a leu), com o fluxo `blocks` e o contador do teto. O bloqueado
 * não fica sabendo.
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
  const blocked = blockedOf(list!.get('blocked'));
  if (blocked.includes(fanId)) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      blocked: true,
    };
  }
  if (blocked.length >= BLOCK_LIST_MAX) throw new ModerationError('block_list_full');
  enforceDailyCap(fan, award, 'block');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
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

/** Denunciar fora da API (seed). Rodar de novo responde `already_reported`. */
export function runReport(
  db: Firestore,
  uid: string,
  input: { postId: string; commentId: string; reason: ReportReason | null },
  options: { now: number; config: PointsConfig; actor: Actor; random?: () => number },
): Promise<ReportOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    reportComment(tx, db, { fan, award, ...input }),
  );
}
