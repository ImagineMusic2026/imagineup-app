import { followFixture } from '@/domains/artists/fixtures';
import { api } from '@/services/api';
import { resetFixtureSession, setFixtureNow } from '@/services/fixtures';

import {
  blockFan,
  fetchBlockedFans,
  fetchComments,
  fetchFeed,
  reportComment,
  reportFan,
  unblockFan,
} from '../api';
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
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), request: jest.fn() },
}));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const put = jest.mocked(api.put);
const del = jest.mocked(api.delete);

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

  it('o desbloqueio vai em DELETE /me/blocks/<uid> com a chave (seção 29)', async () => {
    del.mockResolvedValue({ data: { fanId: 'uid Enzo', blocked: false } });
    await expect(unblockFan({ fanId: 'uid Enzo', idempotencyKey: 'unblock-k4' })).resolves.toEqual({
      fanId: 'uid Enzo',
      blocked: false,
    });
    expect(del).toHaveBeenCalledWith('/me/blocks/uid%20Enzo', {
      headers: { 'Idempotency-Key': 'unblock-k4' },
    });
  });

  it('a denúncia de perfil vai em POST /fans/<uid>/report com o motivo (ou null) e a chave', async () => {
    post.mockResolvedValue({ data: { fanId: 'uidEnzo', status: 'already_reported' } });
    await expect(
      reportFan({ fanId: 'uidEnzo', reason: 'harassment', idempotencyKey: 'report-fan-k5' }),
    ).resolves.toEqual({ fanId: 'uidEnzo', status: 'already_reported' });
    expect(post).toHaveBeenCalledWith(
      '/fans/uidEnzo/report',
      { reason: 'harassment' },
      { headers: { 'Idempotency-Key': 'report-fan-k5' } },
    );
    await reportFan({ fanId: 'a/b', reason: null, idempotencyKey: 'report-fan-k6' });
    expect(post).toHaveBeenLastCalledWith(
      '/fans/a%2Fb/report',
      { reason: null },
      {
        headers: { 'Idempotency-Key': 'report-fan-k6' },
      },
    );
  });

  it('a lista de bloqueados vai em GET /me/blocks com o cursor, sem o limit', async () => {
    const page = {
      items: [{ uid: 'uidEnzo', displayName: 'Enzo', username: 'enzo', photoURL: null }],
      nextCursor: '3:uidEnzo',
    };
    get.mockResolvedValue({ data: page });
    await expect(fetchBlockedFans(null)).resolves.toEqual(page);
    expect(get).toHaveBeenCalledWith('/me/blocks', { params: { cursor: null } });
    await fetchBlockedFans('3:uidEnzo');
    expect(get).toHaveBeenLastCalledWith('/me/blocks', { params: { cursor: '3:uidEnzo' } });
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

  it('a denúncia de perfil (seção 29): already_reported na segunda vez da mesma pessoa, pelo outro id', async () => {
    await expect(
      reportFan({ fanId: 'fa-rank-01', reason: 'spam', idempotencyKey: 'report-fan-1' }),
    ).resolves.toEqual({ fanId: 'fa-rank-01', status: 'reported' });
    await expect(
      reportFan({ fanId: 'fa-thalita', reason: null, idempotencyKey: 'report-fan-2' }),
    ).resolves.toEqual({ fanId: 'fa-thalita', status: 'already_reported' });
    await expect(
      reportFan({ fanId: 'me', reason: null, idempotencyKey: 'report-fan-3' }),
    ).rejects.toMatchObject({ status: 404, code: 'fan_not_found' });
  });

  it('a lista de bloqueados: a fa-rank-13 do seed, páginas de 6, e desbloquear pelo alias tira a pessoa', async () => {
    await expect(fetchBlockedFans(null)).resolves.toEqual({
      items: [
        { uid: 'fa-rank-13', displayName: 'Bruno Santana', username: 'brunosan', photoURL: null },
      ],
      nextCursor: null,
    });
    for (const [index, id] of ['01', '02', '03', '04', '05', '06'].entries()) {
      await blockFan({ fanId: `fa-rank-${id}`, idempotencyKey: `bloq-${index}` });
    }
    const first = await fetchBlockedFans(null);
    expect(first.items).toHaveLength(6);
    expect(first.items[0]?.uid).toBe('fa-rank-06');
    expect(first.nextCursor).toBe('1:fa-rank-01');
    await expect(fetchBlockedFans(first.nextCursor)).resolves.toMatchObject({
      items: [{ uid: 'fa-rank-13' }],
      nextCursor: null,
    });

    // fa-thalita é a fa-rank-01 (o alias do comentário).
    await unblockFan({ fanId: 'fa-thalita', idempotencyKey: 'unblock-1' });
    const after = await fetchBlockedFans(null);
    expect(after.items.map((fan) => fan.uid)).not.toContain('fa-rank-01');
    expect(after.items).toHaveLength(6);
    expect(after.nextCursor).toBeNull();
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
