// Os ajudantes puros da lista de comentários, genéricos no tipo: o Mural os
// usa com o `PostComment`, e o fã-clube (seção 37, 37.9), com o comentário
// dele. Basta o id do servidor e o id local da linha que ainda vai.

/** O que a lista precisa de um comentário: o id e, na linha que ainda vai, o id local. */
export interface CommentListItem {
  id: string;
  localId?: string;
}

/** A mesma linha antes e depois de chegar ao servidor: o id local fica. */
export function commentKey<T extends CommentListItem>(comment: T): string {
  return comment.localId ?? comment.id;
}

/**
 * Os do fã que ainda não chegaram (os mais novos) em cima, depois os do
 * servidor, sem repetir: o que o servidor gravou fica escondido enquanto a
 * linha local dele ainda está na tela, e o comentário que uma página nova
 * traz de novo (a lista andou uma casa) aparece uma vez só.
 */
export function mergeComments<T extends CommentListItem>(
  local: readonly T[],
  server: readonly T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const comment of [...local, ...server]) {
    const key = commentKey(comment);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(comment);
  }
  return merged;
}
