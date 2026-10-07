import { api } from '@/services/api';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';

import { fetchRewards, redeemReward } from '../api';
import { rewardsFixture } from '../fixtures';
import type { RedeemResult, RewardsResponse } from '../types';

// O api.ts importa o axios do app, que puxa o Firebase (ESM no Jest); as
// fixtures da loja leem os shows da agenda de exemplo, que chegam às missões.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const request = jest.mocked(api.request);
const NOW = new Date(2026, 9, 7, 12, 0);

beforeEach(() => {
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  get.mockReset();
  request.mockReset();
});

afterEach(() => {
  rewardsFixture.reset();
  fixtureWallet.reset();
  setFixtureNow(null);
});

describe('loja do servidor (bloco 10)', () => {
  it('com a API, a 1h vem de GET /rewards, com o regulamento e os pedidos', async () => {
    mockDataSource = 'api';
    const response: RewardsResponse = { rulesUrl: null, rewards: [] };
    get.mockResolvedValue({ data: response });
    await expect(fetchRewards()).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith('/rewards');
  });

  it('com a API, o resgate é POST com a Idempotency-Key e o custo que o fã viu no corpo', async () => {
    mockDataSource = 'api';
    const result: RedeemResult = {
      redemptionId: 'UP-C3NWPB',
      rewardId: 'camisa',
      code: 'UP-C3NWPB',
      balance: 0,
      instructions: 'A equipe fala com você.',
      redeemedAt: NOW.toISOString(),
      status: 'requested',
    };
    request.mockResolvedValue({ data: result });
    await expect(
      redeemReward({ rewardId: 'camisa', idempotencyKey: 'chave-1234', expectedCost: 15_000 }),
    ).resolves.toEqual(result);
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      url: '/rewards/camisa/redeem',
      headers: { 'Idempotency-Key': 'chave-1234' },
      data: { expectedCost: 15_000 },
    });
  });

  it('nas fixtures, nada vai para a rede', async () => {
    const shop = await fetchRewards();
    expect(shop.rewards.map((reward) => reward.id)).toContain('passagem-de-som');
    const result = await redeemReward({
      rewardId: 'videochamada',
      idempotencyKey: 'chave-1234',
      expectedCost: 8_500,
    });
    expect(result).toMatchObject({ rewardId: 'videochamada', status: 'requested' });
    expect(get).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
