import { missionsFixture } from '@/domains/missions';
import { fixtureWallet, resetFixtureSession, setFixtureNow } from '@/services/fixtures';

import { addComment, fetchComments, fetchPost, setPostLike } from '../api';
import {
  buildCommentsPageFixture,
  buildPostsFixture,
  COMMENT_POINTS,
  COMMENTS_PAGE_SIZE,
  postsFixture,
} from '../fixtures';
import type { CommentAuthor, PostComment } from '../types';

// O perfil (Firestore) entra pelo domínio de missões e pelo de perfil; nada aqui fala com ele.
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
jest.mock('@/config/env', () => ({ dataSource: 'fixtures' }));

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const CAMILA: CommentAuthor = { id: 'uid-camila', name: 'Camila Ribeiro', photoURL: null };

const minutesBefore = (comment: PostComment | undefined) =>
  comment ? (NOW.getTime() - new Date(comment.createdAt).getTime()) / 60_000 : NaN;

beforeEach(() => {
  setFixtureNow(NOW);
  postsFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
});

afterEach(() => setFixtureNow(null));

describe('comentários de exemplo', () => {
  it('o clipe abre com a resposta do Netto e os três do pódio, do mais novo ao mais antigo', () => {
    const { items } = buildCommentsPageFixture(NOW, 'p-clipe', null);
    expect(items.slice(0, 4).map((comment) => comment.authorName)).toEqual([
      'Netto Brito',
      'Thalita S.',
      'Davi Lima',
      'Jean P.',
    ]);
    expect(items[0]).toMatchObject({ authorId: 'netto-brito', authorIsArtist: true });
    expect(items.slice(1).every((comment) => !comment.authorIsArtist)).toBe(true);
    expect(minutesBefore(items[0])).toBe(48);
    expect(minutesBefore(items[1])).toBe(60);
  });

  it('pagina de 10 em 10 pelo cursor, até a contagem do post, sempre do mais novo ao mais antigo', async () => {
    const [clip] = buildPostsFixture(NOW);
    const all: PostComment[] = [];
    let cursor: string | null = null;
    do {
      const page = await fetchComments('p-clipe', cursor);
      expect(page.items.length).toBeLessThanOrEqual(COMMENTS_PAGE_SIZE);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(all).toHaveLength(clip?.commentCount ?? 0);
    expect(new Set(all.map((comment) => comment.id)).size).toBe(all.length);
    const times = all.map((comment) => new Date(comment.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // Nenhum comentário é mais velho que o post.
    expect(Math.min(...times)).toBeGreaterThan(new Date(clip?.createdAt ?? '').getTime());
  });

  it('a primeira página diz onde começa a seguinte', () => {
    expect(buildCommentsPageFixture(NOW, 'p-clipe', null).nextCursor).toBe('10');
    expect(buildCommentsPageFixture(NOW, 'p-clipe', '10').items[0]?.id).not.toBe(
      buildCommentsPageFixture(NOW, 'p-clipe', null).items[0]?.id,
    );
  });

  it('post que não existe dá 404, como a API', async () => {
    await expect(fetchComments('nao-existe', null)).rejects.toMatchObject({
      kind: 'notFound',
      status: 404,
    });
  });
});

describe('comentar nas fixtures', () => {
  const send = (text: string, idempotencyKey: string) =>
    addComment({
      postId: 'p-clipe',
      text,
      idempotencyKey,
      localId: `local-${idempotencyKey}`,
      sentAt: NOW.toISOString(),
      author: CAMILA,
    });

  it('o comentário entra no topo, com o nome e a foto do fã, e o post conta mais um', async () => {
    const result = await send('Clipe lindo demais, Netto!', 'k1');
    expect(result).toMatchObject({
      postId: 'p-clipe',
      authorId: 'uid-camila',
      authorName: 'Camila Ribeiro',
      authorIsArtist: false,
      text: 'Clipe lindo demais, Netto!',
      createdAt: NOW.toISOString(),
    });

    const { items } = await fetchComments('p-clipe', null);
    expect(items[0]?.id).toBe(result.id);
    expect(items).toHaveLength(COMMENTS_PAGE_SIZE);
    await expect(fetchPost('p-clipe')).resolves.toMatchObject({ commentCount: 328 });
  });

  it('comentar rende os pontos de exemplo, que entram na carteira', async () => {
    const result = await send('Bora!', 'k1');
    expect(result.pointsAwarded).toBe(COMMENT_POINTS);
    expect(fixtureWallet.get()).toMatchObject({ balance: 12_480 + COMMENT_POINTS });
  });

  it('a mesma chave de novo devolve a primeira resposta, sem comentar nem pontuar outra vez', async () => {
    const first = await send('Bora!', 'k1');
    await expect(send('Bora!', 'k1')).resolves.toEqual(first);
    await expect(fetchPost('p-clipe')).resolves.toMatchObject({ commentCount: 328 });
    expect(fixtureWallet.get().balance).toBe(12_480 + COMMENT_POINTS);
  });

  it.each([
    ['vazio', '   '],
    ['longo demais', 'a'.repeat(501)],
  ])('comentário %s é recusado, como a API faria', async (_case, text) => {
    await expect(send(text, 'k1')).rejects.toMatchObject({ kind: 'validation' });
    await expect(fetchPost('p-clipe')).resolves.toMatchObject({ commentCount: 327 });
  });

  it('o fim da sessão apaga os comentários do fã', async () => {
    await send('Bora!', 'k1');
    resetFixtureSession();
    await expect(fetchPost('p-clipe')).resolves.toMatchObject({ commentCount: 327 });
  });
});

describe('curtir nas fixtures', () => {
  it('curtir e descurtir mudam o post no detalhe e no mural', async () => {
    await setPostLike({ postId: 'p-clipe', liked: true, idempotencyKey: 'k1' });
    await expect(fetchPost('p-clipe')).resolves.toMatchObject({
      likedByMe: true,
      likeCount: 4_813,
    });
    expect(buildPostsFixture(NOW)[0]).toMatchObject({ likedByMe: true, likeCount: 4_813 });

    await setPostLike({ postId: 'p-clipe', liked: false, idempotencyKey: 'k2' });
    await expect(fetchPost('p-clipe')).resolves.toMatchObject({
      likedByMe: false,
      likeCount: 4_812,
    });
  });

  it('curtir não rende pontos e post que não existe dá 404', async () => {
    await expect(
      setPostLike({ postId: 'p-clipe', liked: true, idempotencyKey: 'k1' }),
    ).resolves.toEqual({ pointsAwarded: 0 });
    await expect(
      setPostLike({ postId: 'nao-existe', liked: true, idempotencyKey: 'k2' }),
    ).rejects.toMatchObject({ kind: 'notFound' });
  });
});
