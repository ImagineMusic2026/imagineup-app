import { buildFanCentralsFixture, followFixture } from '@/domains/artists/fixtures';
import { buildMissionsFixture } from '@/domains/missions/fixtures';
import { api } from '@/services/api';
import { fixtureWallet } from '@/services/fixtures';

import { fetchLeaderboard, fetchMyRank, fetchSeason } from '../api';
import {
  buildLeaderboardPageFixture,
  buildMyRankFixture,
  buildSeasonFixture,
  LEADERBOARD_PAGE_SIZE,
} from '../fixtures';
import { GLOBAL_SCOPE } from '../scope';
import type { LeaderboardEntry, RankingScope } from '../types';

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
jest.mock('@/config/env', () => ({
  get dataSource() {
    return mockDataSource;
  },
}));

const get = jest.mocked(api.get);

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

const NETTO: RankingScope = { kind: 'artist', artistId: 'netto-brito' };
const NENHO: RankingScope = { kind: 'artist', artistId: 'nenho' };
const JUNINHO: RankingScope = { kind: 'artist', artistId: 'juninho-moraes' };

/** O ranking inteiro do recorte, página por página. */
function wholeBoard(scope: RankingScope): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  let cursor: string | null = null;
  do {
    const page = buildLeaderboardPageFixture(scope, cursor);
    entries.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return entries;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  fixtureWallet.reset();
  followFixture.reset();
});

describe('ranking de exemplo', () => {
  it('a primeira página do geral traz o pódio e a lista do protótipo', () => {
    const page = buildLeaderboardPageFixture(GLOBAL_SCOPE, null);
    expect(page.items).toHaveLength(LEADERBOARD_PAGE_SIZE);
    expect(page.nextCursor).toBe(String(LEADERBOARD_PAGE_SIZE));
    expect(
      page.items
        .slice(0, 8)
        .map(({ position, displayName, city, points, change }) => [
          position,
          displayName,
          city,
          points,
          change,
        ]),
    ).toEqual([
      [1, 'Thalita Santos', 'Irará, BA', 9_140, 1],
      [2, 'Davi Lima', 'Salvador, BA', 7_902, -1],
      [3, 'Jean Pereira', 'Aracaju, SE', 7_318, 0],
      [4, 'Maria Clara Souza', 'Salvador, BA', 6_844, 3],
      [5, 'Alan Ferreira', 'Irará, BA', 6_201, 1],
      [6, 'Bruna Andrade', 'Recife, PE', 5_930, 7],
      [7, 'Igor Nascimento', 'Aracaju, SE', 5_412, 2],
      [8, 'Leila Matos', 'Feira de Santana, BA', 5_106, 4],
    ]);
    // O 10º tem 4.960: a meta do fã, 840 acima dos 4.120 dele.
    expect(page.items[9]).toMatchObject({ position: 10, points: 4_960, city: null });
  });

  it('o fã é o 12º do geral com os pontos da temporada da carteira, a 840 do top 10', () => {
    const { seasonPoints } = fixtureWallet.get();
    expect(seasonPoints).toBe(4_120);

    const me = wholeBoard(GLOBAL_SCOPE).filter((entry) => entry.isMe);
    expect(me).toEqual([expect.objectContaining({ position: 12, points: seasonPoints })]);
    expect(buildMyRankFixture(GLOBAL_SCOPE)).toEqual({
      position: 12,
      points: 4_120,
      target: { kind: 'top', position: 10, pointsLeft: 840 },
    });
  });

  it('ganhar pontos da temporada muda a posição do fã, como a API faria', () => {
    fixtureWallet.earn(15);
    expect(buildMyRankFixture(GLOBAL_SCOPE)).toMatchObject({ position: 12, points: 4_135 });

    fixtureWallet.earn(900);
    expect(buildMyRankFixture(GLOBAL_SCOPE)).toEqual({
      position: 10,
      points: 5_035,
      target: { kind: 'position', position: 9, pointsLeft: 3 },
    });
  });

  it('nas centrais, a posição do fã é a da home: 12º no Netto, 41º no Nenho, sem posição no Juninho', () => {
    const centrals = buildFanCentralsFixture();
    expect(centrals.map(({ artistId, fanRank }) => [artistId, fanRank])).toEqual([
      ['netto-brito', 12],
      ['nenho', 41],
      ['juninho-moraes', null],
    ]);
    for (const { artistId, fanRank } of centrals) {
      const scope: RankingScope = { kind: 'artist', artistId };
      expect(buildMyRankFixture(scope).position).toBe(fanRank);
      expect(wholeBoard(scope).find((entry) => entry.isMe)?.position ?? null).toBe(fanRank);
    }
    expect(buildMyRankFixture(NETTO)).toEqual({
      position: 12,
      points: 4_120,
      target: { kind: 'top', position: 10, pointsLeft: expect.any(Number) },
    });
    expect(buildMyRankFixture(JUNINHO)).toEqual({ position: null, points: 0, target: null });
  });

  it('cada central tem outra ordem, com menos pontos que o geral', () => {
    const global = wholeBoard(GLOBAL_SCOPE);
    for (const scope of [NETTO, NENHO, JUNINHO]) {
      const board = wholeBoard(scope);
      expect(board[0]?.userId).not.toBe(global[0]?.userId);
      expect(board[0]?.points).toBeLessThan(global[0]?.points ?? 0);
    }
  });

  it('as posições seguem os pontos, sem repetir gente, de página em página', () => {
    for (const scope of [GLOBAL_SCOPE, NETTO, NENHO, JUNINHO]) {
      const board = wholeBoard(scope);
      expect(board.map(({ position }) => position)).toEqual(board.map((_, index) => index + 1));
      for (let index = 1; index < board.length; index += 1) {
        expect(board[index]?.points).toBeLessThanOrEqual(board[index - 1]?.points ?? 0);
      }
      expect(new Set(board.map(({ userId }) => userId)).size).toBe(board.length);
      expect(new Set(board.map(({ displayName }) => displayName)).size).toBe(board.length);
    }
    // 41º no Nenho: a quinta página.
    expect(buildLeaderboardPageFixture(NENHO, '40').items[0]).toMatchObject({
      position: 41,
      isMe: true,
    });
  });

  it('a temporada é a de São João e acaba junto com a meta das missões', () => {
    const season = buildSeasonFixture(NOW);
    expect(season).toMatchObject({
      id: 'temporada-sao-joao',
      name: 'São João',
      status: 'active',
      leaderTitle: null,
    });
    expect(season.endsAt).toBe(buildMissionsFixture(NOW).season?.endsAt);
    expect(Date.parse(season.startsAt)).toBeLessThan(NOW.getTime());
  });
});

describe('ranking pela API', () => {
  it('nas fixtures, nada vai à rede', async () => {
    await expect(fetchSeason()).resolves.toMatchObject({ name: 'São João' });
    await expect(fetchLeaderboard(NENHO, '10')).resolves.toMatchObject({ nextCursor: '20' });
    await expect(fetchMyRank(NENHO)).resolves.toMatchObject({ position: 41 });
    expect(get).not.toHaveBeenCalled();
  });

  it('com a API, cada recorte vai com o artista e o cursor', async () => {
    mockDataSource = 'api';
    get.mockResolvedValueOnce({ data: { season: null } });
    await expect(fetchSeason()).resolves.toBeNull();
    expect(get).toHaveBeenLastCalledWith('/ranking/season');

    const page = { items: [], nextCursor: null };
    get.mockResolvedValueOnce({ data: page });
    await expect(fetchLeaderboard(GLOBAL_SCOPE, null)).resolves.toEqual(page);
    expect(get).toHaveBeenLastCalledWith('/ranking', {
      params: { artistId: undefined, cursor: null },
    });

    get.mockResolvedValueOnce({ data: page });
    await fetchLeaderboard(NETTO, '10');
    expect(get).toHaveBeenLastCalledWith('/ranking', {
      params: { artistId: 'netto-brito', cursor: '10' },
    });

    const mine = { position: 3, points: 10, target: null };
    get.mockResolvedValueOnce({ data: mine });
    await expect(fetchMyRank(NENHO)).resolves.toEqual(mine);
    expect(get).toHaveBeenLastCalledWith('/me/rank', { params: { artistId: 'nenho' } });
  });
});
