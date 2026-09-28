import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import type { HapticEvent } from '@/services/haptics';
import { colors, radii, shadows, spacing } from '@/theme';

export type ButtonVariant = 'primary' | 'points' | 'secondary' | 'ghost';
export type ButtonSize = 'lg' | 'md';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  haptic?: HapticEvent | null;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

const foreground: Record<ButtonVariant, string> = {
  primary: colors.onAccent,
  points: colors.onPoints,
  secondary: colors.text,
  ghost: colors.text,
};

/** Botão de ação: rosa para ação, lima só quando o assunto é ponto. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading = false,
  disabled = false,
  haptic = 'tap',
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const color = foreground[variant];
  const inactive = disabled || loading;

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      haptic={haptic}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: loading, disabled: inactive }}
      style={[styles.base, styles[size], styles[variant], inactive && styles.inactive, style]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon icon={icon} size={18} color={color} strokeWidth={2.2} /> : null}
          <Text variant={size === 'lg' ? 'button' : 'buttonSmall'} color={color}>
            {label}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lg: {
    minHeight: 50,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.cta,
  },
  md: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
  },
  primary: {
    // O CTA do protótipo usa #FF2D6F com texto branco (3,59:1, reprova AA).
    // accentStrong mantém o tom e passa em contraste.
    backgroundColor: colors.accentStrong,
    ...shadows.glowAccent,
  },
  points: {
    backgroundColor: colors.points,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.borderGlass,
  },
  inactive: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
