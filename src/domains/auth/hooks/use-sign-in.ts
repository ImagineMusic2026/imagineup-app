import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

import { authErrorMessageKey, signInWithEmail } from '../api';
import type { SignInForm } from '../schemas';

/** Entrar não passa pelo cache: o resultado chega pelo listener de sessão. */
export function useSignIn() {
  return useMutation<void, Error, SignInForm>({
    mutationFn: ({ email, password }) => signInWithEmail(email, password),
    onSuccess: () => haptics.trigger('success'),
    onError: (error) => {
      haptics.trigger('error');
      // O erro aparece embaixo do botão; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(authErrorMessageKey(error)));
    },
    networkMode: 'always',
    retry: false,
  });
}
