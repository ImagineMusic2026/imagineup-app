import type { LucideIcon } from 'lucide-react-native';
import { forwardRef, useEffect, useState, type ReactNode } from 'react';
import {
  TextInput as NativeTextInput,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInputProps as NativeTextInputProps,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Glyph, type GlyphName } from '@/components/glyph';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { HapticEvent } from '@/services/haptics';
import { borderWidths, colors, layout, motion, radii, spacing, typography } from '@/theme';

/**
 * - `default`: os formulários do app;
 * - `glass`: as telas de conta, sobre a foto da 1k;
 * - `bare`: sem borda nem fundo, para os campos dentro do card de um grupo (a
 *   tela "Editar perfil"); o foco aparece numa linha embaixo do campo.
 */
export type TextInputVariant = 'default' | 'glass' | 'bare';

export interface TextInputProps extends Omit<NativeTextInputProps, 'style'> {
  label: string;
  error?: string;
  /**
   * Borda de erro sem mensagem embaixo, quando o erro é do envio e aparece em
   * outro lugar da tela ("E-mail ou senha incorretos." embaixo do botão).
   */
  invalid?: boolean;
  /** Orientação fixa embaixo do campo ("Pelo menos 6 caracteres"), lida junto com o erro. */
  hint?: string;
  variant?: TextInputVariant;
  /**
   * Ícone decorativo à esquerda (a lupa da busca). Fica fora do leitor de tela
   * e deixa o toque passar: tocar nele também abre o teclado.
   */
  leadingIcon?: LucideIcon;
  /** Como o `leadingIcon`, com um desenho do `Glyph` (as marcas das redes sociais). */
  leadingGlyph?: GlyphName;
  /**
   * Texto fixo antes do que o fã digita, em cinza (o "@" do usuário, o "in/"
   * do LinkedIn). Não entra no valor nem no leitor. O texto digitado começa
   * depois dele, pela largura medida, que cresce com a fonte.
   */
  prefix?: string;
  /**
   * Ação à direita, dentro do campo (o olho da senha): use `TextInputAction`.
   * Um status sem toque (o check do @) vai com `pointerEvents="none"` e oculto
   * do leitor, e o texto dele chega pelo `accessibilityStatus`.
   */
  trailing?: ReactNode;
  /** Sem rótulo visível (busca); o leitor de tela continua ouvindo o `label`. */
  labelHidden?: boolean;
  /**
   * Embaixo da caixa do texto e fora dela (o contador da bio, que assim nunca
   * cobre a última linha). O que ele mostra chega ao leitor pelo
   * `accessibilityStatus`.
   */
  footer?: ReactNode;
  /**
   * Texto somado à dica do campo para o leitor, sem ser desenhado (o status do
   * @, mostrado embaixo do card; o contador da bio).
   */
  accessibilityStatus?: string;
}

const REST_BORDER: Record<TextInputVariant, string> = {
  default: colors.border,
  glass: colors.borderGlass,
  // Sem linha parada: o card do grupo desenha as divisórias, e a linha só aparece no foco.
  bare: colors.transparent,
};

// Altura mínima do campo de várias linhas (a bio), em linhas de texto.
const MULTILINE_MIN_LINES = 3;

/** Erro e dica numa frase só para o leitor, com a pausa de um ponto entre eles. */
function joinSentences(...parts: (string | undefined)[]): string | undefined {
  const sentences = parts
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .map((part) => (/[.!?…]$/.test(part) ? part : `${part}.`));
  return sentences.length > 0 ? sentences.join(' ') : undefined;
}

/**
 * Campo de formulário com rótulo visível. Para o leitor de tela, rótulo, erro e
 * dica chegam pelo próprio campo (label e hint), então os textos visíveis ficam
 * escondidos dele e nada é lido duas vezes. Com `ref` do react-hook-form, o
 * envio inválido leva o foco ao primeiro campo com erro.
 *
 * Com `multiline`, o texto começa no topo, com a entrelinha da tipografia, a
 * caixa tem pelo menos 3 linhas e o ícone fica na altura da primeira.
 */
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  {
    label,
    error,
    invalid = false,
    hint,
    variant = 'default',
    leadingIcon,
    leadingGlyph,
    prefix,
    trailing,
    labelHidden = false,
    footer,
    accessibilityStatus,
    onFocus,
    onBlur,
    ...props
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [prefixWidth, setPrefixWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const failed = !!error || invalid;
  const bare = variant === 'bare';
  const multiline = !!props.multiline;
  const hasLeading = !!leadingIcon || !!leadingGlyph;
  const borderStyle = useFocusBorder(
    focused,
    failed ? colors.danger : REST_BORDER[variant],
    failed ? colors.danger : colors.accent,
  );

  // A primeira linha do texto, com a fonte do sistema: o ícone e o prefixo do
  // campo de várias linhas ficam na altura dela, e a caixa tem 3 delas.
  const lineHeight = typography.input.lineHeight * Math.min(fontScale, MAX_FONT_SCALE);
  const firstLine = multiline
    ? { top: INPUT_PADDING_MULTILINE, bottom: undefined, height: lineHeight }
    : null;
  // Onde o texto digitado começa: depois do ícone e do prefixo.
  const leadingInset = spacing.lg + (hasLeading ? LEADING_ICON_SIZE + spacing.sm : 0);
  const textStart = prefix ? leadingInset + prefixWidth : hasLeading ? leadingInset : undefined;
  const messages = !!error || !!hint || !!footer;

  return (
    <View style={styles.container}>
      {labelHidden ? null : (
        <Text
          variant="labelSmall"
          color={colors.textSecondary}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {label}
        </Text>
      )}
      <Animated.View
        style={[
          styles.field,
          styles[variant],
          multiline && {
            alignItems: 'flex-start',
            minHeight: lineHeight * MULTILINE_MIN_LINES + INPUT_PADDING_MULTILINE * 2,
          },
          borderStyle,
        ]}
      >
        <NativeTextInput
          ref={ref}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          textAlignVertical={multiline ? 'top' : undefined}
          {...props}
          accessibilityLabel={label}
          accessibilityHint={joinSentences(error, hint, accessibilityStatus)}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            textStart !== undefined && { paddingLeft: textStart },
            !!trailing && styles.inputBeforeTrailing,
          ]}
        />
        {/* Por cima do campo e sem receber toque: o campo ocupa a caixa inteira. */}
        {hasLeading ? (
          <View pointerEvents="none" style={[styles.leading, firstLine]}>
            {leadingIcon ? (
              <Icon icon={leadingIcon} size={LEADING_ICON_SIZE} color={colors.textMuted} />
            ) : leadingGlyph ? (
              <Glyph name={leadingGlyph} size={LEADING_ICON_SIZE} color={colors.textMuted} />
            ) : null}
          </View>
        ) : null}
        {prefix ? (
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            onLayout={(event) => setPrefixWidth(Math.ceil(event.nativeEvent.layout.width))}
            style={[styles.prefix, { left: leadingInset }, firstLine]}
          >
            <Text variant="input" color={colors.textMuted} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {prefix}
            </Text>
          </View>
        ) : null}
        {trailing ? (
          <View style={[styles.trailing, multiline && styles.trailingMultiline]}>{trailing}</View>
        ) : null}
      </Animated.View>
      {messages ? (
        <View style={[styles.messages, bare && styles.bareMessages]}>
          {error ? (
            <Text
              variant="caption"
              color={colors.danger}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {error}
            </Text>
          ) : null}
          {hint ? (
            <Text
              variant="caption"
              color={colors.textMuted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {hint}
            </Text>
          ) : null}
          {footer}
        </View>
      ) : null}
    </View>
  );
});

/**
 * Borda que vai até a cor do foco em 150 ms. Aqui a troca é em RGB: do branco
 * translúcido ao rosa, o HSV passaria o matiz por todas as cores no caminho.
 * Exportada para os campos sem rótulo visível, como o do comentário do post.
 */
export function useFocusBorder(focused: boolean, rest: string, active: string) {
  const reducedMotion = usePrefersReducedMotion();
  const focus = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    const value = focused ? 1 : 0;
    focus.set(
      reducedMotion
        ? value
        : withTiming(value, { duration: motion.duration.fast, easing: motion.easing.out }),
    );
  }, [focused, reducedMotion, focus]);

  return useAnimatedStyle(() => {
    const p = focus.get();
    if (p <= 0) return { borderColor: rest };
    if (p >= 1) return { borderColor: active };
    return { borderColor: interpolateColor(p, [0, 1], [rest, active]) };
  });
}

export interface TextInputActionProps {
  icon: LucideIcon;
  onPress: () => void;
  /** O que o toque faz, via `t()` ("Mostrar senha"). Troca junto com o estado. */
  accessibilityLabel: string;
  haptic?: HapticEvent | null;
}

const ACTION_ICON_SIZE = 20;
// Lupa da busca de artistas (sheet da 1l), pessoa e marcas da tela "Editar perfil".
const LEADING_ICON_SIZE = 18;
// Em cima e embaixo do texto no campo de várias linhas.
const INPUT_PADDING_MULTILINE = spacing.md;

/**
 * Botão de ícone para o `trailing` do campo (olho da senha): alvo de 44 dentro
 * do campo de 50, porque o hitSlop fora do pai não recebe toque no Fabric do iOS.
 */
export function TextInputAction({
  icon,
  onPress,
  accessibilityLabel,
  haptic = 'selection',
}: TextInputActionProps) {
  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic}
      accessibilityLabel={accessibilityLabel}
      style={styles.action}
    >
      <Icon icon={icon} size={ACTION_ICON_SIZE} color={colors.textSecondary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.metaGap,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.fieldHeight,
    borderWidth: borderWidths.default,
  },
  default: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  glass: {
    borderRadius: radii.cta,
    backgroundColor: colors.glass,
  },
  // Só a linha de baixo, que acende no foco (e fica no tom de erro com ele).
  bare: {
    borderWidth: 0,
    borderBottomWidth: borderWidths.default,
    backgroundColor: colors.transparent,
  },
  // Sem lineHeight: num campo de uma linha, o iOS desalinha o texto com ele.
  input: {
    flex: 1,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
  },
  inputMultiline: {
    lineHeight: typography.input.lineHeight,
    paddingTop: INPUT_PADDING_MULTILINE,
    paddingBottom: INPUT_PADDING_MULTILINE,
  },
  inputBeforeTrailing: {
    paddingRight: 0,
  },
  leading: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: spacing.lg,
    justifyContent: 'center',
  },
  prefix: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  // O ícone do alvo de 44 termina a 16 da borda, como o texto do outro lado.
  trailing: {
    paddingRight: spacing.xs,
  },
  trailingMultiline: {
    alignSelf: 'flex-start',
  },
  messages: {
    gap: spacing.metaGap,
  },
  // Dentro do card: alinhado ao texto do campo, com folga até a divisória.
  bareMessages: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  action: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
