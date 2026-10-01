import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import {
  borderWidths,
  colors,
  radii,
  spacing,
  tints,
  typography,
  type TypographyVariant,
} from '@/theme';
import { withAlpha } from '@/utils/color';

/**
 * - `points`: lima cheio, texto ink ("Compartilhar +2" da 1b, "+N" do toast).
 * - `pointsTint`: lima tingido, texto lima ("+20" da 1g, nível da 1e).
 * - `neutral`: superfície com borda, texto secundário (contagem "4.812" da 1b).
 * - `accentStrong`: rosa fechado, texto branco ("SÓ 20 VAGAS" da 1h; o #FF2D6F reprova AA).
 * - `events`: superfície com borda e texto ciano (shows e agenda).
 */
export type PillTone = 'points' | 'pointsTint' | 'neutral' | 'accentStrong' | 'events';

/** `xs` é o selo da 1h (4 x 10); `sm` os chips da 1b e da 1g (6 x 11); `md` os da 1a (8 x 12). */
export type PillSize = 'xs' | 'sm' | 'md';

export interface PillProps {
  label: string;
  tone?: PillTone;
  size?: PillSize;
  /** Selo em caixa alta com espaçamento: nível da 1e, vagas da 1h. */
  caps?: boolean;
  /** Peça antes do texto (barras da marca, ícone). Decorativa: some para o leitor de tela. */
  leading?: ReactNode;
  /** Cor do texto fora a do tom, como o número branco do curtir ligado (post). */
  labelColor?: string;
  /**
   * Com rótulo, a pílula vira um elemento só para o leitor ("+20" lido como
   * "vale 20 pontos"). Sem ele, o texto é lido como está. Dentro de um
   * pressável, deixe sem: quem fala é o pressável de fora.
   */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Cor do texto de cada tom, para o ícone do `leading` acompanhar. */
export const pillForeground: Record<PillTone, string> = {
  points: colors.onPoints,
  pointsTint: colors.points,
  neutral: colors.textSecondary,
  accentStrong: colors.onAccent,
  events: colors.events,
};

// Sora nos tons de marca, Manrope na contagem neutra, como no protótipo.
const LABEL_VARIANT: Record<
  PillSize,
  { brand: TypographyVariant; neutral: TypographyVariant; caps: TypographyVariant }
> = {
  xs: { brand: 'chipSmall', neutral: 'labelTiny', caps: 'badgeSmall' },
  sm: { brand: 'chipSmall', neutral: 'labelTiny', caps: 'badge' },
  md: { brand: 'chip', neutral: 'labelCompact', caps: 'badge' },
};

/** Pílula de texto, sem toque. A versão tocável (`PillButton`) põe esta dentro de um pressável. */
export function Pill({
  label,
  tone = 'neutral',
  size = 'sm',
  caps = false,
  leading,
  labelColor,
  accessibilityLabel,
  style,
  testID,
}: PillProps) {
  const variants = LABEL_VARIANT[size];
  const variant = caps ? variants.caps : tone === 'neutral' ? variants.neutral : variants.brand;

  return (
    <View
      testID={testID}
      accessible={accessibilityLabel ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.base, styles[size], styles[tone], style]}
    >
      {leading ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {leading}
        </View>
      ) : null}
      <Text variant={variant} color={labelColor ?? pillForeground[tone]}>
        {label}
      </Text>
    </View>
  );
}

// Todo tom tem borda (da cor do fundo nos cheios) para pílulas lado a lado
// terem a mesma altura. No `xs` e no `sm`, o padding de cima e de baixo é o do
// protótipo menos a sobra da entrelinha do RN (o CSS usa entrelinha 1). No
// `md`, quem dá a altura é o ícone de 15 e 16 das ações do post, e o padding
// fica o do protótipo (8): 34 no curtir e 33 no compartilhar. A altura mínima
// iguala a Manrope, de entrelinha menor, à Sora do mesmo tamanho.

/** Padding de cima e de baixo de cada tamanho, para quem se alinha a uma pílula. */
export const pillPaddingVertical: Record<PillSize, number> = {
  xs: spacing.xxs,
  sm: spacing.xs,
  md: spacing.sm,
};

const minHeight = (lineHeight: number, paddingVertical: number) =>
  lineHeight + paddingVertical * 2 + borderWidths.default * 2;

/** Altura da pílula só com texto; um ícone maior que a entrelinha a faz crescer. */
export const pillMinHeight: Record<PillSize, number> = {
  xs: minHeight(typography.badgeSmall.lineHeight, pillPaddingVertical.xs),
  sm: minHeight(typography.chipSmall.lineHeight, pillPaddingVertical.sm),
  md: minHeight(typography.labelCompact.lineHeight, pillPaddingVertical.md),
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.metaGap,
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
  },
  xs: {
    minHeight: pillMinHeight.xs,
    paddingVertical: pillPaddingVertical.xs,
    paddingHorizontal: spacing.listGap,
  },
  sm: {
    minHeight: pillMinHeight.sm,
    paddingVertical: pillPaddingVertical.sm,
    paddingHorizontal: spacing.gridGap,
  },
  md: {
    minHeight: pillMinHeight.md,
    paddingVertical: pillPaddingVertical.md,
    paddingHorizontal: spacing.md,
  },
  points: {
    backgroundColor: colors.points,
    borderColor: colors.points,
  },
  pointsTint: {
    backgroundColor: withAlpha(colors.points, tints.soft.fill),
    borderColor: withAlpha(colors.points, tints.soft.border),
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  accentStrong: {
    backgroundColor: colors.accentStrong,
    borderColor: colors.accentStrong,
  },
  events: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.events,
  },
});
