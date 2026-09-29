import { useEffect, useRef } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

/**
 * De 0 (o saldo cobre: quadro colorido e preço lima) a 1 (fora do alcance:
 * vidro e contorno). Quando o saldo muda com o card na tela (depois de um
 * resgate, ao puxar para atualizar), a troca anda em 250 ms, sem salto. A
 * montagem já nasce no estado certo, e a célula que a FlashList reaproveita
 * para outra recompensa vai direto ao estado dela; com reduzir movimento,
 * sempre direto.
 */
export function useMutedProgress(rewardId: string, muted: boolean): SharedValue<number> {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(muted ? 1 : 0);
  const shown = useRef({ rewardId, muted });

  useEffect(() => {
    const previous = shown.current;
    if (previous.rewardId === rewardId && previous.muted === muted) return;
    shown.current = { rewardId, muted };
    const target = muted ? 1 : 0;
    const jump = reducedMotion || previous.rewardId !== rewardId;
    progress.set(
      jump
        ? target
        : withTiming(target, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [muted, rewardId, reducedMotion, progress]);

  return progress;
}
