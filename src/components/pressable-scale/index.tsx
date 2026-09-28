import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { haptics, type HapticEvent } from '@/services/haptics';
import { motion } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Toque do evento, disparado quando o toque vira ação (onPress). No início do
   * toque ele vibraria também quando o dedo só começa uma rolagem. `null` desliga.
   */
  haptic?: HapticEvent | null;
  scaleTo?: number;
}

/**
 * Base de todo elemento tocável: encolhe de leve no toque e volta com mola.
 * As props de acessibilidade ficam aqui, no pressável de fora; os filhos não
 * recebem role nem label próprios.
 */
export function PressableScale({
  children,
  style,
  haptic = 'tap',
  scaleTo = motion.pressScale,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  accessibilityRole = 'button',
  ...props
}: PressableScaleProps) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...props.accessibilityState }}
      onPress={(event) => {
        if (haptic) haptics.trigger(haptic);
        onPress?.(event);
      }}
      onPressIn={(event) => {
        if (!reducedMotion) {
          scale.set(
            withTiming(scaleTo, {
              duration: motion.duration.fast,
              easing: motion.easing.out,
            }),
          );
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(reducedMotion ? 1 : withSpring(1, motion.spring.snappy));
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
