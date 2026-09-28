import { useEffect } from 'react';

import { queryClient, queryPersister } from '@/services/query';
import { useSessionStore } from '@/stores/session';

import { listenToAuth } from '../api';

/**
 * Mantém o store de sessão igual ao Firebase Auth. Quando alguém sai, o cache
 * do React Query (inclusive o salvo no aparelho) vai junto, para o próximo fã
 * não ver dados do anterior.
 */
export function useAuthListener(): void {
  useEffect(() => {
    let previousUid: string | null = null;
    return listenToAuth((user) => {
      const { setSignedIn, setSignedOut } = useSessionStore.getState();
      if (user) {
        previousUid = user.uid;
        setSignedIn(user);
        return;
      }
      if (previousUid) {
        queryClient.clear();
        Promise.resolve(queryPersister.removeClient()).catch(() => undefined);
      }
      previousUid = null;
      setSignedOut();
    });
  }, []);
}
