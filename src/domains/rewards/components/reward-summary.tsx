import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, spacing } from '@/theme';
import { formatPointsSpoken } from '@/utils/number';

import { priceText } from '../describe-reward';

export interface SummaryLine {
  /** "Custo", "Seu saldo depois". */
  label: string;
  points: number;
  /** O custo vai em lima (é ponto); o resto, em branco. */
  highlight?: boolean;
}

export interface RewardSummaryProps {
  lines: readonly SummaryLine[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Quadro de números do resgate (custo, saldo agora e depois), um foco só para
 * o leitor de tela: "Custo: 10.000 pontos. Seu saldo depois: 2.480 pontos."
 */
export function RewardSummary({ lines, style, testID }: RewardSummaryProps) {
  const spoken = lines
    .map((line) =>
      t('rewards.summary.line', { label: line.label, points: formatPointsSpoken(line.points) }),
    )
    .join(' ');

  return (
    <Card accessible accessibilityLabel={spoken} testID={testID} style={style}>
      {lines.map((line, index) => (
        <View key={line.label} style={[styles.line, index > 0 && styles.divided]}>
          <Text variant="bodySmall" color={colors.textSecondary} style={styles.label}>
            {line.label}
          </Text>
          <Text variant="button" color={line.highlight ? colors.points : colors.text}>
            {priceText(line.points)}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: spacing.md,
  },
  divided: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: borderWidths.default,
    borderTopColor: colors.divider,
  },
  label: {
    flexShrink: 1,
  },
});
