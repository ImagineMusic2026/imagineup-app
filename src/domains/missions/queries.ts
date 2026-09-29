import { useQuery } from '@tanstack/react-query';

import { fetchDailyMission, fetchMissions } from './api';

/** A chave inclui tudo que muda o resultado. */
export const missionKeys = {
  all: ['missions'] as const,
  daily: () => [...missionKeys.all, 'daily'] as const,
  list: () => [...missionKeys.all, 'list'] as const,
};

/** Missão do dia (1b). `null` quando não há missão hoje. */
export function useDailyMissionQuery() {
  return useQuery({
    queryKey: missionKeys.daily(),
    queryFn: fetchDailyMission,
  });
}

/** Meta da temporada e missões da 1g. */
export function useMissionsQuery() {
  return useQuery({
    queryKey: missionKeys.list(),
    queryFn: fetchMissions,
  });
}
