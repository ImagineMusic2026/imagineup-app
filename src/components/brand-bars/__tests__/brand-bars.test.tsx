import { act, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { Polygon } from 'react-native-svg';

import { createStackEntrance } from '@/hooks/use-stack-fade';
import { colors, motion } from '@/theme';

import { BrandBars, type BrandBarsProps } from '..';

const mockReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion(),
}));

type Point = { x: number; y: number };

/** Os quatro cantos de cada barra: topo esquerdo, topo direito, pé direito, pé esquerdo. */
function bars() {
  return screen.root
    .findAll((node) => node.type === Polygon)
    .map((node) => {
      const [topLeft, topRight, footRight, footLeft] = String(node.props.points)
        .split(' ')
        .map((pair): Point => {
          const [x, y] = pair.split(',').map(Number);
          return { x: x ?? NaN, y: y ?? NaN };
        });
      return {
        fill: node.props.fill as string,
        opacity: node.props.fillOpacity as number,
        topLeft: topLeft as Point,
        topRight: topRight as Point,
        footRight: footRight as Point,
        footLeft: footLeft as Point,
      };
    });
}

describe('BrandBars', () => {
  it('é desenho: some para o leitor de tela', () => {
    render(<BrandBars />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it('são três barras na cor pedida, rosa quando não se diz nada', () => {
    render(<BrandBars />);
    expect(bars().map((bar) => bar.fill)).toEqual(Array(3).fill(colors.accent));

    screen.rerender(<BrandBars color={colors.onPoints} />);
    expect(bars().map((bar) => bar.fill)).toEqual(Array(3).fill(colors.onPoints));
  });

  it('inclina as barras como as do logo (22°), sem depender do skew da View', () => {
    render(<BrandBars size="hero" />);
    for (const { topLeft, footLeft } of bars()) {
      // O topo anda para a direita: "///".
      expect(topLeft.x - footLeft.x).toBeCloseTo(21 * Math.tan((22 * Math.PI) / 180), 1);
    }
    expect(screen.root).not.toHaveStyle({ transform: expect.anything() });
  });

  it.each<[NonNullable<BrandBarsProps['size']>, number[], { width: number; height: number }]>([
    ['pill', [1, 0.6, 0.3], { width: 2.5, height: 10 }],
    ['badge', [1, 0.6, 0.3], { width: 2.5, height: 9 }],
    ['title', [1, 0.6, 0.28], { width: 4, height: 20 }],
    ['hero', [1, 0.6, 0.28], { width: 4, height: 21 }],
  ])('%s: medidas e opacidades do protótipo', (size, opacities, { width, height }) => {
    render(<BrandBars size={size} />);
    expect(bars().map((bar) => bar.opacity)).toEqual(opacities);
    for (const bar of bars()) {
      expect(bar.topRight.x - bar.topLeft.x).toBeCloseTo(width, 2);
      expect(bar.footRight.x - bar.footLeft.x).toBeCloseTo(width, 2);
      expect(bar.footLeft.y - bar.topLeft.y).toBe(height);
    }
  });

  it('a caixa do layout é a das barras retas: a inclinação passa para fora dela', () => {
    render(<BrandBars size="hero" />);
    // 3 barras de 4 com vãos de 2,5.
    expect(screen.root).toHaveStyle({ width: 17, height: 21 });
  });

  it('as opacidades podem ser trocadas por prop', () => {
    render(<BrandBars size="hero" opacities="soft" />);
    expect(bars().map((bar) => bar.opacity)).toEqual([1, 0.6, 0.3]);
  });

  describe('acendendo', () => {
    const litOpacities = () =>
      screen.root
        .findAll((node) => node.type === Polygon)
        .map((node) => (node.props.animatedProps as { fillOpacity: number }).fillOpacity);

    afterEach(() => {
      mockReducedMotion.mockReturnValue(false);
      jest.restoreAllMocks();
    });

    it('nascem apagadas, no mesmo desenho e na mesma cor', () => {
      render(<BrandBars size="hero" lightUp />);
      expect(litOpacities()).toEqual([0, 0, 0]);
      expect(bars().map((bar) => bar.fill)).toEqual(Array(3).fill(colors.accent));
      for (const { topLeft, footLeft } of bars()) {
        expect(topLeft.x - footLeft.x).toBeCloseTo(21 * Math.tan((22 * Math.PI) / 180), 1);
      }
    });

    // O mock do Reanimated cria o valor de novo a cada render: o desenho mostra
    // o primeiro quadro, e o acender se confere pelas animações que ele pede.
    it('acendem uma depois da outra (80 ms entre elas), depois da espera pedida', () => {
      const delay = jest.spyOn(Reanimated, 'withDelay');
      const timing = jest.spyOn(Reanimated, 'withTiming');
      render(<BrandBars size="hero" lightUp lightUpDelay={150} />);

      expect(delay.mock.calls.map(([wait]) => wait)).toEqual([150, 230, 310]);
      expect(timing).toHaveBeenCalledTimes(3);
      for (const [target, config] of timing.mock.calls) {
        expect(target).toBe(1);
        expect(config).toMatchObject({ duration: motion.duration.slow, easing: motion.easing.out });
      }
    });

    it('com a entrada de uma pilha, esperam o fade dela começar para acender', () => {
      const entrance = createStackEntrance();
      const delay = jest.spyOn(Reanimated, 'withDelay');
      render(<BrandBars size="hero" lightUp entrance={entrance} />);
      expect(delay).not.toHaveBeenCalled();

      act(() => entrance.enter());
      expect(delay.mock.calls.map(([wait]) => wait)).toEqual([0, 80, 160]);
    });

    it('com reduzir movimento, já nascem acesas na opacidade de cada uma', () => {
      mockReducedMotion.mockReturnValue(true);
      render(<BrandBars size="hero" lightUp />);
      expect(litOpacities()).toEqual([1, 0.6, 0.28]);
    });
  });
});
