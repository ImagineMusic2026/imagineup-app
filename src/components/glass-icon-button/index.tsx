import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';

import { Glass, type GlassTone } from '@/components/glass';
import { Glyph, type GlyphName } from '@/components/glyph';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import type { HapticEvent } from '@/services/haptics';
import { colors, layout, opacities } from '@/theme';

/** Um ícone do lucide ou um desenho cheio do `Glyph` (a seta de compartilhar). */
type GlassIconButtonArt = { icon: LucideIcon; glyph?: never } | { glyph: GlyphName; icon?: never };

export type GlassIconButtonProps = GlassIconButtonArt & {
  onPress: () => void;
  /** O que o toque faz, via `t()` ("Voltar", "Compartilhar", "Mais opções"). */
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Como o `expanded` do menu "mais". */
  accessibilityState?: AccessibilityState;
  haptic?: HapticEvent | null;
  disabled?: boolean;
  /** `dark` sobre a capa da 1d; `darkStrong` sobre foto clara. */
  tone?: GlassTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// Ícone de 17 dentro do círculo de 38, como na capa da 1d.
const ICON_SIZE = 17;

/**
 * Botão redondo de vidro sobre foto (voltar, compartilhar e mais da capa da
 * 1d). O círculo de 38 fica no centro de um pressável de 44, que leva o papel e
 * o rótulo; vidro e ícone não recebem foco.
 */
export function GlassIconButton({
  icon,
  glyph,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  haptic = 'tap',
  disabled = false,
  tone = 'dark',
  style,
  testID,
}: GlassIconButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      testID={testID}
      style={[styles.target, disabled && styles.inactive, style]}
    >
      <Glass tone={tone} strength="glass" radius={layout.coverButtonSize / 2} style={styles.circle}>
        {glyph ? (
          <Glyph name={glyph} size={ICON_SIZE} color={colors.text} />
        ) : icon ? (
          <Icon icon={icon} size={ICON_SIZE} strokeWidth={2.2} />
        ) : null}
      </Glass>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: layout.coverButtonSize,
    height: layout.coverButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: {
    opacity: opacities.disabled,
  },
});
