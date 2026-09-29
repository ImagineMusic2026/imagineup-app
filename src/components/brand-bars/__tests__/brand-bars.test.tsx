import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors } from '@/theme';

import { BrandBars, type BrandBarsProps } from '..';

function bars() {
  return screen.root.children
    .filter((child) => typeof child !== 'string')
    .map((bar) => StyleSheet.flatten(bar.props.style));
}

describe('BrandBars', () => {
  it('é desenho: some para o leitor de tela', () => {
    render(<BrandBars />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it('inclina o grupo como as barras do logo', () => {
    render(<BrandBars />);
    expect(screen.root).toHaveStyle({ transform: [{ skewX: '-22deg' }] });
  });

  it('são três barras na cor pedida, rosa quando não se diz nada', () => {
    render(<BrandBars />);
    expect(bars().map((bar) => bar.backgroundColor)).toEqual(Array(3).fill(colors.accent));

    screen.rerender(<BrandBars color={colors.onPoints} />);
    expect(bars().map((bar) => bar.backgroundColor)).toEqual(Array(3).fill(colors.onPoints));
  });

  it.each<[NonNullable<BrandBarsProps['size']>, number[], { width: number; height: number }]>([
    ['pill', [1, 0.6, 0.3], { width: 2.5, height: 10 }],
    ['badge', [1, 0.6, 0.3], { width: 2.5, height: 9 }],
    ['title', [1, 0.6, 0.28], { width: 4, height: 20 }],
    ['hero', [1, 0.6, 0.28], { width: 4, height: 21 }],
  ])('%s: medidas e opacidades do protótipo', (size, opacities, measures) => {
    render(<BrandBars size={size} />);
    expect(bars().map((bar) => bar.opacity)).toEqual(opacities);
    for (const bar of bars()) expect(bar).toMatchObject(measures);
  });

  it('as opacidades podem ser trocadas por prop', () => {
    render(<BrandBars size="hero" opacities="soft" />);
    expect(bars().map((bar) => bar.opacity)).toEqual([1, 0.6, 0.3]);
  });
});
