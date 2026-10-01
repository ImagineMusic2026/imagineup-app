import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { Mask, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, glows } from '@/theme';

import { PageGlow } from '..';

function radial() {
  const gradient = screen.UNSAFE_getByType(RadialGradient);
  return {
    props: gradient.props as { cx: number; cy: number; rx: number; ry: number },
    stops: gradient
      .findAllByType(Stop)
      .map(({ props }) => [props.offset, props.stopColor, props.stopOpacity]),
  };
}

describe('PageGlow', () => {
  it('é só fundo: não recebe toque e não existe para o leitor de tela', () => {
    render(<PageGlow preset="profile" />);
    expect(screen.root).toHaveProp('pointerEvents', 'none');
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it.each(['profile', 'ranking'] as const)(
    '%s: faixa presa ao topo da tela com a altura do preset',
    (preset) => {
      render(<PageGlow preset={preset} />);
      expect(screen.root).toHaveStyle({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: glows[preset].height,
      });
    },
  );

  it('o brilho some na parada do preset, na cor dele (a opacidade à parte, como o SVG pede)', () => {
    render(<PageGlow preset="ranking" />);
    expect(radial().stops).toEqual([
      [0, colors.points, 0.16],
      [glows.ranking.stop, colors.points, 0],
    ]);
  });

  it('é uma elipse de 120% da largura medida por 100% da faixa, centrada no topo', () => {
    render(<PageGlow preset="profile" />);
    fireEvent(screen.root, 'layout', { nativeEvent: { layout: { width: 400, height: 250 } } });
    expect(radial().props).toMatchObject({ cx: 200, cy: 0, rx: 480, ry: 250 });
  });

  it('o perfil leva as listras da marca, que somem no fim da faixa', () => {
    render(<PageGlow preset="profile" />);
    const stripe = screen.UNSAFE_getByType(Pattern).findByType(Rect);
    expect(stripe.props).toMatchObject({ fill: colors.text, fillOpacity: 0.045 });
    const striped = screen.UNSAFE_getAllByType(Rect).find((rect) => rect.props.mask);
    expect(striped?.props).toMatchObject({ fill: 'url(#stripes)', mask: 'url(#fadeOut)' });
    expect(screen.UNSAFE_getByType(Mask)).toBeTruthy();
  });

  it('o ranking é só o brilho, sem listras', () => {
    render(<PageGlow preset="ranking" />);
    expect(screen.UNSAFE_queryAllByType(Pattern)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(Mask)).toHaveLength(0);
  });
});
