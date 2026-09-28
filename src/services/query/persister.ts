import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';

import { StorageKeys } from '@/services/storage/keys';

import { PERSIST_MAX_AGE_MS } from './client';

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: StorageKeys.QueryCache,
  throttleTime: 1000,
});

/**
 * O que vai para o disco: só consultas que deram certo e não pediram para ficar
 * de fora (`meta: { persist: false }`, para dados sensíveis ou efêmeros).
 * Versão nova do app descarta o cache antigo (`buster`).
 */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: Constants.expoConfig?.version ?? 'dev',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && query.meta?.persist !== false,
  },
};
