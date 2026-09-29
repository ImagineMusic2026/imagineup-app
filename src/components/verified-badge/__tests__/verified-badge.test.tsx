import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { colors } from '@/theme';

import { VerifiedBadge } from '..';

function paths() {
  return screen.root.findAll((node) => node.type === Path);
}

describe('VerifiedBadge', () => {
  it('é decorativo: o "verificado" vai no rótulo de quem está em volta', () => {
    render(<VerifiedBadge />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it.each([13, 14, 20] as const)('desenha no tamanho %i', (size) => {
    render(<VerifiedBadge size={size} />);
    expect(screen.root).toHaveProp('width', size);
    expect(screen.root).toHaveProp('height', size);
  });

  it('roseta rosa com o check branco por cima', () => {
    render(<VerifiedBadge />);
    const [rosette, check] = paths();
    expect(rosette?.props.fill).toBe(colors.accent);
    expect(check?.props.stroke).toBe(colors.onAccent);
  });
});
