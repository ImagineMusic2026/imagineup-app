import { sourceOf } from '@/config/data-source';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { buildRewardsFixture, rewardsFixture } from './fixtures';
import type { RedeemResult, RedeemVariables, RewardsResponse } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchRewards(): Promise<RewardsResponse> {
  if (sourceOf('rewards') === 'fixtures') {
    await fixtureDelay();
    return buildRewardsFixture(fixtureNow());
  }
  const { data } = await api.get<RewardsResponse>('/rewards');
  return data;
}

/**
 * Troca pontos do saldo por uma recompensa. Quem decide é o servidor (saldo,
 * estoque, limite por fã, instruções); a chave de idempotência impede que uma
 * repetição gaste duas vezes, e o `expectedCost` (o custo que o fã viu na
 * confirmação) impede que ele pague um custo que não viu (`reward_changed`).
 */
export async function redeemReward({
  rewardId,
  idempotencyKey,
  expectedCost,
}: RedeemVariables): Promise<RedeemResult> {
  if (sourceOf('rewards') === 'fixtures') {
    await fixtureDelay();
    return rewardsFixture.redeem(rewardId, idempotencyKey, expectedCost);
  }
  const { data } = await api.request<RedeemResult>({
    method: 'POST',
    url: `/rewards/${encodeURIComponent(rewardId)}/redeem`,
    headers: { 'Idempotency-Key': idempotencyKey },
    data: { expectedCost },
  });
  return data;
}
