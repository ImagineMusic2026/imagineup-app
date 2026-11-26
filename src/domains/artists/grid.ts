import { layout, spacing } from '@/theme';

/** Colunas das grades de cards de central: a Explorar, a 1l e a sheet de todos os artistas. */
export const TILE_COLUMNS = 2;

/**
 * Altura do card de central numa grade de duas colunas, pela largura da tela:
 * a coluna (a tela menos a margem `gutter` dos dois lados e o vão entre as
 * colunas, dividida pelas colunas) na proporção `layout.centralTileAspect`,
 * 4:5. A Explorar passa o `spacing.gutter`; a 1l e a sheet de todos os
 * artistas, o `spacing.gutterOnboarding`. O esqueleto de cada grade usa a
 * mesma altura, para nada pular quando as centrais chegam.
 */
export function centralTileHeight(windowWidth: number, gutter: number): number {
  const column = (windowWidth - 2 * gutter - (TILE_COLUMNS - 1) * spacing.itemGap) / TILE_COLUMNS;
  return Math.round(column / layout.centralTileAspect);
}
