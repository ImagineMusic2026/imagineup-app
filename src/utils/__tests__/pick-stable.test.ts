import { pickStable, stableHash } from '../pick-stable';

// Pares do render-telas.js do site, com o lima, para conferir que o hash é o mesmo.
const SITE_PAIRS = [
  ['#FF2D6F', '#6A1B9A'],
  ['#3DDCFF', '#23237A'],
  ['#D6FF3F', '#11694F'],
  ['#FF8A3D', '#C2185B'],
  ['#9D6BFF', '#FF2D6F'],
  ['#3DDCFF', '#FF2D6F'],
] as const;

describe('escolha estável pelo id', () => {
  it.each([
    ['', 0],
    ['a', 97],
    ['ab', 3105],
    ['up-1b-post1', 1913882631],
    ['up-1h-hero', 2588569726],
    ['a'.repeat(40), 1042809472],
  ])('o hash de "%s" é %i, igual ao do site', (id, expected) => {
    expect(stableHash(id)).toBe(expected);
  });

  it.each([
    ['up-1b-post1', SITE_PAIRS[3]],
    ['up-1h-hero', SITE_PAIRS[4]],
    ['a', SITE_PAIRS[1]],
  ])('o slot "%s" cai no mesmo par que o site usa', (id, expected) => {
    expect(pickStable(id, SITE_PAIRS)).toBe(expected);
  });

  it('devolve sempre o mesmo item para o mesmo id', () => {
    const list = ['rosa', 'ciano', 'laranja'] as const;
    expect(pickStable('nettobrito', list)).toBe(pickStable('nettobrito', list));
  });

  it('espalha ids diferentes pela lista', () => {
    const list = [0, 1, 2, 3] as const;
    const picked = new Set(
      ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6'].map((id) => pickStable(id, list)),
    );
    expect(picked.size).toBeGreaterThan(1);
  });

  it('com um item só, devolve esse item', () => {
    expect(pickStable('qualquer', ['único'] as const)).toBe('único');
  });
});
