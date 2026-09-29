import { act, renderHook } from '@testing-library/react-native';

import { useArtistSelection, useIsArtistSelected } from '../hooks/use-artist-selection';

beforeEach(() => useArtistSelection.getState().clear());

describe('escolha de artistas compartilhada', () => {
  it('tocar liga e desliga, na ordem em que o fã tocou', () => {
    const { toggle } = useArtistSelection.getState();
    toggle('nenho');
    toggle('netto-brito');
    toggle('rock-salles');
    expect(useArtistSelection.getState().selectedIds).toEqual([
      'nenho',
      'netto-brito',
      'rock-salles',
    ]);

    toggle('netto-brito');
    expect(useArtistSelection.getState().selectedIds).toEqual(['nenho', 'rock-salles']);
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
