import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { motion } from '@/theme';

import { Logo } from '..';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const image = () => screen.UNSAFE_getByType(Image);

afterEach(() => {
  mockReducedMotion = false;
  jest.restoreAllMocks();
});

describe('Logo', () => {
  it('é decorativo: o leitor de tela não para nele', () => {
    render(<Logo />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it('a largura segue a proporção do arquivo (610 x 139)', () => {
    render(<Logo height={9} />);
    const { width, height } = StyleSheet.flatten(image().props.style);
    expect(height).toBe(9);
    expect(width).toBeCloseTo(39.5, 1);
  });

  it('abre na altura da abertura (1k) e apaga até a opacidade do protótipo', () => {
    mockReducedMotion = true;
    render(<Logo />);
    expect(StyleSheet.flatten(image().props.style)).toMatchObject({ height: 17 });
    expect(screen.root).toHaveStyle({ opacity: 1 });

    screen.rerender(<Logo opacity={0.75} />);
    expect(screen.root).toHaveStyle({ opacity: 0.75 });
  });

  it('a imagem que ainda não estava na memória entra em fade quando chega, e não seca', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(<Logo />);
    expect(screen.root).toHaveStyle({ opacity: 0 });
    expect(timing).not.toHaveBeenCalled();

    fireEvent(image(), 'load', { source: { width: 610, height: 139 } });
    expect(timing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.duration.base, easing: motion.easing.out }),
    );
  });
});
