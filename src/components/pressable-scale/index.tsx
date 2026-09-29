import type { ReactNode, Ref } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
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

export interface PressableScaleProps extends Omit<
  PressableProps,
  'style' | 'children' | 'onPress' | 'onAccessibilityTap'
> {
  children: ReactNode;
  /** Sem o evento do toque: a ativação pelo leitor de tela também chama isto, e ela não tem evento. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** O `View` de fora, para levar o foco do leitor de tela até ele. */
  ref?: Ref<View>;
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
 *
 * O toque duplo do VoiceOver chega pelo `onAccessibilityTap`. Sem ele, o
 * Fabric do iOS devolve a ativação ao sistema, que simula um toque no centro do
 * elemento: se o centro estiver sob o rodapé fixo (1l com a fonte grande) ou
 * sob o teclado (sheet de artistas), o toque cai no que está por cima.
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
  ref,
  ...props
}: PressableScaleProps) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const press = (): void => {
    if (haptic) haptics.trigger(haptic);
    onPress?.();
  };

  return (
    <AnimatedPressable
      {...props}
      ref={ref}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...props.accessibilityState }}
      onPress={press}
      // Desativado, fica sem: a ativação volta ao sistema, e o Pressable desativado a ignora.
      onAccessibilityTap={disabled || !onPress ? undefined : press}
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
