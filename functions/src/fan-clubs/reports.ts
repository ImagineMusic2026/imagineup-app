import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import {
  emptyFanClubReasons,
  fanClubReasonKey,
  fanClubReasonsOf,
  ModerationError,
  storedFanClubReasonKey,
  type FanClubReasonCounts,
  type FanClubReportReason,
} from '../moderation/model';
import {
  addEngagementCounts,
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { fanClubPostNotFound, fanClubPostRecord, fanClubReportId } from './model';
import { fanClubPostRef, fanClubReportQueueRef, fanClubReportsOf } from './store';

// A denúncia de uma publicação de fã-clube (docs/arquitetura-api.md, seção
// 34, decisão 18 e 34.5; etapa 2 de 34.14), no molde da denúncia de perfil
// (29.4): uma por fã e publicação por rodada, em `fanClubReports`, e a fila
// própria `fanClubReportQueue/{postId}`, fora da `moderationQueue` (o card do
// painel publicado quebra com item sem `postId` e `commentId` do Mural). Nada
// some sozinho pelo número de denúncias: a equipe decide Manter ou Ocultar.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

/** A rodada guardada (inteiro de 1 em diante), ou 0 quando falta ou está torta. */
const roundOf = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 0;

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

export type ReportPostOutcome = { plan: AwardPlan; status: 'reported' | 'already_reported' };

/**
 * `POST /fan-club-posts/:postId/report` (34.5), na transação do
 * runIdempotent: a publicação, a denúncia de quem pede e o item da fila num
 * `getAll`; a publicação que não existe ou não está no ar é 404
 * `fan_club_post_not_found`; a própria, 400 `own_post`. A mesma pessoa na
 * mesma rodada do item (o `round` dela igual ao do item, aberto ou resolvido:
 * a publicação não muda depois de enviada) responde `already_reported` sem
 * contar no teto. Senão, o teto `report` de sempre (somado com as denúncias de
 * comentário e de perfil); o item nasce na rodada 1, soma 1, ou reabre na
 * rodada seguinte com a contagem do zero e o `openedAt` novo (o
 * `firstReportedAt` fica); a denúncia é regravada com a rodada em que contou.
 * A denúncia não esconde a publicação de ninguém.
 */
export async function reportFanClubPost(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    postId: string;
    reason: FanClubReportReason | null;
  },
): Promise<ReportPostOutcome> {
  const { fan, award, postId, reason } = options;
  const reportDoc = fanClubReportsOf(db).doc(fanClubReportId(fan.uid, postId));
  const itemDoc = fanClubReportQueueRef(db, postId);
  const [postSnap, report, item] = await tx.getAll(fanClubPostRef(db, postId), reportDoc, itemDoc);
  if (!postSnap!.exists) throw fanClubPostNotFound();
  const post = fanClubPostRecord(postSnap!.id, postSnap!.data() ?? {});
  if (post.status !== 'published') throw fanClubPostNotFound();
  if (post.authorUid === fan.uid) throw new ModerationError('own_post');
  const round = item!.exists ? roundOf(item!.get('round')) : 0;
  const open = item!.exists && item!.get('status') === 'open';
  if (report!.exists && round > 0 && roundOf(report!.get('round')) === round) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      status: 'already_reported',
    };
  }
  enforceDailyCap(fan, award, 'report');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  const at = tsOf(award.now);
  const key = fanClubReasonKey(reason);
  let reportRound: number;
  if (!item!.exists) {
    reportRound = 1;
    tx.create(itemDoc, {
      postId,
      clubId: post.clubId,
      artistId: post.artistId,
      authorUid: post.authorUid,
      reportCount: 1,
      reasons: { ...emptyFanClubReasons(), [key]: 1 },
      status: 'open',
      resolution: null,
      round: reportRound,
      openedAt: at,
      firstReportedAt: at,
      lastReportedAt: at,
      resolvedAt: null,
      resolvedBy: null,
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
    // Resolvido e a publicação de volta no ar: reabre na rodada seguinte, com a contagem do zero.
    reportRound = round + 1;
    tx.update(itemDoc, {
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      round: reportRound,
      reportCount: 1,
      reasons: { ...emptyFanClubReasons(), [key]: 1 },
      openedAt: at,
      lastReportedAt: at,
    });
  }
  tx.set(reportDoc, {
    postId,
    clubId: post.clubId,
    reporterUid: fan.uid,
    reason,
    round: reportRound,
    reportedAt: at,
    day: plan.day,
    schemaVersion: 1,
  });
  // No total do dia, sem central: o conteúdo de fã não é o da central oficial (decisão 17).
  addEngagementCounts(plan, [{ kind: 'reports', artistIds: [] }]);
  countDailyAction(plan, fan, award, 'report');
  return { plan, status: 'reported' };
}

/** Denunciar fora da API (o seed dos emuladores). Na mesma rodada, `already_reported`. */
export function runReportFanClubPost(
  db: Firestore,
  uid: string,
  input: { postId: string; reason: FanClubReportReason | null },
  options: RunOptions,
): Promise<ReportPostOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    reportFanClubPost(tx, db, { fan, award, ...input }),
  );
}

/** Denúncias por página (e por transação) na exclusão de conta. */
export const REPORTS_DELETE_PAGE = 100;

/**
 * As denúncias que o fã fez em publicações de fã-clube, na exclusão de conta
 * (34.7, passo 4), como as de perfil (29.9): em páginas de 100, cada uma numa
 * transação que relê as denúncias e os itens; cada denúncia sai, e a da
 * rodada aberta do item (o mesmo `round`) desconta dele (nunca abaixo de 0);
 * o item que chega a 0 vai a `resolved` com `withdrawn`. A de uma rodada
 * antiga sai sem mexer no item. Devolve quantas saíram.
 */
export async function removeFanClubReportsOf(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await fanClubReportsOf(db)
      .where('reporterUid', '==', uid)
      .limit(REPORTS_DELETE_PAGE)
      .get();
    if (snap.empty) return removed;
    const refs = snap.docs.map((doc) => doc.ref);
    const count = await db.runTransaction(async (tx) => {
      const reports = await tx.getAll(...refs);
      const postIds = [
        ...new Set(
          reports
            .filter((report) => report.exists)
            .map((report) => report.get('postId'))
            .filter((id): id is string => typeof id === 'string' && id !== ''),
        ),
      ];
      const itemSnaps =
        postIds.length > 0
          ? await tx.getAll(...postIds.map((id) => fanClubReportQueueRef(db, id)))
          : [];
      const items = new Map(postIds.map((id, index) => [id, itemSnaps[index]!]));
      const updates = new Map<string, { reportCount: number; reasons: FanClubReasonCounts }>();
      let deleted = 0;
      for (const report of reports) {
        if (!report.exists) continue;
        tx.delete(report.ref);
        deleted += 1;
        const postId = report.get('postId');
        const item = typeof postId === 'string' ? items.get(postId) : undefined;
        if (!item?.exists || item.get('status') !== 'open') continue;
        if (item.get('round') !== report.get('round')) continue;
        const current = updates.get(item.id) ?? {
          reportCount: countOf(item.get('reportCount')),
          reasons: fanClubReasonsOf(item.get('reasons')),
        };
        const key = storedFanClubReasonKey(report.get('reason'));
        current.reportCount = Math.max(0, current.reportCount - 1);
        current.reasons[key] = Math.max(0, current.reasons[key] - 1);
        updates.set(item.id, current);
      }
      for (const [id, update] of updates) {
        tx.update(fanClubReportQueueRef(db, id), {
          reportCount: update.reportCount,
          reasons: update.reasons,
          ...(update.reportCount === 0
            ? {
                status: 'resolved',
                resolution: 'withdrawn',
                resolvedAt: tsOf(now),
                resolvedBy: null,
              }
            : {}),
        });
      }
      return deleted;
    });
    removed += count;
    if (count === 0 && snap.size < REPORTS_DELETE_PAGE) return removed;
  }
}
