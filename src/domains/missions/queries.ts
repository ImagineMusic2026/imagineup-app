import { useQuery } from '@tanstack/react-query';

import { fetchDailyMission } from './api';

/** A chave inclui tudo que muda o resultado. */
export const missionKeys = {
  all: ['missions'] as const,
  daily: () => [...missionKeys.all, 'daily'] as const,
};

/** Missão do dia (1b). `null` quando não há missão hoje. */
export function useDailyMissionQuery() {
  return useQuery({
    queryKey: missionKeys.daily(),
    queryFn: fetchDailyMission,
  });
}
