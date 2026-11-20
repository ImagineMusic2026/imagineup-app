import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';

import { authErrorMessageKey, sendPasswordReset } from '../api';

/**
 * "Esqueci minha senha": manda o link para o e-mail digitado. A resposta é a
 * mesma exista a conta ou não, para a tela não revelar quem tem conta.
 *
 * `sentKey` é a frase anunciada quando o pedido sai, a mesma que a tela mostra:
 * a longa na "Trocar senha" (o padrão) e a curta no entrar com e-mail, que a
 * põe acima do pé da pergunta.
 */
export function usePasswordReset(sentKey: TranslationKey = 'auth.signIn.resetSent') {
  return useMutation<void, Error, string>({
    mutationFn: (email) => sendPasswordReset(email),
    onSuccess: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(t(sentKey));
    },
    onError: (error) => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(authErrorMessageKey(error, 'passwordReset')));
    },
    networkMode: 'always',
    retry: false,
  });
}
