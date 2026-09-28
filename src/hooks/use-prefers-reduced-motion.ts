import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * "Reduzir movimento" do sistema, atualizado se o usuário mudar a opção com o
 * app aberto (o hook do Reanimated só lê na abertura).
 */
export function usePrefersReducedMotion(): boolean {
  const atLaunch = useReducedMotion();
  const [enabled, setEnabled] = useState(atLaunch);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setEnabled(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
