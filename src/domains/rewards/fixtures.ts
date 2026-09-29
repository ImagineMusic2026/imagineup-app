import { addMonths, set, startOfMonth } from 'date-fns';

import { ApiError } from '@/services/api/errors';
import { fixtureNow, fixtureWallet } from '@/services/fixtures';

import { REDEEM_ERROR_CODES } from './consts';
import type { RedeemResult, Reward, RewardKind, RewardRedemption, RewardsResponse } from './types';

/**
 * Loja de exemplo da 1h enquanto a API (M2) não existe: as recompensas do
 * protótipo, com custos, estoque e instruções de exemplo. Os reais vêm do
 * painel. Texto de fixture é dado, não interface: não passa por `t()`.
 */

/** Dia 21 do mês seguinte, às 22 h: o São João de Irará, destaque da agenda. */
function nextShow(now: Date): string {
  return set(addMonths(startOfMonth(now), 1), {
    date: 21,
    hours: 22,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  }).toISOString();
}

type Defaults = 'featured' | 'scarcity' | 'stock' | 'event' | 'status' | 'imageUrl' | 'redemptions';
type RewardBase = Omit<Reward, Defaults> & Partial<Pick<Reward, Defaults>>;

function reward(base: RewardBase): Reward {
  return {
    imageUrl: null,
    featured: false,
    scarcity: false,
    stock: null,
    event: null,
    status: 'available',
    redemptions: [],
    ...base,
  };
}

/** A loja na ordem do painel, antes do que foi resgatado nesta abertura do app. */
function buildBaseRewards(now: Date): Reward[] {
  return [
    reward({
      id: 'meet-netto',
      kind: 'meet',
      title: 'Meet & greet com o Netto',
      subtitle: 'Camarim do São João de Irará',
      description:
        'Um encontro rápido com o Netto Brito no camarim, antes do show, com foto e autógrafo.',
      cost: 10_000,
      featured: true,
      scarcity: true,
      stock: { remaining: 20, total: 20 },
      event: { name: 'São João de Irará', startsAt: nextShow(now) },
    }),
    reward({
      id: 'ingressos',
      kind: 'ticket',
      title: 'Par de ingressos',
      subtitle: 'Pra Encher e Derramar',
      description: 'Dois ingressos de pista para o Pra Encher e Derramar, em Feira de Santana.',
      cost: 6_000,
    }),
    reward({
      id: 'videochamada',
      kind: 'videocall',
      title: 'Videochamada',
      subtitle: '5 min com o artista',
      description:
        'Cinco minutos de videochamada com um artista da Imagine Music, no dia e horário que a equipe combinar com você.',
      cost: 8_500,
    }),
    reward({
      id: 'camisa',
      kind: 'merch',
      title: 'Camisa oficial',
      subtitle: 'Coleção São João',
      description:
        'A camisa oficial da coleção São João, no tamanho que você escolher com a equipe.',
      cost: 15_000,
    }),
    reward({
      id: 'telao',
      kind: 'screen',
      title: 'Foto no telão',
      subtitle: 'Durante o show',
      description: 'Sua foto aparece no telão durante um show da Imagine Music.',
      cost: 20_000,
    }),
  ];
}

/**
 * Instruções de exemplo que o servidor devolve no resgate: retirada com o
 * código ou contato da equipe pelo e-mail da conta. O app nunca pede endereço;
 * a entrega física fica com a equipe.
 */
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

// Estado de "servidor": resgates do fã desta abertura do app, por recompensa
// (do mais antigo para o mais novo), e o que cada chave de idempotência já
// devolveu.
let redeemedById = new Map<string, RewardRedemption[]>();
let answered = new Map<string, RedeemResult>();
let redemptionCount = 0;

function applyRedemptions(item: Reward): Reward {
  const taken = redeemedById.get(item.id) ?? [];
  if (taken.length === 0) return item;
  const redemptions = taken.map((redemption) => ({ ...redemption })).reverse();
  if (!item.stock) return { ...item, redemptions };
  const remaining = Math.max(0, item.stock.remaining - taken.length);
  return {
    ...item,
    redemptions,
    stock: { ...item.stock, remaining },
    status: remaining === 0 ? 'soldOut' : item.status,
  };
}

/** A loja com o estoque que sobrou; objetos novos a cada chamada. */
export function buildRewardsFixture(now: Date): RewardsResponse {
  return { rewards: buildBaseRewards(now).map(applyRedemptions) };
}

/**
 * O servidor do resgate nas fixtures. Desconta só o saldo (`fixtureWallet`: o
 * nível e a temporada não caem), baixa o estoque e devolve o código e as
 * instruções, que também voltam na loja (`redemptions`). Recusa sem saldo
 * (`insufficient_points`) e esgotado (`sold_out`) com os erros que a API
 * mandaria. A mesma chave de idempotência devolve o resgate da primeira vez,
 * sem gastar de novo. Fica em memória e volta ao início quando o app reabre.
 */
export const rewardsFixture = {
  redeem(rewardId: string, idempotencyKey: string, now: Date = fixtureNow()): RedeemResult {
    const previous = answered.get(idempotencyKey);
    if (previous) return { ...previous };

    const item = buildRewardsFixture(now).rewards.find((candidate) => candidate.id === rewardId);
    if (!item) {
      throw new ApiError(
        'notFound',
        'Recompensa não encontrada.',
        404,
        REDEEM_ERROR_CODES.notFound,
      );
    }
    if (item.status === 'soldOut' || item.stock?.remaining === 0) {
      throw new ApiError('validation', 'Recompensa esgotada.', 409, REDEEM_ERROR_CODES.soldOut);
    }
    // Sem saldo, a carteira recusa antes de mexer no estoque.
    const { balance } = fixtureWallet.spend(item.cost);
    redemptionCount += 1;
    const redemption: RewardRedemption = {
      id: `resgate-${redemptionCount}`,
      code: `UP-${1000 + redemptionCount}`,
      instructions: INSTRUCTIONS[item.kind],
      redeemedAt: now.toISOString(),
    };
    redeemedById.set(item.id, [...(redeemedById.get(item.id) ?? []), redemption]);

    const result: RedeemResult = {
      redemptionId: redemption.id,
      rewardId: item.id,
      code: redemption.code,
      balance,
      instructions: redemption.instructions,
      redeemedAt: redemption.redeemedAt,
    };
    answered.set(idempotencyKey, result);
    return { ...result };
  },

  /** Volta ao início (testes). A carteira volta com `fixtureWallet.reset()`. */
  reset(): void {
    redeemedById = new Map();
    answered = new Map();
    redemptionCount = 0;
  },
};
