import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo, Alert } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { authErrorMessageKey, signInWithEmail } from '../api';
import { linkPendingGoogle, type GoogleLinkOutcome } from '../google-entry';
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
      let linked: GoogleLinkOutcome | null;
      try {
        const user = await signInWithEmail(email, password);
        linked = await linkPendingGoogle(user);
        haptics.trigger('success');
        await playAuthExit();
      } finally {
        release();
      }
      if (linked === 'linked') {
        AccessibilityInfo.announceForAccessibilityWithOptions(t('auth.google.linked'), { queue: true });
      } else if (linked === 'failed') {
        Alert.alert(t('auth.google.linkFailed'), t('auth.google.linkFailedDetails'));
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
