import type { Ref } from 'react';
import {
  StyleSheet,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';

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
  /**
   * O segurar, como o da reação do fã-clube (seção 37, 37.9): o toque longo
   * não dispara o `onPress`. O toque do evento fica com quem chama.
   */
  onLongPress?: () => void;
  /** Quanto o dedo segura antes do `onLongPress`, em ms (o padrão do RN é 500). */
  delayLongPress?: number;
  /**
   * As ações do leitor de tela, que alcançam o que o segurar faz (o
   * `longpress` com o rótulo, uma ação por opção), no molde do carrossel da
   * apresentação do fã-clube.
   */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  /** O pressável de fora, para levar o foco do leitor de volta a ele. */
  ref?: Ref<View>;
  /** Vai no alvo de toque (margem, `alignSelf`), não na pílula. */
  style?: StyleProp<ViewStyle>;
  /** Vai no desenho da pílula, como o padding mais largo do compartilhar do post. */
  pillStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Pílula tocável: chips da 1b e curtir, comentar e compartilhar do post. A
 * pílula desenha 24 a 34 pt; o pressável em volta cresce até 44 e leva o papel
 * e o rótulo, e a pílula por dentro fica sem papel próprio. Desde a Fase 2 do
 * fã-clube, repassa o segurar, as ações do leitor de tela e o `ref`.
 */
export function PillButton({
  onPress,
  haptic = 'tap',
  disabled = false,
  selected,
  accessibilityLabel,
  accessibilityHint,
  onLongPress,
  delayLongPress,
  accessibilityActions,
  onAccessibilityAction,
  ref,
  style,
  pillStyle,
  testID,
  ...pill
}: PillButtonProps) {
  return (
    <PressableScale
      ref={ref}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      haptic={haptic}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? pill.label}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
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
