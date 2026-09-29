import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { colors, spacing } from '@/theme';

import { BACK_BUTTON_SLACK, BackButton } from './back-button';

export interface LargeTitleHeaderProps {
  title: string;
  subtitle?: string;
  /** Peça à direita do título, como a pílula de pontos do Resgatar. */
  accessory?: ReactNode;
  /** Linha abaixo do título, como os chips do Ranking e da Agenda. */
  children?: ReactNode;
  /**
   * Voltar na linha do título, para telas empilhadas que o protótipo desenhou
   * como raiz (1g, 1h, 1m). Alternativa ao `BackHeader` em cima do título, que
   * empurra o título 44 pt para baixo.
   */
  showBack?: boolean;
  /** Padrão do voltar: volta na pilha ou vai ao início. */
  onBack?: () => void;
}

/** Título de página das abas (Ranking, Missões, Resgatar, Agenda). Rola com o conteúdo. */
export function LargeTitleHeader({
  title,
  subtitle,
  accessory,
  children,
  showBack = false,
  onBack,
}: LargeTitleHeaderProps) {
  return (
    <View style={[styles.container, showBack && styles.containerWithBack]}>
      <View style={styles.row}>
        <View style={styles.lead}>
          {showBack ? <BackButton onPress={onBack} /> : null}
          <Text variant="titlePage" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        </View>
        {accessory}
      </View>
      {subtitle ? (
        <Text variant="bodySmall" color={colors.textMuted} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
      {children ? <View style={styles.below}>{children}</View> : null}
    </View>
  );
}

// Vãos do protótipo: título até subtítulo 9, até a linha de chips 15 e até o
// primeiro card 18. O topo de 12 é convenção do app sobre a área segura real.
const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
    paddingBottom: spacing.blockGap,
  },
  // Com o voltar, o círculo fica onde o título começaria (e onde os formulários
  // de conta põem o deles); a folga do alvo de 44 sai do topo.
  containerWithBack: {
    paddingTop: spacing.md - BACK_BUTTON_SLACK,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // O alvo do voltar já sobra 8 à direita do círculo; o vão pequeno completa 12.
  lead: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
  },
  subtitle: {
    marginTop: spacing.tileGap,
  },
  below: {
    marginTop: spacing.titleToChips,
  },
});
