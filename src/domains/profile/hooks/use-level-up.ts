import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

import type { Level } from '../types';

interface Celebration {
  id: number;
  level: Level;
}

/**
 * Subida de nível vista pelo fã: quando o nível que chega é maior que o que
 * a 1e já mostrava (o do cache, na abertura, ou o da última vez que ela esteve
 * em foco), toca o `levelUp`, o leitor de tela ouve "Você subiu para o nível
 * 8, Xodó." e o selo festeja (a chave devolvida muda). O primeiro nível visto
 * só fica anotado.
 *
 * Fora de foco nada acontece e o nível visto não muda: a 1e segue montada
 * quando o fã troca de aba, e o nível pode subir por lá (o "Eu vou" da
 * agenda). A festa sai uma vez, quando ele volta ao perfil.
 */
export function useLevelUp(level: Level | undefined, focused: boolean): number | null {
  const [seen, setSeen] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const played = useRef(0);

  // Reage ao nível novo no próprio render, como as missões da 1g.
  if (focused && level && level.number !== seen) {
    setSeen(level.number);
    if (seen !== null && level.number > seen) {
      setCelebration({ id: (celebration?.id ?? 0) + 1, level });
    }
  }

  // Separado da festa do selo: se o efeito rodar de novo, o fã não ouve duas vezes.
  useEffect(() => {
    if (!celebration || played.current === celebration.id) return;
    played.current = celebration.id;
    haptics.trigger('levelUp');
    AccessibilityInfo.announceForAccessibilityWithOptions(
      t('profile.level.up', { number: celebration.level.number, name: celebration.level.name }),
      { queue: true },
    );
  }, [celebration]);

  return celebration?.id ?? null;
}
