import { useEffect, useState } from 'react';
import {
  cancelAnimation,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
  type EasingFunctionFactory,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { motion } from '@/theme';
import { formatNumber, formatThousandsWorklet } from '@/utils/number';

import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * A curva `out` presa em 0 no começo. A contagem sai do JS no meio de um
 * quadro, e o primeiro quadro pode chegar com o tempo um pouco negativo; a
 * `out`, íngreme na origem, passa então do valor de partida (12.480 virava
 * 12.582 antes de descer para 3.980). Fábrica, como a `motion.easing.out`.
 */
export const countEasing: EasingFunctionFactory = {
  factory: () => {
    'worklet';
    const ease = motion.easing.out.factory();
    return (progress: number) => {
      'worklet';
      return ease(Math.max(0, progress));
    };
  },
};

export interface CountedNumber {
  /** O número formatado do quadro ("12.480"); `null` enquanto o valor não chegou. */
  text: string | null;
  /**
   * `true` enquanto a contagem anda. Quem mostra o número usa algarismos
   * tabulares só nessa hora, para ele não tremer; parado, o "1" tabular da
   * Sora tem pé e abre um vão.
   */
  counting: boolean;
}

/**
 * O número formatado ("12.480") que conta do valor antigo ao novo quando ele
 * muda (o saldo depois de um resgate), no tempo do contador. O primeiro valor
 * aparece direto, sem contar a partir do zero; com reduzir movimento, o novo
 * aparece na hora.
 *
 * Quem mostra o número dá ao leitor de tela o valor final, e não este texto,
 * que muda a cada quadro enquanto conta.
 */
export function useCountedNumber(value: number | null): CountedNumber {
  const reducedMotion = usePrefersReducedMotion();
  const counter = useSharedValue(value ?? 0);
  // Último valor conhecido; `null` até o primeiro chegar, para não contar a partir do zero.
  const settled = useSharedValue<number | null>(value);
  // Texto do contador, vindo do thread de UI enquanto ele anda.
  const [counting, setCounting] = useState<string | null>(null);

  useAnimatedReaction(
    () => (settled.get() === null ? null : Math.round(counter.get())),
    (now, previous) => {
      if (now !== null && now !== previous) scheduleOnRN(setCounting, formatThousandsWorklet(now));
    },
  );

  useEffect(() => {
    if (value === null) return;
    const from = settled.get();
    settled.set(value);
    if (from === null || reducedMotion) {
      cancelAnimation(counter);
      counter.set(value);
      return;
    }
    counter.set(withTiming(value, { duration: motion.duration.counter, easing: countEasing }));
  }, [value, reducedMotion, counter, settled]);

  if (value === null) return { text: null, counting: false };
  const final = formatNumber(value);
  if (reducedMotion || counting === null) return { text: final, counting: false };
  // O último quadro da contagem é o próprio valor final.
  return { text: counting, counting: counting !== final };
}
