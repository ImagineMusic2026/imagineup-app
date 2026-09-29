import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme';

export interface TextProps extends NativeTextProps {
  variant?: TypographyVariant;
  color?: string;
  /** Números alinhados, para contadores e placares que mudam de valor. */
  tabular?: boolean;
}

/**
 * O texto cresce até 200% com a fonte do sistema (WCAG 1.4.4). Quem desenha um
 * rótulo que não é layout fixo com uma variante limitada (o `chip` num botão)
 * passa este valor para ele crescer como o resto.
 */
export const MAX_FONT_SCALE = 2;

// Só as variantes minúsculas presas a um layout fixo (tab bar, chips, selos,
// pódio, caixas de número) param antes; a tab bar compensa com o visualizador
// de conteúdo ampliado do iOS.
const FIXED_LAYOUT_MULTIPLIER = 1.5;
const MAX_FONT_SIZE_MULTIPLIER: Partial<Record<TypographyVariant, number>> = {
  tabLabel: 1.3,
  tabLabelActive: 1.3,
  chip: FIXED_LAYOUT_MULTIPLIER,
  chipSmall: FIXED_LAYOUT_MULTIPLIER,
  badge: FIXED_LAYOUT_MULTIPLIER,
  badgeSmall: FIXED_LAYOUT_MULTIPLIER,
  pointsTiny: FIXED_LAYOUT_MULTIPLIER,
  micro: FIXED_LAYOUT_MULTIPLIER,
  statLabel: FIXED_LAYOUT_MULTIPLIER,
  labelTiny: FIXED_LAYOUT_MULTIPLIER,
  dateMonth: FIXED_LAYOUT_MULTIPLIER,
  microLabel: FIXED_LAYOUT_MULTIPLIER,
  overlineStrong: FIXED_LAYOUT_MULTIPLIER,
};

/**
 * Até quanto a variante cresce. Camadas sobrepostas de variantes diferentes
 * (os dois rótulos do `Chip`) usam o mesmo limite, para a de baixo não vazar.
 */
export function maxFontScaleOf(variant: TypographyVariant): number {
  return MAX_FONT_SIZE_MULTIPLIER[variant] ?? MAX_FONT_SCALE;
}

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
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? maxFontScaleOf(variant)}
      style={[typography[variant], { color }, tabular && { fontVariant: ['tabular-nums'] }, style]}
    />
  );
}
