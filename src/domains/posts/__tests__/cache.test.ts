import { hydrate, QueryClient, type InfiniteData } from '@tanstack/react-query';

import { missionsFixture } from '@/domains/missions';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';

import type { AddCommentVariables } from '../api';
import { insertComment, patchPostEverywhere, readPost, withLike } from '../cache';
import {
  buildCommentsPageFixture,
  buildFeedPageFixture,
  findPostFixture,
  postsFixture,
} from '../fixtures';
import { postKeys, postMutationKeys, registerPostMutationDefaults } from '../queries';
import type { Page, Post, PostComment } from '../types';

// Comentar invalida a carteira e o ranking, domínios que leem o Firestore.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), request: jest.fn() },
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

type PostPages = InfiniteData<Page<Post>>;
type CommentPages = InfiniteData<Page<PostComment>>;

const pagesOf = <T>(page: Page<T>): InfiniteData<Page<T>> => ({
  pages: [page],
  pageParams: [null],
});

let client: QueryClient;

beforeEach(() => {
  setFixtureNow(NOW);
  postsFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
});

afterEach(() => {
  client.clear();
  setFixtureNow(null);
});

describe('o mesmo post em todos os caches', () => {
  function seed(): void {
    client.setQueryData(postKeys.detail('p-clipe'), findPostFixture(NOW, 'p-clipe'));
    client.setQueryData(postKeys.feed(), pagesOf(buildFeedPageFixture(NOW, null)));
    client.setQueryData(postKeys.byArtist('netto-brito'), pagesOf(buildFeedPageFixture(NOW, null)));
    client.setQueryData(
      postKeys.comments('p-clipe'),
      pagesOf(buildCommentsPageFixture(NOW, 'p-clipe', null)),
    );
  }

  const clipIn = (key: readonly unknown[]) =>
    client.getQueryData<PostPages>(key)?.pages[0]?.items.find((post) => post.id === 'p-clipe');

  it('a curtida chega ao detalhe, ao mural e à lista da central, sem mexer nos comentários', () => {
    seed();
    const comments = client.getQueryData(postKeys.comments('p-clipe'));

    patchPostEverywhere(client, 'p-clipe', (post) => withLike(post, true));

    expect(client.getQueryData(postKeys.detail('p-clipe'))).toMatchObject({
      likedByMe: true,
      likeCount: 4_813,
    });
    expect(clipIn(postKeys.feed())).toMatchObject({ likedByMe: true, likeCount: 4_813 });
    expect(clipIn(postKeys.byArtist('netto-brito'))).toMatchObject({ likedByMe: true });
    expect(client.getQueryData(postKeys.comments('p-clipe'))).toBe(comments);
    // Os outros posts ficam como estavam.
    expect(client.getQueryData<PostPages>(postKeys.feed())?.pages[0]?.items[1]?.likedByMe).toBe(
      false,
    );
  });

  it('sem o post no cache, nada é gravado', () => {
    seed();
    const feed = client.getQueryData(postKeys.feed());
    patchPostEverywhere(client, 'nao-existe', (post) => withLike(post, true));
    expect(client.getQueryData(postKeys.feed())).toBe(feed);
  });

  it('lê o post pelo detalhe e, sem ele, por uma lista', () => {
    client.setQueryData(postKeys.feed(), pagesOf(buildFeedPageFixture(NOW, null)));
    expect(readPost(client, 'p-clipe')).toMatchObject({ id: 'p-clipe', likedByMe: false });
    client.setQueryData(postKeys.detail('p-clipe'), {
      ...findPostFixture(NOW, 'p-clipe'),
      likedByMe: true,
    });
    expect(readPost(client, 'p-clipe')).toMatchObject({ likedByMe: true });
    expect(readPost(client, 'nao-existe')).toBeUndefined();
  });

  it('o comentário do servidor entra no topo da primeira página uma vez só', () => {
    seed();
    const comment: PostComment = {
      id: 'c-servidor',
      postId: 'p-clipe',
      authorId: 'uid-camila',
      authorName: 'Camila Ribeiro',
      authorAvatarUrl: null,
      authorIsArtist: false,
      text: 'Oi',
      createdAt: NOW.toISOString(),
    };
    insertComment(client, postKeys.comments('p-clipe'), comment);
    insertComment(client, postKeys.comments('p-clipe'), comment);
    const items = client.getQueryData<CommentPages>(postKeys.comments('p-clipe'))?.pages[0]?.items;
    expect(items?.[0]?.id).toBe('c-servidor');
    expect(items?.filter((item) => item.id === 'c-servidor')).toHaveLength(1);
  });
});

describe('comentário restaurado do disco (sem a tela aberta)', () => {
  const variables: AddCommentVariables = {
    postId: 'p-clipe',
    text: 'Mandei offline',
    idempotencyKey: 'k1',
    localId: 'local-1',
    sentAt: NOW.toISOString(),
    author: { id: 'uid-camila', name: 'Camila Ribeiro', photoURL: null },
  };

  it('a função registrada manda, e o comentário entra na lista com o id local', async () => {
    registerPostMutationDefaults(client);
    client.setQueryData(
      postKeys.comments('p-clipe'),
      pagesOf(buildCommentsPageFixture(NOW, 'p-clipe', null)),
    );
    const mutation = client
      .getMutationCache()
      .build<unknown, Error, AddCommentVariables, unknown>(client, {
        mutationKey: postMutationKeys.comment,
      });

    await mutation.execute(variables);

    const first = client.getQueryData<CommentPages>(postKeys.comments('p-clipe'))?.pages[0]
      ?.items[0];
    expect(first).toMatchObject({ text: 'Mandei offline', localId: 'local-1' });
    expect(findPostFixture(NOW, 'p-clipe').commentCount).toBe(328);
  });

  /**
   * Como o persister devolve a fila com o app reaberto: pausada, sem passar
   * pelo `onMutate`, e com o post buscado de novo (sem o +1 de antes de fechar).
   */
  function restorePaused(text: string): void {
    hydrate(client, {
      queries: [],
      mutations: [
        {
          mutationKey: postMutationKeys.comment,
          state: {
            context: undefined,
            data: undefined,
            error: null,
            failureCount: 0,
            failureReason: null,
            isPaused: true,
            status: 'pending',
            variables: { ...variables, text },
            submittedAt: NOW.getTime(),
          },
        },
      ],
    });
  }

  const shownCount = () => client.getQueryData<Post>(postKeys.detail('p-clipe'))?.commentCount;

  it('volta do disco sem mexer na contagem, e ela sobe uma vez quando o servidor grava', async () => {
    registerPostMutationDefaults(client);
    client.setQueryData(postKeys.detail('p-clipe'), findPostFixture(NOW, 'p-clipe'));
    restorePaused('Mandei offline');
    expect(shownCount()).toBe(327);

    await client.resumePausedMutations();

    expect(shownCount()).toBe(328);
    // Gravado, sai da fila; a tela mostra a linha do servidor.
    expect(client.getMutationCache().findAll({ mutationKey: postMutationKeys.comment })).toEqual(
      [],
    );
  });

  it('volta do disco e falha: a contagem fica como está, e a linha fica "Não enviado"', async () => {
    registerPostMutationDefaults(client);
    client.setQueryData(postKeys.detail('p-clipe'), findPostFixture(NOW, 'p-clipe'));
    restorePaused('   ');

    await client.resumePausedMutations();

    expect(shownCount()).toBe(327);
    const [failed] = client.getMutationCache().findAll({ mutationKey: postMutationKeys.comment });
    expect(failed?.state.status).toBe('error');
    expect(failed?.options.gcTime).toBe(Infinity);
  });
});
