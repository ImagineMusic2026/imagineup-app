import { colors, gradients, layout } from '@/theme';

type Rgb = [number, number, number];
interface Paint {
  rgb: Rgb;
  alpha: number;
}

const WHITE: Rgb = [1, 1, 1];

/** `#RRGGBB` ou `rgba(r, g, b, a)` (o `withAlpha`) em canais de 0 a 1. */
function paint(color: string): Paint {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) {
    const channel = (i: number) => parseInt(hex[i], 16) / 255;
    return { rgb: [channel(1), channel(2), channel(3)], alpha: 1 };
  }
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color);
  if (!rgba) throw new Error(`Cor fora do formato: ${color}`);
  const channel = (i: number) => Number(rgba[i]) / 255;
  return { rgb: [channel(1), channel(2), channel(3)], alpha: Number(rgba[4]) };
}

/** A cor por cima do fundo, como a tela compõe (em sRGB). */
function over({ rgb, alpha }: Paint, below: Rgb): Rgb {
  const mix = (i: number) => alpha * rgb[i] + (1 - alpha) * below[i];
  return [mix(0), mix(1), mix(2)];
}

/** Luminância relativa e contraste da WCAG 2.2. */
function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('véu do card da central (grade da Explorar)', () => {
  const { colors: stops, locations } = gradients.scrims.centralTileCopy;
  const { fade, below } = layout.centralTileVeil;
  const veil = paint(stops[stops.length - 1]);

  it('a curva termina no topo do texto, e dali até o pé é o véu cheio', () => {
    expect(locations[locations.length - 2]).toBeCloseTo(fade / (fade + below));
    expect(locations[locations.length - 1]).toBe(1);
    expect(stops[stops.length - 2]).toBe(stops[stops.length - 1]);
  });

  it('nasce transparente e só escurece, sem degrau para trás', () => {
    const alphas = stops.map((stop) => paint(stop).alpha);
    expect(alphas[0]).toBe(0);
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
  });

  it('o nome e o "N fãs" passam AA (4,5:1) mesmo sobre foto branca', () => {
    const background = over(veil, WHITE);
    const name = over(paint(colors.text), background);
    const fans = over(paint(colors.textSubtle), background);
    expect(contrast(name, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fans, background)).toBeGreaterThanOrEqual(4.5);
  });
});
