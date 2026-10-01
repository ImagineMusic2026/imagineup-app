import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';

import { fixtureWallet } from '@/services/fixtures';

import { fetchArtist, fetchArtists, fetchFanCentrals, followArtists, joinCentral } from '../api';
import {
  buildArtistDetailsFixture,
  buildArtistsFixture,
  buildFanCentralsFixture,
  followFixture,
  JOIN_CENTRAL_POINTS,
} from '../fixtures';

// A API real passa pelo axios com o token do Firebase; aqui só importa o que o domínio pede a ela.
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
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
const put = jest.mocked(api.put);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  followFixture.reset();
  fixtureWallet.reset();
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

describe('centrais do fã', () => {
  it('as três do protótipo, com a posição e os pontos do fã: #12, #41 e "novo"', () => {
    expect(buildFanCentralsFixture()).toEqual([
      {
        artistId: 'netto-brito',
        name: 'Netto Brito',
        shortName: null,
        photoURL: null,
        fanCount: 412_000,
        fanRank: 12,
        seasonPoints: 4_120,
      },
      {
        artistId: 'nenho',
        name: 'Nenho',
        shortName: null,
        photoURL: null,
        fanCount: 298_000,
        fanRank: 41,
        seasonPoints: 2_980,
      },
      {
        artistId: 'juninho-moraes',
        name: 'Juninho Moraes',
        shortName: 'Juninho M.',
        photoURL: null,
        fanCount: 141_000,
        fanRank: null,
        seasonPoints: 0,
      },
    ]);
  });

  it('as que a escolha de artistas somou entram no fim, ainda sem posição', async () => {
    await followArtists({ artistIds: ['rock-salles'], idempotencyKey: 'chave-4' });
    await expect(fetchFanCentrals()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artistId: 'rock-salles',
          name: 'Rock Salles',
          fanRank: null,
          seasonPoints: 0,
        }),
      ]),
    );
    expect((await fetchFanCentrals()).map((central) => central.artistId)).toEqual([
      'netto-brito',
      'nenho',
      'juninho-moraes',
      'rock-salles',
    ]);
  });

  it('com a API, pede /me/centrals', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: [] });
    await expect(fetchFanCentrals()).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith('/me/centrals');
  });
});

describe('página da central', () => {
  it('o Netto do protótipo: 412 mil fãs, 1.284 posts, 8,4 mi de pontos, gestão da Imagine e o fã dentro', () => {
    expect(buildArtistDetailsFixture('netto-brito')).toEqual({
      id: 'netto-brito',
      name: 'Netto Brito',
      coverUrl: null,
      photoURL: null,
      verified: true,
      managedByImagine: true,
      fanCount: 412_000,
      postCount: 1_284,
      centralPoints: 8_400_000,
      isMember: true,
    });
  });

  it('o Rock Salles fica fora das centrais do fã, para o "Entrar na central"', () => {
    expect(buildArtistDetailsFixture('rock-salles')).toMatchObject({ isMember: false });
  });

  it('as centrais genéricas não têm a pílula de gestão oficial', () => {
    expect(buildArtistDetailsFixture('artista-5')).toMatchObject({ managedByImagine: false });
  });

  it('artista que não existe dá 404, como a API', async () => {
    await expect(fetchArtist('ninguem')).rejects.toMatchObject({
      kind: 'notFound',
    } satisfies Partial<ApiError>);
  });

  it('com a API, pede /artists/<id>', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { id: 'nenho' } });
    await fetchArtist('nenho');
    expect(get).toHaveBeenCalledWith('/artists/nenho');
  });
});

describe('entrar na central', () => {
  it('rende os pontos de exemplo na carteira e põe a central nas do fã', async () => {
    const before = fixtureWallet.get();
    await expect(
      joinCentral({ artistId: 'rock-salles', idempotencyKey: 'entrar-1' }),
    ).resolves.toEqual({ artistId: 'rock-salles', pointsAwarded: JOIN_CENTRAL_POINTS });

    expect(fixtureWallet.get()).toEqual({
      balance: before.balance + JOIN_CENTRAL_POINTS,
      xp: before.xp + JOIN_CENTRAL_POINTS,
      seasonPoints: before.seasonPoints + JOIN_CENTRAL_POINTS,
    });
    expect(buildArtistDetailsFixture('rock-salles').isMember).toBe(true);
    expect(buildFanCentralsFixture().at(-1)).toMatchObject({
      artistId: 'rock-salles',
      fanRank: null,
    });
  });

  it('a mesma chave de novo devolve a mesma resposta, sem pontos a mais', async () => {
    await joinCentral({ artistId: 'rock-salles', idempotencyKey: 'entrar-2' });
    const after = fixtureWallet.get();
    await expect(
      joinCentral({ artistId: 'rock-salles', idempotencyKey: 'entrar-2' }),
    ).resolves.toEqual({ artistId: 'rock-salles', pointsAwarded: JOIN_CENTRAL_POINTS });
    expect(fixtureWallet.get()).toEqual(after);
  });

  it('quem já está na central não ganha de novo', async () => {
    await expect(
      joinCentral({ artistId: 'netto-brito', idempotencyKey: 'entrar-3' }),
    ).resolves.toEqual({ artistId: 'netto-brito', pointsAwarded: 0 });
  });

  it('com a API, manda a chave de idempotência', async () => {
    mockDataSource = 'api';
    put.mockResolvedValue({ data: { artistId: 'nenho', pointsAwarded: 5 } });
    await joinCentral({ artistId: 'nenho', idempotencyKey: 'entrar-4' });
    expect(put).toHaveBeenCalledWith('/me/centrals/nenho', null, {
      headers: { 'Idempotency-Key': 'entrar-4' },
    });
  });
});
