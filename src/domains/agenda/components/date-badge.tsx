import { StyleSheet, View } from 'react-native';

import { Glass } from '@/components/glass';
import { Text } from '@/components/text';
import { colors, layout, radii, spacing } from '@/theme';

export interface DateBadgeProps {
  /** "21". */
  day: string;
  /** "OUT", ou "Hoje" no dia do show (a caixa alta vem da variante). */
  month: string;
  /**
   * - `glass`: selo de vidro escuro sobre a foto do destaque, mês em rosa;
   * - `plain`: coluna de 50 das linhas, mês em cinza.
   */
  variant: 'glass' | 'plain';
}

/**
 * Selo de data da agenda (1m). Decorativo para o leitor de tela: a data vai,
 * por extenso, no rótulo do card ou da linha em volta.
 */
export function DateBadge({ day, month, variant }: DateBadgeProps) {
  const content = (
    <>
      <Text variant="numberDate">{day}</Text>
      <Text
        variant="dateMonth"
        // Rosa como texto fica no #FF2D6F; sobre o vidro a .9 passa em contraste.
        color={variant === 'glass' ? colors.accent : colors.textMuted}
        style={styles.month}
      >
        {month}
      </Text>
    </>
  );

  if (variant === 'glass') {
    return (
      <Glass tone="darkStrong" strength="badge" radius={radii.sm} style={styles.glass}>
        {content}
      </Glass>
    );
  }
  return <View style={styles.plain}>{content}</View>;
}

const styles = StyleSheet.create({
  glass: {
    minWidth: layout.dateBadge.width,
    minHeight: layout.dateBadge.height,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.gridGap,
  },
  plain: {
    minWidth: layout.dateColumn,
    alignItems: 'center',
  },
  // 4 do dia ao mês no protótipo: a entrelinha dos dois já soma 2.
  month: {
    marginTop: spacing.xxs,
  },
});
