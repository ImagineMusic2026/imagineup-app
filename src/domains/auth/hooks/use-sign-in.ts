import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo, Alert } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { authErrorMessageKey, signInWithEmail } from '../api';
import type { SignInForm } from '../schemas';
import { hasAnyCentral, linkPendingGoogle, type GoogleLinkOutcome } from '../social';
import { playAuthExit } from './use-auth-exit';

/**
 * A escolha de artistas (1l) de quem entra numa conta que já existe, por
 * qualquer jeito (seção 33, decisão 11): com alguma central, o onboarding fica
 * concluído; sem nenhuma, a 1l aparece; sem a resposta em 3 s (ou sem a API),
 * vale o que o aparelho já tem.
 */
export async function settleOnboarding(uid: string): Promise<void> {
  const anyCentral = await hasAnyCentral(uid);
  const { completeOnboarding, resetOnboarding } = usePreferencesStore.getState();
  if (anyCentral === true) completeOnboarding();
  else if (anyCentral === false) resetOnboarding();
}

/**
 * O fã já está nas abas: a ligação do Google é anunciada, e a falha vira um
 * `Alert`, uma vez, sem tirar o fã da conta em que ele entrou.
 */
function tellGoogleLink(outcome: GoogleLinkOutcome | null): void {
  if (outcome === null) return;
  if (outcome === 'linked') {
    AccessibilityInfo.announceForAccessibilityWithOptions(t('auth.link.done'), { queue: true });
    return;
  }
  Alert.alert(t('auth.link.failed'), outcome === 'inUse' ? t('auth.link.inUse') : undefined, [
    { text: t('errors.ok') },
  ]);
}

/**
 * Entrar não passa pelo cache: a sessão chega pelo listener. O fã fica seguro
 * nas telas de conta até elas saírem em fade; só então o guard troca a pilha.
 * Ainda seguro, a entrada confere as centrais da conta (a 1l) e, no modo
 * "ligar", liga o Google que esbarrou nesta conta (seção 33, decisão 8).
 */
export function useSignIn() {
  return useMutation<void, Error, SignInForm>({
    mutationFn: async ({ email, password }) => {
      const release = useSessionStore.getState().holdAuth();
      let linked: GoogleLinkOutcome | null;
      try {
        const user = await signInWithEmail(email, password);
        usePreferencesStore.getState().setLastSignInMethod('password');
        [linked] = await Promise.all([linkPendingGoogle(user), settleOnboarding(user.uid)]);
        haptics.trigger('success');
        await playAuthExit();
      } finally {
        release();
      }
      tellGoogleLink(linked);
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
