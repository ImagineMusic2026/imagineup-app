/** Posição e largura de um item dentro do conteúdo de uma rolagem horizontal. */
export interface ScrollItemBox {
  x: number;
  width: number;
}

/** Quanto já rolou e a largura visível da rolagem. */
export interface ScrollViewport {
  offset: number;
  width: number;
}

/**
 * Para onde rolar uma fileira horizontal (chips da 1f e da 1m, abas da 1d) para
 * o item escolhido ficar inteiro na tela, com `margin` sobrando do lado. `null`
 * quando ele já está à vista ou a rolagem ainda não foi medida.
 */
export function revealOffset(
  item: ScrollItemBox,
  viewport: ScrollViewport,
  margin: number,
): number | null {
  if (viewport.width === 0) return null;
  const start = item.x - margin;
  const end = item.x + item.width + margin;
  if (start < viewport.offset) return Math.max(0, start);
  if (end > viewport.offset + viewport.width) return end - viewport.width;
  return null;
}
