import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { buildRewardsFixture, rewardsFixture } from './fixtures';
import type { RedeemResult, RedeemVariables, RewardsResponse } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchRewards(): Promise<RewardsResponse> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildRewardsFixture(fixtureNow());
  }
  const { data } = await api.get<RewardsResponse>('/rewards');
  return data;
}

/**
 * Troca pontos do saldo por uma recompensa. Quem decide é o servidor (saldo,
 * estoque, instruções); a chave de idempotência impede que uma repetição gaste
 * duas vezes.
 */
export async function redeemReward({
  rewardId,
  idempotencyKey,
}: RedeemVariables): Promise<RedeemResult> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return rewardsFixture.redeem(rewardId, idempotencyKey);
  }
  const { data } = await api.request<RedeemResult>({
    method: 'POST',
    url: `/rewards/${encodeURIComponent(rewardId)}/redeem`,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}
