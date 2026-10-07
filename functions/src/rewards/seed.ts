import type { Firestore } from 'firebase-admin/firestore';

import { eventRef } from '../agenda/store';
import { runAward } from '../points/award';
import { createConfigSource } from '../points/config';
import { dayKey, shiftDay } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import type { RedemptionStatus, RewardFields } from './model';
import { newRewardDoc } from './panel';
import { runRedeemReward, runRedemptionStatus } from './service';
import { rewardRef } from './store';

// A loja de teste no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): o catálogo das fixtures do app
// (src/domains/rewards/fixtures.ts), com os mesmos ids, custos, estoque,
// limites e shows, e os pedidos antigos da Camila em status diferentes, pelos
// mesmos núcleos da rota e das callables. Nunca roda em produção: o script
// fixa o emulador. docs/arquitetura-api.md, 25.13.

type SeedReward = RewardFields & { id: string; status: 'draft' | 'published' };

const INSTRUCTIONS = {
  meet: 'Mostre este código na entrada do camarim no dia do show, a partir das 20 h, com um documento com foto.',
  ticket:
    'Retire o par de ingressos na bilheteria do show com este código e um documento com foto.',
  videocall:
    'A equipe da Imagine Music fala com você pelo e-mail da sua conta em até 5 dias úteis para marcar a videochamada.',
  merch:
    'A equipe da Imagine Music fala com você pelo e-mail da sua conta para combinar o tamanho e a entrega da camisa.',
  screen:
    'A equipe da Imagine Music fala com você pelo e-mail da sua conta para receber a foto e avisar em qual show ela entra.',
} as const;

/**
 * O catálogo na ordem do painel, todas no ar e sem foto (a tabela de 25.13): o
 * meet & greet é o destaque com escassez, a camisa é a sem limite e a
 * passagem de som, com 1 vaga, é a esgotada (pelo pedido da Camila).
 */
export const SEED_REWARDS: readonly SeedReward[] = [
  {
    id: 'meet-netto',
    kind: 'meet',
    title: 'Meet & greet com o Netto',
    subtitle: 'Camarim do São João de Irará',
    description:
      'Um encontro rápido com o Netto Brito no camarim, antes do show, com foto e autógrafo.',
    cost: 10_000,
    featured: true,
    scarcity: true,
    stockTotal: 20,
    perFanLimit: 1,
    eventId: 'sao-joao-irara',
    instructions: INSTRUCTIONS.meet,
    status: 'published',
  },
  {
    id: 'ingressos',
    kind: 'ticket',
    title: 'Par de ingressos',
    subtitle: 'Pra Encher e Derramar',
    description: 'Dois ingressos de pista para o Pra Encher e Derramar, em Feira de Santana.',
    cost: 6_000,
    featured: false,
    scarcity: false,
    stockTotal: null,
    perFanLimit: 2,
    eventId: null,
    instructions: INSTRUCTIONS.ticket,
    status: 'published',
  },
  {
    id: 'videochamada',
    kind: 'videocall',
    title: 'Videochamada',
    subtitle: '5 min com o artista',
    description:
      'Cinco minutos de videochamada com um artista da Imagine Music, no dia e horário que a equipe combinar com você.',
    cost: 8_500,
    featured: false,
    scarcity: false,
    stockTotal: null,
    perFanLimit: 1,
    eventId: null,
    instructions: INSTRUCTIONS.videocall,
    status: 'published',
  },
  {
    id: 'camisa',
    kind: 'merch',
    title: 'Camisa oficial',
    subtitle: 'Coleção São João',
    description: 'A camisa oficial da coleção São João, no tamanho que você escolher com a equipe.',
    cost: 15_000,
    featured: false,
    scarcity: false,
    stockTotal: null,
    perFanLimit: null,
    eventId: null,
    instructions: INSTRUCTIONS.merch,
    status: 'published',
  },
  {
    id: 'telao',
    kind: 'screen',
    title: 'Foto no telão',
    subtitle: 'Durante o show',
    description: 'Sua foto aparece no telão durante um show da Imagine Music.',
    cost: 20_000,
    featured: false,
    scarcity: false,
    stockTotal: null,
    perFanLimit: 1,
    eventId: null,
    instructions: INSTRUCTIONS.screen,
    status: 'published',
  },
  {
    id: 'passagem-de-som',
    kind: 'ticket',
    title: 'Passagem de som',
    subtitle: 'Arrocha na Praia',
    description: 'Acompanhe a passagem de som do Nenho antes do Arrocha na Praia, em Aracaju.',
    cost: 3_000,
    featured: false,
    scarcity: false,
    stockTotal: 1,
    perFanLimit: 1,
    eventId: 'arrocha-na-praia',
    instructions:
      'Mostre este código na entrada do palco às 17 h do dia do show, com um documento com foto.',
    status: 'published',
  },
  {
    // Rascunho: o app não mostra.
    id: 'recompensa-rascunho',
    kind: 'merch',
    title: 'Camisa autografada',
    subtitle: 'Coleção São João',
    description: null,
    cost: 30_000,
    featured: false,
    scarcity: false,
    stockTotal: null,
    perFanLimit: 1,
    eventId: null,
    instructions: INSTRUCTIONS.merch,
    status: 'draft',
  },
];

type SeedTransition = {
  to: 'approved' | 'delivered' | 'refused';
  daysAgo: number;
  /** O status de onde a transição sai: com outro, o seed pula (25.4, passo 7). */
  from: RedemptionStatus;
  reason?: string;
};

type SeedRedemption = {
  code: string;
  rewardId: string;
  points: number;
  daysAgo: number;
  then: readonly SeedTransition[];
};

/** Os pedidos antigos da Camila (a tabela de 25.13), às 18:00 de São Paulo. */
export const SEED_REDEMPTIONS: readonly SeedRedemption[] = [
  {
    code: 'UP-4KD9TM',
    rewardId: 'ingressos',
    points: 6_000,
    daysAgo: 7,
    then: [
      { to: 'approved', daysAgo: 6, from: 'requested' },
      { to: 'delivered', daysAgo: 5, from: 'approved' },
    ],
  },
  {
    code: 'UP-9FJT6V',
    rewardId: 'videochamada',
    points: 8_500,
    daysAgo: 6,
    then: [
      {
        to: 'refused',
        daysAgo: 5,
        from: 'requested',
        reason: 'A agenda de videochamadas deste mês fechou antes do seu pedido.',
      },
    ],
  },
  {
    code: 'UP-7QXH2R',
    rewardId: 'passagem-de-som',
    points: 3_000,
    daysAgo: 4,
    then: [{ to: 'approved', daysAgo: 3, from: 'requested' }],
  },
  { code: 'UP-C3NWPB', rewardId: 'camisa', points: 15_000, daysAgo: 2, then: [] },
];

/** O ajuste que paga os pedidos antigos (só o saldo): o que eles gastam no fim. */
export const SEED_SHOP_ADJUSTMENT = {
  eventId: 'camila-loja',
  balance: 24_000,
  daysAgo: 8,
} as const;

/** 18:00 de São Paulo (21:00 UTC) do dia `daysAgo` antes de `now`. */
export function eveningDaysAgo(now: number, daysAgo: number): number {
  return Date.parse(`${shiftDay(dayKey(now), -daysAgo)}T21:00:00.000Z`);
}

/**
 * O catálogo de teste, como o painel cadastraria e publicaria (sem a
 * conferência de foto e sem auditoria): cria só as que faltam. Os shows
 * citados precisam existir (o seed da agenda vem antes).
 */
export async function seedRewards(db: Firestore, now: number = Date.now()): Promise<number> {
  let created = 0;
  for (const [index, seed] of SEED_REWARDS.entries()) {
    const { id, status, ...fields } = seed;
    const ref = rewardRef(db, id);
    created += await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return 0;
      if (fields.eventId && !(await tx.get(eventRef(db, fields.eventId))).exists) {
        throw new Error(
          `O show ${fields.eventId} da recompensa ${id} não existe: rode o seed da agenda antes.`,
        );
      }
      tx.create(ref, newRewardDoc(fields, { order: index + 1, status, now, by: 'seed' }));
      return 1;
    });
  }
  return created;
}

export type SeedRedemptionsResult = { redeemed: number; transitions: number };

/**
 * Os pedidos antigos da Camila, em ordem de data: o ajuste `seed:camila-loja`
 * (8 dias atrás, +24.000 só no saldo), depois cada pedido pelo núcleo da rota
 * (com o código fixo) e as transições dele pelo núcleo das callables, com o
 * ator do sistema (sem auditoria, sem teto do dia, sem marcar atividade). A
 * carteira termina como antes (12.480 de saldo). Rodar de novo não muda nada:
 * o ajuste e os pedidos voltam sem efeito, e cada transição só roda a partir
 * do status de onde ela sai.
 */
export async function seedCamilaRedemptions(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<SeedRedemptionsResult> {
  const { points: config } = await createConfigSource(db, { ttlMs: 0 }).get();
  await runAward(
    db,
    uid,
    [
      {
        kind: 'adjust',
        source: 'seed',
        eventId: SEED_SHOP_ADJUSTMENT.eventId,
        balance: SEED_SHOP_ADJUSTMENT.balance,
      },
    ],
    { now: eveningDaysAgo(now, SEED_SHOP_ADJUSTMENT.daysAgo), config, actor: SEED_ACTOR },
  );

  type Step =
    | { daysAgo: number; kind: 'redeem'; redemption: SeedRedemption }
    | { daysAgo: number; kind: 'status'; code: string; transition: SeedTransition };
  const steps: Step[] = SEED_REDEMPTIONS.flatMap((redemption): Step[] => [
    { daysAgo: redemption.daysAgo, kind: 'redeem', redemption },
    ...redemption.then.map((transition): Step => ({
      daysAgo: transition.daysAgo,
      kind: 'status',
      code: redemption.code,
      transition,
    })),
  ]);
  // Do mais antigo ao mais novo; no mesmo dia, na ordem da tabela.
  const ordered = steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => b.step.daysAgo - a.step.daysAgo || a.index - b.index)
    .map(({ step }) => step);

  let redeemed = 0;
  let transitions = 0;
  for (const step of ordered) {
    const at = eveningDaysAgo(now, step.daysAgo);
    if (step.kind === 'redeem') {
      const outcome = await runRedeemReward(
        db,
        uid,
        {
          rewardId: step.redemption.rewardId,
          expectedCost: step.redemption.points,
          code: step.redemption.code,
        },
        { now: at, config, actor: SEED_ACTOR },
      );
      if (outcome.result) redeemed += 1;
    } else {
      const outcome = await runRedemptionStatus(
        db,
        {
          code: step.code,
          to: step.transition.to,
          reason: step.transition.reason ?? null,
          restock: true,
          expectFrom: step.transition.from,
        },
        { now: at, config },
      );
      if (outcome.changed) transitions += 1;
    }
  }
  return { redeemed, transitions };
}
