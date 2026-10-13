import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';

import { changeEmailFailure, requestEmailChange, signOut, type ChangeEmailFailure } from '../api';
import { handOffEmail } from '../email-handoff';

export interface ChangeEmailVariables {
  /** O e-mail novo, já normalizado pelo schema. */
  email: string;
  /** A senha atual, para reautenticar. */
  password: string;
}

export const CHANGE_EMAIL_ERRORS: Record<ChangeEmailFailure, TranslationKey> = {
  wrongPassword: 'deleteAccount.errors.wrongPassword',
  emailInUse: 'changeEmail.errors.emailInUse',
  invalidEmail: 'validation.emailInvalid',
  notAllowed: 'changeEmail.errors.notAllowed',
  tooManyRequests: 'auth.errors.tooManyRequests',
  network: 'auth.errors.network',
  sessionEnded: 'changePassword.errors.sessionEnded',
  unknown: 'changeEmail.errors.unknown',
};

/**
 * Pedir a troca do e-mail (seção 29, frente D), no molde da exclusão da conta
 * (sem fila offline, sem nova tentativa sozinha). Deu certo, o e-mail novo
 * fica guardado em memória para o login (`handOffEmail`): quando o fã abre o
 * link, a sessão cai sozinha com o app aberto, e a entrada já vem com ele. O
 * "Sair" de dentro do app limpa, porque antes do link o e-mail novo ainda não
 * entra.
 */
export function useChangeEmail() {
  return useMutation<void, Error, ChangeEmailVariables>({
    mutationFn: ({ email, password }) => requestEmailChange(password, email),
    networkMode: 'always',
    retry: false,
    onSuccess: (_data, { email }) => {
      handOffEmail(email);
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(t('changeEmail.sentAnnounce', { email }));
    },
    onError: (error) => {
      const failure = changeEmailFailure(error);
      if (failure === 'sessionEnded') signOut().catch(() => undefined);
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(CHANGE_EMAIL_ERRORS[failure]));
    },
  });
}
