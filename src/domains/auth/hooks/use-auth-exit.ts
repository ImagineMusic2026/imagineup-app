import { playStackExit, useStackFade } from '@/hooks/use-stack-fade';

/**
 * Apaga as telas de conta até o fundo escuro e resolve quando elas somem.
 * Quem entra ou acaba de criar a conta chama isto ainda seguro no grupo
 * `(auth)` (`holdAuth`) e só solta depois: a troca de grupo na pilha raiz não
 * anima, e sem a saída a foto da 1k sumia num quadro, com um quadro vazio
 * antes da tela seguinte. Sem a pilha montada, ou com reduzir movimento,
 * resolve na hora.
 */
export function playAuthExit(): Promise<void> {
  return playStackExit('auth');
}

/**
 * Opacidade da pilha `(auth)` (`style`, com o `onLayout` que começa a entrada):
 * ela entra do fundo escuro quando aparece (depois do splash ou de sair da
 * conta) e sai para ele antes de o guard trocar a pilha (`playAuthExit`). Com
 * reduzir movimento, nada anima.
 */
export function useAuthStackFade() {
  return useStackFade('auth');
}
