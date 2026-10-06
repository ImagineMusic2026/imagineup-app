import { followFixture } from '@/domains/artists/fixtures';
import { api } from '@/services/api';
import { resetFixtureSession, setFixtureNow } from '@/services/fixtures';

import { blockFan, fetchComments, fetchFeed, reportComment } from '../api';
import { buildCommentsPageFixture, moderationFixture } from '../fixtures';

// O perfil (Firestore) entra pelo domínio de missões; nada aqui fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), request: jest.fn() },
}));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const post = jest.mocked(api.post);
const put = jest.mocked(api.put);

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  setFixtureNow(NOW);
  resetFixtureSession();
});

afterEach(() => setFixtureNow(null));

describe('denunciar e bloquear pela API', () => {
  beforeEach(() => {
    mockDataSource = 'api';
  });

  it('a denúncia vai em POST .../comments/<id>/report com o motivo e a chave', async () => {
    post.mockResolvedValue({ data: { commentId: 'c 1', status: 'reported' } });
    await expect(
      reportComment({ postId: 'p-clipe', commentId: 'c 1', reason: 'spam', idempotencyKey: 'k1' }),
    ).resolves.toEqual({ commentId: 'c 1', status: 'reported' });
    expect(post).toHaveBeenCalledWith(
      '/posts/p-clipe/comments/c%201/report',
      { reason: 'spam' },
      { headers: { 'Idempotency-Key': 'k1' } },
    );
  });

  it('sem motivo, vai null', async () => {
    post.mockResolvedValue({ data: { commentId: 'c1', status: 'reported' } });
    await reportComment({ postId: 'p-clipe', commentId: 'c1', reason: null, idempotencyKey: 'k2' });
    expect(post).toHaveBeenCalledWith(expect.any(String), { reason: null }, expect.any(Object));
  });

  it('o bloqueio vai em PUT /me/blocks/<uid> com a chave, sem corpo', async () => {
    put.mockResolvedValue({ data: { fanId: 'uidEnzo', blocked: true } });
    await expect(blockFan({ fanId: 'uidEnzo', idempotencyKey: 'k3' })).resolves.toEqual({
      fanId: 'uidEnzo',
      blocked: true,
    });
    expect(put).toHaveBeenCalledWith('/me/blocks/uidEnzo', undefined, {
      headers: { 'Idempotency-Key': 'k3' },
    });
  });
});

describe('moderação de exemplo (fixtures)', () => {
  it('a segunda denúncia do mesmo comentário é already_reported; a mesma chave repete a resposta', async () => {
    const first = await reportComment({
      postId: 'p-clipe',
      commentId: 'c-clipe-thalita',
      reason: null,
      idempotencyKey: 'chave-1',
    });
    expect(first).toEqual({ commentId: 'c-clipe-thalita', status: 'reported' });
    await expect(
      reportComment({
        postId: 'p-clipe',
        commentId: 'c-clipe-thalita',
        reason: null,
        idempotencyKey: 'chave-1',
      }),
    ).resolves.toEqual(first);
    await expect(
      reportComment({
        postId: 'p-clipe',
        commentId: 'c-clipe-thalita',
        reason: 'spam',
        idempotencyKey: 'chave-2',
      }),
    ).resolves.toEqual({ commentId: 'c-clipe-thalita', status: 'already_reported' });
  });

  it('bloquear some com os comentários do autor da lista, e o fim da sessão desfaz', async () => {
    const before = buildCommentsPageFixture(NOW, 'p-clipe', null);
    expect(before.items.some((item) => item.authorId === 'fa-thalita')).toBe(true);
    await blockFan({ fanId: 'fa-thalita', idempotencyKey: 'chave-bloq' });
    const after = await fetchComments('p-clipe', null);
    expect(after.items.some((item) => item.authorId === 'fa-thalita')).toBe(false);
    expect(after.items.length).toBeGreaterThan(0);
    moderationFixture.reset();
    expect(
      buildCommentsPageFixture(NOW, 'p-clipe', null).items.some(
        (item) => item.authorId === 'fa-thalita',
      ),
    ).toBe(true);
  });
});

describe('mural de exemplo filtrado pelas centrais seguidas', () => {
  it('mostra só as centrais do fã; sair do Netto tira os posts dele', async () => {
    const all = await fetchFeed(null);
    expect(all.items.map((item) => item.artist.id)).toContain('nettobrito');
    followFixture.leave('nettobrito', 'sair-netto');
    const page = await fetchFeed(null);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((item) => item.artist.id === 'nettobrito')).toBe(false);
  });
});
