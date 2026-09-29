import { fixtureWallet } from '@/services/fixtures';

import type { MyInvite, Wallet } from './types';

/**
 * Carteira de exemplo, lida da carteira das fixtures (`fixtureWallet`), que o
 * resgate desconta e as ações que valem ponto somam. Objeto novo a cada chamada.
 */
export function buildWalletFixture(): Wallet {
  const { balance, xp, seasonPoints } = fixtureWallet.get();
  return { balance, xp, seasonPoints } satisfies Wallet;
}

/**
 * Convite de exemplo da Camila do protótipo. Código e pontos são exemplo: os
 * de verdade vêm da API e do painel.
 */
export function buildMyInviteFixture(): MyInvite {
  return { code: 'CAMILA12', pointsPerVisit: 2, pointsPerSignup: 10 } satisfies MyInvite;
}
