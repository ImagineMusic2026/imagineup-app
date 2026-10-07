import { set, subDays } from 'date-fns';

import { buildAgendaEventsFixture } from '@/domains/agenda/fixtures';
import { isUpcoming } from '@/domains/agenda/group-by-month';
import { ApiError } from '@/services/api/errors';
import { fixtureNow, fixtureWallet, onFixtureSessionEnd } from '@/services/fixtures';

import { REDEEM_ERROR_CODES, REWARDS_RULES_URL } from './consts';
import type {
  RedeemResult,
  RedemptionStatus,
  Reward,
  RewardKind,
  RewardRedemption,
  RewardsResponse,
} from './types';

/**
 * Loja de exemplo da 1h nas builds sem API: o mesmo catálogo do seed dos
 * emuladores (docs/arquitetura-api.md, 25.13, `functions/src/rewards/seed.ts`),
 * com os mesmos ids, custos, estoque, limites, shows e instruções, e os
 * pedidos antigos da Camila nos quatro status. Os reais vêm do painel. Texto
 * de fixture é dado, não interface: não passa por `t()`. Mudou um lado, mude o
 * outro e a tabela da nota (`__tests__/fixtures.test.ts` trava).
 */

type FixtureReward = {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string | null;
  cost: number;
  featured: boolean;
  scarcity: boolean;
  /** O total oferecido, ou `null` sem limite. */
  stockTotal: number | null;
  /** Os pedidos que seguram vaga (solicitados, aprovados e entregues) no começo. */
  redeemedCount: number;
  perFanLimit: number | null;
  /** O show da agenda de exemplo (`buildAgendaEventsFixture`). */
  eventId: string | null;
  instructions: string;
};

const INSTRUCTIONS: Record<RewardKind, string> = {
  meet: 'Mostre este código na entrada do camarim no dia do show, a partir das 20 h, com um documento com foto.',
  ticket:
    'Retire o par de ingressos na bilheteria do show com este código e um documento com foto.',
  videocall:
    'A equipe da Imagine Music fala com você pelo e-mail da sua conta em até 5 dias úteis para marcar a videochamada.',
  merch:
    'A equipe da Imagine Music fala com você pelo e-mail da sua conta para combinar o tamanho e a entrega da camisa.',
  screen:
    'A equipe da Imagine Music fala com você pelo e-mail da sua conta para receber a foto e avisar em qual show ela entra.',
};

/** O catálogo na ordem do painel (a tabela de 25.13). */
export const FIXTURE_REWARDS: readonly FixtureReward[] = [
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
    redeemedCount: 0,
    perFanLimit: 1,
    eventId: 'sao-joao-irara',
    instructions: INSTRUCTIONS.meet,
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
    redeemedCount: 1,
    perFanLimit: 2,
    eventId: null,
    instructions: INSTRUCTIONS.ticket,
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
    redeemedCount: 0,
    perFanLimit: 1,
    eventId: null,
    instructions: INSTRUCTIONS.videocall,
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
    redeemedCount: 1,
    perFanLimit: null,
    eventId: null,
    instructions: INSTRUCTIONS.merch,
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
    redeemedCount: 0,
    perFanLimit: 1,
    eventId: null,
    instructions: INSTRUCTIONS.screen,
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
    redeemedCount: 1,
    perFanLimit: 1,
    eventId: 'arrocha-na-praia',
    instructions:
      'Mostre este código na entrada do palco às 17 h do dia do show, com um documento com foto.',
  },
];

type FixtureRedemption = {
  code: string;
  rewardId: string;
  points: number;
  daysAgo: number;
  status: RedemptionStatus;
  /** Dias atrás do status de agora (o do pedido, no solicitado). */
  statusDaysAgo: number;
  refundedPoints: number;
  refusalReason: string | null;
};

/** Os pedidos antigos da Camila (a tabela de 25.13), às 18:00 de cada dia. */
export const FIXTURE_REDEMPTIONS: readonly FixtureRedemption[] = [
  {
    code: 'UP-4KD9TM',
    rewardId: 'ingressos',
    points: 6_000,
    daysAgo: 7,
    status: 'delivered',
    statusDaysAgo: 5,
    refundedPoints: 0,
    refusalReason: null,
  },
  {
    code: 'UP-9FJT6V',
    rewardId: 'videochamada',
    points: 8_500,
    daysAgo: 6,
    status: 'refused',
    statusDaysAgo: 5,
    refundedPoints: 8_500,
    refusalReason: 'A agenda de videochamadas deste mês fechou antes do seu pedido.',
  },
  {
    code: 'UP-7QXH2R',
    rewardId: 'passagem-de-som',
    points: 3_000,
    daysAgo: 4,
    status: 'approved',
    statusDaysAgo: 3,
    refundedPoints: 0,
    refusalReason: null,
  },
  {
    code: 'UP-C3NWPB',
    rewardId: 'camisa',
    points: 15_000,
    daysAgo: 2,
    status: 'requested',
    statusDaysAgo: 2,
    refundedPoints: 0,
    refusalReason: null,
  },
];

/** O alfabeto do código de retirada (o do convite: sem vogal, sem 0, 1, I, L e O). */
const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';

/** 18:00 do dia `daysAgo` antes de `now`, no fuso do aparelho (como o extrato de exemplo). */
function eveningDaysAgo(now: Date, daysAgo: number): string {
  return set(subDays(now, daysAgo), {
    hours: 18,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  }).toISOString();
}

const countsTowardLimit = (status: RedemptionStatus): boolean =>
  status === 'requested' || status === 'approved' || status === 'delivered';

/** Um pedido guardado: o da Camila (dias atrás) ou o desta sessão (instante fixo). */
type StoredRedemption = Omit<RewardRedemption, 'instructions'> & { rewardId: string };

function baseRedemptions(now: Date): StoredRedemption[] {
  return FIXTURE_REDEMPTIONS.map((item) => ({
    id: item.code,
    code: item.code,
    rewardId: item.rewardId,
    status: item.status,
    statusAt: eveningDaysAgo(now, item.statusDaysAgo),
    points: item.points,
    refundedPoints: item.refundedPoints,
    refusalReason: item.refusalReason,
    redeemedAt: eveningDaysAgo(now, item.daysAgo),
  }));
}

// Estado de "servidor": os pedidos desta abertura do app (do mais antigo para
// o mais novo) e o que cada chave de idempotência já devolveu, com o custo
// que ela mandou.
let sessionRedemptions: StoredRedemption[] = [];
let answered = new Map<string, { result: RedeemResult; expectedCost: number }>();

function allRedemptions(now: Date): StoredRedemption[] {
  return [...baseRedemptions(now), ...sessionRedemptions];
}

function reject(kind: ApiError['kind'], message: string, status: number, code: string): never {
  throw new ApiError(kind, message, status, code);
}

/** A recompensa como a loja mostra, com o show aberto e os pedidos do fã. */
function toReward(item: FixtureReward, now: Date, redemptions: StoredRedemption[]): Reward {
  const mine = redemptions
    .filter((redemption) => redemption.rewardId === item.id)
    .sort((a, b) => Date.parse(b.redeemedAt) - Date.parse(a.redeemedAt));
  const taken =
    item.redeemedCount +
    sessionRedemptions.filter(
      (redemption) => redemption.rewardId === item.id && countsTowardLimit(redemption.status),
    ).length;
  const remaining = item.stockTotal === null ? null : Math.max(0, item.stockTotal - taken);
  const event = item.eventId
    ? (buildAgendaEventsFixture(now).find((candidate) => candidate.id === item.eventId) ?? null)
    : null;
  const eventOpen = event !== null && isUpcoming(event, now);
  const counted = mine.filter((redemption) => countsTowardLimit(redemption.status)).length;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    description: item.description,
    cost: item.cost,
    imageUrl: null,
    featured: item.featured,
    scarcity: item.scarcity,
    stock: item.stockTotal === null ? null : { total: item.stockTotal, remaining: remaining ?? 0 },
    event: eventOpen && event ? { name: event.title, startsAt: event.startsAt } : null,
    status: remaining === 0 || (item.eventId !== null && !eventOpen) ? 'soldOut' : 'available',
    perFanLimit: item.perFanLimit,
    limitReached: item.perFanLimit !== null && counted >= item.perFanLimit,
    redemptions: mine.map(({ rewardId: _rewardId, ...redemption }) => ({
      ...redemption,
      instructions: item.instructions,
    })),
  };
}

/** A loja com o estoque que sobrou; objetos novos a cada chamada. */
export function buildRewardsFixture(now: Date): RewardsResponse {
  const redemptions = allRedemptions(now);
  return {
    rulesUrl: REWARDS_RULES_URL.trim() === '' ? null : REWARDS_RULES_URL,
    rewards: FIXTURE_REWARDS.map((item) => toReward(item, now, redemptions)),
  };
}

/** Um código novo, do mesmo alfabeto do servidor, que ainda não existe. */
function drawCode(taken: ReadonlySet<string>): string {
  for (;;) {
    let code = 'UP-';
    for (let index = 0; index < 6; index += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!taken.has(code)) return code;
  }
}

/**
 * O servidor do resgate nas fixtures, com as recusas da API na mesma ordem
 * (25.2), fora o teto do dia: a chave já usada com outro custo
 * (`idempotency_key_reused`), a recompensa que não existe
 * (`reward_not_found`), esgotada (`sold_out`: sem vaga ou com o show que
 * passou), o custo mudado (`reward_changed`), o limite por fã
 * (`redeem_limit_reached`) e, pela `fixtureWallet.spend`, o saldo
 * (`insufficient_points`). Desconta só o saldo (o nível e a temporada não
 * caem), baixa o estoque e devolve o código e as instruções, com o pedido
 * solicitado, que também voltam na loja (`redemptions`). A mesma chave
 * devolve o resgate da primeira vez, sem gastar de novo. Fica em memória e
 * volta ao início quando o app reabre ou a sessão termina.
 */
export const rewardsFixture = {
  redeem(
    rewardId: string,
    idempotencyKey: string,
    expectedCost: number,
    now: Date = fixtureNow(),
  ): RedeemResult {
    const previous = answered.get(idempotencyKey);
    if (previous) {
      if (previous.expectedCost !== expectedCost) {
        reject(
          'validation',
          'Esta chave já foi usada em outro pedido.',
          422,
          REDEEM_ERROR_CODES.alreadyRedeemed,
        );
      }
      return { ...previous.result };
    }

    const base = FIXTURE_REWARDS.find((candidate) => candidate.id === rewardId);
    if (!base) {
      reject('notFound', 'Recompensa não encontrada.', 404, REDEEM_ERROR_CODES.notFound);
    }
    const redemptions = allRedemptions(now);
    const item = toReward(base, now, redemptions);
    if (item.status === 'soldOut') {
      reject('validation', 'Recompensa esgotada.', 409, REDEEM_ERROR_CODES.soldOut);
    }
    if (expectedCost !== item.cost) {
      reject(
        'validation',
        'O custo desta recompensa mudou. Confira antes de resgatar.',
        409,
        REDEEM_ERROR_CODES.changed,
      );
    }
    if (item.limitReached) {
      reject(
        'validation',
        'Você chegou ao limite de resgates desta recompensa.',
        409,
        REDEEM_ERROR_CODES.limitReached,
      );
    }
    // Sem saldo, a carteira recusa antes de mexer no estoque.
    const { balance } = fixtureWallet.spend(item.cost);
    const code = drawCode(new Set(redemptions.map((redemption) => redemption.code)));
    const at = now.toISOString();
    sessionRedemptions = [
      ...sessionRedemptions,
      {
        id: code,
        code,
        rewardId,
        status: 'requested',
        statusAt: at,
        points: item.cost,
        refundedPoints: 0,
        refusalReason: null,
        redeemedAt: at,
      },
    ];
    const result: RedeemResult = {
      redemptionId: code,
      rewardId,
      code,
      balance,
      instructions: base.instructions,
      redeemedAt: at,
      status: 'requested',
    };
    answered.set(idempotencyKey, { result, expectedCost });
    return { ...result };
  },

  /** Volta ao início (fim da sessão e testes). A carteira volta com `fixtureWallet.reset()`. */
  reset(): void {
    sessionRedemptions = [];
    answered = new Map();
  },
};

onFixtureSessionEnd(() => rewardsFixture.reset());
