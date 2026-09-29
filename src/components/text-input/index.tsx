import type { LucideIcon } from 'lucide-react-native';
import { forwardRef, useEffect, useState, type ReactNode } from 'react';
import {
  TextInput as NativeTextInput,
  StyleSheet,
  View,
  type TextInputProps as NativeTextInputProps,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { HapticEvent } from '@/services/haptics';
import { borderWidths, colors, layout, motion, radii, spacing, typography } from '@/theme';

/** `default` nos formulários do app; `glass` nas telas de conta, sobre a foto da 1k. */
export type TextInputVariant = 'default' | 'glass';

export interface TextInputProps extends Omit<NativeTextInputProps, 'style'> {
  label: string;
  error?: string;
  /** Orientação fixa embaixo do campo ("Pelo menos 6 caracteres"), lida junto com o erro. */
  hint?: string;
  variant?: TextInputVariant;
  /**
   * Ícone decorativo à esquerda (a lupa da busca). Fica fora do leitor de tela
   * e deixa o toque passar: tocar nele também abre o teclado.
   */
  leadingIcon?: LucideIcon;
  /** Ação à direita, dentro do campo (o olho da senha): use `TextInputAction`. */
  trailing?: ReactNode;
  /** Sem rótulo visível (busca); o leitor de tela continua ouvindo o `label`. */
  labelHidden?: boolean;
}

const REST_BORDER: Record<TextInputVariant, string> = {
  default: colors.border,
  glass: colors.borderGlass,
};

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
 */
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  {
    label,
    error,
    hint,
    variant = 'default',
    leadingIcon,
    trailing,
    labelHidden = false,
    onFocus,
    onBlur,
    ...props
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const borderStyle = useFocusBorder(
    focused,
    error ? colors.danger : REST_BORDER[variant],
    error ? colors.danger : colors.accent,
  );

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
      <Animated.View style={[styles.field, styles[variant], borderStyle]}>
        <NativeTextInput
          ref={ref}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          {...props}
          accessibilityLabel={label}
          accessibilityHint={joinSentences(error, hint)}
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
            !!leadingIcon && styles.inputAfterLeading,
            !!trailing && styles.inputBeforeTrailing,
          ]}
        />
        {/* Por cima do campo e sem receber toque: o campo ocupa a caixa inteira. */}
        {leadingIcon ? (
          <View pointerEvents="none" style={styles.leading}>
            <Icon icon={leadingIcon} size={LEADING_ICON_SIZE} color={colors.textMuted} />
          </View>
        ) : null}
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </Animated.View>
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
    </View>
  );
});

/**
 * Borda que vai até a cor do foco em 150 ms. Aqui a troca é em RGB: do branco
 * translúcido ao rosa, o HSV passaria o matiz por todas as cores no caminho.
 */
function useFocusBorder(focused: boolean, rest: string, active: string) {
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
// Lupa da busca de artistas (sheet da 1l).
const LEADING_ICON_SIZE = 18;

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
  // Sem lineHeight: num campo de uma linha, o iOS desalinha o texto com ele.
  input: {
    flex: 1,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
  },
  // O texto começa depois do ícone, que fica sobre a margem do próprio campo.
  inputAfterLeading: {
    paddingLeft: spacing.lg + LEADING_ICON_SIZE + spacing.sm,
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
  // O ícone do alvo de 44 termina a 16 da borda, como o texto do outro lado.
  trailing: {
    paddingRight: spacing.xs,
  },
  action: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
