import { useRef, useState } from 'react';

import { useMyRsvpsQuery } from '@/domains/agenda';
import { useFanCentralsQuery } from '@/domains/artists';
import { useDailyMissionQuery } from '@/domains/missions';
import { useFeedQuery } from '@/domains/posts';
import { haptics } from '@/services/haptics';

/**
 * Puxar para atualizar da home: missão do dia, centrais, mural e presenças,
 * juntos. O perfil não entra: a escuta do Firestore já o mantém em dia. O
 * indicador fica só durante o puxão do fã, não nas buscas de fundo.
 *
 * Sem rede (com a API), as buscas pausam até ela voltar, e a promessa do
 * `refetch` só resolve nessa hora: o indicador sai assim que alguma pausa, em
 * vez de girar até a rede voltar. O `OfflineBanner` já avisa, e as buscas
 * seguem sozinhas quando a conexão volta.
 */
export function useHomeRefresh() {
  const mission = useDailyMissionQuery();
  const centrals = useFanCentralsQuery();
  const feed = useFeedQuery();
  const rsvps = useMyRsvpsQuery();
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  const paused = [mission, centrals, feed, rsvps].some((query) => query.fetchStatus === 'paused');
  if (pull !== null && paused) setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    await Promise.allSettled([
      mission.refetch(),
      centrals.refetch(),
      feed.refetch(),
      rsvps.refetch(),
    ]);
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
