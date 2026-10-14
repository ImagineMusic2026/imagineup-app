import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';

import { changePassword, changePasswordFailure, signOut, type ChangePasswordFailure } from '../api';

export interface ChangePasswordVariables {
  current: string;
  next: string;
}

/** As frases que a troca de senha já dividia com a entrada e a exclusão da conta são as mesmas. */
export const CHANGE_PASSWORD_ERRORS: Record<ChangePasswordFailure, TranslationKey> = {
  wrongPassword: 'deleteAccount.errors.wrongPassword',
  weakPassword: 'auth.errors.weakPassword',
  tooManyRequests: 'auth.errors.tooManyRequests',
  network: 'auth.errors.network',
  sessionEnded: 'changePassword.errors.sessionEnded',
  unknown: 'changePassword.errors.unknown',
};

/**
 * Trocar a senha (seção 29, frente D), no molde da exclusão da conta: não
 * entra na fila offline nem tenta de novo sozinha, e o fã espera a resposta.
 * Deu certo, anuncia e toca o sucesso; a tela volta. A sessão que já tinha
 * caído sai da conta também aqui, para o guard levar à entrada.
 */
export function useChangePassword() {
  return useMutation<void, Error, ChangePasswordVariables>({
    mutationFn: ({ current, next }) => changePassword(current, next),
    networkMode: 'always',
    retry: false,
    onSuccess: () => {
      haptics.trigger('success');
      // A tela fecha logo depois: o anúncio vai na fila, para a troca de tela não cortá-lo.
      AccessibilityInfo.announceForAccessibilityWithOptions(t('changePassword.done'), {
        queue: true,
      });
    },
    onError: (error) => {
      const failure = changePasswordFailure(error);
      if (failure === 'sessionEnded') signOut().catch(() => undefined);
      haptics.trigger('error');
      // A mensagem aparece na tela; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(CHANGE_PASSWORD_ERRORS[failure]));
    },
  });
}
