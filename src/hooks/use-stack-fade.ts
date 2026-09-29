import { useEffect, useRef } from 'react';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';

import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

/**
 * Grupos da pilha raiz que entram do fundo escuro: as telas de conta
 * (`(auth)`), a escolha de artistas (`(onboarding)`) e as abas (`(tabs)`). As
 * duas primeiras também saem para ele (`playStackExit`) antes de o guard
 * trocar de grupo; as abas só entram (depois do splash, da 1l ou de entrar).
 */
export type FadingStack = 'auth' | 'onboarding' | 'tabs';

type ExitAnimation = () => Promise<void>;

// A saída de cada pilha montada. Só existe uma pilha de cada grupo por vez.
const mountedExits = new Map<FadingStack, ExitAnimation>();

// Se o guard não trocar a pilha depois da saída (sessão que caiu no meio do
// caminho, ação que não deu certo), a pilha volta a aparecer.
const RESTORE_AFTER_MS = 1000;

/**
 * Apaga a pilha até o fundo escuro e resolve quando ela some. A troca de grupo
 * na pilha raiz (`Stack.Protected`) não anima: quem vai trocar de grupo chama
 * isto antes de mudar o estado que o guard lê, para a tela sair em fade em vez
 * de sumir num quadro. Sem a pilha montada, ou com reduzir movimento, resolve
 * na hora.
 */
export function playStackExit(stack: FadingStack): Promise<void> {
  const exit = mountedExits.get(stack);
  return exit ? exit() : Promise.resolve();
}

/**
 * Opacidade da pilha (`style`): ela entra do fundo escuro quando aparece
 * (depois do splash ou de outra pilha sair) e sai para ele em
 * `playStackExit`. Com reduzir movimento, nada anima.
 *
 * A entrada começa no primeiro `onLayout` do contêiner, e não na montagem: a
 * árvore de um grupo inteiro leva um tempo entre montar e aparecer (no
 * emulador, 150 ms na abertura e mais na ida da 1l para as abas), e o fade
 * que começava antes já estava quase no fim no primeiro quadro visível.
 */
export function useStackFade(stack: FadingStack) {
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const entered = useRef(false);

  // Reduzir movimento ligado com a pilha já montada: ela fica inteira na hora.
  useEffect(() => {
    if (reducedMotion) opacity.set(1);
  }, [opacity, reducedMotion]);

  const onLayout = (): void => {
    if (entered.current) return;
    entered.current = true;
    opacity.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.slow, easing: motion.easing.out }),
    );
  };

  useEffect(() => {
    let active = true;
    let restore: ReturnType<typeof setTimeout> | undefined;
    const exit: ExitAnimation = () => {
      if (reducedMotion) return Promise.resolve();
      opacity.set(withTiming(0, { duration: motion.duration.base, easing: motion.easing.inOut }));
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve();
          if (!active) return;
          restore = setTimeout(() => {
            if (active) opacity.set(withTiming(1, { duration: motion.duration.base }));
          }, RESTORE_AFTER_MS);
        }, motion.duration.base);
      });
    };
    mountedExits.set(stack, exit);
    return () => {
      active = false;
      clearTimeout(restore);
      if (mountedExits.get(stack) === exit) mountedExits.delete(stack);
    };
  }, [opacity, reducedMotion, stack]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return { style, onLayout };
}
