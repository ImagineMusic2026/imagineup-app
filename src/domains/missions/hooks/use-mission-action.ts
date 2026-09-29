import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';

import { missionHref } from '../describe-mission';
import type { Mission } from '../types';

/**
 * O toque numa missão da 1g. Aberta, leva à ação dela (convite, post, agenda,
 * central), pelo tipo e alvo que a API manda. Bloqueada, não navega: o toque
 * já vibrou `locked`, e o leitor de tela ouve quando ela abre.
 */
export function useMissionAction(): (mission: Mission) => void {
  return (mission) => {
    if (mission.status === 'locked') {
      AccessibilityInfo.announceForAccessibility(
        t('missions.lockedAnnouncement', {
          hint: mission.unlockHint ?? t('missions.meta.locked'),
        }),
      );
      return;
    }
    const href = missionHref(mission);
    if (href) router.push(href);
  };
}
