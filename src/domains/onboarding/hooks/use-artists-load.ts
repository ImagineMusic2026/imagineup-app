import { useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, type HostInstance } from 'react-native';

import { useArtistsQuery } from '@/domains/artists';

export type ArtistsLoadState = 'loading' | 'error' | 'ready';

/**
 * A lista de artistas da 1l e da sheet, com o que a tela mostra. Sem cache e
 * sem rede, a consulta pausa: a tela mostra o erro, e ela volta sozinha com a
 * rede. Depois de um erro, "Tentar de novo" fica na tela, ocupado, enquanto
 * busca de novo (`retrying`): trocar pelo esqueleto tirava da tela o botão em
 * que o leitor de tela estava. (Sem dado, a busca nova tira a consulta do
 * estado de erro, então quem lembra que ela veio de um erro é a tela.)
 *
 * Lista vazia (nenhuma central publicada no painel) também é erro de
 * carregar: a 1l não teria o que escolher. Não acontece com o seed, e a API
 * só vai para as builds com as centrais da cliente no ar (UP-2).
 */
export function useArtistsLoad() {
  const artists = useArtistsQuery();
  const [retrying, setRetrying] = useState(false);
  const empty = artists.data !== undefined && artists.data.length === 0;
  const failed =
    artists.isError || artists.fetchStatus === 'paused' || (empty && !artists.isFetching);
  const state: ArtistsLoadState =
    artists.data && !empty ? 'ready' : failed || retrying ? 'error' : 'loading';

  return {
    artists: empty ? undefined : artists.data,
    state,
    // Pausada sem rede, não está buscando: o botão volta a ficar livre.
    retrying: state === 'error' && retrying && artists.fetchStatus === 'fetching',
    retry: () => {
      setRetrying(true);
      void artists.refetch().finally(() => setRetrying(false));
    },
  };
}

/**
 * Quando a lista chega depois de um erro, o "Tentar de novo" focado sai da
 * tela, e o leitor de tela ficaria sem foco. Leva o foco ao alvo (o primeiro
 * card, o campo de busca) depois de `delayMs`, o tempo de ele aparecer.
 */
export function useFocusAfterRecovery(
  state: ArtistsLoadState,
  target: RefObject<HostInstance | null>,
  delayMs = 0,
): void {
  const previous = useRef(state);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (was !== 'error' || state !== 'ready') return;
    const timer = setTimeout(() => {
      if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
    }, delayMs);
    return () => clearTimeout(timer);
  }, [state, target, delayMs]);
}
