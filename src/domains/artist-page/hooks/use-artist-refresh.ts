import type { FetchStatus } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { haptics } from '@/services/haptics';

/** O que o puxar para atualizar precisa de cada consulta. */
export interface RefreshableQuery {
  fetchStatus: FetchStatus;
  refetch: () => Promise<unknown>;
}

/**
 * Puxar para atualizar da página do artista (1d): a central, os top fãs e o
 * conteúdo da aba escolhida, juntos. O indicador fica só durante o puxão do
 * fã, e sai assim que alguma busca pausa sem rede (o `OfflineBanner` já avisa,
 * e ela segue sozinha quando a conexão volta).
 */
export function useArtistRefresh(queries: readonly RefreshableQuery[]) {
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  const paused = queries.some((query) => query.fetchStatus === 'paused');
  if (pull !== null && paused) setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    await Promise.allSettled(queries.map((query) => query.refetch()));
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
