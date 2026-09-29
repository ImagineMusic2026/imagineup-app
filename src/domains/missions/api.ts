import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { buildMissionsFixture } from './fixtures';
import type { DailyMission, DailyMissionResponse, MissionsResponse } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchMissions(): Promise<MissionsResponse> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildMissionsFixture(fixtureNow());
  }
  const { data } = await api.get<MissionsResponse>('/missions');
  return data;
}

/**
 * Missão do dia (1b). Nas fixtures, é a destacada de "Hoje" da mesma lista da
 * 1g, com o que o fã já fez; na API, o servidor escolhe.
 */
export async function fetchDailyMission(): Promise<DailyMission | null> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    const { missions } = buildMissionsFixture(fixtureNow());
    return missions.find((mission) => mission.featured && mission.period === 'daily') ?? null;
  }
  const { data } = await api.get<DailyMissionResponse>('/missions/daily');
  return data.mission;
}
