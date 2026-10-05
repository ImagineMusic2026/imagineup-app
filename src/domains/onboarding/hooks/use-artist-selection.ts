import { create } from 'zustand';

interface ArtistSelectionState {
  /** Na ordem em que o fã tocou. */
  selectedIds: readonly string[];
  toggle: (artistId: string) => void;
  /**
   * Fica só com os ids da lista: a central que saiu do ar (a lista buscou de
   * novo depois de a 1l recusar) sai da escolha. Sem mudança, nada muda.
   */
  retain: (artistIds: readonly string[]) => void;
  clear: () => void;
}

/**
 * Artistas escolhidos na 1l. Fica num store, e não no estado da tela, porque a
 * sheet de todos os artistas é outra rota e escolhe na mesma lista: o contador
 * do botão lá atrás já volta certo. Estado do cliente, sem persistir; a tela
 * limpa quando sai.
 */
export const useArtistSelection = create<ArtistSelectionState>()((set) => ({
  selectedIds: [],
  toggle: (artistId) =>
    set(({ selectedIds }) => ({
      selectedIds: selectedIds.includes(artistId)
        ? selectedIds.filter((id) => id !== artistId)
        : [...selectedIds, artistId],
    })),
  retain: (artistIds) =>
    set((state) => {
      const known = new Set(artistIds);
      const kept = state.selectedIds.filter((id) => known.has(id));
      return kept.length === state.selectedIds.length ? state : { selectedIds: kept };
    }),
  clear: () => set({ selectedIds: [] }),
}));

/** O artista está escolhido. Cada card só renderiza de novo quando o dele muda. */
export function useIsArtistSelected(artistId: string): boolean {
  return useArtistSelection((state) => state.selectedIds.includes(artistId));
}
