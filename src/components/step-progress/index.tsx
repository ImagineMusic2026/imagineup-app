import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors, layout, motion, radii, spacing } from '@/theme';

export interface StepProgressProps {
  total: number;
  /** Etapa em que o fã está, a partir de 1 (o cadastro é a 1, a escolha de artistas a 2). */
  current: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type SegmentState = 'done' | 'current' | 'todo';

function Segment({
  state,
  fill,
  testID,
}: {
  state: SegmentState;
  fill: SharedValue<number>;
  testID?: string;
}) {
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));
  return (
    <View style={styles.segment}>
      {state === 'done' ? <View testID={testID} style={[styles.fill, styles.full]} /> : null}
      {state === 'current' ? (
        <Animated.View testID={testID} style={[styles.fill, fillStyle]} />
      ) : null}
    </View>
  );
}

/**
 * Barra de etapas do cadastro e da escolha de artistas (1l): as etapas feitas
 * em rosa e a atual enchendo da esquerda para a direita quando a tela abre.
 */
export function StepProgress({ total, current, style, testID }: StepProgressProps) {
  const steps = Math.max(1, Math.round(total));
  const step = Math.min(steps, Math.max(0, Math.round(current)));
  const reducedMotion = usePrefersReducedMotion();
  // Quanto da etapa atual já encheu. Com reduzir movimento, nasce cheia.
  const currentFill = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      currentFill.set(1);
      return;
    }
    currentFill.set(0);
    currentFill.set(withTiming(1, { duration: motion.duration.slow, easing: motion.easing.out }));
  }, [step, reducedMotion, currentFill]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('components.stepProgress.label', { current: step, total: steps })}
      accessibilityValue={{ min: 0, max: steps, now: step }}
      style={[styles.row, style]}
    >
      {Array.from({ length: steps }, (_, index) => {
        const position = index + 1;
        return (
          <Segment
            key={position}
            state={position < step ? 'done' : position === step ? 'current' : 'todo'}
            fill={currentFill}
            testID={testID ? `${testID}-step-${position}` : undefined}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.iconLabelGap,
  },
  segment: {
    flex: 1,
    height: layout.stepBar,
    borderRadius: radii.pill,
    backgroundColor: colors.trackStrong,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  full: {
    width: '100%',
  },
});
