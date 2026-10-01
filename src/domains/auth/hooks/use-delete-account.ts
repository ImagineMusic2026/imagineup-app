import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';

import { deleteAccount, deleteAccountFailure, signOut, type DeleteAccountFailure } from '../api';

export interface DeleteAccountVariables {
  /** Só depois que o Firebase pediu o login recente (`needsPassword`). */
  password?: string;
}

export const DELETE_ACCOUNT_ERRORS: Record<DeleteAccountFailure, TranslationKey> = {
  needsPassword: 'deleteAccount.errors.needsPassword',
  wrongPassword: 'deleteAccount.errors.wrongPassword',
  network: 'deleteAccount.errors.network',
  tooManyRequests: 'deleteAccount.errors.tooManyRequests',
  sessionEnded: 'deleteAccount.errors.sessionEnded',
  unknown: 'deleteAccount.errors.unknown',
};

/**
 * Excluir a conta. Não entra na fila offline nem tenta de novo sozinha: o fã
 * espera a resposta, e sem rede o erro aparece na hora, com a conta como
 * estava. Deu certo, o Firebase encerra a sessão e o listener do Auth faz o
 * resto (abas em fade, cache do aparelho limpo, guard na entrada); o perfil e
 * o @ somem no servidor (`deleteUserProfile`).
 *
 * Sessão que já não existe (conta excluída em outro aparelho, token
 * revogado) sai da conta também aqui, para o guard levar à entrada.
 */
export function useDeleteAccount() {
  return useMutation<void, Error, DeleteAccountVariables>({
    mutationFn: ({ password }) => deleteAccount(password),
    networkMode: 'always',
    retry: false,
    onSuccess: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibilityWithOptions(t('deleteAccount.done'), {
        queue: true,
      });
    },
    onError: (error) => {
      const failure = deleteAccountFailure(error);
      if (failure === 'sessionEnded') signOut().catch(() => undefined);
      haptics.trigger(failure === 'needsPassword' ? 'warning' : 'error');
      // A mensagem aparece na tela; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(DELETE_ACCOUNT_ERRORS[failure]));
    },
  });
}
