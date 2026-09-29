import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { buildFanCentralsFixture, followFixture } from '../fixtures';
import { artistKeys, useFollowArtistsMutation } from '../queries';

jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/config/env', () => ({ dataSource: 'fixtures' }));

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  followFixture.reset();
  // Sem prazo de coleta: os timers dele deixariam o Jest aberto depois dos testes.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
});

afterEach(() => client.clear());

describe('seguir centrais', () => {
  it('depois de seguir, as centrais do carrossel da home buscam de novo; a lista de artistas, não', async () => {
    client.setQueryData(artistKeys.centrals(), buildFanCentralsFixture());
    client.setQueryData(artistKeys.list(), []);
    const onFollowed = jest.fn();

    const { result } = renderHook(() => useFollowArtistsMutation({ onFollowed }), { wrapper });
    act(() => result.current.follow(['netto-brito', 'nenho', 'juninho-moraes']));

    await waitFor(() => expect(onFollowed).toHaveBeenCalled());
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
    expect(client.getQueryState(artistKeys.list())?.isInvalidated).toBe(false);
  });
});
