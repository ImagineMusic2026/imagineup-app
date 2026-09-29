import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Logo } from '..';

describe('Logo', () => {
  it('é decorativo: o leitor de tela não para nele', () => {
    render(<Logo />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it('a largura segue a proporção do arquivo (610 x 139)', () => {
    render(<Logo height={9} />);
    const { width, height } = StyleSheet.flatten(screen.root.props.style);
    expect(height).toBe(9);
    expect(width).toBeCloseTo(39.5, 1);
  });

  it('abre na altura da abertura (1k), sem apagar, e aceita a opacidade do protótipo', () => {
    render(<Logo />);
    expect(screen.root).toHaveStyle({ height: 17, opacity: 1 });

    screen.rerender(<Logo opacity={0.75} />);
    expect(screen.root).toHaveStyle({ opacity: 0.75 });
  });
});
