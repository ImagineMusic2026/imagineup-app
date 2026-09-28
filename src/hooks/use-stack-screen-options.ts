import type { NativeStackNavigationOptions } from 'expo-router';

import { colors } from '@/theme';

import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * Opções de toda pilha do app. As `screenOptions` de um navegador não passam
 * para os aninhados, então cada Stack chama isto; sem isso, o push dentro das
 * abas desliza mesmo com "reduzir movimento" ligado.
 */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const reducedMotion = usePrefersReducedMotion();
  return {
    headerShown: false,
    contentStyle: { backgroundColor: colors.background },
    animation: reducedMotion ? 'none' : 'default',
  };
}
