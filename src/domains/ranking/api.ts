import { sourceOf } from '@/config/data-source';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { buildLeaderboardPageFixture, buildMyRankFixture, buildSeasonFixture } from './fixtures';
import { artistIdOf } from './scope';
import type { LeaderboardPage, MyRank, RankingScope, Season } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */

/** A temporada do ranking; `null` quando não há nenhuma em andamento. */
export async function fetchSeason(): Promise<Season | null> {
  if (sourceOf('ranking') === 'fixtures') {
    await fixtureDelay();
    return buildSeasonFixture(fixtureNow());
  }
  const { data } = await api.get<{ season: Season | null }>('/ranking/season');
  return data.season;
}

/** O ranking do recorte, uma página por vez, em ordem de posição. */
export async function fetchLeaderboard(
  scope: RankingScope,
  cursor: string | null,
): Promise<LeaderboardPage> {
  if (sourceOf('ranking') === 'fixtures') {
    await fixtureDelay();
    return buildLeaderboardPageFixture(scope, cursor);
  }
  const { data } = await api.get<LeaderboardPage>('/ranking', {
    params: { artistId: artistIdOf(scope), cursor },
  });
  return data;
}

/** A posição do fã no recorte e a próxima meta dele. */
export async function fetchMyRank(scope: RankingScope): Promise<MyRank> {
  if (sourceOf('ranking') === 'fixtures') {
    await fixtureDelay();
    return buildMyRankFixture(scope);
  }
  const { data } = await api.get<MyRank>('/me/rank', {
    params: { artistId: artistIdOf(scope) },
  });
  return data;
}
