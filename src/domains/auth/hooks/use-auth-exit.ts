import { useEffect } from 'react';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

type ExitAnimation = () => Promise<void>;

// A saída da pilha `(auth)` montada. Só existe uma pilha de conta por vez.
let mountedExit: ExitAnimation | null = null;

// Se o guard não trocar a pilha depois da saída (sessão que caiu no meio do
// caminho), as telas de conta voltam a aparecer.
const RESTORE_AFTER_MS = 1000;

/**
 * Apaga as telas de conta até o fundo escuro e resolve quando elas somem.
 * Quem entra ou acaba de criar a conta chama isto ainda seguro no grupo
 * `(auth)` (`holdAuth`) e só solta depois: a troca de grupo na pilha raiz não
 * anima, e sem a saída a foto da 1k sumia num quadro, com um quadro vazio
 * antes da tela seguinte. Sem a pilha montada, ou com reduzir movimento,
 * resolve na hora.
 */
export function playAuthExit(): Promise<void> {
  return mountedExit ? mountedExit() : Promise.resolve();
}

/**
 * Opacidade da pilha `(auth)`: ela entra do fundo escuro quando aparece (depois
 * do splash ou de sair da conta) e sai para ele antes de o guard trocar a
 * pilha (`playAuthExit`). Com reduzir movimento, nada anima.
 */
export function useAuthStackFade() {
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    opacity.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.slow, easing: motion.easing.out }),
    );
  }, [opacity, reducedMotion]);

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
    mountedExit = exit;
    return () => {
      active = false;
      clearTimeout(restore);
      if (mountedExit === exit) mountedExit = null;
    };
  }, [opacity, reducedMotion]);

  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}
