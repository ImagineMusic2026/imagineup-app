import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { colors, gradients, layout, motion, radii, type GradientStops } from '@/theme';

export type ProgressBarSize = keyof typeof layout.progressBar;

export interface ProgressBarProps {
  /** De 0 a 1. */
  value: number;
  /** `sm` (7) na 1g e na 1e; `md` (8) no card da missão do dia (1b). */
  size?: ProgressBarSize;
  track?: string;
  /**
   * Cor sólida ou gradiente da esquerda para a direita. O gradiente cobre só a
   * parte cheia: a ponta sempre termina na última cor (lima na barra de nível).
   */
  fill?: string | GradientStops;
  /**
   * Com rótulo, a barra é um elemento `progressbar` para o leitor de tela. Sem
   * ele, fica calada, para o card em volta ler tudo num elemento só.
   */
  accessibilityLabel?: string;
  /** Sem ele, o leitor ouve a porcentagem. Na 1b: `{ min: 0, max: 5, now: 3 }`. */
  accessibilityValue?: AccessibilityValue;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Barra de progresso (missão do dia 1b, destaque da 1g, nível da 1e). Cresce de
 * 0 até o valor ao aparecer e anda até o valor novo quando ele muda, na mesma
 * duração e curva do `ProgressRing`, para barra e anel andarem juntos.
 */
export function ProgressBar({
  value,
  size = 'sm',
  track = colors.track,
  fill = gradients.progress.colors,
  accessibilityLabel,
  accessibilityValue,
  style,
  testID,
}: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const reducedMotion = usePrefersReducedMotion();
  // Com reduzir movimento, a barra já nasce no valor.
  const progress = useSharedValue(reducedMotion ? clamped : 0);

  useEffect(() => {
    progress.set(
      reducedMotion
        ? clamped
        : withTiming(clamped, { duration: motion.duration.counter, easing: motion.easing.out }),
    );
  }, [clamped, reducedMotion, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  return (
    <View
      testID={testID}
      accessible={accessibilityLabel ? true : undefined}
      accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={
        accessibilityLabel
          ? (accessibilityValue ?? { min: 0, max: 100, now: Math.round(clamped * 100) })
          : undefined
      }
      style={[styles.track, styles[size], { backgroundColor: track }, style]}
    >
      <Animated.View
        testID={testID ? `${testID}-fill` : undefined}
        style={[
          styles.fill,
          typeof fill === 'string' ? { backgroundColor: fill } : null,
          fillStyle,
        ]}
      >
        {typeof fill === 'string' ? null : (
          <LinearGradient
            colors={fill}
            start={gradients.progress.start}
            end={gradients.progress.end}
            style={StyleSheet.absoluteFill}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  sm: {
    height: layout.progressBar.sm,
  },
  md: {
    height: layout.progressBar.md,
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
});
