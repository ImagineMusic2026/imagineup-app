import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Anuncia a mensagem ao leitor de tela cada vez que `active` passa a verdadeiro
 * (o iOS não tem live region). As telas juntam aqui as falhas de carga (home,
 * missões), num lugar só: o `EmptyState` mostra o erro e deixa o anúncio para a
 * tela. Na fila, para duas falhas juntas não se cortarem.
 */
export function useAnnounceWhen(active: boolean, message: string): void {
  useEffect(() => {
    if (active) AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  }, [active, message]);
}
