import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { profileKeys } from '@/domains/profile';
import { haptics } from '@/services/haptics';

import { useRewardsQuery } from '../queries';

/**
 * Puxar para atualizar da 1h. Busca a loja e o saldo juntos, porque um sem o
 * outro deixaria o "faltam N" errado. O indicador fica só durante o puxão do
 * fã, e sai assim que a busca pausa sem rede (o `OfflineBanner` já avisa, e
 * ela segue sozinha).
 */
export function useRewardsRefresh() {
  const rewards = useRewardsQuery();
  const queryClient = useQueryClient();
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  if (pull !== null && rewards.fetchStatus === 'paused') setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    await Promise.all([
      rewards.refetch(),
      queryClient.invalidateQueries({ queryKey: profileKeys.wallet() }),
    ]);
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
