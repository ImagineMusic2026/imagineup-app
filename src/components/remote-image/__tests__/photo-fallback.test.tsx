import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { LinearGradient, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { ReactTestInstance } from 'react-test-renderer';

import { colors, gradients, photoFallbackPairs, stripes } from '@/theme';
import { stableHash } from '@/utils/pick-stable';

import { PhotoFallback, photoFallbackPair, StaticPhotoFallback } from '..';

// Pares do render-telas.js do site, na ordem dele (o lima na posição 2).
const SITE_PAIRS = [
  ['#FF2D6F', '#6A1B9A'],
  ['#3DDCFF', '#23237A'],
  ['#D6FF3F', '#11694F'],
  ['#FF8A3D', '#C2185B'],
  ['#9D6BFF', '#FF2D6F'],
  ['#3DDCFF', '#FF2D6F'],
] as const;
const SITE_LIME = 2;

// O Skia do Jest não desenha: os nós chegam à árvore com o nome do elemento.
function nodesOf(type: string): ReactTestInstance[] {
  return screen.UNSAFE_root.findAll((node) => (node.type as unknown) === type);
}

function measure(width = 366, height = 196) {
  fireEvent(screen.getByTestId('fallback', { includeHiddenElements: true }), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  });
}

function baseColors(): string[] {
  const [base] = nodesOf('skLinearGradient');
  return base?.props.colors as string[];
}

describe('PhotoFallback', () => {
  it('só desenha depois de medir, para não piscar uma cor chapada', () => {
    render(<PhotoFallback seed="up-1h-hero" testID="fallback" />);
    expect(nodesOf('skLinearGradient')).toHaveLength(0);

    measure();
    // Gradiente de 150°, brilho do canto e listras.
    expect(nodesOf('skLinearGradient')).toHaveLength(2);
    expect(nodesOf('skRadialGradient')).toHaveLength(1);
  });

  it('o mesmo id cai sempre no mesmo par, em qualquer tela', () => {
    const { unmount } = render(<PhotoFallback seed="up-1d-g1" testID="fallback" />);
    measure();
    const first = baseColors();
    unmount();

    render(<PhotoFallback seed="up-1d-g1" testID="fallback" />);
    measure(118, 104);
    expect(baseColors()).toEqual(first);
    expect(first).toEqual([...photoFallbackPair('up-1d-g1')]);
  });

  it('nunca usa o par lima do site: lima é só para pontos', () => {
    const seeds = Array.from({ length: 300 }, (_, index) => `seed-${index}`);
    for (const seed of seeds) {
      expect(photoFallbackPair(seed)).not.toContain(colors.points);
    }
    // E todos os pares do app aparecem.
    const used = new Set(seeds.map((seed) => photoFallbackPair(seed).join()));
    expect(used.size).toBe(new Set(photoFallbackPairs.map((pair) => pair.join())).size);
  });

  it.each(['up-1b-post1', 'up-1h-hero', 'up-1d-cover', 'rocksalles', 'juninhomoraes'])(
    'o slot "%s" cai no mesmo par que o site usa, se o do site não for o lima',
    (seed) => {
      const position = stableHash(seed) % SITE_PAIRS.length;
      const expected = position === SITE_LIME ? photoFallbackPairs[0] : SITE_PAIRS[position];
      expect(photoFallbackPair(seed)).toEqual(expected);
    },
  );

  it('a miniatura do post da 1b sai no laranja do site', () => {
    expect(photoFallbackPair('up-1b-post1')).toEqual(['#FF8A3D', '#C2185B']);
  });

  it('show sem foto sai no azul de shows, sem o brilho de canto', () => {
    render(<PhotoFallback seed="up-1m-ev1" variant="events" testID="fallback" />);
    measure();
    expect(baseColors()).toEqual([...gradients.eventsTile.colors]);
    expect(nodesOf('skRadialGradient')).toHaveLength(0);
  });

  it('um par fixo vence o escolhido pelo id (abertura 1k)', () => {
    const pinkToPurple = photoFallbackPairs[0];
    render(<PhotoFallback seed="up-1k-bg" pair={pinkToPurple} testID="fallback" />);
    measure(402, 874);
    expect(baseColors()).toEqual([...pinkToPurple]);
  });

  it('as listras podem trocar de jogo ou sair, para a capa desenhar as suas', () => {
    const { unmount } = render(
      <PhotoFallback seed="nettobrito" stripes="photo" testID="fallback" />,
    );
    measure(402, 270);
    const [, stripeGradient] = nodesOf('skLinearGradient');
    const { width, period } = stripes.photo;
    expect(stripeGradient?.props.positions).toEqual([0, width / period, width / period, 1]);
    unmount();

    render(<PhotoFallback seed="nettobrito" stripes={null} testID="fallback" />);
    measure(402, 270);
    // Só o gradiente do par; o brilho do canto continua.
    expect(nodesOf('skLinearGradient')).toHaveLength(1);
    expect(nodesOf('skRadialGradient')).toHaveLength(1);
  });

  it('é decorativo: oculto do leitor de tela e sem receber toque', () => {
    render(<PhotoFallback seed="up-1h-hero" testID="fallback" />);
    const root = screen.getByTestId('fallback', { includeHiddenElements: true });
    expect(isHiddenFromAccessibility(root)).toBe(true);
    expect(root).toHaveProp('pointerEvents', 'none');
  });
});

describe('StaticPhotoFallback', () => {
  const stopsOf = (gradient: 'linear' | 'radial') =>
    screen
      .UNSAFE_getByType<object>(gradient === 'linear' ? LinearGradient : RadialGradient)
      .findAllByType(Stop);

  it('desenha já no primeiro quadro, sem medir: o mesmo par do id e o brilho do canto', () => {
    render(<StaticPhotoFallback seed="up-1d-g1" width={402} height={874} />);
    expect(stopsOf('linear').map((stop) => stop.props.stopColor)).toEqual([
      ...photoFallbackPair('up-1d-g1'),
    ]);
    const { color, alphas, stop } = gradients.photoFallback.sheen;
    expect(
      stopsOf('radial').map(({ props }) => [props.offset, props.stopColor, props.stopOpacity]),
    ).toEqual([
      [0, color, alphas[0]],
      [stop, color, alphas[1]],
    ]);
  });

  it('um par fixo vence o do id, como no fundo da abertura (1k)', () => {
    const pinkToPurple = photoFallbackPairs[0];
    render(<StaticPhotoFallback seed="auth" pair={pinkToPurple} width={402} height={874} />);
    expect(stopsOf('linear').map((stop) => stop.props.stopColor)).toEqual([...pinkToPurple]);
  });

  it('é decorativo: oculto do leitor de tela e sem receber toque', () => {
    render(<StaticPhotoFallback seed="auth" width={402} height={874} />);
    const [root] = screen.UNSAFE_root.findAll((node) => node.props.pointerEvents === 'none');
    expect(root && isHiddenFromAccessibility(root)).toBe(true);
  });

  it('leva as listras do placeholder do site, como o do Skia, ou nenhuma com `null`', () => {
    const { rerender } = render(<StaticPhotoFallback seed="x" width={402} height={270} />);
    const stripe = screen.UNSAFE_getByType(Pattern).findByType(Rect);
    expect(stripe.props).toMatchObject({
      width: stripes.placeholder.width,
      fillOpacity: stripes.placeholder.alpha,
    });

    rerender(<StaticPhotoFallback seed="x" stripes={null} width={402} height={270} />);
    expect(screen.UNSAFE_queryAllByType(Pattern)).toHaveLength(0);
  });

  it('`events` é o bloco ciano dos shows (1m), sem o brilho do canto', () => {
    render(<StaticPhotoFallback seed="sao-joao" variant="events" width={366} height={186} />);
    expect(stopsOf('linear').map((stop) => stop.props.stopColor)).toEqual([
      ...gradients.eventsTile.colors,
    ]);
    expect(screen.UNSAFE_queryAllByType(RadialGradient)).toHaveLength(0);
  });

  it('desenha na medida esperada e se corrige se o espaço real for outro (fonte grande)', () => {
    render(<StaticPhotoFallback seed="x" width={366} height={186} />);
    const base = () =>
      screen.UNSAFE_getAllByType(Rect).find((rect) => rect.props.fill === 'url(#base)');
    expect(base()?.props).toMatchObject({ width: 366, height: 186 });

    const [root] = screen.UNSAFE_root.findAll((node) => node.props.pointerEvents === 'none');
    fireEvent(root!, 'layout', { nativeEvent: { layout: { width: 366, height: 260 } } });
    expect(base()?.props).toMatchObject({ width: 366, height: 260 });
  });
});
