import type { ReactNode, Ref } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Card, type CardPadding } from '@/components/card';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import type { HapticEvent } from '@/services/haptics';
import { borderWidths, colors, spacing, type TypographyVariant } from '@/theme';

/**
 * - `card`: card de lista (missões 1g, shows 1m): raio 16, padding 14, vão 12.
 * - `compact`: card baixo (centrais 1e): raio 14, padding 9 x 12, vão 11, meta menor.
 * - `divided`: sem fundo, com linha embaixo (ranking 1f).
 */
export type ListRowVariant = 'card' | 'compact' | 'divided';

/** `locked`: ainda não abriu (missão bloqueada 1g). Borda e textos apagados, sem opacidade no todo. */
export type ListRowTone = 'default' | 'locked';

interface ListRowBaseProps {
  title: string;
  meta?: string;
  /** Selo à esquerda (ícone, avatar, posição, data). Mais de uma peça ficam lado a lado, no vão da linha. */
  leading?: ReactNode;
  variant?: ListRowVariant;
  tone?: ListRowTone;
  /** Nomes do ranking cabem numa linha com reticências; o resto quebra, para a fonte a 200%. */
  titleNumberOfLines?: number;
  /** Troca o vão da variante (a linha da agenda usa 13). */
  gap?: keyof typeof spacing;
  /** Troca o padding do card (a linha da agenda usa 12). Não vale para `divided`. */
  padding?: CardPadding;
  /**
   * Onde fica o `trailing`: à direita (padrão) ou embaixo do selo, do título
   * e da meta, alinhado à esquerda. Com a fonte grande, o "Eu vou" da agenda
   * (1m) desce para o título não ficar sem espaço e ser cortado.
   */
  trailingPlacement?: 'end' | 'below';
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * O elemento que o leitor de tela foca (a linha ou, com
   * `accessibilityGroup="content"`, o bloco de conteúdo), para levar o foco
   * até ele (a linha do próprio fã no ranking 1f).
   */
  ref?: Ref<View>;
}

/**
 * A linha inteira (ou o bloco de `accessibilityGroup="content"`) num rótulo
 * só, via `t()`: "Missão relâmpago do show. Bloqueada. Vale 50 pontos."
 */
type RowLabel = { accessibilityLabel?: string };

interface PressableRowBase {
  /**
   * A linha toda vira um pressável só. O `trailing` fica oculto do leitor e
   * sem toque: o que ele mostra entra no rótulo, e botão dentro com a mesma
   * ação daria dois focos para uma coisa só.
   *
   * Bloqueada, continua tocável (o toque dá o haptic `locked` e quem chama
   * anuncia a dica) e não se diz desativada: "Bloqueada" vai no rótulo.
   */
  onPress: () => void;
  /** Padrão: `tap`; na linha bloqueada, `locked`. */
  haptic?: HapticEvent | null;
  accessibilityRole?: AccessibilityRole;
  /**
   * A ação da linha está andando (sair da conta): o leitor ouve que ela está
   * ocupada, já que o indicador do `trailing` fica fora dele.
   */
  busy?: boolean;
  accessibilityGroup?: never;
}

/**
 * Com `trailing`, o rótulo é obrigatório: o valor da direita fica fora do
 * leitor, e sem o rótulo o "+20" se perderia.
 */
type PressableRow = PressableRowBase &
  (
    | ({ trailing?: undefined } & RowLabel)
    | {
        /** Valor à direita ("+20", pontos, check). */
        trailing: ReactNode;
        accessibilityLabel: string;
      }
  );

interface StaticRow extends RowLabel {
  onPress?: undefined;
  /** Valor à direita ou um botão com ação própria (com `accessibilityGroup="content"`). */
  trailing?: ReactNode;
  haptic?: never;
  busy?: never;
  accessibilityRole?: never;
  /**
   * O que o leitor lê como um elemento só:
   * - `row` (padrão): a linha inteira (ranking 1f, missão concluída);
   * - `content`: selo, título e meta. O `trailing` fica de fora com foco
   *   próprio, porque é um botão ("Eu vou" da 1m). A linha inteira agrupada
   *   esconderia o botão no iOS.
   */
  accessibilityGroup?: 'row' | 'content';
}

export type ListRowProps = ListRowBaseProps & (PressableRow | StaticRow);

const META_VARIANT: Record<ListRowVariant, TypographyVariant> = {
  card: 'caption',
  compact: 'metaSmall',
  divided: 'metaSmall',
};

// Peça dentro de um pressável que repete a ação dele: fora do leitor de tela.
const HIDDEN_FROM_READER = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/**
 * Linha de lista: selo à esquerda, título, meta e um valor ou ação à direita.
 * Pressável ou não; as props de acessibilidade ficam sempre no elemento de
 * fora que o leitor foca, e os filhos não recebem papel.
 */
export function ListRow(props: ListRowProps) {
  const {
    title,
    meta,
    leading,
    trailing,
    variant = 'card',
    tone = 'default',
    titleNumberOfLines,
    gap,
    padding,
    trailingPlacement = 'end',
    accessibilityLabel,
    accessibilityHint,
    style,
    testID,
    ref,
  } = props;
  const locked = tone === 'locked';
  const below = trailing ? trailingPlacement === 'below' : false;
  const pressable = props.onPress !== undefined;
  const group = pressable ? 'row' : (props.accessibilityGroup ?? 'row');
  // Só a linha estática bloqueada se diz desativada. A pressável responde ao
  // toque, e o TalkBack nem entrega a ação a um nó desativado.
  const accessibilityState: AccessibilityState | undefined =
    locked && !pressable ? { disabled: true } : props.busy ? { busy: true } : undefined;
  const gapStyle = [gapStyles[variant], gap ? gapFor(gap) : null];

  // O rótulo vai para quem o leitor foca: a linha, ou só o bloco de conteúdo.
  const rowAccessibility =
    group === 'row'
      ? {
          accessible: pressable ? undefined : true,
          accessibilityLabel,
          accessibilityHint,
          accessibilityState,
        }
      : {};

  const content = (
    <>
      <View
        ref={group === 'content' ? ref : undefined}
        accessible={group === 'content' ? true : undefined}
        accessibilityLabel={group === 'content' ? accessibilityLabel : undefined}
        accessibilityHint={group === 'content' ? accessibilityHint : undefined}
        accessibilityState={group === 'content' ? accessibilityState : undefined}
        style={[styles.content, gapStyle, below && styles.contentAbove]}
      >
        {leading ? <View style={[styles.leading, gapStyle]}>{leading}</View> : null}
        <View style={styles.texts}>
          <Text
            variant="label"
            color={locked ? colors.textMuted : colors.text}
            numberOfLines={titleNumberOfLines}
          >
            {title}
          </Text>
          {meta ? (
            <Text
              variant={META_VARIANT[variant]}
              color={colors.textMuted}
              style={metaStyles[variant]}
            >
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      {trailing ? (
        <View
          {...(pressable ? HIDDEN_FROM_READER : null)}
          pointerEvents={pressable ? 'none' : undefined}
          testID={testID ? `${testID}-trailing` : undefined}
          style={[styles.trailing, below && styles.trailingBelow]}
        >
          {trailing}
        </View>
      ) : null}
    </>
  );

  const haptic = pressable && props.haptic !== undefined ? props.haptic : locked ? 'locked' : 'tap';

  if (variant === 'divided') {
    const rowStyle = [styles.row, styles.divided, gapStyle, below && styles.stacked, style];
    if (pressable) {
      return (
        <PressableScale
          ref={ref}
          onPress={props.onPress}
          haptic={haptic}
          accessibilityRole={props.accessibilityRole}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={accessibilityState}
          testID={testID}
          style={rowStyle}
        >
          {content}
        </PressableScale>
      );
    }
    return (
      <View
        ref={group === 'row' ? ref : undefined}
        {...rowAccessibility}
        testID={testID}
        style={rowStyle}
      >
        {content}
      </View>
    );
  }

  return (
    <Card
      ref={group === 'row' ? ref : undefined}
      variant={variant === 'compact' ? 'compact' : locked ? 'locked' : 'default'}
      padding={padding}
      onPress={props.onPress}
      haptic={pressable ? haptic : undefined}
      accessibilityRole={props.accessibilityRole}
      {...rowAccessibility}
      testID={testID}
      style={[
        styles.row,
        gapStyle,
        below && styles.stacked,
        locked && variant === 'compact' && styles.lockedBorder,
        style,
      ]}
    >
      {content}
    </Card>
  );
}

function gapFor(token: keyof typeof spacing): ViewStyle {
  return { gap: spacing[token] };
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divided: {
    paddingVertical: spacing.gridGap,
    borderBottomWidth: borderWidths.default,
    // Branco a .06 do protótipo, o mesmo tom do card bloqueado.
    borderBottomColor: colors.borderSubtle,
  },
  lockedBorder: {
    borderColor: colors.borderSubtle,
  },
  content: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  leading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  // O trailing embaixo: o alvo de 44 do botão já traz a sobra em volta do desenho.
  stacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.xs,
  },
  // Na coluna, o conteúdo fica com a altura dele (com `flex: 1` sumiria).
  contentAbove: {
    flex: 0,
  },
  trailingBelow: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
});

const gapStyles = StyleSheet.create({
  card: { gap: spacing.itemGap },
  compact: { gap: spacing.gridGap },
  divided: { gap: spacing.itemGap },
});

// Título até meta: 6 nos cards (5 a 6 no protótipo), 4 no ranking.
const metaStyles = StyleSheet.create({
  card: { marginTop: spacing.metaGap },
  compact: { marginTop: spacing.metaGap },
  divided: { marginTop: spacing.xs },
});
