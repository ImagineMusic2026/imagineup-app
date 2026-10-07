import {
  FieldPath,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import type { EventRecord } from '../agenda/model';
import { eventOf, eventRef } from '../agenda/store';
import type { RedeemResult, RewardsResponse } from '../api/contract';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import {
  addRedemptionCounts,
  applyAwards,
  planAwards,
  retryOnAlreadyExists,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { dayKey, NO_GAME, type Actor, type AwardEntry, type PointsConfig } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import {
  addRedemptionToShard,
  emptyShardDelta,
  isEmptyShardDelta,
  pickShard,
  shardRef,
  shardWrite,
} from '../points/stats';
import { rewardPanelError } from './errors';
import {
  compareRewards,
  drawRedemptionCode,
  FAN_REDEMPTIONS_READ_MAX,
  isOpenRedemption,
  isRewardId,
  isVisibleToFan,
  redeemProblem,
  REDEMPTION_DELETE_PAGE,
  redemptionRecord,
  REWARDS_LIST_MAX,
  rewardProblem,
  rewardRecord,
  rewardView,
  rulesUrlOf,
  transitionProblem,
  type RedemptionStatus,
  type RewardRecord,
} from './model';
import {
  redemptionOf,
  redemptionRef,
  redemptionsRef,
  rewardOf,
  rewardRef,
  rewardsRef,
} from './store';

// Loja e resgate no Firestore (bloco 10, docs/arquitetura-api.md, 25.2 a
// 25.4 e 25.11): a loja do fã, o resgate numa transação só (teto do dia,
// recompensa, show, custo, limite por fã, estoque e o débito pelo núcleo de
// pontos), as transições de status do pedido (a recusa devolve os pontos pelo
// `refund` do núcleo) e o cancelamento dos pedidos abertos na exclusão de conta.

const iso = (ms: number) => new Date(ms).toISOString();

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * `GET /rewards` (25.2): as recompensas no ar na ordem do painel, as
 * encerradas em que o fã tem pedido (no lugar delas, como esgotadas), os
 * pedidos dele em cada uma e o show aberto montado na hora. Só lê.
 */
export async function readRewardsForFan(
  db: Firestore,
  uid: string,
  now: number,
): Promise<RewardsResponse> {
  const [published, mine] = await Promise.all([
    rewardsRef(db)
      .where('status', '==', 'published')
      .orderBy('order')
      .orderBy(FieldPath.documentId())
      .limit(REWARDS_LIST_MAX)
      .get(),
    redemptionsRef(db)
      .where('uid', '==', uid)
      .orderBy('requestedAt', 'desc')
      .limit(FAN_REDEMPTIONS_READ_MAX)
      .get(),
  ]);
  const rewards = new Map<string, RewardRecord>();
  for (const doc of published.docs) rewards.set(doc.id, rewardRecord(doc.id, doc.data()));
  const redemptions = mine.docs.map((doc) => redemptionRecord(doc.id, doc.data()));

  // As recompensas dos pedidos que não vieram na lista: na prática, as encerradas.
  const missing = [...new Set(redemptions.map((item) => item.rewardId))].filter(
    (id) => isRewardId(id) && !rewards.has(id),
  );
  if (missing.length > 0) {
    const snaps = await db.getAll(...missing.map((id) => rewardRef(db, id)));
    for (const snap of snaps) {
      const reward = rewardOf(snap);
      if (reward && isVisibleToFan(reward, true)) rewards.set(reward.id, reward);
    }
  }

  const list = [...rewards.values()].sort(compareRewards);
  const eventIds = [
    ...new Set(list.map((reward) => reward.eventId).filter((id): id is string => id !== null)),
  ];
  const events = new Map<string, EventRecord | null>();
  if (eventIds.length > 0) {
    const snaps = await db.getAll(...eventIds.map((id) => eventRef(db, id)));
    eventIds.forEach((id, index) => events.set(id, eventOf(snaps[index])));
  }

  return {
    rulesUrl: rulesUrlOf(),
    rewards: list.map((reward) =>
      rewardView(reward, {
        event: reward.eventId ? (events.get(reward.eventId) ?? null) : null,
        redemptions,
        now,
      }),
    ),
  };
}

export type RedeemOutcome = { plan: AwardPlan; result: RedeemResult | null };

/**
 * O resgate (`POST /rewards/:rewardId/redeem`, 25.4), no `runIdempotent`,
 * depois do `requireFan`, numa transação só:
 * 1. o teto do dia (antes de ler a recompensa disputada);
 * 2. a recompensa: não existe ou em rascunho, encerrada, sem vaga;
 * 3. o show (só com show) e os pedidos do fã nesta recompensa (só com limite);
 * 4. show fechado, custo mudado, limite por fã;
 * 5. o código sorteado (`crypto.randomInt`), sem ler: o `tx.create` garante
 *    que é único, e a colisão volta pelo `retryOnAlreadyExists`;
 * 6. o débito pelo núcleo (`redeem:<código>`, só o saldo; saldo curto é
 *    `insufficient_points`);
 * 7. o pedido `requested`, o `redeemedCount` mais 1, os contadores do dia e o
 *    teto.
 * O seed passa um código fixo, lido junto com a recompensa: se o pedido já
 * existe, sai sem efeito (`result: null`).
 */
export async function redeemReward(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    rewardId: string;
    expectedCost: number;
    /** users/{uid} lido na transação: a cópia do nome e do @ (25.1, decisão 13). */
    profile: DocumentSnapshot;
    /** O sorteio do código; só o teste da colisão troca. */
    drawCode?: () => string;
    /** Código fixo, só do seed. */
    code?: string;
  },
): Promise<RedeemOutcome> {
  const { fan, award, rewardId, expectedCost } = options;
  enforceDailyCap(fan, award, 'redeem');

  const fixed = options.code ? redemptionRef(db, options.code) : null;
  const [rewardSnap, fixedSnap] = await tx.getAll(
    rewardRef(db, rewardId),
    ...(fixed ? [fixed] : []),
  );
  if (fixed && fixedSnap?.exists) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      result: null,
    };
  }
  const reward = rewardOf(rewardSnap);
  const first = rewardProblem(reward);
  if (first) throw first;
  const item = reward!;

  const [eventSnap, limitSnap] = await Promise.all([
    item.eventId ? tx.get(eventRef(db, item.eventId)) : Promise.resolve(null),
    // Só igualdades: a junção dos índices simples, sem composto (25.17).
    item.perFanLimit !== null
      ? tx.get(redemptionsRef(db).where('uid', '==', fan.uid).where('rewardId', '==', rewardId))
      : Promise.resolve(null),
  ]);
  const problem = redeemProblem({
    reward: item,
    event: eventSnap ? eventOf(eventSnap) : null,
    expectedCost,
    fanRedemptions: limitSnap
      ? limitSnap.docs.map((doc) => redemptionRecord(doc.id, doc.data()))
      : [],
    now: award.now,
  });
  if (problem) throw problem;

  const code = options.code ?? (options.drawCode ?? drawRedemptionCode)();
  const entry: AwardEntry = {
    kind: 'spend',
    source: 'redeem',
    eventId: code,
    points: item.cost,
    subject: { type: 'reward', id: rewardId },
    ...(item.title ? { title: item.title } : {}),
  };
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [entry] }], award);

  const at = Timestamp.fromMillis(award.now);
  tx.create(redemptionRef(db, code), {
    code,
    rewardId,
    rewardTitle: item.title,
    rewardKind: item.kind,
    eventId: item.eventId,
    points: item.cost,
    uid: fan.uid,
    fanName: textOrNull(options.profile.get('displayName')),
    fanUsername: textOrNull(options.profile.get('username')),
    status: 'requested',
    instructions: item.instructions,
    refusalReason: null,
    refundedPoints: 0,
    restocked: null,
    requestedAt: at,
    approvedAt: null,
    deliveredAt: null,
    refusedAt: null,
    canceledAt: null,
    statusAt: at,
    updatedBy: null,
    accountDeleted: false,
    schemaVersion: 1,
  });
  // O resgate não grava o updatedAt da recompensa: o campo é das mudanças da equipe.
  tx.update(rewardRef(db, rewardId), { redeemedCount: item.redeemedCount + 1 });
  addRedemptionCounts(plan, [{ rewardId, kind: 'requested', points: item.cost }]);
  countDailyAction(plan, fan, award, 'redeem');

  const balance =
    plan.fans.find((planned) => planned.uid === fan.uid)?.wallet?.state.balance ??
    fan.wallet.balance - item.cost;
  return {
    plan,
    result: {
      redemptionId: code,
      rewardId,
      code,
      balance,
      instructions: item.instructions,
      redeemedAt: iso(award.now),
      status: 'requested',
    },
  };
}

/** A mudança de status pedida (pela equipe, ou pelo seed com o `expectFrom`). */
export type RedemptionStatusChange = {
  code: string;
  to: 'approved' | 'delivered' | 'refused';
  /** Só na recusa: o texto que o fã vê, ou null. */
  reason: string | null;
  /** Só na recusa: a vaga volta (padrão) ou não (decisão 5). */
  restock: boolean;
  /**
   * Só no seed: a transição roda só quando o status de agora é este; com outro,
   * sai sem efeito (25.4, passo 7).
   */
  expectFrom?: RedemptionStatus;
};

/** O contexto da mudança: o "agora", os valores (só a versão entra no lançamento), o shard e quem fez. */
export type RedemptionStatusContext = {
  now: number;
  config: PointsConfig;
  shard: number;
  actor: Actor;
};

export type RedemptionStatusOutcome = {
  /** false: o mesmo status de agora (ou o `expectFrom` do seed não bateu), sem gravar. */
  changed: boolean;
  from: RedemptionStatus;
  status: RedemptionStatus;
  rewardId: string;
  /** Na recusa, o que voltou ao saldo (o guardado, na repetição); 0 nos outros. */
  refundedPoints: number;
  restocked: boolean | null;
};

/**
 * Muda o status de um pedido (25.4), na transação de quem chama (a callable
 * já leu quem é da equipe nela). O mesmo status responde sem gravar, com o
 * `refundedPoints` guardado; fora da tabela é `invalid-transition`. Aprovar e
 * entregar só gravam o pedido e o contador do dia. Recusar devolve os pontos
 * pelo núcleo (`redeem_refund:<código>`, uma vez; o fã sem perfil não recebe
 * nada) e tira 1 do `redeemedCount` (nunca abaixo de 0); com `restock: false`
 * e estoque, tira 1 também do total, e o que sobra não muda.
 */
export async function applyRedemptionStatus(
  tx: Transaction,
  db: Firestore,
  change: RedemptionStatusChange,
  ctx: RedemptionStatusContext,
): Promise<RedemptionStatusOutcome> {
  const snap = await tx.get(redemptionRef(db, change.code));
  const redemption = redemptionOf(snap);
  if (!redemption) throw rewardPanelError('redemption-not-found');
  const from = redemption.status;
  const unchanged: RedemptionStatusOutcome = {
    changed: false,
    from,
    status: from,
    rewardId: redemption.rewardId,
    refundedPoints: from === 'refused' ? redemption.refundedPoints : 0,
    restocked: from === 'refused' ? redemption.restocked : null,
  };
  if (change.expectFrom && from !== change.expectFrom) return unchanged;
  const problem = transitionProblem(from, change.to);
  if (problem === 'unchanged') return unchanged;
  if (problem) throw rewardPanelError('invalid-transition', { from, to: change.to });

  const award: AwardContext = {
    now: ctx.now,
    config: ctx.config,
    shard: ctx.shard,
    actor: ctx.actor,
    game: NO_GAME,
  };
  const at = Timestamp.fromMillis(ctx.now);
  const updatedBy =
    ctx.actor.type === 'staff' && ctx.actor.uid
      ? { uid: ctx.actor.uid, name: ctx.actor.name ?? '' }
      : null;
  const { rewardId } = redemption;

  if (change.to !== 'refused') {
    const plan = await planAwards(tx, db, [], award);
    tx.update(snap.ref, {
      status: change.to,
      [change.to === 'approved' ? 'approvedAt' : 'deliveredAt']: at,
      statusAt: at,
      updatedBy,
    });
    addRedemptionCounts(plan, [{ rewardId, kind: change.to }]);
    applyAwards(tx, db, plan);
    return { changed: true, from, status: change.to, rewardId, refundedPoints: 0, restocked: null };
  }

  const rewardSnap = isRewardId(rewardId) ? await tx.get(rewardRef(db, rewardId)) : null;
  const entries: AwardEntry[] =
    redemption.uid && redemption.points > 0
      ? [
          {
            kind: 'refund',
            source: 'redeem_refund',
            eventId: change.code,
            points: redemption.points,
            subject: isRewardId(rewardId) ? { type: 'reward', id: rewardId } : null,
            ...(redemption.rewardTitle ? { title: redemption.rewardTitle } : {}),
          },
        ]
      : [];
  const plan = await planAwards(
    tx,
    db,
    redemption.uid && entries.length > 0 ? [{ uid: redemption.uid, entries }] : [],
    award,
  );
  const refundedPoints =
    plan.results.find(
      (result) => result.entryId === `redeem_refund:${change.code}` && result.status === 'applied',
    )?.points ?? 0;

  tx.update(snap.ref, {
    status: 'refused',
    refusedAt: at,
    statusAt: at,
    refusalReason: change.reason,
    refundedPoints,
    restocked: change.restock,
    updatedBy,
  });
  const reward = rewardSnap ? rewardOf(rewardSnap) : null;
  if (reward && rewardSnap) {
    const redeemedCount = Math.max(0, reward.redeemedCount - 1);
    const fields: Record<string, number> = { redeemedCount };
    if (!change.restock && reward.stockTotal !== null) {
      fields.stockTotal = Math.max(redeemedCount, reward.stockTotal - 1);
    }
    tx.update(rewardSnap.ref, fields);
  }
  addRedemptionCounts(plan, [{ rewardId, kind: 'refused', points: refundedPoints }]);
  applyAwards(tx, db, plan);
  return {
    changed: true,
    from,
    status: 'refused',
    rewardId,
    refundedPoints,
    restocked: change.restock,
  };
}

/**
 * Exclusão de conta (25.11), depois do engajamento do mural e antes do
 * `recursiveDelete` do perfil, em páginas de 100, cada uma numa transação que
 * relê os pedidos (o que já perdeu o uid fica como está): os solicitados e
 * aprovados viram `canceled` e devolvem a vaga (nenhum ponto volta: a
 * carteira sai depois); todo pedido do fã perde o uid, a cópia do nome e do @
 * e o motivo da recusa, e ganha `accountDeleted`. Um shard por transação, com
 * os cancelados. Rodar de novo não acha pedido com o uid. A transação decide
 * pelo que relê, nunca pela página: uma recusa da equipe entre a consulta e a
 * transação fica recusada, e a vaga não volta duas vezes.
 */
export async function cancelFanRedemptions(
  db: Firestore,
  uid: string,
  options: {
    now?: () => number;
    random?: () => number;
    /**
     * Chamado entre a consulta de cada página e a transação dela, com os
     * códigos da página: os testes recusam um pedido ali, como a equipe no
     * meio da exclusão (o `onPage` das rodadas do ranking).
     */
    onPage?: (codes: string[]) => Promise<void>;
  } = {},
): Promise<{ canceled: number; anonymized: number }> {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let canceled = 0;
  let anonymized = 0;
  for (;;) {
    const page = await redemptionsRef(db)
      .where('uid', '==', uid)
      .limit(REDEMPTION_DELETE_PAGE)
      .get();
    if (page.empty) break;
    await options.onPage?.(page.docs.map((doc) => doc.id));
    const outcome = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...page.docs.map((doc) => doc.ref));
      const records = snaps
        .map((snap) => ({ snap, record: redemptionOf(snap) }))
        .filter(({ record }) => record !== null && record.uid === uid);
      const toCancel = records.filter(({ record }) => isOpenRedemption(record!.status));
      const rewardIds = [
        ...new Set(toCancel.map(({ record }) => record!.rewardId).filter((id) => isRewardId(id))),
      ];
      const rewardSnaps =
        rewardIds.length > 0 ? await tx.getAll(...rewardIds.map((id) => rewardRef(db, id))) : [];

      const at = now();
      const stamp = Timestamp.fromMillis(at);
      const perReward = new Map<string, number>();
      const delta = emptyShardDelta();
      for (const { snap, record } of records) {
        const open = isOpenRedemption(record!.status);
        tx.update(snap.ref, {
          uid: null,
          fanName: null,
          fanUsername: null,
          refusalReason: null,
          accountDeleted: true,
          ...(open
            ? { status: 'canceled', canceledAt: stamp, statusAt: stamp, updatedBy: null }
            : {}),
        });
        if (open) {
          perReward.set(record!.rewardId, (perReward.get(record!.rewardId) ?? 0) + 1);
          addRedemptionToShard(delta, record!.rewardId, 'canceled');
        }
      }
      rewardIds.forEach((id, index) => {
        const snap = rewardSnaps[index];
        const reward = rewardOf(snap);
        if (!reward || !snap) return;
        const minus = perReward.get(id) ?? 0;
        if (minus === 0) return;
        tx.update(snap.ref, { redeemedCount: Math.max(0, reward.redeemedCount - minus) });
      });
      if (!isEmptyShardDelta(delta)) {
        const day = dayKey(at);
        tx.set(shardRef(db, day, pickShard(random)), shardWrite(delta, day, at), { merge: true });
      }
      return { canceled: toCancel.length, anonymized: records.length };
    });
    canceled += outcome.canceled;
    anonymized += outcome.anonymized;
    // Nada mudou (outra entrega da exclusão levou tudo no meio): a seguinte vê vazio.
    if (outcome.anonymized === 0 && page.size < REDEMPTION_DELETE_PAGE) break;
  }
  return { canceled, anonymized };
}

// --- Fora da API: o seed dos emuladores ---------------------------------------------

/** O resgate fora da API (seed), com o código fixo: rodar de novo não duplica. */
export function runRedeemReward(
  db: Firestore,
  uid: string,
  input: { rewardId: string; expectedCost: number; code: string },
  options: RunOptions,
): Promise<RedeemOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award, profile) =>
    redeemReward(tx, db, { fan, award, profile, ...input }),
  );
}

/**
 * A mudança de status fora da API (seed), com o ator do sistema: sem
 * auditoria, com `updatedBy: null` e só a partir do `expectFrom` (25.4, passo 7).
 */
export function runRedemptionStatus(
  db: Firestore,
  change: RedemptionStatusChange & { expectFrom: RedemptionStatus },
  options: { now: number; config: PointsConfig; random?: () => number },
): Promise<RedemptionStatusOutcome> {
  const random = options.random ?? Math.random;
  return retryOnAlreadyExists(() =>
    db.runTransaction((tx) =>
      applyRedemptionStatus(tx, db, change, {
        now: options.now,
        config: options.config,
        shard: pickShard(random),
        actor: SEED_ACTOR,
      }),
    ),
  );
}
