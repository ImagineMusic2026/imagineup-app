import { useCallback } from 'react';

import { haptics, type HapticEvent } from '@/services/haptics';

/** Atalho para componentes: `const playHaptic = useHaptics(); playHaptic('like')`. */
export function useHaptics(): (event: HapticEvent) => void {
  return useCallback((event: HapticEvent) => haptics.trigger(event), []);
}
