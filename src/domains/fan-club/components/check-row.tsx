import { Check } from 'lucide-react-native';
import type { Ref } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { borderWidths, colors, layout, spacing } from '@/theme';
import { selectionAccessibility } from '@/utils/selection-accessibility';

const CHECK_SIZE = 15;
const CHECK_STROKE = 3;

export interface CheckRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** O erro do campo, embaixo da linha, lido junto com o rótulo. */
  error?: string;
  disabled?: boolean;
  ref?: Ref<View>;
  testID?: string;
}

/**
 * Uma caixa de marcar da candidatura ("Tenho 18 anos ou mais" e o aceite das
 * regras): a linha toda é o alvo, com a marca redonda do rosa da escolha (a da
 * 1l). O papel vem do `selectionAccessibility`: caixa de marcar com `checked`
 * no Android, botão com `selected` no iOS, que não tem o papel. O erro entra
 * no rótulo, para o leitor ouvir junto.
 */
export function CheckRow({
  label,
  checked,
  onChange,
  error,
  disabled,
  ref,
  testID,
}: CheckRowProps) {
  const { role, state } = selectionAccessibility('multiple', checked);
  return (
    <View>
      <PressableScale
        ref={ref}
        onPress={() => onChange(!checked)}
        haptic="selection"
        disabled={disabled}
        accessibilityRole={role}
        accessibilityState={{ ...state, disabled }}
        accessibilityLabel={error ? `${label}. ${error}` : label}
        testID={testID}
        style={styles.row}
      >
        <View style={[styles.mark, checked && styles.markOn, error ? styles.markError : null]}>
          {checked ? (
            <Icon
              icon={Check}
              size={CHECK_SIZE}
              strokeWidth={CHECK_STROKE}
              color={colors.onAccent}
            />
          ) : null}
        </View>
        <Text variant="label" style={styles.label}>
          {label}
        </Text>
      </PressableScale>
      {error ? (
        <Text
          variant="caption"
          color={colors.danger}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.minTouchTarget,
  },
  mark: {
    width: layout.selectMark,
    height: layout.selectMark,
    borderRadius: layout.selectMark / 2,
    borderWidth: borderWidths.strong,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markOn: {
    backgroundColor: colors.accentStrong,
    borderColor: colors.accentStrong,
  },
  markError: {
    borderColor: colors.danger,
  },
  label: {
    flex: 1,
  },
  error: {
    marginLeft: layout.selectMark + spacing.md,
  },
});
