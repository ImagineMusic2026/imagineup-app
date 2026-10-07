import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

import { followArtists, joinCentral, leaveCentral } from '../api';
import {
  buildArtistDetailsFixture,
  buildFanCentralsFixture,
  followFixture,
  JOIN_CENTRAL_POINTS,
} from '../fixtures';
import {
  artistKeys,
  artistMutationKeys,
  registerArtistMutationDefaults,
  useFollowArtistsMutation,
  useJoinCentralMutation,
  useLeaveCentralMutation,
} from '../queries';
import type {
  ArtistDetails,
  FanCentral,
  FollowArtistsResult,
  JoinCentralResult,
  LeaveCentralResult,
} from '../types';

jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));
// Seguir, entrar e sair passam pela API de verdade (as fixtures); um teste segura a resposta.
jest.mock('../api', () => {
  const actual = jest.requireActual<typeof import('../api')>('../api');
  return {
    ...actual,
    followArtists: jest.fn(actual.followArtists),
    joinCentral: jest.fn(actual.joinCentral),
    leaveCentral: jest.fn(actual.leaveCentral),
  };
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
    act(() => result.current.follow(['nettobrito', 'nenho', 'juninhomoraes']));

    await waitFor(() => expect(onFollowed).toHaveBeenCalled());
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
    expect(client.getQueryState(artistKeys.list())?.isInvalidated).toBe(false);
  });

  it('o ranking busca de novo sempre (o fã entra no ranking das centrais com os pontos de lá); a carteira, só com pontos', async () => {
    client.setQueryData(['profile', 'wallet'], { balance: 0 });
    client.setQueryData(['ranking', 'season'], null);
    const onFollowed = jest.fn();
    jest
      .mocked(followArtists)
      .mockResolvedValueOnce({ followedArtistIds: ['nenho'], pointsAwarded: 0 })
      .mockResolvedValueOnce({
        followedArtistIds: ['nenho'],
        pointsAwarded: 30,
      } satisfies FollowArtistsResult);

    const { result } = renderHook(() => useFollowArtistsMutation({ onFollowed }), { wrapper });
    act(() => result.current.follow(['nenho']));
    await waitFor(() => expect(onFollowed).toHaveBeenCalledTimes(1));
    expect(client.getQueryState(['profile', 'wallet'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['ranking', 'season'])?.isInvalidated).toBe(true);
    client.setQueryData(['ranking', 'season'], null);

    act(() => result.current.follow(['nenho', 'rocksalles']));
    await waitFor(() => expect(onFollowed).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(['profile', 'wallet'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['ranking', 'season'])?.isInvalidated).toBe(true);
  });

  it('central que saiu do ar (notFound): a lista de artistas busca de novo e o erro chega à tela', async () => {
    client.setQueryData(artistKeys.list(), []);
    const onError = jest.fn();
    jest
      .mocked(followArtists)
      .mockRejectedValueOnce(new ApiError('notFound', 'Central não encontrada.', 404));
    const { result } = renderHook(() => useFollowArtistsMutation({ onError }), { wrapper });
    act(() => result.current.follow(['artista7']));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(client.getQueryState(artistKeys.list())?.isInvalidated).toBe(true);
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
    client.getQueryData<ArtistDetails>(artistKeys.detail('rocksalles'))?.isMember;

  beforeEach(() => {
    fixtureWallet.reset();
    client.setQueryData(artistKeys.detail('rocksalles'), buildArtistDetailsFixture('rocksalles'));
    client.setQueryData(artistKeys.centrals(), buildFanCentralsFixture());
  });

  it('entrar soma 1 aos fãs da página e da central que entra em "Suas centrais"; o erro desfaz', async () => {
    client.setQueryData<ArtistDetails>(artistKeys.detail('rocksalles'), {
      ...buildArtistDetailsFixture('rocksalles'),
      fanCount: 0,
    });
    const fans = () =>
      client.getQueryData<ArtistDetails>(artistKeys.detail('rocksalles'))?.fanCount;
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());

    await waitFor(() => expect(member()).toBe(true));
    expect(fans()).toBe(1);
    expect(joined().find((central) => central.artistId === 'rocksalles')?.fanCount).toBe(1);

    await response.reject(new ApiError('forbidden', 'Recusado.', 403));
    await waitFor(() => expect(member()).toBe(false));
    expect(fans()).toBe(0);
  });

  it('o botão vira "Na central" e a central entra em "Suas centrais" na hora, antes da resposta', async () => {
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());

    await waitFor(() => expect(member()).toBe(true));
    // A resposta ainda não veio: é o estado otimista.
    expect(result.current.isPending).toBe(true);
    expect(joined().map((central) => central.artistId)).toContain('rocksalles');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você entrou na central de Rock Salles.',
    );

    await response.resolve({ artistId: 'rocksalles', pointsAwarded: 0 });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(member()).toBe(true);
  });

  it('entrar sem pontos (a entrada já paga) também faz o ranking buscar de novo; a carteira, não', async () => {
    client.setQueryData(['profile', 'wallet'], { balance: 0 });
    client.setQueryData(['ranking', 'season'], null);
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());
    await waitFor(() => expect(joinCentral).toHaveBeenCalled());
    await response.resolve({ artistId: 'rocksalles', pointsAwarded: 0 });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(client.getQueryState(['ranking', 'season'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['profile', 'wallet'])?.isInvalidated).toBe(false);
  });

  it('os pontos da resposta viram o "+N"; saldo, ranking e o mural da home buscam de novo', async () => {
    client.setQueryData(['profile', 'wallet'], { balance: 0 });
    client.setQueryData(['ranking', 'season'], null);
    client.setQueryData(['posts', 'feed'], { pages: [], pageParams: [] });
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());

    await waitFor(() =>
      expect(result.current.award).toEqual({
        id: 1,
        points: JOIN_CENTRAL_POINTS,
        announcement: 'Mais 10 pontos.',
        haptic: 'pointsEarned',
      }),
    );
    expect(client.getQueryState(['profile', 'wallet'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['ranking', 'season'])?.isInvalidated).toBe(true);
    // O mural mostra os posts das centrais do fã: a nova entra nele.
    expect(client.getQueryState(['posts', 'feed'])?.isInvalidated).toBe(true);
  });

  it('a missão de entrada concluída e o nível novo entram na frase e no toque do "+N"; as missões buscam de novo', async () => {
    client.setQueryData(['missions', 'list'], { season: null, missions: [] });
    client.setQueryData(['profile', 'achievements'], null);
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());
    await waitFor(() => expect(joinCentral).toHaveBeenCalled());
    await response.resolve({
      artistId: 'rocksalles',
      pointsAwarded: 15,
      completedMissions: [
        {
          id: 'm-entrar',
          title: 'Entre na central do Rock Salles',
          rewardPoints: 5,
          completedAt: '2026-10-05T15:00:00.000Z',
        },
      ],
      levelUp: { number: 8, name: 'Xodó', minXp: 15_000 },
      unlockedAchievements: [],
      missionsChanged: true,
    });
    await waitFor(() =>
      expect(result.current.award).toEqual({
        id: 1,
        points: 15,
        announcement:
          'Mais 15 pontos. Missão concluída: Entre na central do Rock Salles. Você subiu para o nível 8, Xodó.',
        haptic: 'levelUp',
      }),
    );
    expect(client.getQueryState(['missions', 'list'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['profile', 'achievements'])?.isInvalidated).toBe(true);
  });

  it('sem missão que andou (missionsChanged: false), as missões não buscam de novo', async () => {
    client.setQueryData(['missions', 'list'], { season: null, missions: [] });
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());
    await waitFor(() => expect(joinCentral).toHaveBeenCalled());
    await response.resolve({
      artistId: 'rocksalles',
      pointsAwarded: 10,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
    await waitFor(() => expect(result.current.award?.points).toBe(10));
    expect(client.getQueryState(['missions', 'list'])?.isInvalidated).toBe(false);
  });

  it('recusada pela API, o "Na central" e a central em "Suas centrais", já na tela, voltam atrás, com aviso', async () => {
    const response = holdJoin();
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());
    await waitFor(() => expect(member()).toBe(true));
    expect(joined().map((central) => central.artistId)).toContain('rocksalles');

    await response.reject(new ApiError('forbidden', 'Recusado.', 403));

    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'Não deu para entrar na central. Tente de novo.',
      ),
    );
    expect(member()).toBe(false);
    expect(joined().map((central) => central.artistId)).not.toContain('rocksalles');
    expect(result.current.award).toBeNull();
  });

  it('central que saiu do ar (notFound): a página e "Suas centrais" buscam de novo, sem o "Tente de novo"', async () => {
    const trigger = jest.spyOn(haptics, 'trigger');
    jest
      .mocked(joinCentral)
      .mockRejectedValueOnce(new ApiError('notFound', 'Central não encontrada.', 404));
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(client.getQueryState(artistKeys.detail('rocksalles'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
    expect(member()).toBe(false);
    expect(trigger).toHaveBeenCalledWith('error');
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(
      'Não deu para entrar na central. Tente de novo.',
    );
  });

  it('recusa que não é notFound desfaz no lugar, sem buscar a página de novo', async () => {
    jest.mocked(joinCentral).mockRejectedValueOnce(new ApiError('forbidden', 'Recusado.', 403));
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
    act(() => result.current.join());
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(client.getQueryState(artistKeys.detail('rocksalles'))?.isInvalidated).toBe(false);
  });

  it('a entrada restaurada do disco (sem o hook) que falha faz a página e as centrais buscarem de novo', async () => {
    registerArtistMutationDefaults(client);
    jest
      .mocked(joinCentral)
      .mockRejectedValueOnce(new ApiError('notFound', 'Central não encontrada.', 404));
    const mutation = client
      .getMutationCache()
      .build(client, { mutationKey: artistMutationKeys.join });
    await act(async () => {
      await mutation
        .execute({ artistId: 'rocksalles', idempotencyKey: 'chave-restaurada' })
        .catch(() => undefined);
    });
    expect(client.getQueryState(artistKeys.detail('rocksalles'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
  });

  it('depois de uma falha de rede, tentar de novo leva a mesma chave de idempotência', async () => {
    const join = jest.spyOn(followFixture, 'join').mockImplementationOnce(() => {
      throw new ApiError('network', 'Sem rede.', null);
    });
    const { result } = renderHook(() => useJoinCentralMutation('rocksalles'), { wrapper });
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

/** Uma resposta de sair que só chega quando o teste manda. */
function holdLeave() {
  let settle: { resolve: (result: LeaveCentralResult) => void; reject: (error: Error) => void };
  jest.mocked(leaveCentral).mockImplementationOnce(
    () =>
      new Promise<LeaveCentralResult>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    resolve: (result: LeaveCentralResult) => act(async () => settle.resolve(result)),
    reject: (error: Error) => act(async () => settle.reject(error)),
  };
}

describe('sair da central', () => {
  const centrals = () =>
    (client.getQueryData<FanCentral[]>(artistKeys.centrals()) ?? []).map((item) => item.artistId);
  const member = () => client.getQueryData<ArtistDetails>(artistKeys.detail('nenho'))?.isMember;

  beforeEach(() => {
    fixtureWallet.reset();
    client.setQueryData(artistKeys.detail('nenho'), buildArtistDetailsFixture('nenho'));
    client.setQueryData(artistKeys.centrals(), buildFanCentralsFixture());
    client.setQueryData(['profile', 'wallet'], { balance: 0 });
    client.setQueryData(['ranking', 'season'], null);
    client.setQueryData(['posts', 'feed'], { pages: [], pageParams: [] });
    client.setQueryData(['missions', 'list'], { season: null, missions: [] });
  });

  it('não é otimista: a página e "Suas centrais" só mudam quando o servidor confirma', async () => {
    const response = holdLeave();
    const onLeft = jest.fn();
    const { result } = renderHook(() => useLeaveCentralMutation('nenho', { onLeft }), { wrapper });
    act(() => result.current.leave());

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(member()).toBe(true);
    expect(centrals()).toContain('nenho');

    await response.resolve({ artistId: 'nenho' });
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith({ artistId: 'nenho' }));
    expect(member()).toBe(false);
    expect(centrals()).not.toContain('nenho');
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
    expect(client.getQueryState(artistKeys.detail('nenho'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['posts', 'feed'])?.isInvalidated).toBe(true);
    // A missão de entrar nesta central, escondida de quem é membro, volta (1g, 1d).
    expect(client.getQueryState(['missions', 'list'])?.isInvalidated).toBe(true);
    // Sair não muda ponto (a carteira fica), mas tira o fã do ranking da central (bloco 8).
    expect(client.getQueryState(['profile', 'wallet'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['ranking', 'season'])?.isInvalidated).toBe(true);
  });

  it('no erro, tudo fica como estava, e o erro chega à sheet', async () => {
    const response = holdLeave();
    const onError = jest.fn();
    const { result } = renderHook(() => useLeaveCentralMutation('nenho', { onError }), {
      wrapper,
    });
    act(() => result.current.leave());
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await response.reject(new ApiError('server', 'Falhou.', 500));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onError).toHaveBeenCalled();
    expect(member()).toBe(true);
    expect(centrals()).toContain('nenho');
  });

  it('com a sheet já fechada (o hook desmontado), a resposta não chama a sheet: só avisa', async () => {
    const trigger = jest.spyOn(haptics, 'trigger');
    const ok = holdLeave();
    const onLeft = jest.fn();
    const first = renderHook(() => useLeaveCentralMutation('nenho', { onLeft }), { wrapper });
    act(() => first.result.current.leave());
    await waitFor(() => expect(first.result.current.isPending).toBe(true));
    first.unmount();
    await ok.resolve({ artistId: 'nenho' });
    await waitFor(() => expect(member()).toBe(false));
    expect(onLeft).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você saiu da central.',
    );

    const failed = holdLeave();
    const onError = jest.fn();
    const second = renderHook(() => useLeaveCentralMutation('nenho', { onError }), { wrapper });
    act(() => second.result.current.leave());
    await waitFor(() => expect(second.result.current.isPending).toBe(true));
    second.unmount();
    await failed.reject(new ApiError('server', 'Falhou.', 500));
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'Não deu para sair da central. Tente de novo.',
      ),
    );
    expect(onError).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalledWith('error');
  });

  it('depois de uma falha incerta, a mesma chave; depois de uma recusa, chave nova', async () => {
    const leave = jest.mocked(leaveCentral);
    leave
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('forbidden', 'Recusado.', 403));
    const { result } = renderHook(() => useLeaveCentralMutation('nenho'), { wrapper });

    act(() => result.current.leave());
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => result.current.leave());
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => result.current.leave());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = leave.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
