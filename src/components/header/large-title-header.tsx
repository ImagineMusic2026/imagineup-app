import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { maxFontScaleOf, Text } from '@/components/text';
import { colors, layout, spacing, typography } from '@/theme';

import { BackButton } from './back-button';

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

/**
 * Com o voltar, a linha do título tem a altura do alvo de 44 enquanto a
 * entrelinha do título (29, crescendo com a fonte do sistema) for menor. A
 * sobra fica metade em cima e metade embaixo do título; ela sai do topo e do
 * vão até a linha de baixo, para o título ficar a 12 da área segura e o
 * subtítulo a 9 dele, como sem o voltar. O alvo continua inteiro dentro da
 * linha, sem hitSlop nem margem negativa.
 */
function useBackRowSlack(showBack: boolean): number {
  const { fontScale } = useWindowDimensions();
  if (!showBack) return 0;
  const titleLine =
    typography.titlePage.lineHeight * Math.min(fontScale, maxFontScaleOf('titlePage'));
  return Math.max(0, (layout.minTouchTarget - titleLine) / 2);
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
  const slack = useBackRowSlack(showBack);

  return (
    <View style={[styles.container, { paddingTop: spacing.md - slack }]}>
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
        <Text
          variant="bodySmall"
          color={colors.textMuted}
          style={{ marginTop: spacing.tileGap - slack }}
        >
          {subtitle}
        </Text>
      ) : null}
      {children ? (
        <View style={{ marginTop: subtitle ? spacing.titleToChips : spacing.titleToChips - slack }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

// Vãos do protótipo: título até subtítulo 9, até a linha de chips 15 e até o
// primeiro card 18. O topo de 12 é convenção do app sobre a área segura real;
// os três descontam a sobra da linha com o voltar (`useBackRowSlack`).
const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.blockGap,
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
});
