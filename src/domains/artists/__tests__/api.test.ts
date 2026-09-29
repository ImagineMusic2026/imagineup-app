import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';

import { fetchArtists, followArtists } from '../api';
import { buildArtistsFixture, followFixture } from '../fixtures';

// A API real passa pelo axios com o token do Firebase; aqui só importa o que o domínio pede a ela.
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  get dataSource() {
    return mockDataSource;
  },
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  followFixture.reset();
});

describe('artistas de exemplo', () => {
  it('os quatro do protótipo vêm primeiro, com os fãs da 1l', () => {
    const artists = buildArtistsFixture();
    expect(artists.slice(0, 4).map(({ name, fanCount }) => [name, fanCount])).toEqual([
      ['Netto Brito', 412_000],
      ['Nenho', 298_000],
      ['Juninho Moraes', 141_000],
      ['Rock Salles', 96_000],
    ]);
  });

  it('são 22 ao todo (4 da grade e os 18 do "+18 artistas"), sem foto e em ordem', () => {
    const artists = buildArtistsFixture();
    expect(artists).toHaveLength(22);
    expect(new Set(artists.map((artist) => artist.id)).size).toBe(22);
    expect(artists.map((artist) => artist.order)).toEqual(artists.map((_, index) => index));
    expect(artists.every((artist) => artist.photoURL === null)).toBe(true);
    expect(artists[4]?.name).toBe('Artista 5');
    expect(artists[21]?.name).toBe('Artista 22');
  });

  it('cada chamada devolve uma lista nova', () => {
    expect(buildArtistsFixture()).not.toBe(buildArtistsFixture());
    expect(buildArtistsFixture()).toEqual(buildArtistsFixture());
  });
});

describe('lista de artistas', () => {
  it('sem a API, vem das fixtures', async () => {
    await expect(fetchArtists()).resolves.toEqual(buildArtistsFixture());
    expect(get).not.toHaveBeenCalled();
  });

  it('com a API, pede /artists', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: buildArtistsFixture() });
    await expect(fetchArtists()).resolves.toHaveLength(22);
    expect(get).toHaveBeenCalledWith('/artists');
  });
});

describe('seguir artistas', () => {
  it('nas fixtures, soma às centrais que o fã já segue', async () => {
    const result = await followArtists({
      artistIds: ['rock-salles', 'artista-5'],
      idempotencyKey: 'chave-1',
    });
    expect(result.followedArtistIds).toEqual(
      expect.arrayContaining([
        'netto-brito',
        'nenho',
        'juninho-moraes',
        'rock-salles',
        'artista-5',
      ]),
    );
    expect(followFixture.followedIds()).toHaveLength(5);
  });

  it('a mesma chave de novo não segue outra vez', async () => {
    const first = await followArtists({ artistIds: ['rock-salles'], idempotencyKey: 'chave-1' });
    const again = await followArtists({ artistIds: ['artista-6'], idempotencyKey: 'chave-1' });
    expect(again).toEqual(first);
    expect(followFixture.followedIds()).not.toContain('artista-6');
  });

  it('artista que não existe é recusado, como a API faria', async () => {
    await expect(
      followArtists({ artistIds: ['ninguem'], idempotencyKey: 'chave-2' }),
    ).rejects.toMatchObject({ kind: 'notFound' } satisfies Partial<ApiError>);
    expect(followFixture.followedIds()).toHaveLength(3);
  });

  it('com a API, manda os artistas e a chave de idempotência', async () => {
    mockDataSource = 'api';
    post.mockResolvedValue({ data: { followedArtistIds: ['nenho'] } });

    await expect(
      followArtists({ artistIds: ['nenho'], idempotencyKey: 'chave-3' }),
    ).resolves.toEqual({ followedArtistIds: ['nenho'] });
    expect(post).toHaveBeenCalledWith(
      '/me/artists',
      { artistIds: ['nenho'] },
      { headers: { 'Idempotency-Key': 'chave-3' } },
    );
  });
});
