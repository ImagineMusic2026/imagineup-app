import { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
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
  /**
   * Até onde a etapa atual enche, de 0 a 1 (sem valor, a etapa inteira). O
   * cadastro faz uma pergunta por tela dentro da mesma etapa e enche um pedaço
   * a cada uma: quando só este valor muda, o enchimento segue de onde está até
   * o novo, sem voltar a zero e sem esperar o `delay` de novo.
   */
  currentFill?: number;
  /**
   * Espera antes de encher a etapa atual. A 1l passa o tempo da entrada da
   * pilha (`useStackFade`): enchendo junto com ela, a barra já estava quase
   * cheia quando a tela aparecia.
   */
  delay?: number;
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
 * em rosa e a atual enchendo da esquerda para a direita quando a tela abre. No
 * cadastro, a etapa atual enche aos poucos, um pedaço a cada pergunta
 * (`currentFill`).
 */
export function StepProgress({
  total,
  current,
  currentFill = 1,
  delay = 0,
  style,
  testID,
}: StepProgressProps) {
  const steps = Math.max(1, Math.round(total));
  const step = Math.min(steps, Math.max(0, Math.round(current)));
  const target = Math.min(1, Math.max(0, currentFill));
  const reducedMotion = usePrefersReducedMotion();
  // Quanto da etapa atual já encheu. Com reduzir movimento, nasce no destino.
  const fill = useSharedValue(reducedMotion ? target : 0);
  // A etapa e o destino do último enchimento, para saber quando só o destino mudou.
  const lastFill = useRef<{ step: number; target: number } | null>(null);

  useEffect(() => {
    const last = lastFill.current;
    lastFill.current = { step, target };
    if (reducedMotion) {
      fill.set(target);
      return;
    }
    const grow = withTiming(target, { duration: motion.duration.slow, easing: motion.easing.out });
    // Pergunta nova na mesma etapa: segue de onde está, sem esperar de novo.
    if (last?.step === step && last.target !== target) {
      fill.set(grow);
      return;
    }
    // Etapa nova, ou a tela abrindo: enche do zero, depois da espera.
    fill.set(0);
    fill.set(withDelay(delay, grow));
  }, [step, target, delay, reducedMotion, fill]);

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
            fill={fill}
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
