import { act, renderHook } from '@testing-library/react-native';

import { useArtistSelection, useIsArtistSelected } from '../hooks/use-artist-selection';

beforeEach(() => useArtistSelection.getState().clear());

describe('escolha de artistas compartilhada', () => {
  it('tocar liga e desliga, na ordem em que o fã tocou', () => {
    const { toggle } = useArtistSelection.getState();
    toggle('nenho');
    toggle('nettobrito');
    toggle('rocksalles');
    expect(useArtistSelection.getState().selectedIds).toEqual([
      'nenho',
      'nettobrito',
      'rocksalles',
    ]);

    toggle('nettobrito');
    expect(useArtistSelection.getState().selectedIds).toEqual(['nenho', 'rocksalles']);
  });

  it('a lista mudou (central que saiu do ar): fica só o que ainda está nela, na ordem', () => {
    const { toggle, retain } = useArtistSelection.getState();
    toggle('nenho');
    toggle('artista7');
    toggle('nettobrito');
    retain(['nettobrito', 'nenho', 'rocksalles']);
    expect(useArtistSelection.getState().selectedIds).toEqual(['nenho', 'nettobrito']);

    // Sem mudança, o estado é o mesmo (nenhum card renderiza de novo).
    const before = useArtistSelection.getState().selectedIds;
    retain(['nettobrito', 'nenho']);
    expect(useArtistSelection.getState().selectedIds).toBe(before);
  });

  it('limpar começa de novo', () => {
    useArtistSelection.getState().toggle('nenho');
    useArtistSelection.getState().clear();
    expect(useArtistSelection.getState().selectedIds).toEqual([]);
  });

  it('o card de um artista acompanha só a escolha dele', () => {
    const { result } = renderHook(() => useIsArtistSelected('nenho'));
    expect(result.current).toBe(false);

    act(() => useArtistSelection.getState().toggle('nenho'));
    expect(result.current).toBe(true);

    act(() => useArtistSelection.getState().toggle('nenho'));
    expect(result.current).toBe(false);
  });
});
