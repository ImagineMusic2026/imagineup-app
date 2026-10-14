import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateMutation, type Mutation, type Query } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

import { usesFixtures } from '@/config/data-source';
import { isContentRefusal } from '@/services/api/errors';
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
 * Enquanto algum domínio estiver nas fixtures, só vai o dado de verdade
 * (`meta: { realData: true }`: o perfil do Firestore e os domínios que já leem
 * da API, por `queryOptionsFor`): dado de exemplo salvo apareceria no aparelho
 * depois que a API entrasse. Sem fixtures, vai tudo. O formato salvo é o
 * mesmo nos dois casos.
 */
export function shouldPersistQuery(query: Query, fixturesInUse: boolean = usesFixtures()): boolean {
  if (query.state.status !== 'success' || query.meta?.persist === false) return false;
  return !fixturesInUse || query.meta?.realData === true;
}

/**
 * As mutações que vão para o disco: as pausadas, como no padrão do TanStack (a
 * fila offline), e a que pediu para ficar quando o servidor recusou o texto
 * pelo filtro (`meta: { keepRefused: true }` e o erro de conteúdo, seção 30):
 * o comentário da fila que volta recusado com o app fechado não some sem aviso,
 * e a linha "Não publicado" volta com o app reaberto. Quem marca é o `meta`,
 * para o `services` não conhecer o domínio dos posts.
 */
export function shouldPersistMutation(mutation: Mutation): boolean {
  if (defaultShouldDehydrateMutation(mutation)) return true;
  return (
    mutation.meta?.keepRefused === true &&
    mutation.state.status === 'error' &&
    isContentRefusal(mutation.state.error)
  );
}

/** Mudou o formato salvo? Suba QUERY_CACHE_VERSION (`buster`). */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: String(QUERY_CACHE_VERSION),
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => shouldPersistQuery(query),
    shouldDehydrateMutation: (mutation) => shouldPersistMutation(mutation),
  },
};
