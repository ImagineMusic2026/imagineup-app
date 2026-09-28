import { router } from 'expo-router';
import { useMemo } from 'react';

import type { CenterMenuAction } from '@/components/tab-bar';
import { t } from '@/i18n';
import { colors } from '@/theme';

import { QUICK_ACTIONS } from '../actions';

/** Os atalhos do "+" prontos para a tab bar desenhar. */
export function useQuickActions(): CenterMenuAction[] {
  return useMemo(
    () =>
      QUICK_ACTIONS.map((action) => ({
        key: action.id,
        label: t(action.labelKey),
        icon: action.icon,
        color: action.tone === 'points' ? colors.points : colors.accent,
        onPress: () => router.push(action.href),
      })),
    [],
  );
}
