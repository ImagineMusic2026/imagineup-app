import { createContext, useContext, useEffect, type ReactNode, type Ref } from 'react';
import {
  StyleSheet,
  type DimensionValue,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors, motion, radii, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

export type SkeletonTone = 'surface' | 'raised' | 'sunken' | 'line' | 'points';

export interface SkeletonProps {
  height: DimensionValue;
  width?: DimensionValue;
  radius?: number;
  /** Círculo com o diâmetro de `height` (avatar). */
  circle?: boolean;
  /**
   * `surface` no lugar de um card, `raised` e `sunken` nos blocos que o
   * protótipo pinta assim (post, pódio, destaque), `line` nas barras de texto
   * dentro de um card, `points` no card lima da missão do dia.
   */
  tone?: SkeletonTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export interface SkeletonGroupProps {
  children: ReactNode;
  /** Sem ele, o leitor de tela ouve "Carregando". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Para levar o foco do leitor de tela até o "Carregando" (a aba nova da 1d). */
  ref?: Ref<View>;
}

// Pulso lento de opacidade, 1 a .6 e de volta em 1,2 s, como pede o protótipo.
const PULSE_MIN_OPACITY = 0.6;
const PULSE_HALF_CYCLE = 600;

const InsideGroup = createContext(false);

function usePulse(active: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(1);
  const pulsing = active && !reducedMotion;

  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    opacity.set(
      withRepeat(
        withTiming(PULSE_MIN_OPACITY, {
          duration: PULSE_HALF_CYCLE,
          easing: motion.easing.inOut,
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [pulsing, opacity]);

  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

/**
 * Bloco de carregamento no tamanho do conteúdo que vai chegar. Fica fora do
 * leitor de tela: quem avisa que está carregando é o `SkeletonGroup`. Dentro
 * dele, o bloco não pulsa sozinho, para a tela inteira pulsar junto.
 */
export function Skeleton({
  height,
  width = '100%',
  radius = radii.xxs,
  circle = false,
  tone = 'surface',
  style,
  testID,
}: SkeletonProps) {
  const insideGroup = useContext(InsideGroup);
  const pulseStyle = usePulse(!insideGroup);
  const shape: ViewStyle = circle
    ? { width: height, height, borderRadius: radii.pill }
    : { width, height, borderRadius: radius };

  return (
    <Animated.View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles[tone], shape, pulseStyle, style]}
    />
  );
}

/**
 * Esqueleto de uma tela ou seção: um pulso só para todos os blocos dentro e um
 * foco só para o leitor de tela, que ouve "Carregando". Com reduzir movimento,
 * fica parado.
 */
export function SkeletonGroup({ children, accessibilityLabel, style, ref }: SkeletonGroupProps) {
  const pulseStyle = usePulse(true);

  return (
    <Animated.View
      ref={ref}
      accessible
      accessibilityLabel={accessibilityLabel ?? t('common.loading')}
      accessibilityState={{ busy: true }}
      style={[style, pulseStyle]}
    >
      <InsideGroup value>{children}</InsideGroup>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: colors.surface,
  },
  raised: {
    backgroundColor: colors.surfaceRaised,
  },
  sunken: {
    backgroundColor: colors.surfaceSunken,
  },
  line: {
    backgroundColor: colors.skeletonLine,
  },
  points: {
    backgroundColor: withAlpha(colors.points, tints.faint.fill),
  },
});
