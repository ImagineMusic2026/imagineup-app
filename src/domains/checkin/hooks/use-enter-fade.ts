import { useEffect } from 'react';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

/**
 * O que chega do check-in depois de a tela aparecer (o card da Início, a
 * pílula da 1e) entra em fade por um valor animado, e não pelo `entering` do
 * Reanimated: o estado vem do servidor com a tela já montada, e o `FadeIn` de
 * layout nesse caso já apagou a tela inteira no Android (o `useEnterFade` da
 * missão do dia, em CLAUDE.md, "Animação e haptics"). Com reduzir movimento,
 * nasce inteiro.
 */
export function useEnterFade() {
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    opacity.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [opacity, reducedMotion]);

  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}
