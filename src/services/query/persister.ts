import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

import { StorageKeys } from '@/storage/storage/keys';

import { PERSIST_MAX_AGE_MS } from './client';

/**
 * Suba este número sempre que o formato de algo salvo no cache mudar. Ele viaja
 * no JS, então vale também para EAS Update; a `version` do app não serviria,
 * porque entra no fingerprint e mudá-la cortaria o update dos binários.
 */
export const QUERY_CACHE_VERSION = 1;

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: StorageKeys.QueryCache,
  throttleTime: 1000,
});

/**
 * O que vai para o disco: só consultas que deram certo e não pediram para ficar
 * de fora (`meta: { persist: false }`, para dados sensíveis ou efêmeros).
 * Mudou o formato salvo? Suba QUERY_CACHE_VERSION (`buster`).
 */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: String(QUERY_CACHE_VERSION),
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && query.meta?.persist !== false,
  },
};
