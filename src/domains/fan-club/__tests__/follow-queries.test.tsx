import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { artistKeys } from '@/domains/artists';
import { postKeys } from '@/domains/posts/keys';
import { profileKeys } from '@/domains/profile';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { fetchMyFanClub, followFanClub, reportFanClubPost, unfollowFanClub } from '../api';
import { fanClubKeys } from '../keys';
import {
  useCachedFanClub,
  useCachedFanClubOwner,
  useCachedFanClubPost,
  useFanClubGate,
  useFollowFanClubMutation,
  useReportFanClubPostMutation,
  useUnfollowFanClubMutation,
} from '../queries';
import type {
  FanClubCard,
  FanClubListPage,
  FanClubPage,
  FanClubPost,
  FollowedFanClubs,
  MyFanClub,
} from '../types';

// Os ganchos da etapa 8 (34.9, itens 7 a 10): a trava, que não pergunta de
// novo a recusa definitiva a cada tela; o seguir e o deixar de seguir no
// cache; e o que as sheets leem do cache, que só existe depois da trava.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('@/config/data-source', () => ({ sourceOf: () => 'api', usesFixtures: () => false }));
jest.mock('../api', () => ({
  fetchMyFanClub: jest.fn(),
  followFanClub: jest.fn(),
  reportFanClubPost: jest.fn(),
  unfollowFanClub: jest.fn(),
}));

const MINE: MyFanClub = {
  open: true,
  rulesUrl: null,
  rulesVersion: 'termos-2026-10',
  notice: null,
  application: null,
  club: null,
};

const OWNER = { uid: 'fa-thalita', name: 'Thalita Santos', username: 'thalitasan', photoURL: null };

const PAGE: FanClubPage = {
  id: 'fc-1',
  name: 'Nenho Sempre',
  artist: { id: 'nenho', name: 'Nenho', shortName: null, thumbUrl: null },
  owner: OWNER,
  followerCount: 41,
  postCount: 2,
  featured: false,
  isFollowing: false,
  isOwner: false,
  isMember: false,
};

const CARD: FanClubCard = {
  id: 'fc-1',
  name: 'Nenho Sempre',
  owner: OWNER,
  followers: 41,
  featured: false,
  postCount: 2,
  isFollowing: false,
};

const POST: FanClubPost = {
  id: 'p1',
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
  artistId: 'nenho',
  author: OWNER,
  kind: 'text',
  text: 'Quem vai no show?',
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
};

const pages = <T,>(items: T[]): InfiniteData<FanClubListPage<T>, string | null> => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  // O `resetAllMocks` tira também o que um teste deixou na resposta dos mocks.
  jest.resetAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: 'camila@teste.imagineup', displayName: null, photoURL: null },
    authHolds: 0,
  });
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
});

afterEach(() => client.clear());

describe('a trava (useFanClubGate)', () => {
  it('com a api de antes (o 404), a tela seguinte não pergunta de novo', async () => {
    jest
      .mocked(fetchMyFanClub)
      .mockRejectedValue(new ApiError('notFound', 'Não encontrado.', 404, 'not_found'));
    const first = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(first.result.current.query.isError).toBe(true));
    expect(first.result.current.live).toBeNull();

    const second = renderHook(() => useFanClubGate(), { wrapper });
    await act(async () => undefined);
    expect(second.result.current.live).toBeNull();
    expect(fetchMyFanClub).toHaveBeenCalledTimes(1);
  });

  it('com a resposta do servidor novo, vale também com o programa fechado (decisão 9)', async () => {
    jest.mocked(fetchMyFanClub).mockResolvedValue({ ...MINE, open: false });
    const { result } = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(result.current.live).toEqual({ ...MINE, open: false }));
  });

  it('a falha incerta pergunta de novo na tela seguinte', async () => {
    jest.mocked(fetchMyFanClub).mockRejectedValueOnce(new ApiError('network', 'Sem rede.'));
    const first = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(first.result.current.query.isError).toBe(true));
    jest.mocked(fetchMyFanClub).mockResolvedValueOnce(MINE);
    const second = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(second.result.current.live).toEqual(MINE));
    expect(fetchMyFanClub).toHaveBeenCalledTimes(2);
  });

  it('o pedido que nem saiu (sem status) também pergunta de novo', async () => {
    jest
      .mocked(fetchMyFanClub)
      .mockRejectedValueOnce(new ApiError('unknown', 'Firebase: network-request-failed'));
    const first = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(first.result.current.query.isError).toBe(true));
    jest.mocked(fetchMyFanClub).mockResolvedValueOnce(MINE);
    const second = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(second.result.current.live).toEqual(MINE));
  });

  it('a resposta vale a abertura: a tela seguinte (a Início, outra 1d) não pergunta de novo', async () => {
    jest.mocked(fetchMyFanClub).mockResolvedValue(MINE);
    const first = renderHook(() => useFanClubGate(), { wrapper });
    await waitFor(() => expect(first.result.current.live).toEqual(MINE));
    const second = renderHook(() => useFanClubGate(), { wrapper });
    await act(async () => undefined);
    expect(second.result.current.live).toEqual(MINE);
    expect(fetchMyFanClub).toHaveBeenCalledTimes(1);
  });
});

describe('seguir e deixar de seguir no cache', () => {
  it('seguir passa a página e a lista do artista a "Seguindo", soma o seguidor e marca a central', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), PAGE);
    client.setQueryData(fanClubKeys.byArtist('nenho'), pages([CARD]));
    client.setQueryData(fanClubKeys.follows(), { items: [] });
    jest
      .mocked(followFanClub)
      .mockResolvedValue({ clubId: 'fc-1', following: true, joined: true, pointsAwarded: 10 });
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });

    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData<FanClubPage>(fanClubKeys.club('fc-1'))).toMatchObject({
      isFollowing: true,
      followerCount: 42,
      isMember: true,
    });
    const card = client.getQueryData<InfiniteData<FanClubListPage<FanClubCard>>>(
      fanClubKeys.byArtist('nenho'),
    )?.pages[0]?.items[0];
    expect(card).toMatchObject({ isFollowing: true, followers: 41 });
    expect(client.getQueryState(fanClubKeys.follows())?.isInvalidated).toBe(true);
    // O seguir que fez a entrada comemora: o "+N" dos pontos da entrada.
    expect(result.current.award).toMatchObject({ points: 10 });
  });

  // A entrada: as Suas centrais, a 1d do artista (pelo `artistId`, não o id
  // do fã-clube) e o mural, como a entrada de sempre (34.9, item 7).
  const joinKeys = () => [artistKeys.centrals(), artistKeys.detail('nenho'), postKeys.feed()];
  const seedJoinKeys = (): void => {
    client.setQueryData(artistKeys.centrals(), []);
    client.setQueryData(artistKeys.detail('nenho'), { id: 'nenho' });
    client.setQueryData(postKeys.feed(), { pages: [], pageParams: [] });
    client.setQueryData(fanClubKeys.follows(), { items: [] });
    client.setQueryData(fanClubKeys.feed(), pages([]));
  };

  it('o seguir que fez a entrada atualiza o que a entrada atualiza', async () => {
    seedJoinKeys();
    jest
      .mocked(followFanClub)
      .mockResolvedValue({ clubId: 'fc-1', following: true, joined: true, pointsAwarded: 10 });
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const key of joinKeys()) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('o seguir de quem já era da central não comemora nem mexe nas centrais', async () => {
    seedJoinKeys();
    jest
      .mocked(followFanClub)
      .mockResolvedValue({ clubId: 'fc-1', following: true, joined: false, pointsAwarded: 0 });
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const key of joinKeys()) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    // Os do seguir, sim.
    expect(client.getQueryState(fanClubKeys.follows())?.isInvalidated).toBe(true);
    expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(true);
    expect(result.current.award).toBeNull();
  });

  it('a resposta de outra sessão não vai ao cache do fã seguinte', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), PAGE);
    let resolve: (value: Awaited<ReturnType<typeof followFanClub>>) => void = () => undefined;
    jest.mocked(followFanClub).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(followFanClub).toHaveBeenCalled());
    useSessionStore.setState({ user: { uid: 'uid-outro' } as never });
    await act(async () =>
      resolve({ clubId: 'fc-1', following: true, joined: false, pointsAwarded: 0 }),
    );
    expect(client.getQueryData<FanClubPage>(fanClubKeys.club('fc-1'))?.isFollowing).toBe(false);
  });

  it('deixar de seguir tira o fã-clube da lista sem buscar de novo, e a página volta a "Seguir"', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), {
      ...PAGE,
      isFollowing: true,
      followerCount: 42,
    });
    client.setQueryData<FollowedFanClubs>(fanClubKeys.follows(), {
      items: [
        {
          id: 'fc-1',
          name: 'Nenho Sempre',
          artistId: 'nenho',
          artistName: 'Nenho',
          owner: OWNER,
          followedAt: '2026-10-15T15:00:00.000Z',
          available: true,
        },
      ],
    });
    jest.mocked(unfollowFanClub).mockResolvedValue({ clubId: 'fc-1', following: false });
    const { result } = renderHook(() => useUnfollowFanClubMutation(), { wrapper });

    act(() => result.current.mutate('fc-1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData<FollowedFanClubs>(fanClubKeys.follows())?.items).toEqual([]);
    expect(client.getQueryState(fanClubKeys.follows())?.isInvalidated).toBe(false);
    expect(client.getQueryData<FanClubPage>(fanClubKeys.club('fc-1'))).toMatchObject({
      isFollowing: false,
      followerCount: 41,
    });
  });
});

describe('a resposta perdida (o servidor pode ter gravado)', () => {
  const lost = () => new ApiError('network', 'Sem rede.');

  it('o 404 do seguir (o fã-clube saiu do ar ou o gestor foi bloqueado) o tira das telas', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), PAGE);
    client.setQueryData(fanClubKeys.byArtist('nenho'), pages([CARD]));
    client.setQueryData(fanClubKeys.feed(), pages([POST]));
    jest
      .mocked(followFanClub)
      .mockRejectedValue(new ApiError('notFound', 'Não encontrado.', 404, 'fan_club_not_found'));
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    for (const key of [fanClubKeys.club('fc-1'), fanClubKeys.byArtist('nenho'), fanClubKeys.feed()]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('o seguir incerto busca de novo o que o sucesso mudaria, inclusive a entrada', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), PAGE);
    client.setQueryData(fanClubKeys.byArtist('nenho'), pages([CARD]));
    client.setQueryData(fanClubKeys.follows(), { items: [] });
    client.setQueryData(artistKeys.centrals(), []);
    client.setQueryData(artistKeys.detail('nenho'), { id: 'nenho' });
    client.setQueryData(postKeys.feed(), { pages: [], pageParams: [] });
    client.setQueryData(profileKeys.wallet(), { balance: 0 });
    jest.mocked(followFanClub).mockRejectedValue(lost());
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    for (const key of [
      fanClubKeys.club('fc-1'),
      fanClubKeys.byArtist('nenho'),
      fanClubKeys.follows(),
      artistKeys.centrals(),
      artistKeys.detail('nenho'),
      postKeys.feed(),
      profileKeys.wallet(),
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('a nova tentativa leva a mesma chave; com "Seguindo" na página, a tentativa acaba', async () => {
    const follow = jest.mocked(followFanClub);
    follow
      .mockRejectedValueOnce(lost())
      .mockRejectedValueOnce(lost())
      .mockResolvedValueOnce({ clubId: 'fc-1', following: true, joined: false, pointsAwarded: 0 });
    const { result } = renderHook(() => useFollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(follow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isError).toBe(true));
    // A página buscada de novo mostrou "Seguindo": o servidor gravou. Depois de
    // deixar de seguir, o seguir não pode receber a resposta guardada.
    act(() => result.current.closeAttempt('fc-1'));
    act(() => result.current.mutate({ id: 'fc-1', artistId: 'nenho' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = follow.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('o deixar de seguir incerto busca de novo o que os fãs veem', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), { ...PAGE, isFollowing: true });
    client.setQueryData(fanClubKeys.follows(), { items: [] });
    client.setQueryData(fanClubKeys.feed(), pages([POST]));
    jest.mocked(unfollowFanClub).mockRejectedValue(lost());
    const { result } = renderHook(() => useUnfollowFanClubMutation(), { wrapper });
    act(() => result.current.mutate('fc-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    for (const key of [fanClubKeys.club('fc-1'), fanClubKeys.follows(), fanClubKeys.feed()]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('a denúncia de uma publicação que saiu do ar (o 404) a tira das telas', async () => {
    client.setQueryData(fanClubKeys.clubPosts('fc-1'), pages([POST]));
    client.setQueryData(fanClubKeys.feed(), pages([POST]));
    jest
      .mocked(reportFanClubPost)
      .mockRejectedValue(
        new ApiError('notFound', 'Não encontrada.', 404, 'fan_club_post_not_found'),
      );
    const { result } = renderHook(() => useReportFanClubPostMutation(), { wrapper });
    act(() => result.current.mutate({ postId: 'p1', reason: null }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryState(fanClubKeys.clubPosts('fc-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(true);
  });
});

describe('a resposta que chega com a sheet fechada', () => {
  function hold<T>(mock: jest.Mock): { resolve: (value: T) => void; reject: (e: Error) => void } {
    const handles = { resolve: (_: T) => undefined, reject: (_: Error) => undefined } as {
      resolve: (value: T) => void;
      reject: (e: Error) => void;
    };
    mock.mockImplementationOnce(
      () =>
        new Promise<T>((resolve, reject) => {
          handles.resolve = resolve;
          handles.reject = reject;
        }),
    );
    return handles;
  }

  it('deixar de seguir: o hook anuncia o sucesso; com a sheet aberta, quem anuncia é ela', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), { ...PAGE, isFollowing: true });
    const pending = hold<Awaited<ReturnType<typeof unfollowFanClub>>>(jest.mocked(unfollowFanClub));
    const hook = renderHook(() => useUnfollowFanClubMutation(), { wrapper });
    act(() => hook.result.current.mutate('fc-1'));
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    hook.unmount();
    await act(async () => pending.resolve({ clubId: 'fc-1', following: false }));
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        t('fanClub.unfollow.done', { name: 'Nenho Sempre' }),
      ),
    );

    jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    jest.mocked(unfollowFanClub).mockResolvedValueOnce({ clubId: 'fc-1', following: false });
    const open = renderHook(() => useUnfollowFanClubMutation(), { wrapper });
    act(() => open.result.current.mutate('fc-1'));
    await waitFor(() => expect(open.result.current.isSuccess).toBe(true));
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('deixar de seguir: o hook anuncia o erro, com o toque', async () => {
    const pending = hold<Awaited<ReturnType<typeof unfollowFanClub>>>(jest.mocked(unfollowFanClub));
    const hook = renderHook(() => useUnfollowFanClubMutation(), { wrapper });
    act(() => hook.result.current.mutate('fc-1'));
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    hook.unmount();
    await act(async () => pending.reject(new ApiError('server', 'Falhou.', 500)));
    await waitFor(() => expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalled());
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('denunciar: o hook anuncia o envio e o erro', async () => {
    const sent = hold<Awaited<ReturnType<typeof reportFanClubPost>>>(
      jest.mocked(reportFanClubPost),
    );
    const first = renderHook(() => useReportFanClubPostMutation(), { wrapper });
    act(() => first.result.current.mutate({ postId: 'p1', reason: 'spam' }));
    await waitFor(() => expect(first.result.current.isPending).toBe(true));
    first.unmount();
    await act(async () => sent.resolve({ postId: 'p1', status: 'reported' }));
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        t('fanClub.report.sent'),
      ),
    );

    const failed = hold<Awaited<ReturnType<typeof reportFanClubPost>>>(
      jest.mocked(reportFanClubPost),
    );
    const second = renderHook(() => useReportFanClubPostMutation(), { wrapper });
    act(() => second.result.current.mutate({ postId: 'p1', reason: 'spam' }));
    await waitFor(() => expect(second.result.current.isPending).toBe(true));
    second.unmount();
    await act(async () =>
      failed.reject(new ApiError('notFound', 'Não encontrada.', 404, 'fan_club_post_not_found')),
    );
    await waitFor(() => expect(haptics.trigger).toHaveBeenCalledWith('error'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
  });
});

describe('o que as sheets leem do cache (nada antes da trava)', () => {
  it('a publicação da denúncia vem da página ou da Início; a frio, undefined', () => {
    expect(
      renderHook(() => useCachedFanClubPost('p1'), { wrapper }).result.current,
    ).toBeUndefined();
    client.setQueryData(fanClubKeys.byArtist('nenho'), pages([CARD]));
    client.setQueryData(fanClubKeys.feed(), pages([POST]));
    expect(renderHook(() => useCachedFanClubPost('p1'), { wrapper }).result.current).toEqual(POST);
    // O card da lista do artista tem id, mas não é publicação.
    expect(
      renderHook(() => useCachedFanClubPost('fc-1'), { wrapper }).result.current,
    ).toBeUndefined();
  });

  it('o fã-clube da sheet "Deixar de seguir" vem da página ou da lista dos seguidos', () => {
    expect(renderHook(() => useCachedFanClub('fc-1'), { wrapper }).result.current).toBeUndefined();
    client.setQueryData(fanClubKeys.club('fc-1'), PAGE);
    expect(renderHook(() => useCachedFanClub('fc-1'), { wrapper }).result.current).toEqual({
      id: 'fc-1',
      name: 'Nenho Sempre',
      artistId: 'nenho',
      artistName: 'Nenho',
    });
  });

  it('o gestor da denúncia de perfil, só se for o gestor desta página', () => {
    client.setQueryData(fanClubKeys.club('fc-1'), PAGE);
    expect(
      renderHook(() => useCachedFanClubOwner('fc-1', 'fa-thalita'), { wrapper }).result.current,
    ).toEqual(OWNER);
    expect(
      renderHook(() => useCachedFanClubOwner('fc-1', 'fa-outro'), { wrapper }).result.current,
    ).toBeUndefined();
  });
});
