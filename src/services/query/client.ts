import { QueryClient, type NetworkMode } from '@tanstack/react-query';

import { dataSource, type DataSource } from '@/config/env';
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
export function queryNetworkMode(source: DataSource = dataSource): NetworkMode {
  return source === 'fixtures' ? 'always' : 'online';
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      // Precisa ser pelo menos o maxAge do persister, senão o cache salvo é
      // descartado antes de servir offline.
      gcTime: PERSIST_MAX_AGE_MS,
      retry: shouldRetry,
      networkMode: queryNetworkMode(),
    },
    mutations: {
      retry: shouldRetry,
    },
  },
});
