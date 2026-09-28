import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme';

export interface TextProps extends NativeTextProps {
  variant?: TypographyVariant;
  color?: string;
  /** Números alinhados, para contadores e placares que mudam de valor. */
  tabular?: boolean;
}

// O texto cresce até 200% com a fonte do sistema (WCAG 1.4.4). Só as variantes
// minúsculas presas a um layout fixo (tab bar, chips) param antes; a tab bar
// compensa com o visualizador de conteúdo ampliado do iOS.
const DEFAULT_MAX_FONT_SIZE_MULTIPLIER = 2;
const MAX_FONT_SIZE_MULTIPLIER: Partial<Record<TypographyVariant, number>> = {
  tabLabel: 1.3,
  tabLabelActive: 1.3,
  chip: 1.5,
};

/** Todo texto do app passa por aqui, com as variantes do tema. */
export function Text({
  variant = 'body',
  color = colors.text,
  tabular = false,
  style,
  maxFontSizeMultiplier,
  ...props
}: TextProps) {
  return (
    <NativeText
      {...props}
      maxFontSizeMultiplier={
        maxFontSizeMultiplier ??
        MAX_FONT_SIZE_MULTIPLIER[variant] ??
        DEFAULT_MAX_FONT_SIZE_MULTIPLIER
      }
      style={[typography[variant], { color }, tabular && { fontVariant: ['tabular-nums'] }, style]}
    />
  );
}
