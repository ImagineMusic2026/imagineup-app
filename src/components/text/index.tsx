import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme';

export interface TextProps extends NativeTextProps {
  variant?: TypographyVariant;
  color?: string;
  /** Números alinhados, para contadores e placares que mudam de valor. */
  tabular?: boolean;
}

// Tamanhos pequenos do design quebram o layout com fonte muito ampliada; o
// limite ainda deixa o texto crescer para quem precisa.
const MAX_FONT_SIZE_MULTIPLIER = 1.6;

/** Todo texto do app passa por aqui, com as variantes do tema. */
export function Text({
  variant = 'body',
  color = colors.text,
  tabular = false,
  style,
  maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER,
  ...props
}: TextProps) {
  return (
    <NativeText
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typography[variant], { color }, tabular && { fontVariant: ['tabular-nums'] }, style]}
    />
  );
}
