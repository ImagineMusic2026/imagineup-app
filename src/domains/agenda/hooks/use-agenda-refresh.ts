import { useRef, useState } from 'react';

import { haptics } from '@/services/haptics';

import { useAgendaQuery, useMyRsvpsQuery } from '../queries';

/**
 * Puxar para atualizar da agenda (1m): os shows e as presenças, juntos. O
 * indicador fica só durante o puxão do fã, e sai assim que alguma busca pausa
 * sem rede (o `OfflineBanner` já avisa, e ela segue sozinha quando a conexão
 * volta).
 */
export function useAgendaRefresh() {
  const agenda = useAgendaQuery();
  const rsvps = useMyRsvpsQuery();
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  const paused = agenda.fetchStatus === 'paused' || rsvps.fetchStatus === 'paused';
  if (pull !== null && paused) setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    await Promise.allSettled([agenda.refetch(), rsvps.refetch()]);
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
