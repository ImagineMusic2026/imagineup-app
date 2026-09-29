import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

import { authErrorMessageKey, sendPasswordReset } from '../api';

/**
 * "Esqueci minha senha": manda o link para o e-mail digitado. A resposta é a
 * mesma exista a conta ou não, para a tela não revelar quem tem conta.
 */
export function usePasswordReset() {
  return useMutation<void, Error, string>({
    mutationFn: (email) => sendPasswordReset(email),
    onSuccess: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(t('auth.signIn.resetSent'));
    },
    onError: (error) => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(authErrorMessageKey(error, 'passwordReset')));
    },
    networkMode: 'always',
    retry: false,
  });
}
