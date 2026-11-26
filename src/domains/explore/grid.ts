import { layout, spacing } from '@/theme';

/** Colunas da grade das centrais na Explorar. */
export const GRID_COLUMNS = 2;

/**
 * Altura mínima do card da central na grade (`CentralTile`), pela largura da
 * tela: a coluna (a tela menos as margens e o vão entre as colunas, dividida
 * pelas colunas) na proporção `layout.centralTileAspect`, 4:5. É mínima: com
 * a fonte grande, o card cresce além dela. O esqueleto da grade usa a mesma,
 * para a grade não pular quando as centrais chegam.
 */
export function centralTileHeight(windowWidth: number): number {
  const column =
    (windowWidth - 2 * spacing.gutter - (GRID_COLUMNS - 1) * spacing.itemGap) / GRID_COLUMNS;
  return Math.round(column / layout.centralTileAspect);
}
