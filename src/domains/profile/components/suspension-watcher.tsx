import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { showRefusalAlert } from '@/services/refusal-alert';
import { useSuspensionStore } from '@/stores/suspension';

import { profileKeys } from '../keys';

/**
 * Escuta as recusas de conta suspensa que o `MutationCache` anota
 * (`stores/suspension.ts`): a cada uma, o perfil do fã busca de novo (o aviso
 * fixo da 1b, da 1e e dos Ajustes aparece com o `suspendedAt` e o motivo) e,
 * quando a recusa pede (curtir, "Eu vou", entrar e seguir na 1l, que não têm
 * texto na tela), abre o `Alert` "Conta suspensa", no máximo um a cada 30 s.
 * Com a trava segurando o `Alert`, o hook da ação anuncia a frase do suspenso
 * (`alertActionRefusal`, em `services/refusal-alert.ts`).
 *
 * Montado no `AppProviders`, dentro do provedor do Query; o teste da
 * suspensão renderiza o mesmo componente na árvore dele (nenhum teste carrega
 * o `_layout.tsx` de verdade). Não desenha nada.
 */
export function SuspensionWatcher() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      useSuspensionStore.subscribe((state, previous) => {
        if (state.refusals <= previous.refusals) return;
        void queryClient.invalidateQueries({ queryKey: [...profileKeys.all, 'me'] });
        if (state.alerts > previous.alerts) showRefusalAlert('suspended');
      }),
    [queryClient],
  );

  return null;
}
