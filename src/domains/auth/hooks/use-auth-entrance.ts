import { createContext, useContext } from 'react';

import { ALREADY_ENTERED, type StackEntrance } from '@/hooks/use-stack-fade';

/**
 * A entrada da pilha `(auth)` (`useStackFade`), que o `AuthStack` passa às
 * telas. Fora da pilha (uma tela de conta montada sozinha), já aconteceu.
 */
export const AuthEntranceContext = createContext<StackEntrance>(ALREADY_ENTERED);

/**
 * O início da entrada da pilha `(auth)`. O que entra junto com ela (a
 * sequência da 1k, as barras da marca) assina `onEnter` em vez de começar na
 * montagem: a árvore monta bem antes de aparecer, e a animação terminava por
 * trás da pilha ainda apagada.
 */
export function useAuthEntrance(): StackEntrance {
  return useContext(AuthEntranceContext);
}
