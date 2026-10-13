import { useMyProfileQuery } from '../queries';
import type { SuspensionReason } from '../types';

export interface Suspension {
  /** A equipe suspendeu a conta (`suspendedAt` no perfil). */
  suspended: boolean;
  /** O motivo escolhido pela equipe; `null` sem suspensão ou fora dos quatro. */
  reason: SuspensionReason | null;
}

/**
 * O ponto que sabe da suspensão (29.11, frente E): o perfil lido do Firestore
 * (`users/{uid}`, com a escuta das telas que a ligam). O aviso fixo, o
 * compositor e a sheet do convite leem daqui; a recusa que chega antes do
 * perfil (403 `account_suspended`) faz o `SuspensionWatcher` buscá-lo de novo.
 */
export function useSuspension(): Suspension {
  const { data } = useMyProfileQuery();
  const suspended = Boolean(data?.suspendedAt);
  return { suspended, reason: suspended ? (data?.suspensionReason ?? null) : null };
}
