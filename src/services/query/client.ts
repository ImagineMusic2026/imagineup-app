import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/services/api/errors';

/** Quanto tempo o cache salvo no aparelho vale para abrir o app offline. */
export const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      // Precisa ser pelo menos o maxAge do persister, senão o cache salvo é
      // descartado antes de servir offline.
      gcTime: PERSIST_MAX_AGE_MS,
      retry: shouldRetry,
    },
    mutations: {
      retry: shouldRetry,
    },
  },
});
