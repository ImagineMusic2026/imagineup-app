import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/services/api';

import { postKeys } from '../keys';
import { useArtistPostsQuery, useCommentsQuery, useFeedQuery, usePostQuery } from '../queries';

/**
 * As consultas do mural pelo seletor por domínio (bloco 6, 21.13): com os
 * posts na API (o emulador em desenvolvimento), esperam a rede e vão para o
 * disco; nas fixtures, rodam sem rede e ficam fora do disco.
 */

// O perfil (Firestore) entra pelo domínio de perfil; nada aqui fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

let mockDataSource: 'api' | 'fixtures' = 'api';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => true,
}));

const get = jest.mocked(api.get);

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const cases: [string, () => unknown, QueryKey][] = [
  ['useFeedQuery', () => useFeedQuery(), postKeys.feed()],
  ['useArtistPostsQuery', () => useArtistPostsQuery('nettobrito'), postKeys.byArtist('nettobrito')],
  ['usePostQuery', () => usePostQuery('p-clipe'), postKeys.detail('p-clipe')],
  ['useCommentsQuery', () => useCommentsQuery('p-clipe'), postKeys.comments('p-clipe')],
];

const queryOf = (queryKey: QueryKey) => client.getQueryCache().find({ queryKey, exact: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'api';
  // O padrão de hoje (algum domínio nas fixtures): cada consulta diz o dela.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, networkMode: 'always' } },
  });
  onlineManager.setOnline(false);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
});

it.each(cases)('%s com a API espera a rede e vai para o disco', async (_, hook, queryKey) => {
  renderHook(hook, { wrapper });
  await waitFor(() => expect(queryOf(queryKey)?.state.fetchStatus).toBe('paused'));
  expect(queryOf(queryKey)?.options.networkMode).toBe('online');
  expect(queryOf(queryKey)?.meta).toEqual({ realData: true });
  expect(get).not.toHaveBeenCalled();
});

it.each(cases)('%s nas fixtures roda sem rede e fica fora do disco', async (_, hook, queryKey) => {
  mockDataSource = 'fixtures';
  renderHook(hook, { wrapper });
  await waitFor(() => expect(queryOf(queryKey)?.state.status).toBe('success'));
  expect(queryOf(queryKey)?.options.networkMode).toBe('always');
  expect(queryOf(queryKey)?.meta).toEqual({ realData: false });
  expect(get).not.toHaveBeenCalled();
});
