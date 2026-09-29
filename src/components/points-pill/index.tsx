import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  cancelAnimation,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { BrandBars } from '@/components/brand-bars';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors, motion, radii, spacing } from '@/theme';
import { formatNumber, formatThousandsWorklet } from '@/utils/number';

export interface PointsPillProps {
  /** Saldo (o contador que o resgate gasta). `null` enquanto carrega. */
  value: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const LOADING = '…';

function balanceLabel(value: number | null): string {
  if (value === null) return t('components.pointsPill.loading');
  if (value === 1) return t('components.pointsPill.labelOne');
  return t('components.pointsPill.label', { points: formatNumber(value) });
}

/**
 * Pílula lima de saldo (1h). Quando o saldo muda (depois de um resgate), o
 * número conta do valor antigo ao novo; o leitor de tela ouve o valor novo na
 * hora. Não é tocável.
 */
export function PointsPill({ value, style, testID }: PointsPillProps) {
  const reducedMotion = usePrefersReducedMotion();
  const counter = useSharedValue(value ?? 0);
  // Último saldo conhecido; `null` até o primeiro chegar, para não contar a partir do zero.
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
    counter.set(
      withTiming(value, { duration: motion.duration.counter, easing: motion.easing.out }),
    );
  }, [value, reducedMotion, counter, settled]);

  const shown =
    value === null
      ? LOADING
      : reducedMotion
        ? formatNumber(value)
        : (counting ?? formatNumber(value));

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={balanceLabel(value)}
      accessibilityState={value === null ? { busy: true } : undefined}
      style={[styles.pill, style]}
    >
      <BrandBars color={colors.onPoints} size="pill" />
      <Text variant="points" color={colors.onPoints} tabular>
        {shown}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.metaGap,
    // Padding do protótipo (6 12 6 9) menos a sobra da entrelinha do `points` no RN.
    paddingVertical: spacing.xs,
    paddingLeft: spacing.tileGap,
    paddingRight: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.points,
  },
});
