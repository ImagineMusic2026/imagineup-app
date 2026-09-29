import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { colors, layout, spacing, typography } from '@/theme';

export interface SectionHeaderAction {
  /** Texto rosa à direita ("Ver todas"). */
  label: string;
  onPress: () => void;
  /** Frase completa para o leitor ("Ver todas as suas centrais"), via `t()`. */
  accessibilityLabel: string;
  /** `link` quando abre outra tela e o chamador quer que o leitor diga isso. */
  accessibilityRole?: 'button' | 'link';
}

/**
 * Espaço em cima e embaixo, como no protótipo:
 * - `default` (24 / 12): "Suas centrais" (1b) e "Conquistas" (1e);
 * - `tight` (18 / 10): "Suas centrais" (1e);
 * - `compact` (20 / 6): "Comentários" (post).
 */
export type SectionHeaderSpacing = 'default' | 'tight' | 'compact';

export interface SectionHeaderProps {
  title: string;
  /**
   * Número ao lado do título, cinza e sem toque ("327" nos comentários). Chega
   * formatado (`formatNumber`). "14 de 32" das conquistas entra aqui enquanto
   * a lista não existir: rosa é ação, e texto rosa sem toque engana.
   */
  count?: string;
  /** Link rosa à direita, com alvo de 44 sem mudar o desenho da linha. */
  action?: SectionHeaderAction;
  spacing?: SectionHeaderSpacing;
  /** Título e contagem lidos juntos ("Comentários, 327"), via `t()`. Sem ele, o leitor lê o texto. */
  accessibilityLabel?: string;
  /** A margem dos lados é de quem chama: a linha segue o padding da tela. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Cabeçalho de seção: título Sora à esquerda, contagem opcional e um link rosa
 * à direita. O título (com a contagem) é um cabeçalho só para o leitor de tela;
 * o link é outro foco, com o próprio rótulo.
 */
export function SectionHeader({
  title,
  count,
  action,
  spacing: preset = 'default',
  accessibilityLabel,
  style,
  testID,
}: SectionHeaderProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.row,
        action ? [styles.withAction, actionPadding[preset]] : padding[preset],
        style,
      ]}
    >
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={accessibilityLabel}
        style={styles.heading}
      >
        <Text variant="headingSection" style={styles.title}>
          {title}
        </Text>
        {count ? (
          <Text variant="labelSmall" color={colors.textMuted} tabular>
            {count}
          </Text>
        ) : null}
      </View>
      {action ? (
        <PressableScale
          onPress={action.onPress}
          accessibilityRole={action.accessibilityRole ?? 'button'}
          accessibilityLabel={action.accessibilityLabel}
          testID={testID ? `${testID}-action` : undefined}
          style={styles.action}
        >
          <Text variant="labelSmall" color={colors.accent}>
            {action.label}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const PADDING: Record<SectionHeaderSpacing, { top: number; bottom: number }> = {
  default: { top: spacing.sectionTop, bottom: spacing.sectionBottom },
  tight: { top: spacing.blockGap, bottom: spacing.listGap },
  compact: { top: spacing.sectionTopTight, bottom: spacing.metaGap },
};

// Com o link, a linha cresce para 44 e devolve a sobra nos paddings, para o
// toque inteiro caber dentro dela (no Fabric do iOS, o que passa do pai não
// recebe toque). Embaixo o padding é menor que a sobra: o bloco seguinte desce
// 1,5 pt no `default`, 3,5 no `tight` e 7,5 no `compact`.
const ACTION_OUTSET = (layout.minTouchTarget - typography.headingSection.lineHeight) / 2;

function paddingFor(preset: SectionHeaderSpacing, withAction: boolean): ViewStyle {
  const { top, bottom } = PADDING[preset];
  const outset = withAction ? ACTION_OUTSET : 0;
  return {
    paddingTop: Math.max(0, top - outset),
    paddingBottom: Math.max(0, bottom - outset),
  };
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  withAction: {
    minHeight: layout.minTouchTarget,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexShrink: 1,
  },
  title: {
    flexShrink: 1,
  },
  action: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});

const padding = StyleSheet.create({
  default: paddingFor('default', false),
  tight: paddingFor('tight', false),
  compact: paddingFor('compact', false),
});

const actionPadding = StyleSheet.create({
  default: paddingFor('default', true),
  tight: paddingFor('tight', true),
  compact: paddingFor('compact', true),
});
