import { missionsFixture } from '@/domains/missions';
import { buildMissionsFixture } from '@/domains/missions/fixtures';
import {
  fixtureBlocks,
  fixtureWallet,
  resetFixtureSession,
  setFixtureNow,
} from '@/services/fixtures';

import { addComment, fetchComments, fetchPost, setPostLike } from '../api';
import {
  BLOCKED_PAGE_SIZE,
  buildCommentsPageFixture,
  buildPostsFixture,
  COMMENT_POINTS,
  COMMENTS_PAGE_SIZE,
  moderationFixture,
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
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

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
    expect(items[0]).toMatchObject({ authorId: 'nettobrito', authorIsArtist: true });
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

  describe('missão "Curta 5 posts do Nenho" (2 de 5)', () => {
    const likeMission = () =>
      buildMissionsFixture(NOW).missions.find((item) => item.id === 'm-curtir-nenho');

    it('a curtida num post do Nenho anda a missão; num post de outra central, não', async () => {
      await setPostLike({ postId: 'p-clipe', liked: true, idempotencyKey: 'netto' });
      expect(likeMission()?.progress.current).toBe(2);

      await setPostLike({ postId: 'p-show', liked: true, idempotencyKey: 'nenho' });
      expect(likeMission()?.progress.current).toBe(3);
    });

    it('descurtir e curtir de novo o mesmo post não conta outra vez', async () => {
      await setPostLike({ postId: 'p-show', liked: true, idempotencyKey: 'k1' });
      await setPostLike({ postId: 'p-show', liked: false, idempotencyKey: 'k2' });
      await setPostLike({ postId: 'p-show', liked: true, idempotencyKey: 'k3' });
      expect(likeMission()?.progress.current).toBe(3);
    });

    it('a curtida que conclui rende os pontos da missão, que entram na carteira', async () => {
      const before = fixtureWallet.get().balance;
      await setPostLike({ postId: 'p-show', liked: true, idempotencyKey: 'k1' });
      await setPostLike({ postId: 'p-nenho-2', liked: true, idempotencyKey: 'k2' });
      await expect(
        setPostLike({ postId: 'p-nenho-3', liked: true, idempotencyKey: 'k3' }),
      ).resolves.toEqual({ pointsAwarded: 10 });

      expect(likeMission()).toMatchObject({ status: 'completed', progress: { current: 5 } });
      expect(fixtureWallet.get().balance).toBe(before + 10);
    });
  });
});

describe('bloqueio e denúncia de perfil nas fixtures (seção 29, 29.10)', () => {
  beforeEach(() => resetFixtureSession());

  /** Os autores de todos os comentários do clipe, página a página. */
  function clipAuthors(): string[] {
    const authors: string[] = [];
    let cursor: string | null = null;
    do {
      const page = buildCommentsPageFixture(NOW, 'p-clipe', cursor);
      authors.push(...page.items.map((comment) => comment.authorId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    return authors;
  }

  it('a fa-rank-13 começa bloqueada e não comenta: a lista do clipe sai inteira', () => {
    expect(fixtureBlocks.list()).toEqual(['fa-rank-13']);
    const authors = clipAuthors();
    expect(authors).toHaveLength(327);
    expect(authors).not.toContain('fa-rank-13');
  });

  it('bloquear a fa-rank-01 pelo ranking esconde os comentários de fa-thalita, e o contrário', () => {
    moderationFixture.block('fa-rank-01', 'bloq-1');
    expect(clipAuthors()).not.toContain('fa-thalita');
    moderationFixture.unblock('fa-thalita', 'desbloq-1');
    expect(clipAuthors()).toContain('fa-thalita');

    moderationFixture.block('fa-thalita', 'bloq-2');
    expect(fixtureBlocks.list()).toEqual(['fa-rank-13', 'fa-rank-01']);
    expect(clipAuthors()).not.toContain('fa-thalita');
  });

  it('desbloquear quem não está na lista é sucesso sem efeito; a mesma chave repete a resposta', () => {
    expect(moderationFixture.unblock('fa-rank-04', 'k1')).toEqual({
      fanId: 'fa-rank-04',
      blocked: false,
    });
    expect(fixtureBlocks.list()).toEqual(['fa-rank-13']);
    expect(moderationFixture.block('fa-rank-04', 'k2')).toEqual({
      fanId: 'fa-rank-04',
      blocked: true,
    });
    expect(moderationFixture.block('fa-rank-04', 'k2')).toEqual({
      fanId: 'fa-rank-04',
      blocked: true,
    });
    expect(fixtureBlocks.list()).toEqual(['fa-rank-13', 'fa-rank-04']);
  });

  it('a denúncia de perfil: reported, already_reported na segunda vez da mesma pessoa por outro id, e 404 como a API', () => {
    expect(moderationFixture.reportFan('fa-thalita', 'spam', 'r1')).toEqual({
      fanId: 'fa-thalita',
      status: 'reported',
    });
    expect(moderationFixture.reportFan('fa-thalita', 'spam', 'r1')).toEqual({
      fanId: 'fa-thalita',
      status: 'reported',
    });
    expect(moderationFixture.reportFan('fa-rank-01', null, 'r2')).toEqual({
      fanId: 'fa-rank-01',
      status: 'already_reported',
    });
    for (const id of ['me', 'nettobrito', 'fa-ninguem']) {
      expect(() => moderationFixture.reportFan(id, null, `r-${id}`)).toThrow(
        expect.objectContaining({ status: 404, code: 'fan_not_found' }),
      );
    }
  });

  it('a lista de bloqueados pagina de 6 em 6, do mais novo ao mais antigo, com o nome do perfil de exemplo', () => {
    const ids = ['01', '02', '03', '04', '05', '06', '07'].map((n) => `fa-rank-${n}`);
    ids.forEach((id, index) => moderationFixture.block(id, `b-${index}`));

    const first = moderationFixture.blockedPage(null);
    expect(BLOCKED_PAGE_SIZE).toBe(6);
    expect(first.items.map((fan) => fan.uid)).toEqual([
      'fa-rank-07',
      'fa-rank-06',
      'fa-rank-05',
      'fa-rank-04',
      'fa-rank-03',
      'fa-rank-02',
    ]);
    expect(first.items[5]).toEqual({
      uid: 'fa-rank-02',
      displayName: 'Davi Lima',
      username: 'davilim',
      photoURL: null,
    });
    expect(first.nextCursor).toBe('2:fa-rank-02');

    // Desbloquear dois já vistos, um deles o do cursor, não pula ninguém.
    moderationFixture.unblock('fa-rank-02', 'u-1');
    moderationFixture.unblock('fa-rank-05', 'u-2');
    const second = moderationFixture.blockedPage(first.nextCursor);
    expect(second.items.map((fan) => fan.uid)).toEqual(['fa-rank-01', 'fa-rank-13']);
    expect(second.nextCursor).toBeNull();
  });

  it('o id que nenhum perfil de exemplo tem sai da página, e o cursor fora do formato dá 400', () => {
    moderationFixture.block('uid-sem-perfil', 'b-x');
    expect(moderationFixture.blockedPage(null).items.map((fan) => fan.uid)).toEqual(['fa-rank-13']);
    expect(() => moderationFixture.blockedPage('sem-indice')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});
