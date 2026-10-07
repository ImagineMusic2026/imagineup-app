import { AccessibilityInfo } from 'react-native';

// As missões pelos arquivos, fora do index: os domínios das ações (posts,
// agenda, artists) importam daqui direto, e o index das missões puxaria telas.
import { describeRewards } from '@/domains/missions/describe-rewards';
import type { ActionRewards } from '@/domains/missions/types';
import type { HapticEvent } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { noteActionCelebrated } from './level-celebrated';

/** O "+N" de uma ação: a frase de tudo o que ela rendeu e o toque. */
export interface RewardsToast {
  announcement?: string;
  haptic: HapticEvent;
}

/**
 * O que a ação rendeu chegou com a tela aberta (22.12): com pontos, o "+N",
 * com a frase e o toque de tudo o que ela rendeu (`describeRewards`); sem
 * pontos e com conquista (a primeira presença com o "Eu vou" valendo 0), só o
 * anúncio, na fila, sem toast. O que saiu aqui fica marcado (as missões e o
 * nível deste fã), para a 1g, a 1b e a 1e não repetirem o toque nem o anúncio.
 * Devolve o "+N", ou null sem pontos.
 */
export function rewardsToast(
  points: number,
  rewards: ActionRewards | null | undefined,
): RewardsToast | null {
  const { announcement, haptic } = describeRewards(points, rewards);
  noteActionCelebrated(rewards, useSessionStore.getState().user?.uid ?? null);
  if (points > 0) return { announcement: announcement ?? undefined, haptic };
  if (announcement) {
    AccessibilityInfo.announceForAccessibilityWithOptions(announcement, { queue: true });
  }
  return null;
}
