import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { buildDailyMissionFixture } from './fixtures';
import type { DailyMission, DailyMissionResponse } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchDailyMission(): Promise<DailyMission | null> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildDailyMissionFixture(fixtureNow());
  }
  const { data } = await api.get<DailyMissionResponse>('/missions/daily');
  return data.mission;
}
