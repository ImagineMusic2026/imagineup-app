import { useRef, useState } from 'react';

import { useAgendaQuery, useMyRsvpsQuery } from '@/domains/agenda';
import { useArtistsQuery, useFanCentralsQuery } from '@/domains/artists';
import { haptics } from '@/services/haptics';

/**
 * Puxar para atualizar da Explorar: os artistas, as centrais do fã, a agenda
 * e as presenças, juntos. O indicador fica só durante o puxão do fã, e sai
 * assim que alguma busca pausa sem rede (o `OfflineBanner` já avisa, e ela
 * segue sozinha quando a conexão volta), como na home e na agenda.
 */
export function useExploreRefresh() {
  const artists = useArtistsQuery();
  const centrals = useFanCentralsQuery();
  const agenda = useAgendaQuery();
  const rsvps = useMyRsvpsQuery();
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  const paused = [artists, centrals, agenda, rsvps].some((query) => query.fetchStatus === 'paused');
  if (pull !== null && paused) setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    await Promise.allSettled([
      artists.refetch(),
      centrals.refetch(),
      agenda.refetch(),
      rsvps.refetch(),
    ]);
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
