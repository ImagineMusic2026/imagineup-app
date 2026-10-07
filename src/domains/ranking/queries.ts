import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';

import { queryOptionsFor } from '@/services/query/client';

import { fetchLeaderboard, fetchMyRank, fetchSeason } from './api';
import { scopeKey } from './scope';
import type { LeaderboardPage, RankingScope } from './types';

/** A chave inclui tudo que muda o resultado: o recorte entra por `scopeKey`. */
export const rankingKeys = {
  all: ['ranking'] as const,
  season: () => [...rankingKeys.all, 'season'] as const,
  leaderboards: () => [...rankingKeys.all, 'leaderboard'] as const,
  leaderboard: (scope: RankingScope) => [...rankingKeys.leaderboards(), scopeKey(scope)] as const,
  myRanks: () => [...rankingKeys.all, 'me'] as const,
  myRank: (scope: RankingScope) => [...rankingKeys.myRanks(), scopeKey(scope)] as const,
};

/** A temporada do ranking (1f); `null` sem temporada para mostrar. Do servidor desde o bloco 8. */
export function useSeasonQuery() {
  return useQuery({
    ...queryOptionsFor('ranking'),
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
    ...queryOptionsFor('ranking'),
    queryKey: rankingKeys.leaderboard(scope),
    queryFn: ({ pageParam }) => fetchLeaderboard(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** A posição do fã no recorte (card "Você"). */
export function useMyRankQuery(scope: RankingScope) {
  return useQuery({
    ...queryOptionsFor('ranking'),
    queryKey: rankingKeys.myRank(scope),
    queryFn: () => fetchMyRank(scope),
  });
}

/**
 * Os pontos ou o ranking de uma central mudaram (uma ação que rendeu, entrar
 * ou sair, um puxão em outra tela): a temporada, o card "Você" e a primeira
 * página de cada ranking buscam de novo. As páginas seguintes saem antes: a
 * 1f e a 1d ficam montadas nas abas, e o React Query busca de novo, uma depois
 * da outra, toda página carregada de uma consulta infinita invalidada (depois
 * do toque no card, até 10 páginas de uns 45 leituras cada, a cada ação).
 * Quem estava longe recarrega ao rolar; o card segue com o `/me/rank`.
 */
export function refreshRanking(client: QueryClient): void {
  client.setQueriesData<InfiniteData<LeaderboardPage, string | null>>(
    { queryKey: rankingKeys.leaderboards() },
    (data) =>
      data && data.pages.length > 1
        ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
        : undefined,
  );
  void client.invalidateQueries({ queryKey: rankingKeys.all });
}
