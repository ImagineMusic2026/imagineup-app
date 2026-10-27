import { QueryClientProvider, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useSessionStore } from '@/stores/session';

import {
  hideFanClubComment,
  reportFanClubComment,
  requestFanClubCommentReview,
  unhideFanClubComment,
} from '../api';
import { fanClubKeys } from '../keys';
import {
  cachedFanClubCommentReview,
  useCachedFanClubComment,
  useCachedFanClubFollowing,
  useCachedFanClubOwner,
  useCachedFanClubPostOwner,
  useHideFanClubCommentMutation,
  useReportFanClubCommentMutation,
  useRequestFanClubCommentReviewMutation,
} from '../queries';
import type {
  FanClubComment,
  FanClubCommentPage,
  FanClubListPage,
  FanClubPost,
  FanClubPostDetails,
  OwnFanClubPost,
} from '../types';

// A moderação dos comentários do fã-clube no app (seção 37, 37.6 e 37.9; a
// etapa 7 de 37.13): a denúncia, com a chave da tentativa; o "Pedir revisão"
// do autor, que passa a linha a "Revisão pedida"; o ocultar e o reexibir do
// gestor, com os contadores do servidor no cache (o de cima leva as
// respostas, a resposta passa às ocultas do de cima); e o que a sheet de
// opções lê do cache (o comentário, o seguir e o gestor).

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({ authStateReady: () => Promise.resolve(), currentUser: null }),
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
  reportFanClubComment: jest.fn(),
  requestFanClubCommentReview: jest.fn(),
  hideFanClubComment: jest.fn(),
  unhideFanClubComment: jest.fn(),
}));

const report = jest.mocked(reportFanClubComment);
const review = jest.mocked(requestFanClubCommentReview);
const hide = jest.mocked(hideFanClubComment);
const unhide = jest.mocked(unhideFanClubComment);

const OWNER = { uid: 'uid-camila', name: 'Camila Ribeiro', username: 'camilarib', photoURL: null };
const DAVI = { uid: 'fa-davi', name: 'Davi Lima', username: 'davilim', photoURL: null };

const post = (id: string, patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id,
  clubId: 'fc-1',
  clubName: 'Netto de Coração',
  clubOfficial: true,
  artistId: 'nettobrito',
  author: OWNER,
  kind: 'text',
  text: `Publicação ${id}`,
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 2,
  commentCount: 5,
  myReaction: null,
  ...patch,
});

const DETAILS: FanClubPostDetails = {
  ...post('p1'),
  isOwner: true,
  isFollowing: false,
  isMember: true,
  artistName: 'Netto Brito',
};

const OWN: OwnFanClubPost = {
  id: 'p1',
  clubId: 'fc-1',
  artistId: 'nettobrito',
  kind: 'text',
  text: 'Publicação p1',
  photo: null,
  thumb: null,
  status: 'published',
  rejectReason: null,
  submittedAt: '2026-10-19T14:00:00.000Z',
  publishedAt: '2026-10-19T15:00:00.000Z',
  reviewedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 2,
  commentCount: 5,
};

const comment = (id: string, patch: Partial<FanClubComment> = {}): FanClubComment => ({
  id,
  postId: 'p1',
  clubId: 'fc-1',
  author: DAVI,
  isManager: false,
  text: `Comentário ${id}`,
  mentions: [],
  replyToId: null,
  replyCount: 0,
  createdAt: '2026-10-27T15:00:00.000Z',
  hidden: null,
  review: null,
  ...patch,
});

type CommentPages = InfiniteData<FanClubCommentPage, string | null>;

const pagesOf = <T,>(items: T[]): InfiniteData<FanClubListPage<T>, string | null> => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

const network = () => new ApiError('network', 'Sem rede.', 0);
const commentNotFound = () =>
  new ApiError('notFound', 'Comentário.', 404, 'fan_club_comment_not_found');
const refused = (reason: string) =>
  new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason });

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const topList = () => client.getQueryData<CommentPages>(fanClubKeys.comments('p1', null));
const replies = () => client.getQueryData<CommentPages>(fanClubKeys.comments('p1', 'c1'));
const commentCount = () =>
  client.getQueryData<FanClubPostDetails>(fanClubKeys.post('p1'))?.commentCount;
const ownCount = () =>
  client.getQueryData<InfiniteData<FanClubListPage<OwnFanClubPost>>>(fanClubKeys.myPosts())
    ?.pages[0]?.items[0]?.commentCount;
const isInvalid = (queryKey: readonly unknown[]) =>
  client.getQueryCache().find({ queryKey, exact: true })?.state.isInvalidated ?? false;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  resetRefusalAlerts();
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: 'camila@teste.imagineup', displayName: null, photoURL: null },
    authHolds: 0,
  });
  client = createQueryClient({
    queries: { retry: false, gcTime: Infinity },
    mutations: { gcTime: Infinity, retry: false },
  });
  client.setQueryData(fanClubKeys.post('p1'), DETAILS);
  client.setQueryData(fanClubKeys.clubPosts('fc-1'), pagesOf([post('p1')]));
  client.setQueryData(fanClubKeys.myPosts(), pagesOf([OWN]));
  // Os de cima: o c1 com 2 respostas visíveis e 1 oculta pela gestora; o total é 5.
  client.setQueryData(
    fanClubKeys.comments('p1', null),
    pagesOf([comment('c2'), comment('c1', { replyCount: 2, hiddenReplyCount: 1 })]),
  );
  client.setQueryData(
    fanClubKeys.comments('p1', 'c1'),
    pagesOf([
      comment('r1', { replyToId: 'c1' }),
      comment('r2', { replyToId: 'c1' }),
      comment('r3', { replyToId: 'c1', hidden: 'manager' }),
    ]),
  );
});

afterEach(() => client.clear());

describe('o ocultar e o reexibir do gestor (37.6)', () => {
  it('ocultar o de cima: "Oculto por você" na lista, e 1 + replyCount sai do total em todo cache', async () => {
    hide.mockResolvedValue({ commentId: 'c1', hidden: true });
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() => result.current.mutate({ comment: comment('c1', { replyCount: 2 }), hidden: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hide).toHaveBeenCalledWith({
      commentId: 'c1',
      idempotencyKey: expect.stringMatching(/^club-comment-hide-/),
    });
    expect(topList()?.pages[0]?.items.find((item) => item.id === 'c1')?.hidden).toBe('manager');
    expect(commentCount()).toBe(2);
    expect(ownCount()).toBe(2);
    expect(
      client.getQueryData<InfiniteData<FanClubListPage<FanClubPost>>>(fanClubKeys.clubPosts('fc-1'))
        ?.pages[0]?.items[0]?.commentCount,
    ).toBe(2);
    // A publicação busca de novo, para o total acertar com o servidor.
    expect(isInvalid(fanClubKeys.post('p1'))).toBe(true);
  });

  it('ocultar uma resposta: ela passa às ocultas do de cima, e 1 sai do replyCount e do total', async () => {
    hide.mockResolvedValue({ commentId: 'r1', hidden: true });
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() => result.current.mutate({ comment: comment('r1', { replyToId: 'c1' }), hidden: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(replies()?.pages[0]?.items.map((item) => item.hidden)).toEqual([
      'manager',
      null,
      'manager',
    ]);
    expect(topList()?.pages[0]?.items[1]).toMatchObject({ replyCount: 1, hiddenReplyCount: 2 });
    expect(commentCount()).toBe(4);
    expect(ownCount()).toBe(4);
  });

  it('reexibir faz o contrário, pela rota do reexibir', async () => {
    unhide.mockResolvedValue({ commentId: 'r3', hidden: false });
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() =>
      result.current.mutate({
        comment: comment('r3', { replyToId: 'c1', hidden: 'manager' }),
        hidden: false,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(unhide).toHaveBeenCalledWith({
      commentId: 'r3',
      idempotencyKey: expect.stringMatching(/^club-comment-unhide-/),
    });
    expect(hide).not.toHaveBeenCalled();
    expect(replies()?.pages[0]?.items[2]?.hidden).toBeNull();
    expect(topList()?.pages[0]?.items[1]).toMatchObject({ replyCount: 3, hiddenReplyCount: 0 });
    expect(commentCount()).toBe(6);
  });

  it('o que o cache já mostra como o servidor respondeu não conta de novo', async () => {
    hide.mockResolvedValue({ commentId: 'r3', hidden: true });
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() => result.current.mutate({ comment: comment('r3', { replyToId: 'c1' }), hidden: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(commentCount()).toBe(5);
    expect(topList()?.pages[0]?.items[1]).toMatchObject({ replyCount: 2, hiddenReplyCount: 1 });
  });

  it('a falha incerta guarda a chave da tentativa; a resposta clara a solta', async () => {
    hide.mockRejectedValueOnce(network()).mockResolvedValue({ commentId: 'c2', hidden: true });
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() => result.current.mutate({ comment: comment('c2'), hidden: true }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => result.current.mutate({ comment: comment('c2'), hidden: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [first, second] = hide.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(second).toBe(first);
    // Nada mudou na falha: o comentário só fica oculto com a resposta do servidor.
    expect(commentCount()).toBe(4);
  });

  it('o 404 (o comentário saiu da vista) busca de novo as listas; o club_not_active, o estado do gestor', async () => {
    client.setQueryData(fanClubKeys.mine(), { open: true });
    hide.mockRejectedValueOnce(commentNotFound()).mockRejectedValueOnce(refused('club_not_active'));
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() => result.current.mutate({ comment: comment('c2'), hidden: true }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isInvalid(fanClubKeys.comments('p1', null))).toBe(true);
    expect(isInvalid(fanClubKeys.comments('p1', 'c1'))).toBe(true);
    expect(isInvalid(fanClubKeys.mine())).toBe(false);

    act(() => result.current.mutate({ comment: comment('c2'), hidden: true }));
    await waitFor(() => expect(hide).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(isInvalid(fanClubKeys.mine())).toBe(true));
    expect(commentCount()).toBe(5);
  });

  it('um toque por vez', async () => {
    let resolve: () => void = () => undefined;
    hide.mockImplementation(
      () => new Promise((done) => (resolve = () => done({ commentId: 'c2', hidden: true }))),
    );
    const { result } = renderHook(() => useHideFanClubCommentMutation('p1'), { wrapper });

    act(() => {
      result.current.mutate({ comment: comment('c2'), hidden: true });
      result.current.mutate({ comment: comment('c2'), hidden: true });
    });
    await waitFor(() => expect(hide).toHaveBeenCalled());
    await act(async () => resolve());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hide).toHaveBeenCalledTimes(1);
  });
});

describe('o "Pedir revisão" do autor (37.6)', () => {
  beforeEach(() => {
    // A Camila lê como fã: o comentário dela oculto vem no `ownHidden`.
    client.setQueryData<CommentPages>(fanClubKeys.comments('p1', null), {
      pages: [
        {
          items: [comment('c2')],
          nextCursor: null,
          ownHidden: [comment('h1', { author: OWNER, hidden: 'manager' })],
        },
      ],
      pageParams: [null],
    });
  });

  it('o pedido aceito passa a linha a "Revisão pedida"', async () => {
    review.mockResolvedValue({ commentId: 'h1', status: 'requested' });
    const { result } = renderHook(() => useRequestFanClubCommentReviewMutation('p1'), {
      wrapper,
    });

    act(() => result.current.mutate('h1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(review).toHaveBeenCalledWith({
      commentId: 'h1',
      idempotencyKey: expect.stringMatching(/^club-comment-review-/),
    });
    expect(topList()?.pages[0]?.ownHidden?.[0]?.review).toBe('requested');
    expect(isInvalid(fanClubKeys.comments('p1', null))).toBe(false);
  });

  it('o já pedido (noutro aparelho, ou mantido pela equipe) busca de novo a lista, que diz qual', async () => {
    review.mockResolvedValue({ commentId: 'h1', status: 'already_requested' });
    const { result } = renderHook(() => useRequestFanClubCommentReviewMutation('p1'), {
      wrapper,
    });

    act(() => result.current.mutate('h1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Sem marcar "Revisão pedida" antes: pode ser o mantido pela equipe.
    expect(topList()?.pages[0]?.ownHidden?.[0]?.review).toBeNull();
    expect(isInvalid(fanClubKeys.comments('p1', null))).toBe(true);
    expect(cachedFanClubCommentReview(client, 'p1', 'h1')).toBeNull();
    expect(cachedFanClubCommentReview(client, 'p1', 'nenhum')).toBeNull();
  });

  it('o 404 (o gestor reexibiu) busca de novo as listas; a falha incerta repete a chave', async () => {
    review.mockRejectedValueOnce(network()).mockRejectedValueOnce(commentNotFound());
    const { result } = renderHook(() => useRequestFanClubCommentReviewMutation('p1'), {
      wrapper,
    });

    act(() => result.current.mutate('h1'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isInvalid(fanClubKeys.comments('p1', null))).toBe(false);
    act(() => result.current.mutate('h1'));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(isInvalid(fanClubKeys.comments('p1', null))).toBe(true));
    const [first, second] = review.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(second).toBe(first);
    expect(topList()?.pages[0]?.ownHidden?.[0]?.review).toBeNull();
  });
});

describe('a denúncia do comentário (37.9, item 10)', () => {
  it('a chave da tentativa: a mesma depois da falha incerta com o mesmo motivo, nova com outro', async () => {
    report
      .mockRejectedValueOnce(network())
      .mockRejectedValueOnce(network())
      .mockResolvedValue({ commentId: 'c2', status: 'reported' });
    const onDone = jest.fn();
    const onError = jest.fn();
    const { result } = renderHook(
      () => useReportFanClubCommentMutation('p1', 'c2', { onDone, onError }),
      { wrapper },
    );

    act(() => result.current.report('spam'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    act(() => result.current.report('spam'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    act(() => result.current.report(null));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ commentId: 'c2', status: 'reported' }),
    );

    const calls = report.mock.calls.map(([variables]) => variables);
    expect(calls.map(({ reason }) => reason)).toEqual(['spam', 'spam', null]);
    expect(calls[0]?.idempotencyKey).toMatch(/^club-comment-report-c2-/);
    expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
    expect(calls[2]?.idempotencyKey).not.toBe(calls[0]?.idempotencyKey);
    // A denúncia não esconde o comentário.
    expect(topList()?.pages[0]?.items.map((item) => item.id)).toEqual(['c2', 'c1']);
  });

  it('o 404 busca de novo as listas da publicação', async () => {
    report.mockRejectedValue(commentNotFound());
    const onError = jest.fn();
    const { result } = renderHook(() => useReportFanClubCommentMutation('p1', 'c2', { onError }), {
      wrapper,
    });

    act(() => result.current.report(null));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(isInvalid(fanClubKeys.comments('p1', null))).toBe(true);
  });
});

describe('o que a sheet de opções lê do cache', () => {
  it('o comentário de qualquer lista da publicação, também o oculto do fã; a frio, nada', () => {
    client.setQueryData<CommentPages>(fanClubKeys.comments('p1', null), {
      pages: [{ items: [comment('c2')], nextCursor: null, ownHidden: [comment('h1')] }],
      pageParams: [null],
    });
    const read = (commentId: string) =>
      renderHook(() => useCachedFanClubComment('p1', commentId), { wrapper }).result.current;
    expect(read('c2')?.id).toBe('c2');
    expect(read('r2')?.replyToId).toBe('c1');
    expect(read('h1')?.id).toBe('h1');
    expect(read('nenhum')).toBeUndefined();
    expect(
      renderHook(() => useCachedFanClubComment('p9', 'c2'), { wrapper }).result.current,
    ).toBeUndefined();
  });

  it('o seguir vem da publicação em cache; sem ela, da página', () => {
    expect(
      renderHook(() => useCachedFanClubFollowing('p1', 'fc-1'), { wrapper }).result.current,
    ).toBe(false);
    client.setQueryData(fanClubKeys.post('p1'), { ...DETAILS, isFollowing: true });
    expect(
      renderHook(() => useCachedFanClubFollowing('p1', 'fc-1'), { wrapper }).result.current,
    ).toBe(true);
  });

  it('quem vê é o gestor pela publicação em cache; sem ela, não é', () => {
    const isOwner = (postId: string) =>
      renderHook(() => useCachedFanClubPostOwner(postId), { wrapper }).result.current;
    expect(isOwner('p1')).toBe(true);
    client.setQueryData(fanClubKeys.post('p1'), { ...DETAILS, isOwner: false });
    expect(isOwner('p1')).toBe(false);
    expect(isOwner('p9')).toBe(false);
  });

  it('o gestor sem a página em cache: da publicação dele, e só o gestor daquele fã-clube', () => {
    const owner = (fanId: string, clubId = 'fc-1') =>
      renderHook(() => useCachedFanClubOwner(clubId, fanId), { wrapper }).result.current;
    expect(owner('uid-camila')).toEqual(OWNER);
    expect(owner('fa-davi')).toBeUndefined();
    expect(owner('uid-camila', 'fc-9')).toBeUndefined();
  });

  it('o gestor pelo comentário marcado como do gestor, sem publicação em cache', () => {
    client.removeQueries({ queryKey: fanClubKeys.post('p1') });
    client.removeQueries({ queryKey: fanClubKeys.clubPosts('fc-1') });
    client.setQueryData(
      fanClubKeys.comments('p2', null),
      pagesOf([comment('m1', { postId: 'p2', author: DAVI, isManager: true })]),
    );
    expect(
      renderHook(() => useCachedFanClubOwner('fc-1', 'fa-davi'), { wrapper }).result.current,
    ).toEqual(DAVI);
  });
});
