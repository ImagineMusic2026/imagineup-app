import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Pill, type PillProps } from '@/components/pill';
import { PressableScale } from '@/components/pressable-scale';
import type { HapticEvent } from '@/services/haptics';
import { layout, opacities } from '@/theme';

export interface PillButtonProps extends Omit<
  PillProps,
  'accessibilityLabel' | 'style' | 'testID'
> {
  onPress: () => void;
  haptic?: HapticEvent | null;
  disabled?: boolean;
  /** Estado ligado para o leitor de tela, como o curtir do post. */
  selected?: boolean;
  /**
   * O que o toque faz, via `t()`, quando o texto da pílula não basta: "4.812"
   * vira "4.812 curtidas". Sem ele, o leitor ouve o texto da pílula.
   */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Vai no alvo de toque (margem, `alignSelf`), não na pílula. */
  style?: StyleProp<ViewStyle>;
  /** Vai no desenho da pílula, como o padding mais largo do compartilhar do post. */
  pillStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Pílula tocável: chips da 1b e curtir, comentar e compartilhar do post. A
 * pílula desenha 24 a 34 pt; o pressável em volta cresce até 44 e leva o papel
 * e o rótulo, e a pílula por dentro fica sem papel próprio.
 */
export function PillButton({
  onPress,
  haptic = 'tap',
  disabled = false,
  selected,
  accessibilityLabel,
  accessibilityHint,
  style,
  pillStyle,
  testID,
  ...pill
}: PillButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? pill.label}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      testID={testID}
      style={[styles.target, disabled && styles.inactive, style]}
    >
      <Pill {...pill} style={pillStyle} />
    </PressableScale>
  );
}

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
});
