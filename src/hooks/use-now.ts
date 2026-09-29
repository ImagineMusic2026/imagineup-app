import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

const MINUTE_MS = 60_000;

/**
 * A hora de agora, atualizada a cada `intervalMs` (um minuto por padrão) e na
 * volta do app para a frente, para contagens como "termina em 4 h" andarem
 * sozinhas. Com o app em segundo plano o relógio do JS para, e a volta corrige.
 */
export function useNow(intervalMs: number = MINUTE_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const timer = setInterval(tick, intervalMs);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs]);

  return now;
}
