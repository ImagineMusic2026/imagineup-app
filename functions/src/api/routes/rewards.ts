import { parseExpectedCost, readRewardsForFan, redeemReward, isRewardId } from '../../rewards';
import type { RedeemResult, RewardsResponse } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// Rotas da loja (bloco 10): a loja do fã e o resgate. O resgate roda no
// runIdempotent, com o perfil exigido e a atividade marcada, numa transação
// só que confere o teto do dia, a recompensa, o show, o custo, o limite por
// fã, o estoque e o saldo. docs/arquitetura-api.md, seção 25.

/** Id da recompensa fora do formato: a recompensa não existe (404), como os posts. */
function rewardParam(input: RouteInput): void {
  if (!isRewardId(input.params.rewardId)) throw apiError('reward_not_found');
}

/** O custo que o fã viu (`{ expectedCost }`); fora do formato, 400 com o campo. */
function expectedCost(input: RouteInput): number {
  const cost = parseExpectedCost(input.body);
  if (cost === undefined) throw apiError('invalid_request', { field: 'expectedCost' });
  return cost;
}

export const rewardRoutes: ApiRoute[] = [
  {
    method: 'GET',
    pattern: '/rewards',
    writes: false,
    async handle(ctx): Promise<RewardsResponse> {
      return readRewardsForFan(ctx.deps.db, ctx.uid, ctx.now);
    },
  },
  {
    // Resgatar: só o saldo cai (XP, nível e temporada ficam); o pedido nasce
    // solicitado, com o código de retirada sorteado.
    method: 'POST',
    pattern: '/rewards/:rewardId/redeem',
    writes: true,
    validate: (input) => {
      rewardParam(input);
      expectedCost(input);
    },
    async handle(ctx) {
      const { plan, result } = await redeemReward(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        rewardId: ctx.params.rewardId!,
        expectedCost: expectedCost(ctx),
        profile: ctx.profile,
      });
      // Sem código fixo (só o seed passa), o pedido sempre nasce.
      const body: RedeemResult = result!;
      return { body, plan };
    },
  },
];
