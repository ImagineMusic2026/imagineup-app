import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { isSeasonOver } from '../describe-rank';
import { refreshRanking } from '../queries';
import type { Season } from '../types';

/**
 * Se a temporada mostrada já acabou, pelo servidor ou pelo relógio. A 1f e a
 * 1d ficam montadas nas abas: quando o `endsAt` passa com elas abertas, o
 * relógio já diz "encerrada", mas o ranking do cache ainda é o da temporada
 * em andamento, com as setas da semana. Nessa hora o ranking busca de novo,
 * uma vez, e chega o do servidor (encerrada, sem setas; depois da virada, o
 * arquivo). O molde é o da 1g, que busca de novo quando uma missão vence.
 */
export function useSeasonOver(season: Season | null | undefined, now: Date): boolean {
  const queryClient = useQueryClient();
  const over = season ? isSeasonOver(season, now) : false;
  const endedOnScreen = over && season?.status === 'active';
  useEffect(() => {
    if (endedOnScreen) refreshRanking(queryClient);
  }, [endedOnScreen, queryClient]);
  return over;
}
