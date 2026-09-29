import { create } from 'zustand';

interface ArtistSelectionState {
  /** Na ordem em que o fã tocou. */
  selectedIds: readonly string[];
  toggle: (artistId: string) => void;
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
  clear: () => set({ selectedIds: [] }),
}));

/** O artista está escolhido. Cada card só renderiza de novo quando o dele muda. */
export function useIsArtistSelected(artistId: string): boolean {
  return useArtistSelection((state) => state.selectedIds.includes(artistId));
}
