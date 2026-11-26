import { layout, spacing } from '@/theme';

import { centralTileHeight, TILE_COLUMNS } from '../grid';

describe('centralTileHeight', () => {
  it.each([
    // Largura da tela, margem, largura do card (a tela menos as margens e o vão de 12, em duas), altura.
    ['a Explorar', 360, spacing.gutter, 156, 195],
    ['a Explorar', 393, spacing.gutter, 172.5, 216],
    ['a Explorar', 411, spacing.gutter, 181.5, 227],
    ['a Explorar', 440, spacing.gutter, 196, 245],
    ['a 1l', 360, spacing.gutterOnboarding, 152, 190],
    ['a 1l', 393, spacing.gutterOnboarding, 168.5, 211],
    ['a 1l', 440, spacing.gutterOnboarding, 192, 240],
  ])(
    '%s numa tela de %s (margem %s): o card de %s de largura tem %s de altura (4:5)',
    (_grid, screen, gutter, card, height) => {
      expect(TILE_COLUMNS).toBe(2);
      expect(centralTileHeight(screen, gutter)).toBe(height);
      expect(Math.abs(card / height - layout.centralTileAspect)).toBeLessThan(0.01);
    },
  );
});
