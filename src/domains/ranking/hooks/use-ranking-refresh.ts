import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { artistKeys } from '@/domains/artists';
import { haptics } from '@/services/haptics';

import { useLeaderboardInfiniteQuery, useMyRankQuery, useSeasonQuery } from '../queries';
import type { RankingScope } from '../types';

/**
 * Puxar para atualizar do ranking (1f): a temporada, as posições do recorte e
 * a do fã, juntas. "Suas centrais" (o "você é #12" da 1b e o "#12 entre 30
 * fãs" da 1e, montadas nas outras abas) busca de novo junto: a posição da
 * central sai da mesma conta do card, e as telas não podem discordar. O
 * indicador fica só durante o puxão do fã, e sai assim que alguma busca pausa
 * sem rede (o `OfflineBanner` já avisa, e ela segue sozinha quando a conexão
 * volta).
 */
export function useRankingRefresh(scope: RankingScope) {
  const queryClient = useQueryClient();
  const season = useSeasonQuery();
  const board = useLeaderboardInfiniteQuery(scope);
  const myRank = useMyRankQuery(scope);
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  const paused = [season, board, myRank].some((query) => query.fetchStatus === 'paused');
  if (pull !== null && paused) setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    void queryClient.invalidateQueries({ queryKey: artistKeys.centrals() });
    await Promise.allSettled([season.refetch(), board.refetch(), myRank.refetch()]);
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
