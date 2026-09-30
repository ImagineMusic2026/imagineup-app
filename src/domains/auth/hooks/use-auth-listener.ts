import { useEffect } from 'react';

import { dataSource } from '@/config/env';
import { playStackExit } from '@/hooks/use-stack-fade';
import { resetFixtureSession } from '@/services/fixtures';
import { queryClient, queryPersister } from '@/services/query';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { listenToAuth } from '../api';

/**
 * Tudo o que ficou do fã que saiu: o cache do React Query (também o do disco)
 * e, no modo fixtures, o "servidor" em memória (saldo, resgates, centrais,
 * presenças, missões), que não separa um fã do outro.
 */
async function clearSessionData(): Promise<void> {
  queryClient.clear();
  if (dataSource === 'fixtures') resetFixtureSession();
  await Promise.resolve(queryPersister.removeClient()).catch(() => undefined);
}

/**
 * Mantém o store de sessão igual ao Firebase Auth. Sem sessão, o cache do React
 * Query (inclusive o salvo no aparelho) vai embora sempre, e não só num "sair"
 * dentro do app: a sessão também cai por fora (conta excluída, senha trocada),
 * e o próximo fã não pode ver dados do anterior.
 *
 * A troca de grupo na pilha raiz é seca: com as abas na tela (sair e excluir
 * a conta nos Ajustes, sessão que caiu com o app aberto), elas saem em fade
 * até o fundo escuro antes de o cache ir embora e de o guard levar à entrada,
 * que entra do escuro. Sem as abas montadas, ou com reduzir movimento, segue
 * na hora.
 *
 * Um aviso de sessão nova que chega no meio da saída vence o de saída: se for
 * de outro fã, os dados do anterior vão embora ali mesmo; se for o mesmo (o
 * Auth oscilando), o cache fica.
 */
export function useAuthListener(): void {
  useEffect(() => {
    // Cada aviso do Auth tem o seu número: uma saída que termina depois de o
    // fã entrar de novo não derruba a sessão nova.
    let latest = 0;
    return listenToAuth((user) => {
      latest += 1;
      const current = latest;
      const { setSignedIn, setSignedOut } = useSessionStore.getState();
      const { lastSessionUid, setLastSessionUid } = usePreferencesStore.getState();
      if (user) {
        // Durante a saída, o uid guardado ainda é o do fã que saiu.
        if (lastSessionUid !== null && lastSessionUid !== user.uid) void clearSessionData();
        setLastSessionUid(user.uid);
        setSignedIn(user);
        return;
      }
      // O disco é limpo antes de liberar o guard, para a restauração do
      // cache não achar os dados do fã anterior.
      void playStackExit('tabs')
        .then(() => (current === latest ? clearSessionData() : undefined))
        .finally(() => {
          if (current !== latest) return;
          setLastSessionUid(null);
          setSignedOut();
        });
    });
  }, []);
}
