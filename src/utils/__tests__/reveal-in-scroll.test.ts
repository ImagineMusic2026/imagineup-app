import { revealOffset } from '../reveal-in-scroll';

const viewport = { offset: 0, width: 200 };

describe('rolar até o item escolhido', () => {
  it.each([
    ['já à vista', { x: 40, width: 60 }, viewport, null],
    ['cortado à direita', { x: 170, width: 60 }, viewport, 48],
    ['cortado à esquerda', { x: 100, width: 60 }, { offset: 120, width: 200 }, 82],
    [
      'perto do começo, sem rolar para antes do zero',
      { x: 4, width: 60 },
      { offset: 30, width: 200 },
      0,
    ],
    ['sem medida da rolagem', { x: 400, width: 60 }, { offset: 0, width: 0 }, null],
  ])('%s', (_case, item, current, expected) => {
    expect(revealOffset(item, current, 18)).toBe(expected);
  });
});
