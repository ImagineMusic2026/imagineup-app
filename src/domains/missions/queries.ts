import { useQuery } from '@tanstack/react-query';

import { queryOptionsFor } from '@/services/query/client';

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
    ...queryOptionsFor('missions'),
    queryKey: missionKeys.daily(),
    queryFn: fetchDailyMission,
  });
}

/**
 * Meta da temporada e missões da 1g. Da API com o emulador (bloco 7), com
 * rede e disco (`queryOptionsFor`); das fixtures no resto.
 */
export function useMissionsQuery() {
  return useQuery({
    ...queryOptionsFor('missions'),
    queryKey: missionKeys.list(),
    queryFn: fetchMissions,
  });
}

/**
 * Uma missão da lista da 1g (a sheet do convite diz para qual missão é o
 * link). Sem `missionId`, não busca nada; fora da lista, `null`.
 */
export function useMissionQuery(missionId: string | null) {
  return useQuery({
    ...queryOptionsFor('missions'),
    queryKey: missionKeys.list(),
    queryFn: fetchMissions,
    enabled: missionId !== null,
    select: (data) => data.missions.find((mission) => mission.id === missionId) ?? null,
  });
}
