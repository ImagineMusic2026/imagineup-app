import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { haptics } from '@/services/haptics';

import { missionKeys, useMissionsQuery } from '../queries';

/**
 * Puxar para atualizar da 1g. Busca a lista e marca a missão do dia da home
 * para buscar de novo, porque as duas vêm do mesmo servidor e não podem
 * discordar. O indicador fica só durante o puxão do fã, e sai assim que a
 * busca pausa sem rede (o `OfflineBanner` já avisa, e ela segue sozinha).
 */
export function useMissionsRefresh() {
  const missions = useMissionsQuery();
  const queryClient = useQueryClient();
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  if (pull !== null && missions.fetchStatus === 'paused') setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    void queryClient.invalidateQueries({ queryKey: missionKeys.daily() });
    await missions.refetch();
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
