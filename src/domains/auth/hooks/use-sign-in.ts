import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo, Alert } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { authErrorMessageKey, signInWithEmail } from '../api';
import { linkPendingGoogle, type GoogleLinkOutcome } from '../google-entry';
import type { SignInForm } from '../schemas';
import { playAuthExit } from './use-auth-exit';

/**
 * O aviso que acompanha a senha recusada onde não há o botão do Google (o
 * iPhone). A conta que só entra com o Google não tem senha, e a recusa sozinha
 * ("E-mail ou senha incorretos.") não mostra a saída: o "Esqueci minha senha"
 * manda o link também a essa conta e cria a senha dela, na mesma conta
 * (conferido em produção pelo dono em 23/11/2026). Criar a senha pelo link
 * encerra as sessões dos outros aparelhos. O texto não cita outra plataforma,
 * pela diretriz 2.3.10 da App Store.
 *
 * `shown` diz se a tela tem lugar para o aviso agora: sem o botão do Google,
 * na pergunta da senha e sem pedido do link em curso ou respondido. O que a
 * tela mostra e o que o leitor de tela ouve saem desta mesma conta.
 */
export function googleOnlyHint(errorKey: TranslationKey | null, shown: boolean): string | null {
  if (!shown || errorKey !== 'auth.errors.invalidCredentials') return null;
  return t('auth.signIn.googleOnlyHint', { action: t('auth.signIn.forgot') });
}

type SignInOptions = {
  /**
   * A tela tem lugar agora para o aviso da conta que só entra com o Google
   * (`googleOnlyHint`). Vale o valor do render mais recente: o TanStack Query
   * passa as opções novas à mutação que ainda anda, e o `onError` lê o valor
   * da hora do erro.
   */
  googleOnlyHintShown: boolean;
};

/**
 * Entrar não passa pelo cache: a sessão chega pelo listener. O fã fica seguro
 * nas telas de conta até elas saírem em fade; só então o guard troca a pilha.
 */
export function useSignIn({ googleOnlyHintShown }: SignInOptions) {
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
      const key = authErrorMessageKey(error);
      const hint = googleOnlyHint(key, googleOnlyHintShown);
      // O erro aparece na tela; o leitor de tela precisa ouvir também, num
      // anúncio só, com o aviso da conta que só entra com o Google quando a
      // tela também o mostra.
      AccessibilityInfo.announceForAccessibility(hint ? `${t(key)} ${hint}` : t(key));
    },
    networkMode: 'always',
    retry: false,
  });
}
