import { Eye, EyeOff } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import type { TextInput as NativeTextInput } from 'react-native';

import { TextInput, TextInputAction, type TextInputProps } from '@/components/text-input';
import { t } from '@/i18n';

export type PasswordFieldProps = Omit<TextInputProps, 'secureTextEntry' | 'trailing' | 'variant'>;

/**
 * Campo de senha das telas de conta, com o olho para mostrar e esconder. O
 * rótulo do olho diz o que o toque faz, e muda com o estado.
 */
export const PasswordField = forwardRef<NativeTextInput, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <TextInput
        ref={ref}
        {...props}
        variant="glass"
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        trailing={
          <TextInputAction
            icon={visible ? EyeOff : Eye}
            onPress={() => setVisible((current) => !current)}
            accessibilityLabel={t(visible ? 'auth.hidePassword' : 'auth.showPassword')}
          />
        }
      />
    );
  },
);
