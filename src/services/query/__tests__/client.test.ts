import { MutationObserver, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/services/api/errors';
import { useSuspensionStore } from '@/stores/suspension';

import {
  createQueryClient,
  noteSuspendedRefusal,
  queryClient,
  RATE_LIMIT_RETRIES,
  retryDelay,
  shouldRetry,
  UNCERTAIN_RETRIES,
} from '../client';

// As novas tentativas, o atraso e a conta suspensa do cliente do Query (seção
// 29 de docs/arquitetura-api.md, frentes E e F). Sem API e sem emulador, como
// o `cache.test.ts`: o modo não muda nada disto.
jest.mock('@/config/server', () => ({
  ...jest.requireActual('@/config/server'),
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

const rateLimited = (retryAfterMs: number | null = null) =>
  new ApiError('rateLimited', 'ritmo', 429, 'rate_limited', null, retryAfterMs);
const dailyLimit = new ApiError(
  'dailyLimit',
  'teto',
  429,
  'too_many_requests',
  { limit: 30, action: 'like' },
  43_200_000,
);
const suspended = new ApiError('forbidden', 'suspensa', 403, 'account_suspended');

describe('shouldRetry', () => {
  it.each([
    ['o ritmo', rateLimited(), RATE_LIMIT_RETRIES],
    ['o ritmo com Retry-After', rateLimited(3000), RATE_LIMIT_RETRIES],
    ['a rede', new ApiError('network', 'x'), UNCERTAIN_RETRIES],
    ['o prazo', new ApiError('timeout', 'x'), UNCERTAIN_RETRIES],
    ['o 5xx', new ApiError('server', 'x', 503, 'unavailable', null, 1000), UNCERTAIN_RETRIES],
    ['o erro que não é da API (Firestore, fixtures)', new Error('x'), UNCERTAIN_RETRIES],
    ['o teto do dia', dailyLimit, 0],
    ['a conta suspensa', suspended, 0],
    ['o 404', new ApiError('notFound', 'x', 404, 'post_not_found'), 0],
    ['o 400', new ApiError('validation', 'x', 400, 'invalid_request'), 0],
    ['o 401', new ApiError('unauthorized', 'x', 401, 'unauthenticated'), 0],
  ])('%s: tenta de novo %i vezes', (_, error, retries) => {
    // `failureCount` começa em 0 na primeira falha.
    for (let count = 0; count < retries; count += 1) {
      expect(shouldRetry(count, error)).toBe(true);
    }
    expect(shouldRetry(retries, error)).toBe(false);
  });
});

describe('retryDelay', () => {
  it.each([
    ['o ritmo sem Retry-After: 1 s', rateLimited(), 0, 1000],
    ['o ritmo sem Retry-After: 2 s', rateLimited(), 1, 2000],
    ['o ritmo sem Retry-After: 4 s', rateLimited(), 2, 4000],
    ['o ritmo com o Retry-After', rateLimited(3000), 0, 3000],
    ['o ritmo com o Retry-After, na terceira', rateLimited(3000), 2, 3000],
    ['o ritmo com o Retry-After abaixo do mínimo', rateLimited(0), 0, 1000],
    ['o ritmo com o Retry-After acima do máximo', rateLimited(60_000), 0, 10_000],
    ['o 5xx com o Retry-After', new ApiError('server', 'x', 503, null, null, 1000), 1, 1000],
    [
      'o 5xx com o Retry-After grande',
      new ApiError('server', 'x', 503, null, null, 90_000),
      0,
      10_000,
    ],
    ['o 5xx sem o Retry-After: o padrão', new ApiError('server', 'x', 500), 1, 2000],
    ['a rede: o padrão', new ApiError('network', 'x'), 0, 1000],
    ['o padrão para em 30 s', new ApiError('network', 'x'), 10, 30_000],
    ['o teto do dia nunca vira atraso do Retry-After', dailyLimit, 0, 1000],
  ])('%s', (_, error, failureCount, delay) => {
    expect(retryDelay(failureCount, error)).toBe(delay);
  });
});

describe('MutationCache: a conta suspensa', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = createQueryClient({ mutations: { gcTime: Infinity } });
    useSuspensionStore.getState().reset();
  });

  afterEach(() => client.clear());

  async function refuse(error: unknown, meta?: { suspendedAlert?: boolean }): Promise<void> {
    const observer = new MutationObserver(client, {
      mutationFn: () => Promise.reject(error),
      meta,
    });
    await observer.mutate().catch(() => undefined);
  }

  it('o 403 account_suspended anota a recusa e pede o Alert', async () => {
    await refuse(suspended);
    expect(useSuspensionStore.getState()).toMatchObject({ refusals: 1, alerts: 1 });
  });

  it('com suspendedAlert: false, anota a recusa sem pedir o Alert', async () => {
    await refuse(suspended, { suspendedAlert: false });
    expect(useSuspensionStore.getState()).toMatchObject({ refusals: 1, alerts: 0 });
  });

  it('o resto não anota nada, nem o 403 de outro código', async () => {
    await refuse(new ApiError('forbidden', 'x', 403, 'not_fan'));
    await refuse(dailyLimit);
    await refuse(new Error('x'));
    expect(useSuspensionStore.getState()).toMatchObject({ refusals: 0, alerts: 0 });
  });

  it('o suspenso não tenta de novo, e o ritmo tenta pelo padrão', async () => {
    jest.useFakeTimers();
    try {
      const calls = jest.fn(() => Promise.reject(rateLimited(1000)));
      const observer = new MutationObserver(client, { mutationFn: calls });
      const done = observer.mutate().catch(() => undefined);
      await jest.advanceTimersByTimeAsync(3 * 1000);
      await done;
      expect(calls).toHaveBeenCalledTimes(1 + RATE_LIMIT_RETRIES);

      const once = jest.fn(() => Promise.reject(suspended));
      await new MutationObserver(client, { mutationFn: once }).mutate().catch(() => undefined);
      expect(once).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('o cliente do app', () => {
  it('sai da createQueryClient: as mesmas opções e o mesmo MutationCache', () => {
    const fresh = createQueryClient();
    expect(queryClient.getDefaultOptions()).toEqual(fresh.getDefaultOptions());
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetry);
    expect(queryClient.getDefaultOptions().queries?.retryDelay).toBe(retryDelay);
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(shouldRetry);
    expect(queryClient.getDefaultOptions().mutations?.retryDelay).toBe(retryDelay);
    expect(queryClient.getMutationCache().config.onError).toBe(noteSuspendedRefusal);
    expect(fresh.getMutationCache().config.onError).toBe(noteSuspendedRefusal);
  });

  it('os overrides só somam por cima', () => {
    const client = createQueryClient({ queries: { gcTime: Infinity } });
    expect(client.getDefaultOptions().queries).toMatchObject({
      gcTime: Infinity,
      retry: shouldRetry,
      retryDelay,
    });
  });
});
