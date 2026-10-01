import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { StackEntrance } from '@/hooks/use-stack-fade';
import { motion } from '@/theme';

export interface RiseInProps {
  /** Lugar do bloco na sequência: espera `order` vezes `motion.stagger.step`. */
  order: number;
  /** A sequência começa com a entrada da pilha `(auth)`, no mesmo instante do fade dela. */
  entrance: StackEntrance;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Bloco da entrada da 1k: sobe 12 pt (`motion.stagger.rise`) e aparece, na vez
 * dele. Fica apagado até a entrada da pilha, que começa no mesmo `onLayout` do
 * fade dela, e não na montagem: a `entering` do Reanimated rodava quando a
 * árvore montava, bem antes de a pilha aparecer, e a sequência acabava
 * escondida. Com reduzir movimento, o bloco já nasce no lugar.
 */
export function RiseIn({ order, entrance, style, children }: RiseInProps) {
  const reducedMotion = usePrefersReducedMotion();
  const shown = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      shown.set(1);
      return undefined;
    }
    return entrance.onEnter(() => {
      shown.set(
        withDelay(
          order * motion.stagger.step,
          withTiming(1, { duration: motion.duration.slow, easing: motion.easing.out }),
        ),
      );
    });
  }, [entrance, order, reducedMotion, shown]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * motion.stagger.rise }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
