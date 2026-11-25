import { AppleAuthenticationCredentialState } from 'expo-apple-authentication';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { isFirebaseConfigured } from '@/firebase';
import {
  appleCredentialState,
  appleSignInAvailability,
  onAppleRevoked,
} from '@/services/apple-sign-in';
import { useSessionStore } from '@/stores/session';

import { signOut } from '../api';
import { currentAppleUid, settleSessionAppleName, signsOutOnRevoke } from '../apple-entry';
import { clearHandedOffEmail } from '../email-handoff';

function warnName(error: unknown): void {
  if (__DEV__) console.warn('[auth] O nome da Apple não foi para o perfil na sessão.', error);
}

/**
 * A Apple em cada sessão confirmada (seção 39 de docs/arquitetura-api.md),
 * montado no `_layout.tsx` raiz logo depois do `useAuthListener`:
 *
 * - **A disponibilidade**, uma vez por abertura, no iPhone: o botão da Apple já
 *   nasce no primeiro quadro das telas de conta (`useAppleEntry`).
 * - **O nome guardado da Apple**, em toda sessão, por qualquer jeito de entrar:
 *   com o app fechado no meio da primeira entrada, a sessão ficou salva e não
 *   há entrada seguinte (`settleSessionAppleName`). Espera o fã sair das telas
 *   de conta: enquanto a entrada o segura, ela cuida do nome.
 * - **A conferência da credencial**, só no iPhone e só com a Apple no
 *   `providerData` da conta: o estado na abertura e a cada aviso de revogação.
 *   O estado não pede o token. Só o `REVOKED` tira a sessão, nunca com a
 *   exclusão da conta em andamento (a revogação dela vem antes do
 *   `deleteUser`), e só a sessão da Apple (`signsOutOnRevoke`): a sessão de
 *   senha com a Apple ligada fica. O erro (a rede) não faz nada.
 */
export function useAppleCredentialCheck(): void {
  // Só a sessão confirmada pelo Auth: a presumida da abertura ainda não tem a conta.
  const uid = useSessionStore((state) =>
    state.status === 'signedIn' ? (state.user?.uid ?? null) : null,
  );
  const held = useSessionStore((state) => state.authHolds > 0);

  // A disponibilidade da Apple, uma vez por abertura: o botão nasce no primeiro quadro das telas de conta.
  useEffect(() => {
    if (Platform.OS === 'ios' && isFirebaseConfigured) void appleSignInAvailability();
  }, []);

  // O nome guardado da Apple, em toda sessão; enquanto a entrada segura o fã, ela cuida do nome.
  useEffect(() => {
    if (!isFirebaseConfigured || uid === null || held) return;
    void settleSessionAppleName(uid).catch(warnName);
  }, [uid, held]);

  // A credencial: o estado não pede o token; quem decide se a sessão é da Apple é o signsOutOnRevoke.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isFirebaseConfigured || uid === null) return undefined;
    const appleUid = currentAppleUid(uid);
    if (appleUid === null) return undefined;
    let active = true;
    const check = async (): Promise<void> => {
      const state = await appleCredentialState(appleUid);
      if (!active || state !== AppleAuthenticationCredentialState.REVOKED) return;
      if (useSessionStore.getState().deletingAccount) return;
      if (!(await signsOutOnRevoke(uid))) return;
      const session = useSessionStore.getState();
      if (!active || session.deletingAccount || session.user?.uid !== uid) return;
      clearHandedOffEmail();
      await signOut(uid).catch(() => undefined);
    };
    void check();
    const stop = onAppleRevoked(() => void check());
    return () => {
      active = false;
      stop();
    };
  }, [uid]);
}
