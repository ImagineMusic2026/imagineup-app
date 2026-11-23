import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { clearBoundInvite } from '@/domains/invites';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import {
  deleteAccount,
  deleteAccountFailure,
  signOut,
  type DeleteAccountFailure,
  type DeleteAccountOutcome,
} from '../api';
import { clearHandedOffEmail } from '../email-handoff';

export interface DeleteAccountVariables {
  /** Só depois que o Firebase pediu o login recente (`needsPassword`). */
  password?: string;
  confirmGoogle?: boolean;
}

export const DELETE_ACCOUNT_ERRORS: Record<DeleteAccountFailure, TranslationKey> = {
  needsPassword: 'deleteAccount.errors.needsPassword',
  needsGoogle: 'deleteAccount.errors.needsGoogle',
  wrongPassword: 'deleteAccount.errors.wrongPassword',
  wrongGoogleAccount: 'deleteAccount.errors.wrongGoogleAccount',
  googleUnavailable: 'deleteAccount.errors.googleUnavailable',
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
 * revogado) sai da conta também aqui, para o guard levar à entrada. O convite
 * amarrado à conta excluída sai do aparelho (sair da conta não o apaga: ele
 * volta a valer se a mesma conta entrar de novo dentro do prazo). O e-mail
 * guardado para o login (o da troca de e-mail que não chegou a entrar) também
 * sai, como no Sair: o entrar abriria na senha de uma conta que não existe mais.
 */
export function useDeleteAccount() {
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  return useMutation<DeleteAccountOutcome, Error, DeleteAccountVariables, string | null>({
    mutationFn: async ({ password, confirmGoogle }) => {
      const outcome = await deleteAccount(password, confirmGoogle, uid ?? undefined);
      if (outcome === 'canceled') return outcome;
      clearHandedOffEmail();
      if (uid) await clearBoundInvite(uid).catch(() => undefined);
      return outcome;
    },
    networkMode: 'always',
    retry: false,
    onMutate: () => uid,
    onSuccess: (outcome) => {
      if (outcome === 'canceled') return;
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibilityWithOptions(t('deleteAccount.done'), {
        queue: true,
      });
    },
    onError: (error, _variables, originatingUid) => {
      const failure = deleteAccountFailure(error);
      if (failure === 'sessionEnded') signOut(originatingUid ?? null).catch(() => undefined);
      haptics.trigger(failure === 'needsPassword' || failure === 'needsGoogle' ? 'warning' : 'error');
      // A mensagem aparece na tela; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(DELETE_ACCOUNT_ERRORS[failure]));
    },
  });
}
