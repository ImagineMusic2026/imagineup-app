import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';

import { glows } from '@/theme';

import { PageGlow } from '..';

function nodesOf(type: string) {
  return screen.root.findAll((node) => node.type === type);
}

function radial() {
  const [node] = nodesOf('skRadialGradient');
  return node?.props as {
    r: number;
    transform: { scaleX: number }[];
    colors: string[];
    positions: number[];
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

  it('o brilho some na parada do preset, na cor dele', () => {
    render(<PageGlow preset="ranking" />);
    expect(radial().colors).toEqual(['rgba(214, 255, 63, 0.16)', 'rgba(214, 255, 63, 0)']);
    expect(radial().positions).toEqual([0, glows.ranking.stop]);
  });

  it('estica o círculo em elipse de 120% da largura medida por 100% da faixa', () => {
    render(<PageGlow preset="profile" />);
    fireEvent(screen.root, 'layout', { nativeEvent: { layout: { width: 400, height: 250 } } });
    expect(radial().r).toBe(250);
    expect(radial().transform).toEqual([{ scaleX: (1.2 * 400) / 250 }]);
  });

  it('o perfil leva as listras da marca, que somem no fim da faixa', () => {
    render(<PageGlow preset="profile" />);
    const [stripes] = nodesOf('skLinearGradient').filter((node) => node.props.mode === 'repeat');
    expect(stripes?.props.colors[0]).toBe('rgba(255, 255, 255, 0.045)');
    expect(nodesOf('skFill').some((node) => node.props.blendMode === 'dstIn')).toBe(true);
  });

  it('o ranking é só o brilho, sem listras', () => {
    render(<PageGlow preset="ranking" />);
    expect(nodesOf('skLinearGradient')).toHaveLength(0);
  });
});
