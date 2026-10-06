import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';

import {
  fetchArtist,
  fetchArtists,
  fetchFanCentrals,
  followArtists,
  joinCentral,
  leaveCentral,
} from '../api';
import {
  buildArtistDetailsFixture,
  buildArtistsFixture,
  buildFanCentralsFixture,
  followFixture,
  JOIN_CENTRAL_POINTS,
} from '../fixtures';

// A API real passa pelo axios com o token do Firebase; aqui só importa o que o domínio pede a ela.
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// Lido na hora da chamada: cada teste escolhe a fonte (e, no modo misto, a de um domínio).
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
let mockDomainSources: Partial<Record<string, 'api' | 'fixtures'>> = {};
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => mockDomainSources[domain] ?? mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const put = jest.mocked(api.put);
const del = jest.mocked(api.delete);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  mockDomainSources = {};
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
      artistIds: ['rocksalles', 'artista5'],
      idempotencyKey: 'chave-1',
    });
    expect(result.followedArtistIds).toEqual(
      expect.arrayContaining(['nettobrito', 'nenho', 'juninhomoraes', 'rocksalles', 'artista5']),
    );
    expect(followFixture.followedIds()).toHaveLength(5);
  });

  it('a mesma chave de novo não segue outra vez', async () => {
    const first = await followArtists({ artistIds: ['rocksalles'], idempotencyKey: 'chave-1' });
    const again = await followArtists({ artistIds: ['artista6'], idempotencyKey: 'chave-1' });
    expect(again).toEqual(first);
    expect(followFixture.followedIds()).not.toContain('artista6');
  });

  it('artista que não existe é recusado, como a API faria', async () => {
    await expect(
      followArtists({ artistIds: ['ninguem'], idempotencyKey: 'chave-2' }),
    ).rejects.toMatchObject({ kind: 'notFound' } satisfies Partial<ApiError>);
    expect(followFixture.followedIds()).toHaveLength(3);
  });

  it('nas fixtures, a escolha de artistas não rende pontos', async () => {
    const before = fixtureWallet.get();
    await expect(
      followArtists({ artistIds: ['rocksalles'], idempotencyKey: 'chave-5' }),
    ).resolves.toMatchObject({ pointsAwarded: 0 });
    expect(fixtureWallet.get()).toEqual(before);
  });

  it('com a API, manda os artistas e a chave de idempotência, e devolve os pontos de entrada', async () => {
    mockDataSource = 'api';
    post.mockResolvedValue({ data: { followedArtistIds: ['nenho'], pointsAwarded: 10 } });

    await expect(
      followArtists({ artistIds: ['nenho'], idempotencyKey: 'chave-3' }),
    ).resolves.toEqual({ followedArtistIds: ['nenho'], pointsAwarded: 10 });
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
        artistId: 'nettobrito',
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
        artistId: 'juninhomoraes',
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
    await followArtists({ artistIds: ['rocksalles'], idempotencyKey: 'chave-4' });
    await expect(fetchFanCentrals()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artistId: 'rocksalles',
          name: 'Rock Salles',
          fanRank: null,
          seasonPoints: 0,
        }),
      ]),
    );
    expect((await fetchFanCentrals()).map((central) => central.artistId)).toEqual([
      'nettobrito',
      'nenho',
      'juninhomoraes',
      'rocksalles',
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
    expect(buildArtistDetailsFixture('nettobrito')).toEqual({
      id: 'nettobrito',
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
    expect(buildArtistDetailsFixture('rocksalles')).toMatchObject({ isMember: false });
  });

  it('as centrais genéricas não têm a pílula de gestão oficial', () => {
    expect(buildArtistDetailsFixture('artista5')).toMatchObject({ managedByImagine: false });
  });

  it('artista que não existe dá 404, como a API', async () => {
    await expect(fetchArtist('ninguem')).rejects.toMatchObject({
      kind: 'notFound',
    } satisfies Partial<ApiError>);
  });

  it('com a API, pede /artists/<id>', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { id: 'nenho', postCount: 0 } });
    await expect(fetchArtist('nenho')).resolves.toEqual({ id: 'nenho', postCount: 0 });
    expect(get).toHaveBeenCalledWith('/artists/nenho');
  });

  it('com a API, o "N posts" é o do servidor (o count dos posts no ar), sem troca pelo de exemplo', async () => {
    mockDomainSources = { artists: 'api', posts: 'api' };
    get.mockResolvedValue({ data: { id: 'nenho', postCount: 2, fanCount: 1 } });
    await expect(fetchArtist('nenho')).resolves.toEqual({
      id: 'nenho',
      postCount: 2,
      fanCount: 1,
    });
  });
});

describe('entrar na central', () => {
  it('rende os pontos de exemplo na carteira e põe a central nas do fã', async () => {
    const before = fixtureWallet.get();
    await expect(
      joinCentral({ artistId: 'rocksalles', idempotencyKey: 'entrar-1' }),
    ).resolves.toEqual({ artistId: 'rocksalles', pointsAwarded: JOIN_CENTRAL_POINTS });

    expect(fixtureWallet.get()).toEqual({
      balance: before.balance + JOIN_CENTRAL_POINTS,
      xp: before.xp + JOIN_CENTRAL_POINTS,
      seasonPoints: before.seasonPoints + JOIN_CENTRAL_POINTS,
    });
    expect(buildArtistDetailsFixture('rocksalles').isMember).toBe(true);
    expect(buildFanCentralsFixture().at(-1)).toMatchObject({
      artistId: 'rocksalles',
      fanRank: null,
    });
  });

  it('a mesma chave de novo devolve a mesma resposta, sem pontos a mais', async () => {
    await joinCentral({ artistId: 'rocksalles', idempotencyKey: 'entrar-2' });
    const after = fixtureWallet.get();
    await expect(
      joinCentral({ artistId: 'rocksalles', idempotencyKey: 'entrar-2' }),
    ).resolves.toEqual({ artistId: 'rocksalles', pointsAwarded: JOIN_CENTRAL_POINTS });
    expect(fixtureWallet.get()).toEqual(after);
  });

  it('quem já está na central não ganha de novo', async () => {
    await expect(
      joinCentral({ artistId: 'nettobrito', idempotencyKey: 'entrar-3' }),
    ).resolves.toEqual({ artistId: 'nettobrito', pointsAwarded: 0 });
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

describe('sair da central', () => {
  it('nas fixtures, tira das centrais do fã sem mexer nos pontos; a mesma chave devolve a mesma resposta', async () => {
    const before = fixtureWallet.get();
    await expect(leaveCentral({ artistId: 'nenho', idempotencyKey: 'sair-1' })).resolves.toEqual({
      artistId: 'nenho',
    });
    expect(followFixture.followedIds()).not.toContain('nenho');
    expect(buildArtistDetailsFixture('nenho').isMember).toBe(false);
    expect(fixtureWallet.get()).toEqual(before);

    // Sair de novo, ou com a mesma chave: o mesmo resultado, sem efeito.
    await expect(leaveCentral({ artistId: 'nenho', idempotencyKey: 'sair-1' })).resolves.toEqual({
      artistId: 'nenho',
    });
    await expect(leaveCentral({ artistId: 'nenho', idempotencyKey: 'sair-2' })).resolves.toEqual({
      artistId: 'nenho',
    });
    expect(fixtureWallet.get()).toEqual(before);
  });

  it('nas fixtures, sair e entrar de novo não paga a entrada outra vez', async () => {
    await joinCentral({ artistId: 'rocksalles', idempotencyKey: 'entrar-5' });
    const paid = fixtureWallet.get();
    await leaveCentral({ artistId: 'rocksalles', idempotencyKey: 'sair-3' });
    await expect(
      joinCentral({ artistId: 'rocksalles', idempotencyKey: 'entrar-6' }),
    ).resolves.toEqual({ artistId: 'rocksalles', pointsAwarded: 0 });
    expect(fixtureWallet.get()).toEqual(paid);
    expect(buildArtistDetailsFixture('rocksalles').isMember).toBe(true);
  });

  it('nas fixtures, quem saiu de uma central do protótipo e entra de novo também não ganha', async () => {
    await leaveCentral({ artistId: 'nettobrito', idempotencyKey: 'sair-4' });
    await expect(
      joinCentral({ artistId: 'nettobrito', idempotencyKey: 'entrar-7' }),
    ).resolves.toEqual({ artistId: 'nettobrito', pointsAwarded: 0 });
  });

  it('com a API, DELETE em /me/centrals/<id> com a chave de idempotência', async () => {
    mockDataSource = 'api';
    del.mockResolvedValue({ data: { artistId: 'nenho' } });
    await expect(leaveCentral({ artistId: 'nenho', idempotencyKey: 'sair-5' })).resolves.toEqual({
      artistId: 'nenho',
    });
    expect(del).toHaveBeenCalledWith('/me/centrals/nenho', {
      headers: { 'Idempotency-Key': 'sair-5' },
    });
  });
});
