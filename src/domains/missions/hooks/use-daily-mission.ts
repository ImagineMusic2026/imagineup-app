import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useNow } from '@/hooks/use-now';

import { missionKeys, useDailyMissionQuery } from '../queries';
import type { DailyMission } from '../types';

export interface DailyMissionState {
  /** `null` sem missão hoje, ou quando ela acabou de expirar. */
  mission: DailyMission | null;
  /** Relógio da contagem "termina em 4 h", que anda a cada minuto. */
  now: Date;
  loading: boolean;
  /** Não carregou e não há missão salva para mostrar: a home mostra o erro no lugar do card. */
  failed: boolean;
  /** "Tentar de novo" buscando. */
  retrying: boolean;
  retry: () => void;
}

function isOver(mission: DailyMission, now: Date): boolean {
  if (mission.status === 'expired') return true;
  return mission.status === 'active' && new Date(mission.endsAt).getTime() <= now.getTime();
}

/**
 * Missão do dia com a contagem andando. Quando o prazo acaba, ela some da home
 * na hora e a busca de novo traz a próxima (ou nenhuma), sem esperar o fã
 * puxar a tela.
 */
export function useDailyMission(): DailyMissionState {
  const query = useDailyMissionQuery();
  const now = useNow();
  const queryClient = useQueryClient();
  const mission = query.data ?? null;
  const over = mission !== null && isOver(mission, now);

  useEffect(() => {
    if (over) void queryClient.invalidateQueries({ queryKey: missionKeys.daily() });
  }, [over, queryClient]);

  return {
    mission: over ? null : mission,
    now,
    loading: query.isPending,
    failed: query.isError && query.data === undefined,
    retrying: query.isFetching,
    retry: () => void query.refetch(),
  };
}
