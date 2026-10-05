import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';

import { joinCentral } from '../api';
import {
  buildArtistDetailsFixture,
  buildFanCentralsFixture,
  followFixture,
  JOIN_CENTRAL_POINTS,
} from '../fixtures';
import { artistKeys, useFollowArtistsMutation, useJoinCentralMutation } from '../queries';
import type { ArtistDetails, FanCentral, JoinCentralResult } from '../types';

jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));
// Entrar passa pela API de verdade (as fixtures); um teste segura a resposta.
jest.mock('../api', () => {
  const actual = jest.requireActual<typeof import('../api')>('../api');
  return { ...actual, joinCentral: jest.fn(actual.joinCentral) };
});

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
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

/** Uma resposta da API que só chega quando o teste manda. */
function holdJoin() {
  let settle: { resolve: (result: JoinCentralResult) => void; reject: (error: Error) => void };
  jest.mocked(joinCentral).mockImplementationOnce(
    () =>
      new Promise<JoinCentralResult>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    resolve: (result: JoinCentralResult) => act(async () => settle.resolve(result)),
    reject: (error: Error) => act(async () => settle.reject(error)),
  };
}

describe('entrar na central', () => {
  const joined = () => client.getQueryData<FanCentral[]>(artistKeys.centrals()) ?? [];
  const member = () =>
    client.getQueryData<ArtistDetails>(artistKeys.detail('rock-salles'))?.isMember;

  beforeEach(() => {
    fixtureWallet.reset();
    client.setQueryData(artistKeys.detail('rock-salles'), buildArtistDetailsFixture('rock-salles'));
    client.setQueryData(artistKeys.centrals(), buildFanCentralsFixture());
  });

  it('o botão vira "Na central" e a central entra em "Suas centrais" na hora, antes da resposta', async () => {
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rock-salles'), { wrapper });
    act(() => result.current.join());

    await waitFor(() => expect(member()).toBe(true));
    // A resposta ainda não veio: é o estado otimista.
    expect(result.current.isPending).toBe(true);
    expect(joined().map((central) => central.artistId)).toContain('rock-salles');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você entrou na central de Rock Salles.',
    );

    await response.resolve({ artistId: 'rock-salles', pointsAwarded: 0 });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(member()).toBe(true);
  });

  it('os pontos da resposta viram o "+N"; saldo, ranking e o mural da home buscam de novo', async () => {
    client.setQueryData(['profile', 'wallet'], { balance: 0 });
    client.setQueryData(['ranking', 'season'], null);
    client.setQueryData(['posts', 'feed'], { pages: [], pageParams: [] });
    const { result } = renderHook(() => useJoinCentralMutation('rock-salles'), { wrapper });
    act(() => result.current.join());

    await waitFor(() =>
      expect(result.current.award).toEqual({ id: 1, points: JOIN_CENTRAL_POINTS }),
    );
    expect(client.getQueryState(['profile', 'wallet'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['ranking', 'season'])?.isInvalidated).toBe(true);
    // O mural mostra os posts das centrais do fã: a nova entra nele.
    expect(client.getQueryState(['posts', 'feed'])?.isInvalidated).toBe(true);
  });

  it('recusada pela API, o "Na central" e a central em "Suas centrais", já na tela, voltam atrás, com aviso', async () => {
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rock-salles'), { wrapper });
    act(() => result.current.join());
    await waitFor(() => expect(member()).toBe(true));
    expect(joined().map((central) => central.artistId)).toContain('rock-salles');

    await response.reject(new ApiError('forbidden', 'Recusado.', 403));

    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'Não deu para entrar na central. Tente de novo.',
      ),
    );
    expect(member()).toBe(false);
    expect(joined().map((central) => central.artistId)).not.toContain('rock-salles');
    expect(result.current.award).toBeNull();
  });

  it('depois de uma falha de rede, tentar de novo leva a mesma chave de idempotência', async () => {
    const join = jest.spyOn(followFixture, 'join').mockImplementationOnce(() => {
      throw new ApiError('network', 'Sem rede.', null);
    });
    const { result } = renderHook(() => useJoinCentralMutation('rock-salles'), { wrapper });
    act(() => result.current.join());
    // Espera a falha de verdade: logo depois do toque, a mutação ainda nem virou "pendente".
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    act(() => result.current.join());
    await waitFor(() => expect(result.current.award).not.toBeNull());

    const keys = join.mock.calls.map(([, key]) => key);
    expect(new Set(keys).size).toBe(1);
    join.mockRestore();
  });
});
