import { Platform, Share } from 'react-native';

import { SHARE_LINK_BASE } from '@/domains/invites/consts';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { setFixtureNow } from '@/services/fixtures';

import { fetchArtistPosts, fetchFeed, fetchPost } from '../api';
import {
  ARTIST_POSTS_PAGE_SIZE,
  buildArtistPostsPageFixture,
  buildPostsFixture,
  FEED_PAGE_SIZE,
} from '../fixtures';
import { postPath, sharePost } from '../share-post';

jest.mock('@/services/api', () => ({
  ApiError: jest.requireActual('@/services/api/errors').ApiError,
  api: { get: jest.fn() },
}));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  get dataSource() {
    return mockDataSource;
  },
}));

const get = jest.mocked(api.get);

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  setFixtureNow(NOW);
});

afterEach(() => setFixtureNow(null));

describe('mural de exemplo', () => {
  it('abre com os dois posts da home do protótipo: o clipe do Netto e o show do Nenho', () => {
    const [clip, show] = buildPostsFixture(NOW);
    expect(clip).toMatchObject({
      id: 'p-clipe',
      kind: 'video',
      artist: { name: 'Netto Brito', verified: true },
      likeCount: 4_812,
      sharePointsPerVisit: 2,
      createdAt: new Date(2026, 8, 29, 18, 0).toISOString(),
    });
    expect(show).toMatchObject({
      id: 'p-show',
      kind: 'event',
      artist: { name: 'Nenho' },
      text: 'Sábado tem show em Aracaju! Quem vem?',
      media: null,
      event: { id: 'arrocha-na-praia', city: 'Aracaju, SE' },
    });
  });

  it('o show do post é no sábado seguinte, às 22 h', () => {
    const [, show] = buildPostsFixture(NOW);
    const startsAt = new Date(show?.event?.startsAt ?? '');
    expect(startsAt.getDay()).toBe(6);
    expect(startsAt.getDate()).toBe(3);
    expect(startsAt.getHours()).toBe(22);
  });

  it('vem do mais novo ao mais antigo, e só post de texto fica sem mídia', () => {
    const posts = buildPostsFixture(NOW);
    const times = posts.map((post) => new Date(post.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const post of posts) {
      expect(post.media === null).toBe(post.kind === 'text' || post.kind === 'event');
    }
  });

  it('pagina de 5 em 5 pelo cursor, até acabar', async () => {
    const first = await fetchFeed(null);
    expect(first.items).toHaveLength(FEED_PAGE_SIZE);
    expect(first.items[0]?.id).toBe('p-clipe');
    expect(first.nextCursor).toBe('5');

    const second = await fetchFeed(first.nextCursor);
    expect(second.items.map((post) => post.id)).not.toContain('p-clipe');
    expect(second.nextCursor).toBeNull();
    expect(first.items.length + second.items.length).toBe(buildPostsFixture(NOW).length);
  });

  it('o detalhe acha o post pelo id, e post que não existe dá 404 como a API', async () => {
    await expect(fetchPost('p-show')).resolves.toMatchObject({ kind: 'event' });
    await expect(fetchPost('nao-existe')).rejects.toMatchObject({
      kind: 'notFound',
    } satisfies Partial<ApiError>);
  });

  it('com a API, pede /feed com o cursor', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchFeed('abc');
    expect(get).toHaveBeenCalledWith('/feed', { params: { cursor: 'abc' } });
  });
});

describe('compartilhar um post', () => {
  const post = {
    id: 'p-clipe',
    artist: { id: 'netto-brito', name: 'Netto Brito', verified: true, photoURL: null },
  };
  const share = () => jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    jest.restoreAllMocks();
  });

  it('o link é o do post, com o código de convite do fã', async () => {
    const spy = share();
    Platform.OS = 'android';
    await sharePost(post, 'CAMILA12');
    expect(spy).toHaveBeenCalledWith({
      message: `Olha esse post de Netto Brito no ImagineUP\n${SHARE_LINK_BASE}${postPath('p-clipe')}?ref=CAMILA12`,
    });
  });

  it('no iOS o link vai no campo próprio, para não sair duas vezes', async () => {
    const spy = share();
    Platform.OS = 'ios';
    await sharePost(post, 'CAMILA12');
    expect(spy).toHaveBeenCalledWith({
      message: 'Olha esse post de Netto Brito no ImagineUP',
      url: `${SHARE_LINK_BASE}/post/p-clipe?ref=CAMILA12`,
    });
  });

  it('sem o código (ainda carregando), compartilha o link puro', async () => {
    const spy = share();
    Platform.OS = 'ios';
    await sharePost(post, null);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${SHARE_LINK_BASE}/post/p-clipe` }),
    );
  });
});

describe('posts de uma central (grade da 1d)', () => {
  it('são os do mural, só os do artista, do mais novo ao mais antigo', () => {
    const page = buildArtistPostsPageFixture(NOW, 'netto-brito', null);
    expect(page.items.map((post) => post.id)).toEqual(
      buildPostsFixture(NOW)
        .filter((post) => post.artist.id === 'netto-brito')
        .map((post) => post.id),
    );
    expect(page.items.length).toBeLessThanOrEqual(ARTIST_POSTS_PAGE_SIZE);
    expect(page.nextCursor).toBeNull();
  });

  it('central sem post devolve a página vazia', () => {
    expect(buildArtistPostsPageFixture(NOW, 'rock-salles', null)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('com a API, pede os posts do artista pelo cursor', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { items: [], nextCursor: null } });
    await fetchArtistPosts('netto-brito', '12');
    expect(get).toHaveBeenCalledWith('/artists/netto-brito/posts', { params: { cursor: '12' } });
  });
});
