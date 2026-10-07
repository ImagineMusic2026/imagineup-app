import { QueryClient, type InfiniteData } from '@tanstack/react-query';

import { rankingKeys, refreshRanking } from '../queries';
import { GLOBAL_SCOPE } from '../scope';
import type { LeaderboardPage, MyRank, RankingScope } from '../types';

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

const NETTO: RankingScope = { kind: 'artist', artistId: 'nettobrito' };

const pageOf = (first: number, nextCursor: string | null): LeaderboardPage => ({
  items: [
    {
      position: first,
      userId: `fa-${first}`,
      displayName: null,
      photoURL: null,
      city: null,
      points: 1_000 - first,
      change: 0,
      isMe: false,
    },
  ],
  nextCursor,
});

type Board = InfiniteData<LeaderboardPage, string | null>;

describe('refreshRanking: depois de uma ação, só a primeira página busca de novo', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => client.clear());

  it('corta cada ranking carregado na primeira página e invalida o ranking inteiro', () => {
    client.setQueryData<Board>(rankingKeys.leaderboard(GLOBAL_SCOPE), {
      pages: [pageOf(1, 'c20'), pageOf(21, 'c40'), pageOf(41, null)],
      pageParams: [null, 'c20', 'c40'],
    });
    client.setQueryData<Board>(rankingKeys.leaderboard(NETTO), {
      pages: [pageOf(1, null)],
      pageParams: [null],
    });
    const myRank: MyRank = { position: 12, points: 4_120, target: null };
    client.setQueryData(rankingKeys.myRank(GLOBAL_SCOPE), myRank);

    refreshRanking(client);

    expect(client.getQueryData<Board>(rankingKeys.leaderboard(GLOBAL_SCOPE))).toEqual({
      pages: [pageOf(1, 'c20')],
      pageParams: [null],
    });
    expect(client.getQueryData<Board>(rankingKeys.leaderboard(NETTO))?.pages).toHaveLength(1);
    // O card fica como estava até a busca nova chegar.
    expect(client.getQueryData(rankingKeys.myRank(GLOBAL_SCOPE))).toEqual(myRank);
    for (const key of [
      rankingKeys.leaderboard(GLOBAL_SCOPE),
      rankingKeys.leaderboard(NETTO),
      rankingKeys.myRank(GLOBAL_SCOPE),
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('sem ranking no cache, só invalida (nada nasce vazio)', () => {
    refreshRanking(client);
    expect(client.getQueryData(rankingKeys.leaderboard(GLOBAL_SCOPE))).toBeUndefined();
  });
});
