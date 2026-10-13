import {
  MutationCache,
  QueryClient,
  type DefaultOptions,
  type Mutation,
  type NetworkMode,
} from '@tanstack/react-query';

import { sourceOf, usesFixtures, type DataDomain, type DataSource } from '@/config/data-source';
import { ApiError, isAccountSuspended } from '@/services/api/errors';
import { useSuspensionStore } from '@/stores/suspension';

/** Quanto tempo o cache salvo no aparelho vale para abrir o app offline. */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

/** Novas tentativas do ritmo (429 `rate_limited`): nada foi gravado, a mesma chave serve. */
export const RATE_LIMIT_RETRIES = 3;
/** Novas tentativas do resultado incerto (rede, prazo, 5xx). */
export const UNCERTAIN_RETRIES = 2;
/** O `Retry-After` do ritmo e do 5xx vira atraso só entre estes dois. */
export const RETRY_AFTER_MIN_MS = 1000;
export const RETRY_AFTER_MAX_MS = 10_000;
const DEFAULT_RETRY_MAX_MS = 30_000;

/**
 * Tenta de novo? O ritmo até 3 vezes; o resultado incerto (`isRetryable`) até
 * 2; as outras recusas da API (o teto do dia, o suspenso, os 4xx), nunca. O
 * erro que não é da API (o Firestore do perfil, as fixtures) segue como o
 * incerto. Vale nas consultas e nas mutações sem `retry` próprio, que são as
 * da fila offline (curtir, comentar, "Eu vou", entrar): o `retry` numérico ou
 * `false` de uma mutação passa por cima daqui (29.17).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.isRateLimited) return failureCount < RATE_LIMIT_RETRIES;
    if (!error.isRetryable) return false;
  }
  return failureCount < UNCERTAIN_RETRIES;
}

/**
 * Quanto esperar antes da tentativa seguinte (`failureCount` começa em 0). No
 * ritmo e no 5xx com `Retry-After`, o que o servidor pediu, entre 1 e 10 s; no
 * ritmo sem ele, 1 s, 2 s e 4 s; no resto, o padrão do TanStack (1 s dobrando
 * até 30 s). O teto do dia nunca chega aqui: não tenta de novo, e o
 * `Retry-After` dele vai até a meia-noite.
 */
export function retryDelay(failureCount: number, error: unknown): number {
  if (error instanceof ApiError && (error.isRateLimited || error.kind === 'server')) {
    if (error.retryAfterMs !== null) {
      return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, error.retryAfterMs));
    }
  }
  return Math.min(1000 * 2 ** failureCount, DEFAULT_RETRY_MAX_MS);
}

/**
 * Toda mutação recusada com 403 `account_suspended` passa por aqui: o
 * `SuspensionWatcher` do `profile` busca o perfil de novo e, fora das
 * mutações com `meta: { suspendedAlert: false }` (a tela delas mostra a
 * frase), abre o `Alert` "Conta suspensa". Vale também para a mutação
 * restaurada do disco, que roda só com as defaults.
 */
export function noteSuspendedRefusal(
  error: unknown,
  _variables: unknown,
  _context: unknown,
  mutation: Mutation<unknown, unknown, unknown>,
): void {
  if (!isAccountSuspended(error)) return;
  useSuspensionStore.getState().noteRefusal(mutation.meta?.suspendedAlert !== false);
}

/**
 * Fixture não passa pela rede: sem internet, a consulta roda do mesmo jeito em
 * vez de pausar. Com a API, pausa e volta com a rede. Mutações ficam sempre no
 * padrão ('online'), para a fila offline ser exercitada de verdade.
 */
export function queryNetworkMode(source: DataSource): NetworkMode {
  return source === 'fixtures' ? 'always' : 'online';
}

/**
 * Opções das consultas de um domínio, pela fonte dele: com a API, pausa sem
 * rede e vai para o disco (`meta.realData`); nas fixtures, roda sem rede e
 * fica fora do disco. Cada bloco do servidor espalha isto nas queries do
 * domínio que liga (docs/arquitetura-api.md, seção 13).
 */
export function queryOptionsFor(domain: DataDomain): {
  networkMode: NetworkMode;
  meta: { realData: boolean };
} {
  const source = sourceOf(domain);
  return { networkMode: queryNetworkMode(source), meta: { realData: source === 'api' } };
}

/**
 * O cliente do Query do app: as opções padrão, as novas tentativas e o
 * `MutationCache` que anota a conta suspensa. Os testes que provam o `Alert`,
 * o teto e o ritmo montam o cliente por aqui (um `QueryClient` próprio, com
 * `retry: false` e sem o `MutationCache`, provaria outra montagem); os
 * `overrides` só somam opções por cima (o `gcTime` dos testes, por exemplo).
 */
export function createQueryClient(overrides: DefaultOptions = {}): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({ onError: noteSuspendedRefusal }),
    defaultOptions: {
      ...overrides,
      queries: {
        staleTime: 1000 * 60,
        // Precisa ser pelo menos o maxAge do persister, senão o cache salvo é
        // descartado antes de servir offline.
        gcTime: PERSIST_MAX_AGE_MS,
        retry: shouldRetry,
        retryDelay,
        // Enquanto algum domínio estiver nas fixtures, o padrão é o delas; as
        // consultas que já leem do servidor dizem o seu (queryOptionsFor).
        networkMode: queryNetworkMode(usesFixtures() ? 'fixtures' : 'api'),
        ...overrides.queries,
      },
      mutations: {
        retry: shouldRetry,
        retryDelay,
        ...overrides.mutations,
      },
    },
  });
}

export const queryClient = createQueryClient();
