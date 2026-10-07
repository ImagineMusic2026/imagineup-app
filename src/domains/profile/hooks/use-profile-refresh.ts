import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { useFanCentralsQuery } from '@/domains/artists';
// O ranking pelo arquivo, fora do index: a tela do ranking lê o perfil, e pelo
// index seria um ciclo.
import { refreshRanking } from '@/domains/ranking/queries';
import { haptics } from '@/services/haptics';

import { profileKeys } from '../keys';
import { useMyAchievementsQuery, useMyProgressQuery, useWalletQuery } from '../queries';

/**
 * Puxar para atualizar do perfil (1e): saldo, nível, conquistas e centrais,
 * juntos. O perfil básico não entra: a escuta do Firestore já o mantém em
 * dia. O ranking (1f e 1d, montadas nas outras abas) busca de novo junto, só
 * a primeira página: o "#12 entre 30 fãs" sai da mesma conta do card "Você",
 * e as telas não podem discordar. O indicador fica só durante o puxão do fã,
 * e sai assim que alguma busca pausa sem rede (o `OfflineBanner` já avisa, e
 * ela segue sozinha).
 */
export function useProfileRefresh() {
  const wallet = useWalletQuery();
  const progress = useMyProgressQuery();
  const achievements = useMyAchievementsQuery();
  const centrals = useFanCentralsQuery();
  const queryClient = useQueryClient();
  // Puxão em andamento; cada um tem o seu número, para o fim de um antigo não
  // apagar o indicador de um novo.
  const [pull, setPull] = useState<number | null>(null);
  const pulls = useRef(0);

  const queries = [wallet, progress, achievements, centrals];
  const paused = queries.some((query) => query.fetchStatus === 'paused');
  if (pull !== null && paused) setPull(null);

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    pulls.current += 1;
    const id = pulls.current;
    setPull(id);
    // O extrato mora debaixo da carteira: invalidar leva junto o aberto (bloco 7).
    void queryClient.invalidateQueries({ queryKey: profileKeys.ledger() });
    refreshRanking(queryClient);
    await Promise.allSettled(queries.map((query) => query.refetch()));
    setPull((current) => (current === id ? null : current));
  };

  return { refreshing: pull !== null, refresh };
}
