import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

export interface CascadeInProps {
  /** Posição na grade: cada uma entra 40 ms depois da anterior. */
  index: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

// Os cards da 1l sobem 12 pt enquanto aparecem, 40 ms entre um e outro.
const RISE = 12;
const STEP_MS = 40;

/**
 * Entrada em cascata das células da grade da 1l quando os artistas chegam.
 * Com reduzir movimento, já nasce no lugar.
 */
export function CascadeIn({ index, children, style }: CascadeInProps) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      progress.set(1);
      return;
    }
    progress.set(
      withDelay(
        index * STEP_MS,
        withTiming(1, { duration: motion.duration.slow, easing: motion.easing.out }),
      ),
    );
  }, [index, reducedMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return { opacity: value, transform: [{ translateY: (1 - value) * RISE }] };
  });

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
