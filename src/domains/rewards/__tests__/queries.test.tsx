import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { profileKeys } from '@/domains/profile/keys';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

import { REDEEM_ERROR_CODES } from '../consts';
import { buildRewardsFixture, rewardsFixture } from '../fixtures';
import { rewardKeys, syncRefunds, useRedeemRewardMutation, useRewardsQuery } from '../queries';
import type { RedeemResult, RewardsResponse } from '../types';

/**
 * A loja e o resgate pelo seletor por domínio (bloco 10, 25.12): com a API, a
 * loja espera a rede e vai para o disco; o resgate manda a chave e o custo da
 * tentativa, busca de novo só a carteira e a loja, e as recusas definitivas
 * abrem chave nova; a devolução vista pelo fã busca a carteira pelo
 * `updatedAt` do servidor.
 */

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

let mockDataSource: 'api' | 'fixtures' = 'api';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const request = jest.mocked(api.request);
// Terça, 7 de outubro de 2026, 12 h.
const NOW = new Date(2026, 9, 7, 12, 0);

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const RESULT: RedeemResult = {
  redemptionId: 'UP-C3NWPB',
  rewardId: 'camisa',
  code: 'UP-C3NWPB',
  balance: 2_480,
  instructions: 'A equipe fala com você.',
  redeemedAt: NOW.toISOString(),
  status: 'requested',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'api';
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, networkMode: 'always', gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  get.mockImplementation(async (url: string) => {
    if (url === '/rewards') return { data: buildRewardsFixture(NOW) };
    throw new Error(`rota inesperada ${url}`);
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  rewardsFixture.reset();
  fixtureWallet.reset();
  jest.restoreAllMocks();
});

describe('a loja (useRewardsQuery)', () => {
  it('com a API, espera a rede e vai para o disco', async () => {
    const shop = renderHook(() => useRewardsQuery(), { wrapper });
    await waitFor(() => expect(shop.result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: rewardKeys.list() });
    expect(query?.options.networkMode).toBe('online');
    expect(query?.meta).toEqual({ realData: true });
    expect(get).toHaveBeenCalledWith('/rewards');
  });

  it('com a API e sem internet, pausa em vez de mostrar o exemplo', () => {
    onlineManager.setOnline(false);
    const shop = renderHook(() => useRewardsQuery(), { wrapper });
    expect(shop.result.current.fetchStatus).toBe('paused');
    expect(get).not.toHaveBeenCalled();
  });

  it('nas fixtures, roda sem rede e fica fora do disco', async () => {
    mockDataSource = 'fixtures';
    onlineManager.setOnline(false);
    const shop = renderHook(() => useRewardsQuery(), { wrapper });
    await waitFor(() => expect(shop.result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: rewardKeys.list() });
    expect(query?.options.networkMode).toBe('always');
    expect(query?.meta).toEqual({ realData: false });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('a devolução vista pelo fã (syncRefunds)', () => {
  // A videochamada das fixtures foi recusada 5 dias antes de NOW, às 18 h, com 8.500 de volta.
  const shop = (): RewardsResponse => buildRewardsFixture(NOW);
  const refusedAt = Date.parse(
    shop().rewards.find((reward) => reward.id === 'videochamada')!.redemptions[0]!.statusAt,
  );

  function walletWith(updatedAt: string | null | undefined) {
    client.setQueryData(profileKeys.wallet(), {
      balance: 12_480,
      xp: 12_480,
      seasonPoints: 4_120,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    });
    return jest.spyOn(client, 'invalidateQueries');
  }

  it('a recusa mais nova que a carteira em cache faz a carteira buscar de novo', () => {
    const invalidate = walletWith(new Date(refusedAt - 60_000).toISOString());
    syncRefunds(client, shop());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.wallet() });
  });

  it('a recusa antiga (a carteira gravou depois) não busca nada', () => {
    const invalidate = walletWith(new Date(refusedAt).toISOString());
    syncRefunds(client, shop());
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a recusa que não devolveu pontos (0) não busca nada', () => {
    const invalidate = walletWith(new Date(refusedAt - 60_000).toISOString());
    const response = shop();
    for (const reward of response.rewards) {
      for (const item of reward.redemptions) item.refundedPoints = 0;
    }
    syncRefunds(client, response);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a carteira salva sem o campo (cache antigo) busca de novo, e a que volta com ele não', () => {
    const invalidate = walletWith(undefined);
    syncRefunds(client, shop());
    expect(invalidate).toHaveBeenCalledTimes(1);
    invalidate.mockRestore();
    const again = walletWith(new Date(Date.now()).toISOString());
    syncRefunds(client, shop());
    expect(again).not.toHaveBeenCalled();
  });

  it('o relógio do aparelho adiantado ou atrasado não muda nada (os dois instantes são do servidor)', () => {
    jest.useFakeTimers({ now: new Date(2030, 0, 1), doNotFake: ['setTimeout', 'setInterval'] });
    try {
      const fresh = walletWith(new Date(refusedAt).toISOString());
      syncRefunds(client, shop());
      expect(fresh).not.toHaveBeenCalled();
      fresh.mockRestore();
      jest.setSystemTime(new Date(2020, 0, 1));
      const stale = walletWith(new Date(refusedAt - 1).toISOString());
      syncRefunds(client, shop());
      expect(stale).toHaveBeenCalledWith({ queryKey: profileKeys.wallet() });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sem a carteira em cache, ou nas fixtures, não faz nada', () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    syncRefunds(client, shop());
    mockDataSource = 'fixtures';
    walletWith(new Date(refusedAt - 60_000).toISOString());
    syncRefunds(client, shop());
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('o resgate (useRedeemRewardMutation)', () => {
  const keyOf = (call: number) =>
    (request.mock.calls[call]![0] as { headers: Record<string, string> }).headers[
      'Idempotency-Key'
    ];
  const costOf = (call: number) =>
    (request.mock.calls[call]![0] as { data: { expectedCost: number } }).data.expectedCost;

  /**
   * Um toque em confirmar, até o fim de verdade: os callbacks do toque rodam
   * quando o pedido termina, e as atualizações do React Query chegam num
   * `setTimeout` depois deles (o `notifyManager`), que o `act` espera aqui.
   */
  async function attempt(
    hook: { current: ReturnType<typeof useRedeemRewardMutation> },
    cost: number,
  ) {
    const settled = jest.fn();
    act(() => hook.current.redeem(cost, { onSuccess: settled, onError: settled }));
    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(hook.current.isPending).toBe(false);
  }

  it('o sucesso busca a carteira (com o progresso e o extrato) e a loja, e não as conquistas nem o convite', async () => {
    request.mockResolvedValue({ data: RESULT });
    client.setQueryData(profileKeys.wallet(), { balance: 17_480, xp: 12_480, seasonPoints: 4_120 });
    client.setQueryData(profileKeys.progress(), { xp: 12_480 });
    client.setQueryData(profileKeys.ledger(), { pages: [] });
    client.setQueryData(profileKeys.achievements(), { unlockedCount: 6 });
    client.setQueryData(profileKeys.invite(), { code: 'CAMILA12' });
    client.setQueryData(rewardKeys.list(), buildRewardsFixture(NOW));

    const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });
    await attempt(result, 15_000);

    expect(client.getQueryData(profileKeys.wallet())).toMatchObject({ balance: 2_480 });
    const invalidated = (key: readonly unknown[]) =>
      client.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated;
    expect(invalidated(profileKeys.wallet())).toBe(true);
    expect(invalidated(profileKeys.progress())).toBe(true);
    expect(invalidated(profileKeys.ledger())).toBe(true);
    expect(invalidated(rewardKeys.list())).toBe(true);
    expect(invalidated(profileKeys.achievements())).toBe(false);
    expect(invalidated(profileKeys.invite())).toBe(false);
    expect(costOf(0)).toBe(15_000);
  });

  it.each([
    ['limitReached', new ApiError('validation', 'x', 409, REDEEM_ERROR_CODES.limitReached)],
    ['changed', new ApiError('validation', 'x', 409, REDEEM_ERROR_CODES.changed)],
    ['dailyLimit', new ApiError('unknown', 'x', 429, REDEEM_ERROR_CODES.dailyLimit)],
  ])('%s é definitiva: a próxima tentativa leva chave nova', async (_name, error) => {
    request.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: RESULT });
    const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });
    await attempt(result, 15_000);
    await attempt(result, 15_000);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('depois de uma falha incerta, a nova tentativa leva a mesma chave e o mesmo custo, mesmo com o custo novo', async () => {
    request
      .mockRejectedValueOnce(new ApiError('network', 'sem rede'))
      .mockRejectedValueOnce(new ApiError('validation', 'mudou', 409, REDEEM_ERROR_CODES.changed))
      .mockResolvedValueOnce({ data: RESULT });
    const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });

    await attempt(result, 15_000);
    // A confirmação reaberta mostra o custo novo; a tentativa aberta repete o corpo dela.
    await attempt(result, 16_000);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(costOf(1)).toBe(15_000);

    // O reward_changed fechou a tentativa: a seguinte nasce com a chave e o custo novos.
    await attempt(result, 16_000);
    expect(keyOf(2)).not.toBe(keyOf(0));
    expect(costOf(2)).toBe(16_000);
  });

  it('o limite atingido busca a loja e a carteira: o pedido que fechou o limite gastou saldo em outra sessão', async () => {
    request.mockRejectedValueOnce(
      new ApiError('validation', 'limite', 409, REDEEM_ERROR_CODES.limitReached),
    );
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRedeemRewardMutation('videochamada'), { wrapper });

    await attempt(result, 8_500);
    expect(haptics.trigger).toHaveBeenCalledWith('warning');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rewardKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.wallet() });
  });

  it('o 422 da chave já usada vira alreadyRedeemed: fecha a tentativa, e a loja e a carteira buscam de novo', async () => {
    request
      .mockRejectedValueOnce(
        new ApiError('validation', 'chave', 422, REDEEM_ERROR_CODES.alreadyRedeemed),
      )
      .mockResolvedValueOnce({ data: RESULT });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });

    await attempt(result, 15_000);
    expect(haptics.trigger).toHaveBeenCalledWith('warning');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rewardKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.wallet() });

    await attempt(result, 15_000);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  describe('a falha incerta que gravou: a loja mostra o pedido', () => {
    const NETWORK = new ApiError('network', 'sem rede');
    const shirt = (response: RewardsResponse) =>
      response.rewards.find((reward) => reward.id === 'camisa')!;
    /** A loja com um pedido novo da camisa: o que o servidor gravou antes de a resposta se perder. */
    function withOrder(code: string): RewardsResponse {
      const response = buildRewardsFixture(NOW);
      const base = shirt(response).redemptions[0]!;
      return {
        ...response,
        rewards: response.rewards.map((reward) =>
          reward.id === 'camisa'
            ? { ...reward, redemptions: [{ ...base, id: code, code }, ...reward.redemptions] }
            : reward,
        ),
      };
    }

    beforeEach(() => {
      client.setQueryData(rewardKeys.list(), buildRewardsFixture(NOW));
    });

    it('a confirmação nova, com o pedido à vista, fecha a tentativa: o resgate seguinte leva chave nova', async () => {
      request.mockRejectedValueOnce(NETWORK).mockResolvedValueOnce({ data: RESULT });
      const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });

      await attempt(result, 15_000);
      const shop = withOrder('UP-HG56TT');
      client.setQueryData(rewardKeys.list(), shop);
      expect(result.current.attemptRecorded(shirt(shop))).toBe(true);
      result.current.closeRecordedAttempt(shirt(shop));
      expect(result.current.attemptRecorded(shirt(shop))).toBe(false);

      await attempt(result, 15_000);
      expect(keyOf(1)).not.toBe(keyOf(0));
    });

    it('sem pedido novo na loja, a confirmação nova repete a chave (o servidor pode não ter gravado)', async () => {
      request.mockRejectedValueOnce(NETWORK).mockResolvedValueOnce({ data: RESULT });
      const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });

      await attempt(result, 15_000);
      const shop = buildRewardsFixture(NOW);
      expect(result.current.attemptRecorded(shirt(shop))).toBe(false);
      result.current.closeRecordedAttempt(shirt(shop));

      await attempt(result, 15_000);
      expect(keyOf(1)).toBe(keyOf(0));
    });

    it('o toque na confirmação que ficou aberta repete a chave, mesmo com o pedido à vista', async () => {
      request.mockRejectedValueOnce(NETWORK).mockResolvedValueOnce({ data: RESULT });
      const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });

      await attempt(result, 15_000);
      client.setQueryData(rewardKeys.list(), withOrder('UP-HG56TT'));
      await attempt(result, 15_000);
      expect(keyOf(1)).toBe(keyOf(0));
    });

    it('com o pedido indo, a loja que já mostra o pedido novo não fecha a tentativa', async () => {
      let fail: (error: Error) => void = () => undefined;
      request
        .mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            fail = reject;
          }) as never,
        )
        .mockResolvedValueOnce({ data: RESULT });
      const { result } = renderHook(() => useRedeemRewardMutation('camisa'), { wrapper });
      const settled = jest.fn();
      act(() => result.current.redeem(15_000, { onError: settled }));

      const shop = withOrder('UP-HG56TT');
      expect(result.current.attemptRecorded(shirt(shop))).toBe(false);
      result.current.closeRecordedAttempt(shirt(shop));
      await act(async () => fail(NETWORK));
      await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      // A resposta se perdeu: o toque seguinte, na mesma confirmação, repete a chave.
      await attempt(result, 15_000);
      expect(keyOf(1)).toBe(keyOf(0));
    });
  });
});
