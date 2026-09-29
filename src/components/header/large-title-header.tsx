import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

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
 * vão até o que vem abaixo do título (subtítulo, linha de baixo ou, sem
 * nenhum dos dois, o conteúdo), para o título ficar a 12 da área segura, o
 * subtítulo a 9 e o primeiro card a 18 dele, como sem o voltar. O alvo
 * continua inteiro dentro da linha, sem hitSlop nem margem negativa.
 */
function useBackRowSlack(showBack: boolean): number {
  const { fontScale } = useWindowDimensions();
  if (!showBack) return 0;
  const titleLine =
    typography.titlePage.lineHeight * Math.min(fontScale, maxFontScaleOf('titlePage'));
  return Math.max(0, (layout.minTouchTarget - titleLine) / 2);
}

/**
 * A peça à direita (a pílula de saldo da 1h) desce para uma linha própria
 * quando o título quebra ao lado dela (fonte grande em tela estreita): sem
 * isso, "Resgatar" quebrava no meio da palavra. Quem decide é a quebra real do
 * título (`onTextLayout`), porque a largura da pílula muda depois (o saldo
 * chega, o número conta) e o `flexWrap` da linha não reagia a isso no Android.
 * Volta para o lado quando a largura da tela ou a fonte mudam.
 */
function useAccessoryBelow(hasAccessory: boolean) {
  const { width, fontScale } = useWindowDimensions();
  const screen = `${width}x${fontScale}`;
  const [moved, setMoved] = useState<string | null>(null);
  const below = hasAccessory && moved === screen;

  const onTitleLayout = (event: NativeSyntheticEvent<TextLayoutEventData>): void => {
    if (hasAccessory && !below && event.nativeEvent.lines.length > 1) setMoved(screen);
  };

  return { below, onTitleLayout };
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
  const { below, onTitleLayout } = useAccessoryBelow(accessory !== undefined && accessory !== null);
  const titleIsLast = !subtitle && !children && !below;

  return (
    <View
      style={{
        paddingTop: spacing.md - slack,
        paddingBottom: titleIsLast ? spacing.blockGap - slack : spacing.blockGap,
      }}
    >
      <View style={styles.row}>
        <View style={styles.lead}>
          {showBack ? <BackButton onPress={onBack} /> : null}
          <Text
            variant="titlePage"
            accessibilityRole="header"
            onTextLayout={onTitleLayout}
            style={styles.title}
          >
            {title}
          </Text>
        </View>
        {below ? null : accessory}
      </View>
      {below ? <View style={styles.accessoryBelow}>{accessory}</View> : null}
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
// todos descontam a sobra da linha com o voltar (`useBackRowSlack`).
const styles = StyleSheet.create({
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
  // Na linha própria, a peça fica à direita, onde estaria ao lado do título.
  accessoryBelow: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
  },
  title: {
    flexShrink: 1,
  },
});
