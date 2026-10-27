import {
  QueryClientProvider,
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useSessionStore } from '@/stores/session';
import { useSuspensionStore } from '@/stores/suspension';

import { clearFanClubReaction, setFanClubReaction } from '../api';
import { fanClubKeys } from '../keys';
import { useReactToFanClubPostMutation } from '../queries';
import type {
  FanClubListPage,
  FanClubPost,
  FanClubPostDetails,
  FanClubReactionCounts,
  FanClubReactionResult,
} from '../types';

// A reação otimista do card (seção 37, 37.9, "Mutações"; a etapa 5 de 37.13):
// o toque troca o card na hora em toda página do `public()` e na tela da
// publicação, cada toque com a chave dele, a fila por publicação, a resposta
// que acerta os números e a volta no erro, com a recusa.

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
  setFanClubReaction: jest.fn(),
  clearFanClubReaction: jest.fn(),
}));

const counts = (patch: Partial<FanClubReactionCounts> = {}): FanClubReactionCounts => ({
  heart: 0,
  fire: 0,
  laugh: 0,
  wow: 0,
  clap: 0,
  ...patch,
});

const OWNER = { uid: 'fa-thalita', name: 'Thalita Santos', username: 'thalitasan', photoURL: null };

const post = (id: string, patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id,
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
  clubOfficial: false,
  artistId: 'nenho',
  author: OWNER,
  kind: 'text',
  text: `Publicação ${id}`,
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 5,
  reactionCounts: counts({ heart: 3, fire: 2 }),
  commentCount: 2,
  myReaction: null,
  ...patch,
});

const DETAILS: FanClubPostDetails = {
  ...post('p1'),
  isOwner: false,
  isFollowing: true,
  isMember: true,
  artistName: 'Nenho',
};

type Pages = InfiniteData<FanClubListPage<FanClubPost>, string | null>;

const pages = (items: FanClubPost[]): Pages => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

/** A resposta do servidor: a reação de agora, os contadores e nenhuma recompensa (0 ponto). */
const answer = (
  reaction: FanClubReactionResult['reaction'],
  reactionCount: number,
  perEmoji: Partial<FanClubReactionCounts>,
): FanClubReactionResult => ({
  postId: 'p1',
  reaction,
  reactionCount,
  reactionCounts: counts(perEmoji),
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
});

/** Uma resposta que só chega quando o teste solta. */
function hold<T>(fn: jest.Mock) {
  const pending: { resolve: (value: T) => void; reject: (error: unknown) => void }[] = [];
  fn.mockImplementation(
    () =>
      new Promise<T>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return pending;
}

const refused = (reason: string) =>
  new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason });

const dailyLimit = () =>
  new ApiError('dailyLimit', 'Limite.', 429, 'too_many_requests', { action: 'club_react' });

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** O post p1 em cada lugar do cache: a página do fã-clube, a Início e a tela dele. */
function cached() {
  const inPage = client
    .getQueryData<Pages>(fanClubKeys.clubPosts('fc-1'))
    ?.pages[0]?.items.find((item) => item.id === 'p1');
  const inFeed = client
    .getQueryData<Pages>(fanClubKeys.feed())
    ?.pages[0]?.items.find((item) => item.id === 'p1');
  const details = client.getQueryData<FanClubPostDetails>(fanClubKeys.post('p1'));
  return { inPage, inFeed, details };
}

const set = jest.mocked(setFanClubReaction);
const clear = jest.mocked(clearFanClubReaction);

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  resetRefusalAlerts();
  useSuspensionStore.getState().reset();
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: 'camila@teste.imagineup', displayName: null, photoURL: null },
    authHolds: 0,
  });
  // O cliente do app (com o `MutationCache` do suspenso), como pedem os testes de recusa.
  client = createQueryClient({
    queries: { retry: false, gcTime: Infinity },
    mutations: { gcTime: Infinity },
  });
  client.setQueryData(fanClubKeys.clubPosts('fc-1'), pages([post('p1'), post('p2')]));
  client.setQueryData(fanClubKeys.feed(), pages([post('p1')]));
  client.setQueryData(fanClubKeys.post('p1'), DETAILS);
});

afterEach(() => client.clear());

describe('a reação otimista', () => {
  it('o toque troca o card na hora em todo cache, e a resposta acerta os números', async () => {
    const pending = hold<FanClubReactionResult>(set);
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('heart'));
    await waitFor(() => expect(set).toHaveBeenCalled());
    const now = cached();
    for (const shown of [now.inPage, now.inFeed, now.details]) {
      expect(shown).toMatchObject({
        myReaction: 'heart',
        reactionCount: 6,
        reactionCounts: counts({ heart: 4, fire: 2 }),
      });
    }
    // A outra publicação não muda, e a tela guarda o que é dela.
    expect(client.getQueryData<Pages>(fanClubKeys.clubPosts('fc-1'))?.pages[0]?.items[1]).toEqual(
      post('p2'),
    );
    expect(now.details).toMatchObject({ isFollowing: true, artistName: 'Nenho' });
    expect(set).toHaveBeenCalledWith({
      postId: 'p1',
      reaction: 'heart',
      idempotencyKey: expect.stringMatching(/^club-react-/),
    });
    expect(haptics.trigger).toHaveBeenCalledWith('like');

    // Outros fãs reagiram enquanto isso: o número do servidor vale.
    await act(async () => pending[0]!.resolve(answer('heart', 9, { heart: 6, fire: 3 })));
    await waitFor(() => expect(cached().inFeed?.reactionCount).toBe(9));
    expect(cached().details).toMatchObject({
      myReaction: 'heart',
      reactionCounts: counts({ heart: 6, fire: 3 }),
    });
  });

  it('cada toque leva a chave dele, e tirar vai pelo DELETE', async () => {
    set.mockResolvedValue(answer('fire', 6, { heart: 3, fire: 3 }));
    clear.mockResolvedValue(answer(null, 5, { heart: 3, fire: 2 }));
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('fire'));
    await waitFor(() => expect(cached().inPage?.myReaction).toBe('fire'));
    act(() => result.current.react(null));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const first = set.mock.calls[0]?.[0].idempotencyKey;
    const second = clear.mock.calls[0]?.[0].idempotencyKey;
    expect(second).toMatch(/^club-react-/);
    expect(second).not.toBe(first);
    expect(clear).toHaveBeenCalledWith({ postId: 'p1', idempotencyKey: second });
    expect(cached().inPage).toMatchObject({ myReaction: null, reactionCount: 5 });
  });

  it('os toques da mesma publicação vão em fila, e a resposta de um não desfaz o seguinte', async () => {
    const pending = hold<FanClubReactionResult>(set);
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('fire'));
    act(() => result.current.react('clap'));
    // O segundo espera o primeiro (o `scope` por publicação), mas o card já mostra o último.
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(cached().inPage).toMatchObject({ myReaction: 'clap', reactionCount: 6 });

    await act(async () => pending[0]!.resolve(answer('fire', 6, { heart: 3, fire: 3 })));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(cached().inPage).toMatchObject({ myReaction: 'clap' });

    await act(async () => pending[1]!.resolve(answer('clap', 6, { heart: 3, fire: 2, clap: 1 })));
    await waitFor(() =>
      expect(cached().inPage?.reactionCounts).toEqual(counts({ heart: 3, fire: 2, clap: 1 })),
    );
  });

  it('a busca que leu o servidor antes da gravação não chega por cima da resposta: recomeça', async () => {
    const feedFn = jest.fn();
    const fetches = hold<FanClubListPage<FanClubPost>>(feedFn);
    const puts = hold<FanClubReactionResult>(set);
    const { result } = renderHook(
      () => {
        // A Início, sem buscar ao montar: a busca é o puxar para atualizar do teste.
        const feed = useInfiniteQuery({
          queryKey: fanClubKeys.feed(),
          queryFn: feedFn as () => Promise<FanClubListPage<FanClubPost>>,
          initialPageParam: null as string | null,
          getNextPageParam: (last: FanClubListPage<FanClubPost>) => last.nextCursor,
          staleTime: Infinity,
        });
        const reaction = useReactToFanClubPostMutation('p1');
        return { refetch: feed.refetch, fetching: feed.isFetching, react: reaction.react };
      },
      { wrapper },
    );

    act(() => void result.current.refetch());
    await waitFor(() => expect(result.current.fetching).toBe(true));
    expect(feedFn).toHaveBeenCalledTimes(1);
    act(() => result.current.react('heart'));
    await waitFor(() => expect(set).toHaveBeenCalled());
    await act(async () => puts[0]!.resolve(answer('heart', 6, { heart: 4, fire: 2 })));
    await waitFor(() => expect(feedFn).toHaveBeenCalledTimes(2));

    // A busca de antes chega com o card sem a reação; a nova, com ela.
    await act(async () => fetches[0]!.resolve({ items: [post('p1')], nextCursor: null }));
    await act(async () =>
      fetches[1]!.resolve({
        items: [post('p1', { myReaction: 'heart', reactionCount: 6 })],
        nextCursor: null,
      }),
    );
    await waitFor(() => expect(result.current.fetching).toBe(false));
    expect(cached().inFeed).toMatchObject({ myReaction: 'heart', reactionCount: 6 });
  });
});

describe('a volta no erro, com a recusa', () => {
  it('o teto do dia: o card volta ao que era e abre o "Limite de hoje"', async () => {
    set.mockRejectedValue(dailyLimit());
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('wow'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached().inPage).toEqual(post('p1'));
    expect(cached().details).toEqual(DETAILS);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Limite de hoje',
      'Você chegou ao limite de reações de hoje no fã-clube. Tente amanhã.',
      expect.any(Array),
    );
    // A volta foi ao que o servidor confirmou: nada busca de novo.
    expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(false);
  });

  it('os dois toques da fila recusados: a volta foi ao otimista do primeiro, e a publicação busca de novo', async () => {
    const pending = hold<FanClubReactionResult>(set);
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('heart'));
    act(() => result.current.react('fire'));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    await act(async () => pending[0]!.reject(dailyLimit()));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    await act(async () => pending[1]!.reject(dailyLimit()));

    await waitFor(() =>
      expect(client.getQueryState(fanClubKeys.clubPosts('fc-1'))?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(true);
  });

  it('volta só se nada mudou depois: o toque seguinte já deixou o card como o fã quer', async () => {
    const pending = hold<FanClubReactionResult>(set);
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('fire'));
    act(() => result.current.react('laugh'));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    await act(async () => pending[0]!.reject(new ApiError('network', 'Sem rede.')));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(cached().inPage).toMatchObject({ myReaction: 'laugh' });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Não deu para reagir. Tente de novo.',
    );
  });

  it('deixou de seguir noutro aparelho (not_following): volta, diz a frase e busca a página de novo', async () => {
    client.setQueryData(fanClubKeys.club('fc-1'), { id: 'fc-1', isFollowing: true });
    set.mockRejectedValue(refused('not_following'));
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('heart'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached().inFeed).toEqual(post('p1'));
    expect(Alert.alert).toHaveBeenCalledWith('Siga o fã-clube para comentar e reagir.');
    expect(client.getQueryState(fanClubKeys.club('fc-1'))?.isInvalidated).toBe(true);
  });

  it('a publicação que saiu do ar: volta, diz que não está mais disponível e some das telas', async () => {
    set.mockRejectedValue(
      new ApiError('notFound', 'Publicação não encontrada.', 404, 'fan_club_post_not_found'),
    );
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('heart'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Esta publicação não está mais disponível.',
    );
    expect(client.getQueryState(fanClubKeys.clubPosts('fc-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(true);
  });

  it('a conta suspensa: a reação volta, e o "Conta suspensa" fica com o aviso do app', async () => {
    set.mockRejectedValue(new ApiError('forbidden', 'Suspensa.', 403, 'account_suspended'));
    const { result } = renderHook(() => useReactToFanClubPostMutation('p1'), { wrapper });

    act(() => result.current.react('heart'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached().inPage).toEqual(post('p1'));
    // A recusa pede o Alert do SuspensionWatcher (sem o suspendedAlert falso).
    expect(useSuspensionStore.getState()).toMatchObject({ refusals: 1, alerts: 1 });
  });
});
