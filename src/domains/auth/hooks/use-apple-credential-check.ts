import { AppleAuthenticationCredentialState } from 'expo-apple-authentication';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { appleCredentialState, onAppleRevoked } from '@/services/apple-sign-in';
import { useSessionStore } from '@/stores/session';

import { currentAppleUid, settleSessionAppleName } from '../social';
import { useSessionMethod } from './use-session-method';
import { signOutOfApp } from './use-sign-out';

function warnName(error: unknown): void {
  if (__DEV__) console.warn('[auth] O nome da Apple não foi para o perfil na sessão.', error);
}

/**
 * A Apple no início de cada sessão confirmada (seção 33 de
 * docs/arquitetura-api.md, decisões 6 e 9), montado no `_layout.tsx` raiz junto
 * do `useAuthListener`:
 *
 * - **O nome guardado da Apple**, em toda sessão, por qualquer jeito de entrar:
 *   com o app fechado no meio da primeira entrada, a sessão ficou salva e não
 *   há entrada seguinte (`settleSessionAppleName`). Espera o fã sair das telas
 *   de conta: enquanto ele está seguro, a própria entrada cuida do nome.
 * - **A conferência da credencial**, só no iOS e só com a sessão aberta pela
 *   Apple (o provedor da sessão, e não a Apple no `providerData`: a conta com
 *   a Apple e o Google que entrou pelo Google não sai por causa da Apple). O
 *   estado na abertura e a cada aviso de revogação: só o `REVOKED` tira a
 *   sessão, nunca com a exclusão da conta em andamento (a revogação dela vem
 *   antes do `deleteUser`); o erro (o simulador, a rede) não faz nada.
 */
export function useAppleCredentialCheck(): void {
  // Só a sessão confirmada pelo Auth: a presumida da abertura ainda não tem a conta.
  const uid = useSessionStore((state) =>
    state.status === 'signedIn' ? (state.user?.uid ?? null) : null,
  );
  const held = useSessionStore((state) => state.authHolds > 0);
  const method = useSessionMethod();
  const appleSession = Platform.OS === 'ios' && method === 'apple';

  useEffect(() => {
    if (uid === null || held) return;
    void settleSessionAppleName(uid).catch(warnName);
  }, [uid, held]);

  useEffect(() => {
    if (uid === null || !appleSession) return undefined;
    let active = true;
    const check = async (): Promise<void> => {
      const appleUid = currentAppleUid(uid);
      if (!appleUid) return;
      const state = await appleCredentialState(appleUid);
      if (!active || state !== AppleAuthenticationCredentialState.REVOKED) return;
      const session = useSessionStore.getState();
      if (session.deletingAccount || session.user?.uid !== uid) return;
      await signOutOfApp().catch(() => undefined);
    };
    void check();
    const stop = onAppleRevoked(() => void check());
    return () => {
      active = false;
      stop();
    };
  }, [uid, appleSession]);
}
