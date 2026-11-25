import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useNow } from '@/hooks/use-now';

import { checkinRollover, liveCheckin } from '../describe-checkin';
import { checkinKeys } from '../keys';
import { useCheckinQuery } from '../queries';
import type { CheckinState } from '../types';

export interface CheckinView {
  /**
   * O estado para mostrar, ou `null`: carregando, sem resposta, com a chave
   * desligada, com a `api` de antes (o 404) ou com o dia virado e a resposta
   * nova ainda por chegar.
   */
  state: CheckinState | null;
  /** Relógio do "Termina em 4 h", que anda a cada minuto. */
  now: Date;
}

/**
 * O check-in diário pronto para a tela (o card da Início e a pílula da 1e),
 * com a virada do dia: quando o relógio passa do `resetsAt`, o estado de ontem
 * some na hora e a consulta busca o de hoje, sem esperar o fã puxar a tela
 * (como a missão do dia, no `useDailyMission`). Enquanto o de hoje não chega
 * (sem rede, por exemplo), nada aparece, e a busca sai de novo a cada minuto.
 * Não anuncia nem vibra: o que não aparece não fala.
 */
export function useCheckin(): CheckinView {
  const query = useCheckinQuery();
  const now = useNow();
  const client = useQueryClient();
  const live = liveCheckin(query.data, query.error);
  const rollover = live ? checkinRollover(live.resetsAt, query.dataUpdatedAt, now) : 'current';

  useEffect(() => {
    if (rollover === 'current') return;
    // Sem cancelar a busca que já vai: a Início e a 1e pedem juntas.
    void client.invalidateQueries({ queryKey: checkinKeys.state() }, { cancelRefetch: false });
  }, [rollover, now, client]);

  return { state: rollover === 'stale' ? null : live, now };
}
