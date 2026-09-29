import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { authErrorMessageKey, signInWithEmail } from '../api';
import type { SignInForm } from '../schemas';
import { playAuthExit } from './use-auth-exit';

/**
 * Entrar não passa pelo cache: a sessão chega pelo listener. O fã fica seguro
 * nas telas de conta até elas saírem em fade; só então o guard troca a pilha.
 */
export function useSignIn() {
  return useMutation<void, Error, SignInForm>({
    mutationFn: async ({ email, password }) => {
      const release = useSessionStore.getState().holdAuth();
      try {
        await signInWithEmail(email, password);
        haptics.trigger('success');
        await playAuthExit();
      } finally {
        release();
      }
    },
    onError: (error) => {
      haptics.trigger('error');
      // O erro aparece embaixo do botão; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(authErrorMessageKey(error)));
    },
    networkMode: 'always',
    retry: false,
  });
}
