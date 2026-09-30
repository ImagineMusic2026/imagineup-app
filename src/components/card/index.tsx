import type { ReactNode, Ref } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type AccessibilityValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import type { HapticEvent } from '@/services/haptics';
import { borderWidths, colors, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

export type CardVariant = 'default' | 'large' | 'compact' | 'inset' | 'locked' | 'dashed';
export type CardPadding = keyof typeof spacing | 'none';

export interface CardProps {
  children: ReactNode;
  /**
   * `default` nas linhas de lista (1g 1h 1m), `large` nos cards de destaque
   * (1e 1g), `compact` nas linhas de central (1e), `inset` no card dentro de
   * card (top fãs da 1d), `locked` no que ainda não abriu (1g 1h), `dashed` nos
   * alvos de "adicionar" (1l).
   */
  variant?: CardVariant;
  /** Borda lima: o 1º dos top fãs (1d). */
  highlight?: boolean;
  /** Troca o padding da variante por um token de `spacing`, igual nos quatro lados. */
  padding?: CardPadding;
  style?: StyleProp<ViewStyle>;
  /** Com ele, o card inteiro vira um pressável só: nada de botão dentro com a mesma ação. */
  onPress?: () => void;
  onLongPress?: () => void;
  haptic?: HapticEvent | null;
  disabled?: boolean;
  /** Sem `onPress`, agrupa o conteúdo num foco só (card de números, por exemplo). */
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityValue?: AccessibilityValue;
  testID?: string;
  /** O card montado, para levar o foco do leitor de tela até ele. */
  ref?: Ref<View>;
}

/**
 * Superfície dos cards do protótipo. Opcionalmente pressável, e sem papel
 * próprio: quem chama decide o rótulo e o papel (sem papel, o pressável é
 * botão). Os filhos não recebem papel nem rótulo.
 */
export function Card({
  children,
  variant = 'default',
  highlight = false,
  padding,
  style,
  onPress,
  onLongPress,
  haptic,
  disabled,
  accessible,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  accessibilityState,
  accessibilityValue,
  testID,
  ref,
}: CardProps) {
  const surface = [
    styles.base,
    styles[variant],
    highlight && styles.highlight,
    padding !== undefined && paddingStyle(padding),
    style,
  ];

  if (onPress) {
    return (
      <PressableScale
        ref={ref}
        onPress={onPress}
        onLongPress={onLongPress}
        haptic={haptic}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityValue={accessibilityValue}
        testID={testID}
        style={surface}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View
      ref={ref}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityValue={accessibilityValue}
      testID={testID}
      style={surface}
    >
      {children}
    </View>
  );
}

// paddingVertical e paddingHorizontal vencem `padding` no React Native, então a
// troca usa os mesmos lados das variantes.
function paddingStyle(padding: CardPadding): ViewStyle {
  const value = padding === 'none' ? 0 : spacing[padding];
  return { paddingVertical: value, paddingHorizontal: value };
}

const styles = StyleSheet.create({
  base: {
    borderWidth: borderWidths.default,
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  default: {
    borderRadius: radii.lg,
    paddingVertical: spacing.cardPadding,
    paddingHorizontal: spacing.cardPadding,
  },
  large: {
    borderRadius: radii.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  compact: {
    borderRadius: radii.md,
    paddingVertical: spacing.tileGap,
    paddingHorizontal: spacing.md,
  },
  inset: {
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    paddingVertical: spacing.listGap,
    paddingHorizontal: spacing.sm,
  },
  // Sem a opacidade .5 do protótipo, que levava a meta abaixo do texto mínimo
  // (.5): o conteúdo usa `textMuted` e só a borda apaga.
  locked: {
    borderColor: colors.borderSubtle,
    borderRadius: radii.lg,
    paddingVertical: spacing.cardPadding,
    paddingHorizontal: spacing.cardPadding,
  },
  dashed: {
    backgroundColor: colors.transparent,
    borderColor: colors.borderDashed,
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    paddingVertical: spacing.cardPadding,
    paddingHorizontal: spacing.cardPadding,
  },
  // O protótipo usa lima a .35; a borda das tintas (.4) é a mais próxima.
  highlight: {
    borderColor: withAlpha(colors.points, tints.soft.border),
  },
});
