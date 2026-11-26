import { layout } from '@/theme';

import { centralTileHeight, GRID_COLUMNS } from '../grid';

describe('centralTileHeight', () => {
  it.each([
    // Largura da tela, largura do card (a tela menos as margens de 18 e o vão de 12, em duas), altura.
    [360, 156, 195],
    [393, 172.5, 216],
    [411, 181.5, 227],
    [440, 196, 245],
  ])('numa tela de %s, o card de %s de largura tem %s de altura (4:5)', (screen, card, height) => {
    expect(GRID_COLUMNS).toBe(2);
    expect(centralTileHeight(screen)).toBe(height);
    expect(Math.abs(card / height - layout.centralTileAspect)).toBeLessThan(0.01);
  });
});
