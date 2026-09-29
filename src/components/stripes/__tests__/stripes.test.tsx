import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';

import { stripes, type StripeToken } from '@/theme';

import { Stripes, stripeGradient } from '..';

// Nó do Skia que o mock deixa na árvore, com as props que iriam para o desenho.
const LINEAR_GRADIENT: string = 'skLinearGradient';

function drawnGradient() {
  const [gradient] = screen.root.findAll((node) => node.type === LINEAR_GRADIENT);
  return gradient?.props as { colors: string[]; positions: number[]; mode: string };
}

describe('stripeGradient', () => {
  it.each<[string, StripeToken, { x: number; y: number }, number]>([
    ['2 a cada 13 da 1k', stripes.auth, { x: 11.876, y: 5.288 }, 2 / 13],
    ['3 a cada 11 do card lima', stripes.onPoints, { x: 10.049, y: 4.474 }, 3 / 11],
    [
      'a 90°, o período corre na horizontal',
      { ...stripes.photo, angle: 90 },
      { x: 12, y: 0 },
      2 / 12,
    ],
    [
      'a 180°, o período corre para baixo',
      { ...stripes.photo, angle: 180 },
      { x: 0, y: 12 },
      2 / 12,
    ],
  ])('%s: um período no eixo do ângulo e a listra na fração certa', (_, token, end, edge) => {
    const gradient = stripeGradient(token);
    expect(gradient.start).toEqual({ x: 0, y: 0 });
    expect(gradient.end.x).toBeCloseTo(end.x, 2);
    expect(gradient.end.y).toBeCloseTo(end.y, 2);
    expect(gradient.positions).toEqual([0, edge, edge, 1]);
  });

  it('vai da cor no alfa da listra para a mesma cor a 0, nunca para "transparent"', () => {
    expect(stripeGradient(stripes.onPoints).colors).toEqual([
      'rgba(11, 11, 16, 0.09)',
      'rgba(11, 11, 16, 0.09)',
      'rgba(11, 11, 16, 0)',
      'rgba(11, 11, 16, 0)',
    ]);
  });
});

describe('Stripes', () => {
  it('é só textura: não recebe toque e não existe para o leitor de tela', () => {
    render(<Stripes preset="auth" />);
    expect(screen.root).toHaveProp('pointerEvents', 'none');
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
  });

  it('cobre o pai inteiro e repete o período pela área toda', () => {
    render(<Stripes preset="photo" />);
    expect(screen.root).toHaveStyle({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
    expect(drawnGradient().mode).toBe('repeat');
  });

  it('desenha o preset e aceita ajuste fino por prop', () => {
    render(<Stripes preset="onPoints" alpha={0.08} />);
    expect(drawnGradient().colors[0]).toBe('rgba(11, 11, 16, 0.08)');
    expect(drawnGradient().positions).toEqual([0, 3 / 11, 3 / 11, 1]);
  });

  it('sem preset, desenha com os valores passados', () => {
    render(<Stripes color="#FFFFFF" alpha={0.1} width={4} period={16} />);
    expect(drawnGradient().colors[0]).toBe('rgba(255, 255, 255, 0.1)');
    expect(drawnGradient().positions).toEqual([0, 0.25, 0.25, 1]);
  });
});
