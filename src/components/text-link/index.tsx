import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { haptics, type HapticEvent } from '@/services/haptics';
import { colors, layout, opacities, type TypographyVariant } from '@/theme';
import { withAlpha } from '@/utils/color';

/**
 * - `standalone`: link sozinho numa linha ("Esqueci minha senha", "Ver agenda
 *   completa", "Ver ranking"), com alvo de 44.
 * - `inline`: trecho tocável dentro de um `Text` (os termos da 1k, "Criar
 *   conta" no rodapé). O leitor de tela lista esses trechos pelo rotor (iOS) e
 *   pelo menu de links (Android).
 */
export type TextLinkVariant = 'inline' | 'standalone';

/** `link` abre algo fora do app (termos); `button` faz uma ação ou navega dentro dele. */
export type TextLinkRole = 'link' | 'button';

/** Rosa é ação. Branco sublinhado é o link dentro de texto cinza (termos da 1k). */
export type TextLinkTone = 'accent' | 'text';

export interface TextLinkProps {
  label: string;
  onPress: () => void;
  variant?: TextLinkVariant;
  /** Padrão: `link` no trecho dentro do texto, `button` no avulso. */
  role?: TextLinkRole;
  tone?: TextLinkTone;
  /**
   * Variante de texto. No trecho dentro de texto, use a do texto em volta com
   * peso 700 (Manrope), para o tamanho não mudar no meio da frase.
   */
  textVariant?: TypographyVariant;
  /** Padrão: sublinhado só no tom `text`, que sem ele se confundiria com o texto em volta. */
  underline?: boolean;
  /** Padrão: `tap` no avulso; nenhum no trecho dentro do texto (termos). */
  haptic?: HapticEvent | null;
  disabled?: boolean;
  /** Quando o texto visível sozinho não diz aonde vai ("Ver todos" → "Ver todos os artistas"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Só no avulso: vai no alvo de toque (`alignSelf`, margem). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONE_COLOR: Record<TextLinkTone, string> = {
  // Rosa como texto fica no #FF2D6F (5,1 a 5,5:1); o accentStrong reprova como texto.
  accent: colors.accent,
  text: colors.text,
};

/** Link de texto: rosa para ação, no alvo de 44 quando está sozinho na linha. */
export function TextLink({
  label,
  onPress,
  variant = 'standalone',
  role,
  tone = 'accent',
  textVariant = 'label',
  underline,
  haptic,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: TextLinkProps) {
  const underlined = underline ?? tone === 'text';
  const textStyle = underlined ? UNDERLINE[tone] : undefined;

  if (variant === 'inline') {
    const handlePress = (): void => {
      if (haptic) haptics.trigger(haptic);
      onPress();
    };
    return (
      <Text
        variant={textVariant}
        // Trecho aninhado não aceita opacidade: desativado, ele apaga pela cor.
        color={disabled ? colors.textMuted : TONE_COLOR[tone]}
        onPress={disabled ? undefined : handlePress}
        accessibilityRole={role ?? 'link'}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={disabled ? { disabled } : undefined}
        testID={testID}
        style={textStyle}
      >
        {label}
      </Text>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic === undefined ? 'tap' : haptic}
      disabled={disabled}
      accessibilityRole={role ?? 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={[styles.target, disabled && styles.inactive, style]}
    >
      <Text variant={textVariant} color={TONE_COLOR[tone]} style={textStyle}>
        {label}
      </Text>
    </PressableScale>
  );
}

// Sublinhado na cor do texto a .35, como nos termos da 1k (o Android usa a cor do texto).
const UNDERLINE_ALPHA = 0.35;

const styles = StyleSheet.create({
  target: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: {
    opacity: opacities.disabled,
  },
  underlineAccent: {
    textDecorationLine: 'underline',
    textDecorationColor: withAlpha(TONE_COLOR.accent, UNDERLINE_ALPHA),
  },
  underlineText: {
    textDecorationLine: 'underline',
    textDecorationColor: withAlpha(TONE_COLOR.text, UNDERLINE_ALPHA),
  },
});

const UNDERLINE: Record<TextLinkTone, (typeof styles)['underlineText']> = {
  accent: styles.underlineAccent,
  text: styles.underlineText,
};
