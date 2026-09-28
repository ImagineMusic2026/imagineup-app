import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { colors, spacing } from '@/theme';

export interface LargeTitleHeaderProps {
  title: string;
  subtitle?: string;
  /** Peça à direita do título, como a pílula de pontos do Resgatar. */
  accessory?: ReactNode;
  /** Linha abaixo do título, como os chips do Ranking e da Agenda. */
  children?: ReactNode;
}

/** Título de página das abas (Ranking, Missões, Resgatar, Agenda). Rola com o conteúdo. */
export function LargeTitleHeader({ title, subtitle, accessory, children }: LargeTitleHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text variant="titlePage" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {accessory}
      </View>
      {subtitle ? (
        <Text variant="bodySmall" color={colors.textTertiary}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flexShrink: 1,
  },
});
