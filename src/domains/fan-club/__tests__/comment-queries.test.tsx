import { QueryClientProvider, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useSessionStore } from '@/stores/session';

import { addFanClubComment } from '../api';
import { fanClubKeys } from '../keys';
import {
  useAddFanClubCommentMutation,
  useCachedFanClubPost,
  useLocalFanClubComments,
  type AddFanClubCommentOptions,
} from '../queries';
import type {
  AddFanClubCommentResult,
  FanClubComment,
  FanClubCommentPage,
  FanClubListPage,
  FanClubPost,
  FanClubPostDetails,
  OwnFanClubPost,
} from '../types';

// O comentário do fã-clube (seção 37, 37.9, "Mutações"; a etapa 6 de 37.13):
// a linha local na hora, só na memória; o gravado no topo da lista (ou no fim
// das respostas da conversa, com +1 no de cima) e no total da publicação; a
// mesma chave na falha incerta, o texto de volta na recusa, o "Não publicado"
// do filtro, o `not_following` e o respondido que saiu da vista.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(() =>
    Promise.resolve({
      exists: () => true,
      data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib' }),
      metadata: { fromCache: false },
    }),
  ),
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
jest.mock('../api', () => ({ addFanClubComment: jest.fn() }));

const add = jest.mocked(addFanClubComment);

const OWNER = { uid: 'fa-thalita', name: 'Thalita Santos', username: 'thalitasan', photoURL: null };
const CAMILA = { uid: 'uid-camila', name: 'Camila Ribeiro', username: 'camilarib', photoURL: null };

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
  reactionCount: 0,
  commentCount: 3,
  myReaction: null,
  ...patch,
});

/** A publicação em "Minhas publicações" do gestor, com o "Ver comentários (3)". */
const OWN: OwnFanClubPost = {
  id: 'p1',
  clubId: 'fc-1',
  artistId: 'nenho',
  kind: 'text',
  text: 'Publicação p1',
  photo: null,
  thumb: null,
  status: 'published',
  rejectReason: null,
  submittedAt: '2026-10-19T14:00:00.000Z',
  publishedAt: '2026-10-19T15:00:00.000Z',
  reviewedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 0,
  commentCount: 3,
};

const DETAILS: FanClubPostDetails = {
  ...post('p1'),
  isOwner: false,
  isFollowing: true,
  isMember: true,
  artistName: 'Nenho',
};

const comment = (id: string, patch: Partial<FanClubComment> = {}): FanClubComment => ({
  id,
  postId: 'p1',
  clubId: 'fc-1',
  author: OWNER,
  isManager: true,
  text: `Comentário ${id}`,
  mentions: [],
  replyToId: null,
  replyCount: 0,
  createdAt: '2026-10-27T15:00:00.000Z',
  hidden: null,
  review: null,
  ...patch,
});

const answer = (id: string, patch: Partial<FanClubComment> = {}): AddFanClubCommentResult => ({
  ...comment(id, { author: CAMILA, isManager: false, ...patch }),
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
});

type CommentPages = InfiniteData<FanClubCommentPage, string | null>;
type PostPages = InfiniteData<FanClubListPage<FanClubPost>, string | null>;

const pagesOf = <T,>(items: T[]): InfiniteData<FanClubListPage<T>, string | null> => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

const network = () => new ApiError('network', 'Sem rede.', 0);
const dailyLimit = () =>
  new ApiError('dailyLimit', 'Limite.', 429, 'too_many_requests', { action: 'club_comment' });
const contentRefused = () =>
  new ApiError('validation', 'Recusado.', 400, 'comment_invalid', { reason: 'not_allowed' });

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** O campo de mentira da tela: vazio (devolve o texto) ou ocupado (não devolve). */
function renderComments(options: AddFanClubCommentOptions = {}) {
  return renderHook(
    () => ({
      commenting: useAddFanClubCommentMutation(
        { id: 'p1', clubId: 'fc-1', isOwner: false },
        options,
      ),
      local: useLocalFanClubComments('p1'),
    }),
    { wrapper },
  );
}

const topList = () => client.getQueryData<CommentPages>(fanClubKeys.comments('p1', null));

beforeEach(() => {
  jest.clearAllMocks();
  add.mockReset();
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
  client.setQueryData(fanClubKeys.clubPosts('fc-1'), pagesOf([post('p1'), post('p2')]));
  client.setQueryData(
    fanClubKeys.comments('p1', null),
    pagesOf([comment('c2'), comment('c1', { replyCount: 1 })]),
  );
  client.setQueryData(
    fanClubKeys.comments('p1', 'c1'),
    pagesOf([comment('r1', { replyToId: 'c1' })]),
  );
});

afterEach(() => client.clear());

describe('comentar', () => {
  it('a linha aparece na hora; o gravado entra no topo com o id dela, e o total sobe em todo cache', async () => {
    let resolve: (value: AddFanClubCommentResult) => void = () => undefined;
    add.mockImplementation(() => new Promise((done) => (resolve = done)));
    client.setQueryData(fanClubKeys.myPosts(), pagesOf([OWN]));
    const { result } = renderComments();

    let localId = '';
    act(() => {
      localId = result.current.commenting.send('Que publicação linda!', null);
    });
    await waitFor(() => expect(result.current.local.comments).toHaveLength(1));
    expect(result.current.local.comments[0]).toMatchObject({
      id: localId,
      text: 'Que publicação linda!',
      status: 'pending',
      replyToId: null,
    });
    expect(result.current.local.sending).toBe(true);
    expect(add).toHaveBeenCalledWith({
      postId: 'p1',
      text: 'Que publicação linda!',
      replyToId: null,
      idempotencyKey: expect.stringMatching(/^club-comment-/),
    });

    await act(async () => resolve(answer('c9', { text: 'Que publicação linda!' })));
    await waitFor(() => expect(result.current.local.comments).toHaveLength(0));
    expect(topList()?.pages[0]?.items.map((item) => item.id)).toEqual(['c9', 'c2', 'c1']);
    expect(topList()?.pages[0]?.items[0]).toMatchObject({ localId });
    // Os pontos e as recompensas ficam fora da lista.
    expect(topList()?.pages[0]?.items[0]).not.toHaveProperty('missionsChanged');
    expect(client.getQueryData<FanClubPostDetails>(fanClubKeys.post('p1'))?.commentCount).toBe(4);
    expect(
      client
        .getQueryData<PostPages>(fanClubKeys.clubPosts('fc-1'))
        ?.pages[0]?.items.map((item) => item.commentCount),
    ).toEqual([4, 3]);
    // O "Ver comentários (N)" do gestor acompanha, fora do `public()`.
    expect(
      client.getQueryData<InfiniteData<FanClubListPage<OwnFanClubPost>, string | null>>(
        fanClubKeys.myPosts(),
      )?.pages[0]?.items[0]?.commentCount,
    ).toBe(4);
    // O último a terminar busca a publicação de novo, para o total acertar com o servidor.
    expect(client.getQueryState(fanClubKeys.post('p1'))?.isInvalidated).toBe(true);
    expect(haptics.trigger).toHaveBeenCalledWith('commentSent');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Comentário enviado.');
    // Fora do disco: a mutação não vai para o cache salvo.
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('a resposta vai com o respondido; entra no fim das respostas da conversa, e o de cima ganha +1', async () => {
    add.mockResolvedValue(answer('r2', { replyToId: 'c1', text: '@thalitasan bora!' }));
    const { result } = renderComments();

    act(() => {
      result.current.commenting.send('@thalitasan bora!', { commentId: 'r1', threadId: 'c1' });
    });
    await waitFor(() =>
      expect(
        client
          .getQueryData<CommentPages>(fanClubKeys.comments('p1', 'c1'))
          ?.pages[0]?.items.map((item) => item.id),
      ).toEqual(['r1', 'r2']),
    );
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ replyToId: 'r1' }));
    expect(topList()?.pages[0]?.items.find((item) => item.id === 'c1')?.replyCount).toBe(2);
    expect(topList()?.pages[0]?.items).toHaveLength(2);
    expect(client.getQueryData<FanClubPostDetails>(fanClubKeys.post('p1'))?.commentCount).toBe(4);
  });

  it('com outro comentário ainda indo, a publicação não busca de novo; o último a terminar busca', async () => {
    const resolvers: ((value: AddFanClubCommentResult) => void)[] = [];
    add.mockImplementation(() => new Promise((done) => resolvers.push(done)));
    const { result } = renderComments();

    act(() => {
      result.current.commenting.send('Um', null);
      result.current.commenting.send('Dois', null);
    });
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers[0]?.(answer('c9', { text: 'Um' })));
    await waitFor(() => expect(result.current.local.comments).toHaveLength(1));
    expect(client.getQueryState(fanClubKeys.post('p1'))?.isInvalidated).toBe(false);

    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[1]?.(answer('c10', { text: 'Dois' })));
    await waitFor(() =>
      expect(client.getQueryState(fanClubKeys.post('p1'))?.isInvalidated).toBe(true),
    );
    expect(client.getQueryData<FanClubPostDetails>(fanClubKeys.post('p1'))?.commentCount).toBe(5);
  });

  it('a linha local da resposta fica na conversa dela, embaixo do de cima', async () => {
    add.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderComments();

    act(() => {
      result.current.commenting.send('@davilim também!', { commentId: 'r1', threadId: 'c1' });
    });
    await waitFor(() =>
      expect(result.current.local.comments[0]).toMatchObject({
        replyToId: 'c1',
        status: 'pending',
      }),
    );
  });
});

describe('as falhas', () => {
  it('a falha incerta deixa "Não enviado"; tocar manda de novo com a mesma chave', async () => {
    add.mockRejectedValueOnce(network()).mockResolvedValueOnce(answer('c9'));
    const restoreDraft = jest.fn(() => true);
    const { result } = renderComments({ restoreDraft });

    act(() => {
      result.current.commenting.send('Oi!', null);
    });
    await waitFor(() => expect(result.current.local.comments[0]?.status).toBe('failed'));
    // O servidor pode ter gravado: o texto não volta ao campo.
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Comentário não enviado. Toque nele para tentar de novo.',
    );

    const localId = result.current.local.comments[0]!.id;
    act(() => result.current.commenting.retry(localId));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1]?.[0].idempotencyKey).toBe(add.mock.calls[0]?.[0].idempotencyKey);
    await waitFor(() => expect(result.current.local.comments).toHaveLength(0));
  });

  it('o teto do dia: o texto volta ao campo vazio, a frase fica embaixo, e o próximo envio leva chave nova', async () => {
    add.mockRejectedValueOnce(dailyLimit());
    const restoreDraft = jest.fn(() => true);
    const { result } = renderComments({ restoreDraft });

    act(() => {
      result.current.commenting.send('Oi!', null);
    });
    await waitFor(() =>
      expect(result.current.commenting.refusal).toEqual({
        key: 'fanClub.refusal.commentDailyLimit',
        type: 'dailyLimit',
      }),
    );
    // Com o id da linha, para a tela devolver também o modo resposta do envio.
    expect(restoreDraft).toHaveBeenCalledWith('Oi!', expect.stringMatching(/^club-comment-local-/));
    await waitFor(() => expect(result.current.local.comments).toHaveLength(0));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você chegou ao limite de comentários de hoje no fã-clube. Tente amanhã.',
    );
  });

  it('o filtro com o campo ocupado: "Não publicado"; o toque não manda de novo e pede para esvaziar o campo', async () => {
    add.mockRejectedValueOnce(contentRefused());
    const { result } = renderComments({ restoreDraft: () => false });

    act(() => {
      result.current.commenting.send('Texto barrado', null);
    });
    await waitFor(() => expect(result.current.local.comments[0]?.status).toBe('refused'));
    act(() => result.current.commenting.retry(result.current.local.comments[0]!.id));
    expect(add).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith(
      'Esvazie o campo para editar o comentário não publicado.',
    );
  });

  it('o filtro com o campo vazio: o texto volta, com a frase e o foco no campo', async () => {
    add.mockRejectedValueOnce(contentRefused());
    const focusDraft = jest.fn();
    const { result } = renderComments({ restoreDraft: () => true, focusDraft });

    act(() => {
      result.current.commenting.send('Texto barrado', null);
    });
    await waitFor(() => expect(result.current.commenting.refusal?.type).toBe('content'));
    expect(focusDraft).toHaveBeenCalled();
    expect(result.current.local.comments).toHaveLength(0);
    // O fã digitou: a frase sai.
    act(() => result.current.commenting.dismissEditableRefusal());
    expect(result.current.commenting.refusal).toBeNull();
  });

  it('o not_following: a linha fica "Não enviado", a publicação busca de novo e o leitor ouve a frase', async () => {
    add.mockRejectedValueOnce(
      new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason: 'not_following' }),
    );
    const restoreDraft = jest.fn(() => true);
    const { result } = renderComments({ restoreDraft });

    act(() => {
      result.current.commenting.send('Oi!', null);
    });
    await waitFor(() => expect(result.current.local.comments[0]?.status).toBe('failed'));
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(client.getQueryState(fanClubKeys.post('p1'))?.isInvalidated).toBe(true);
    // Como na reação: a página e as listas também diziam que o fã segue.
    expect(client.getQueryState(fanClubKeys.clubPosts('fc-1'))?.isInvalidated).toBe(true);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Siga o fã-clube para comentar e reagir.',
    );
  });

  it('o respondido saiu da vista: o texto volta, a tela sai do modo resposta e a lista busca de novo', async () => {
    add.mockRejectedValueOnce(
      new ApiError('notFound', 'Comentário.', 404, 'fan_club_comment_not_found'),
    );
    const onReplyGone = jest.fn();
    const restoreDraft = jest.fn(() => true);
    const { result } = renderComments({ restoreDraft, onReplyGone });

    act(() => {
      result.current.commenting.send('@thalitasan oi', { commentId: 'r1', threadId: 'c1' });
    });
    await waitFor(() =>
      expect(result.current.commenting.refusal).toEqual({
        key: 'fanClub.commentNotFound',
        type: 'replyGone',
      }),
    );
    expect(onReplyGone).toHaveBeenCalledWith('r1');
    // O texto volta sem o modo resposta.
    expect(restoreDraft).toHaveBeenCalledWith('@thalitasan oi', null);
    await waitFor(() =>
      expect(client.getQueryState(fanClubKeys.comments('p1', null))?.isInvalidated).toBe(true),
    );
    // O respondido era uma resposta: a conversa aberta dele busca de novo também.
    await waitFor(() =>
      expect(client.getQueryState(fanClubKeys.comments('p1', 'c1'))?.isInvalidated).toBe(true),
    );
    // A publicação continua: só o comentário saiu.
    expect(client.getQueryState(fanClubKeys.post('p1'))?.isInvalidated).toBe(false);
  });
});

describe('a publicação em cache para a denúncia', () => {
  it('a sheet acha a publicação aberta pela tela dela, sem a página no cache', () => {
    client.removeQueries({ queryKey: fanClubKeys.clubPosts('fc-1') });
    const { result } = renderHook(() => useCachedFanClubPost('p1'), { wrapper });
    expect(result.current).toMatchObject({ id: 'p1', artistName: 'Nenho' });
  });
});
