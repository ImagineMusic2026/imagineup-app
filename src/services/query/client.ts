import { QueryClient, type NetworkMode } from '@tanstack/react-query';

import { sourceOf, usesFixtures, type DataDomain, type DataSource } from '@/config/data-source';
import { ApiError } from '@/services/api/errors';

/** Quanto tempo o cache salvo no aparelho vale para abrir o app offline. */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      // Precisa ser pelo menos o maxAge do persister, senão o cache salvo é
      // descartado antes de servir offline.
      gcTime: PERSIST_MAX_AGE_MS,
      retry: shouldRetry,
      // Enquanto algum domínio estiver nas fixtures, o padrão é o delas; as
      // consultas que já leem do servidor dizem o seu (queryOptionsFor).
      networkMode: queryNetworkMode(usesFixtures() ? 'fixtures' : 'api'),
    },
    mutations: {
      retry: shouldRetry,
    },
  },
});
