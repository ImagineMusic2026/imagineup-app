import { api } from '@/services/api';
import { fixtureWallet } from '@/services/fixtures';
import { followFixture } from '@/domains/artists/fixtures';

import { fetchLeaderboard, fetchMyRank, fetchSeason } from '../api';
import { GLOBAL_SCOPE } from '../scope';
import type { LeaderboardPage, MyRank, RankingScope, Season } from '../types';

// O build do Firebase que o Jest resolve é ESM; o ranking não fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);

const NETTO: RankingScope = { kind: 'artist', artistId: 'nettobrito' };
const NENHO: RankingScope = { kind: 'artist', artistId: 'nenho' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  fixtureWallet.reset();
  followFixture.reset();
});

describe('ranking: as três rotas (bloco 8, 23.2)', () => {
  it('nas fixtures, nada vai à rede', async () => {
    await expect(fetchSeason()).resolves.toMatchObject({ name: 'São João' });
    await expect(fetchLeaderboard(NENHO, '20')).resolves.toMatchObject({ nextCursor: '40' });
    await expect(fetchMyRank(NENHO)).resolves.toMatchObject({ position: 41, member: true });
    expect(get).not.toHaveBeenCalled();
  });

  it('com a API, a temporada vem desembrulhada; o ranking e a posição levam o artista e o cursor', async () => {
    mockDataSource = 'api';
    const season: Season = {
      id: 'temporada-sao-joao',
      name: 'São João',
      startsAt: '2026-09-19T01:00:00.000Z',
      endsAt: '2026-10-19T01:00:00.000Z',
      status: 'ended',
      leaderTitle: null,
    };
    get.mockResolvedValueOnce({ data: { season } });
    await expect(fetchSeason()).resolves.toEqual(season);
    expect(get).toHaveBeenLastCalledWith('/ranking/season');
    get.mockResolvedValueOnce({ data: { season: null } });
    await expect(fetchSeason()).resolves.toBeNull();

    const page: LeaderboardPage = { items: [], nextCursor: null };
    get.mockResolvedValueOnce({ data: page });
    await expect(fetchLeaderboard(GLOBAL_SCOPE, null)).resolves.toEqual(page);
    expect(get).toHaveBeenLastCalledWith('/ranking', {
      params: { artistId: undefined, cursor: null },
    });

    get.mockResolvedValueOnce({ data: page });
    await fetchLeaderboard(NETTO, 'WzEwLDEsInVpZCIsMjBd');
    expect(get).toHaveBeenLastCalledWith('/ranking', {
      params: { artistId: 'nettobrito', cursor: 'WzEwLDEsInVpZCIsMjBd' },
    });

    // O `member` da central chega como o servidor manda.
    const mine: MyRank = { position: null, points: 750, target: null, member: false };
    get.mockResolvedValueOnce({ data: mine });
    await expect(fetchMyRank(NENHO)).resolves.toEqual(mine);
    expect(get).toHaveBeenLastCalledWith('/me/rank', { params: { artistId: 'nenho' } });
    get.mockResolvedValueOnce({ data: { position: 12, points: 4_120, target: null } });
    await fetchMyRank(GLOBAL_SCOPE);
    expect(get).toHaveBeenLastCalledWith('/me/rank', { params: { artistId: undefined } });
  });
});
