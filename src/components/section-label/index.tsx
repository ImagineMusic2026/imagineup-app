import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Text } from '@/components/text';
import { colors, spacing } from '@/theme';

/**
 * Espaço em cima e embaixo da sobrelinha:
 * - `default` (22 / 10): "Hoje", "Ao seu alcance" (1g 1h);
 * - `tight` (20 / 10): "Esta semana" (1g);
 * - `month` (18 / 10): mês da agenda (1m).
 */
export type SectionLabelSpacing = 'default' | 'tight' | 'month';

export interface SectionLabelProps {
  /** Escrito como frase ("Esta semana"); a caixa alta vem da variante `overline`. */
  children: string;
  spacing?: SectionLabelSpacing;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Sobrelinha de seção em caixa alta. O protótipo usa branco a .35, que reprova
 * contraste; aqui fica no piso de `textMuted` (.5). É cabeçalho para o leitor
 * de tela, que pula de seção em seção por ele.
 */
export function SectionLabel({
  children,
  spacing: preset = 'default',
  style,
  testID,
}: SectionLabelProps) {
  return (
    <Text
      variant="overline"
      color={colors.textMuted}
      accessibilityRole="header"
      testID={testID}
      style={[styles[preset], style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  default: {
    paddingTop: spacing.sectionLabelTop,
    paddingBottom: spacing.listGap,
  },
  tight: {
    paddingTop: spacing.sectionTopTight,
    paddingBottom: spacing.listGap,
  },
  month: {
    paddingTop: spacing.blockGap,
    paddingBottom: spacing.listGap,
  },
});
