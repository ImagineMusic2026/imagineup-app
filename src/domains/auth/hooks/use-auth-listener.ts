import { useEffect } from 'react';

import { queryClient, queryPersister } from '@/services/query';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { listenToAuth } from '../api';

async function clearCachedData(): Promise<void> {
  queryClient.clear();
  await Promise.resolve(queryPersister.removeClient()).catch(() => undefined);
}

/**
 * Mantém o store de sessão igual ao Firebase Auth. Sem sessão, o cache do React
 * Query (inclusive o salvo no aparelho) vai embora sempre, e não só num "sair"
 * dentro do app: a sessão também cai por fora (conta excluída, senha trocada),
 * e o próximo fã não pode ver dados do anterior.
 */
export function useAuthListener(): void {
  useEffect(() => {
    return listenToAuth((user) => {
      const { setSignedIn, setSignedOut } = useSessionStore.getState();
      const { setLastSessionUid } = usePreferencesStore.getState();
      if (user) {
        setLastSessionUid(user.uid);
        setSignedIn(user);
        return;
      }
      // O disco é limpo antes de liberar o guard, para a restauração do
      // cache não achar os dados do fã anterior.
      void clearCachedData().finally(() => {
        setLastSessionUid(null);
        setSignedOut();
      });
    });
  }, []);
}
