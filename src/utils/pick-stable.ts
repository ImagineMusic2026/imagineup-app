/**
 * Hash de 32 bits do id, o mesmo do `render-telas.js` do site: numa lista do
 * mesmo tamanho, o mesmo slot de foto cai na mesma posição nos dois lugares
 * (os pares do placeholder, em `photoFallbackPairs`).
 */
export function stableHash(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * Escolhe um item da lista sempre igual para o mesmo id (cor do avatar sem
 * foto, par do placeholder), para a cor não trocar a cada render nem entre telas.
 */
export function pickStable<List extends readonly [unknown, ...unknown[]]>(
  id: string,
  list: List,
): List[number] {
  return list[stableHash(id) % list.length] ?? list[0];
}
