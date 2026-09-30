import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { fetchLeaderboard, fetchMyRank, fetchSeason } from './api';
import { scopeKey } from './scope';
import type { RankingScope } from './types';

/** A chave inclui tudo que muda o resultado: o recorte entra por `scopeKey`. */
export const rankingKeys = {
  all: ['ranking'] as const,
  season: () => [...rankingKeys.all, 'season'] as const,
  leaderboards: () => [...rankingKeys.all, 'leaderboard'] as const,
  leaderboard: (scope: RankingScope) => [...rankingKeys.leaderboards(), scopeKey(scope)] as const,
  myRanks: () => [...rankingKeys.all, 'me'] as const,
  myRank: (scope: RankingScope) => [...rankingKeys.myRanks(), scopeKey(scope)] as const,
};

/** A temporada do ranking (1f); `null` sem temporada em andamento. */
export function useSeasonQuery() {
  return useQuery({
    queryKey: rankingKeys.season(),
    queryFn: fetchSeason,
  });
}

/**
 * O ranking do recorte (geral ou de uma central), uma página por vez: a
 * primeira traz o pódio e o começo da lista, e as outras chegam ao rolar.
 */
export function useLeaderboardInfiniteQuery(scope: RankingScope) {
  return useInfiniteQuery({
    queryKey: rankingKeys.leaderboard(scope),
    queryFn: ({ pageParam }) => fetchLeaderboard(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** A posição do fã no recorte (card "Você"). */
export function useMyRankQuery(scope: RankingScope) {
  return useQuery({
    queryKey: rankingKeys.myRank(scope),
    queryFn: () => fetchMyRank(scope),
  });
}
