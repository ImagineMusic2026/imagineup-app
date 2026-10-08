import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import type { HapticEvent } from '@/services/haptics';
import { borderWidths, colors, layout, opacities } from '@/theme';

export interface HeaderIconButtonProps {
  icon: LucideIcon;
  onPress: () => void;
  /** O que o toque faz, via `t()` ("Salvar"). */
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Apagado e sem toque (nada para salvar, sem internet). */
  disabled?: boolean;
  /** A ação andando: o indicador no lugar do ícone, e o leitor ouve que está ocupado. */
  busy?: boolean;
  haptic?: HapticEvent | null;
  testID?: string;
}

const ICON_SIZE = 20;
const ICON_STROKE = 2.2;

/**
 * Botão de ícone do lado direito do `BackHeader` (o ✓ da tela "Editar
 * perfil"): o mesmo círculo de vidro de 36 do `BackButton`, colado no fim de um
 * alvo de 44, que é o próprio pressável (no Fabric do iOS o hitSlop fora do
 * pai não recebe toque). O ícone e o indicador ficam fora do leitor; quem fala
 * é o botão.
 */
export function HeaderIconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  busy = false,
  haptic = 'tap',
  testID,
}: HeaderIconButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic}
      disabled={disabled || busy}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={busy ? { busy: true } : undefined}
      testID={testID}
      style={[styles.target, disabled && !busy && styles.inactive]}
    >
      <View style={styles.circle}>
        {busy ? (
          <ActivityIndicator
            color={colors.text}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        ) : (
          <Icon icon={icon} size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  inactive: {
    opacity: opacities.disabled,
  },
  circle: {
    width: layout.headerButtonSize,
    height: layout.headerButtonSize,
    borderRadius: layout.headerButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: borderWidths.default,
    borderColor: colors.borderGlass,
  },
});
