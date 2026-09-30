import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BrandBars } from '@/components/brand-bars';
import { Text } from '@/components/text';
import { useCountedNumber } from '@/hooks/use-counted-number';
import { t } from '@/i18n';
import { colors, radii, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

export { countEasing } from '@/hooks/use-counted-number';

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
  const counted = useCountedNumber(value).text;

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
        {counted ?? LOADING}
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
