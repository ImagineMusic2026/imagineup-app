import { pointsToastAnnouncement } from '@/components/points-toast';
import { t } from '@/i18n';
import type { HapticEvent } from '@/services/haptics';

import type { ActionRewards } from './types';

/** A frase do anúncio e o toque de uma ação que rendeu alguma coisa. */
export interface RewardsDescription {
  /** Tudo numa frase só, para o leitor de tela; `null` quando não rendeu nada. */
  announcement: string | null;
  /** Um evento, um toque: a subida de nível vence a missão, que vence os pontos. */
  haptic: HapticEvent;
}

/**
 * O que a ação rendeu, numa frase e num toque (22.12): "Mais 21 pontos.",
 * uma frase por missão concluída ("Missão concluída: Curta 5 posts do
 * Nenho."), a do nível ("Você subiu para o nível 8, Xodó.") e uma por
 * conquista ("Conquista nova: Fã de show."). O "+N" do `PointsToast` já é o
 * `pointsAwarded`, que inclui a missão.
 */
export function describeRewards(
  points: number,
  rewards?: ActionRewards | null,
): RewardsDescription {
  const parts: string[] = [];
  if (points > 0) parts.push(`${pointsToastAnnouncement(points)}.`);
  for (const mission of rewards?.completedMissions ?? []) {
    parts.push(t('missions.rewards.mission', { title: mission.title }));
  }
  if (rewards?.levelUp) {
    parts.push(
      t('profile.level.up', { number: rewards.levelUp.number, name: rewards.levelUp.name }),
    );
  }
  for (const achievement of rewards?.unlockedAchievements ?? []) {
    parts.push(t('missions.rewards.achievement', { title: achievement.title }));
  }
  const haptic: HapticEvent = rewards?.levelUp
    ? 'levelUp'
    : (rewards?.completedMissions?.length ?? 0) > 0
      ? 'missionComplete'
      : 'pointsEarned';
  return { announcement: parts.length > 0 ? parts.join(' ') : null, haptic };
}

/** O que buscar de novo depois de uma ação, pelo que a resposta disse (22.12). */
export interface RewardsRefresh {
  /** As missões: com `missionsChanged: true`, ou sem o campo (as fixtures). */
  missions: boolean;
  /** As conquistas da 1e: com conquista nova ou subida de nível. */
  achievements: boolean;
}

export function rewardsRefresh(rewards?: ActionRewards | null): RewardsRefresh {
  return {
    missions: rewards?.missionsChanged !== false,
    achievements: (rewards?.unlockedAchievements?.length ?? 0) > 0 || !!rewards?.levelUp,
  };
}
