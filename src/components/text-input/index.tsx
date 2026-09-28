import { forwardRef, useState } from 'react';
import {
  TextInput as NativeTextInput,
  StyleSheet,
  View,
  type TextInputProps as NativeTextInputProps,
} from 'react-native';

import { Text } from '@/components/text';
import { colors, fonts, radii, spacing } from '@/theme';

export interface TextInputProps extends Omit<NativeTextInputProps, 'style'> {
  label: string;
  error?: string;
}

/** Campo de formulário com rótulo visível e erro anunciado pelo leitor de tela. */
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  { label, error, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      <Text variant="labelSmall" color={colors.textSecondary}>
        {label}
      </Text>
      <NativeTextInput
        ref={ref}
        {...props}
        accessibilityLabel={label}
        accessibilityHint={error}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, focused && styles.focused, !!error && styles.invalid]}
      />
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs + 2,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontFamily: fonts.manropeMedium,
    fontSize: 15,
  },
  focused: {
    borderColor: colors.accent,
  },
  invalid: {
    borderColor: colors.danger,
  },
});
