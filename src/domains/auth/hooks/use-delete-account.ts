import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { clearBoundInvite } from '@/domains/invites';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { deleteAccountFailure, signOut, type DeleteAccountFailure } from '../api';
import { deleteAccount, type DeleteAccountOutcome, type DeleteAccountRequest } from '../social';

export const DELETE_ACCOUNT_ERRORS: Record<DeleteAccountFailure, TranslationKey> = {
  needsPassword: 'deleteAccount.errors.needsPassword',
  needsGoogle: 'deleteAccount.errors.needsGoogle',
  wrongPassword: 'deleteAccount.errors.wrongPassword',
  wrongAccount: 'deleteAccount.errors.wrongAccount',
  network: 'deleteAccount.errors.network',
  tooManyRequests: 'deleteAccount.errors.tooManyRequests',
  sessionEnded: 'deleteAccount.errors.sessionEnded',
  unknown: 'deleteAccount.errors.unknown',
};

/**
 * Excluir a conta, pelo provedor da sessão (seção 33 de
 * docs/arquitetura-api.md, decisão 12; o `deleteAccount` de `social.ts`). Não
 * entra na fila offline nem tenta de novo sozinha: o fã espera a resposta, e
 * sem rede o erro aparece na hora, com a conta como estava. A folha do Google
 * ou da Apple fechada pelo fã responde `canceled`, sem erro e sem toque. Deu
 * certo, o Firebase encerra a sessão e o listener do Auth faz o resto (abas em
 * fade, cache do aparelho limpo, guard na entrada); o perfil e o @ somem no
 * servidor (`deleteUserProfile`).
 *
 * Enquanto a exclusão corre, a marca `deletingAccount` segura o `REVOKED` da
 * conferência da Apple: a revogação vem antes do `deleteUser`, e o aviso dela
 * não pode tirar a sessão no meio. A marca sai quando a exclusão não passa (ou
 * foi cancelada); deu certo, ela sai com a sessão (`setSignedOut`).
 *
 * Sessão que já não existe (conta excluída em outro aparelho, token
 * revogado) sai da conta também aqui, para o guard levar à entrada. O convite
 * amarrado à conta excluída sai do aparelho (sair da conta não o apaga: ele
 * volta a valer se a mesma conta entrar de novo dentro do prazo), e a abertura
 * deixa de dizer o jeito da última entrada, que era desta conta.
 */
export function useDeleteAccount() {
  return useMutation<DeleteAccountOutcome, Error, DeleteAccountRequest>({
    mutationFn: async (request) => {
      const session = useSessionStore.getState();
      const uid = session.user?.uid ?? null;
      session.setDeletingAccount(true);
      let outcome: DeleteAccountOutcome = 'canceled';
      try {
        outcome = await deleteAccount(request);
      } finally {
        if (outcome !== 'deleted') useSessionStore.getState().setDeletingAccount(false);
      }
      if (outcome === 'deleted') {
        usePreferencesStore.getState().setLastSignInMethod(null);
        if (uid) await clearBoundInvite(uid).catch(() => undefined);
      }
      return outcome;
    },
    networkMode: 'always',
    retry: false,
    onSuccess: (outcome) => {
      if (outcome !== 'deleted') return;
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibilityWithOptions(t('deleteAccount.done'), {
        queue: true,
      });
    },
    onError: (error, request) => {
      // A senha errada só existe no pedido da senha (o token recusado da folha não é).
      const failure = deleteAccountFailure(error, request.kind);
      if (failure === 'sessionEnded') signOut().catch(() => undefined);
      const confirm = failure === 'needsPassword' || failure === 'needsGoogle';
      haptics.trigger(confirm ? 'warning' : 'error');
      // A mensagem aparece na tela; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(DELETE_ACCOUNT_ERRORS[failure]));
    },
  });
}
