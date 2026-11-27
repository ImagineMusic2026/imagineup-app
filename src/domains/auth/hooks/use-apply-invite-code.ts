import { useMutation } from '@tanstack/react-query';

import { useSessionStore } from '@/stores/session';

import { applyInviteCode, type ApplyInviteOutcome } from '../invite-code';

/**
 * O "Usar o código" da tela "Código de convite" (20.18): manda o código da
 * conta da sessão e devolve o que a tela mostra. Sem retry: o incerto fica
 * com a sincronização, e o resto o fã decide.
 */
export function useApplyInviteCode() {
  return useMutation<ApplyInviteOutcome, Error, { code: string }>({
    mutationFn: async ({ code }) => {
      const uid = useSessionStore.getState().user?.uid ?? null;
      if (!uid) return { status: 'failed' };
      return applyInviteCode(uid, code);
    },
    networkMode: 'always',
    retry: false,
  });
}
