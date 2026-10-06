import type { InfiniteData, Query, QueryClient } from '@tanstack/react-query';

import type { Page, Post, PostComment } from './types';

/**
 * O mesmo post aparece em mais de um cache: o detalhe, o mural da home e as
 * listas de uma central (a grade da 1d). Toda lista de posts mora debaixo de
 * `['posts']` (menos os comentários), e aqui mudam todas juntas: curtir no
 * detalhe já aparece na home ao voltar.
 */

const POSTS_ROOT = 'posts';
const COMMENTS_SEGMENT = 'comments';

type PostPatch = (post: Post) => Post;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPost(value: unknown): value is Post {
  return isRecord(value) && typeof value.id === 'string' && typeof value.likedByMe === 'boolean';
}

/** Troca o post onde ele estiver; devolve o mesmo objeto quando nada mudou. */
function patchData(data: unknown, postId: string, patch: PostPatch): unknown {
  if (isPost(data)) return data.id === postId ? patch(data) : data;
  if (Array.isArray(data)) {
    const next = data.map((item: unknown) => patchData(item, postId, patch));
    return next.some((item, index) => item !== data[index]) ? next : data;
  }
  if (!isRecord(data)) return data;
  if (Array.isArray(data.pages)) {
    const pages = patchData(data.pages, postId, patch);
    return pages === data.pages ? data : { ...data, pages };
  }
  if (Array.isArray(data.items)) {
    const items = patchData(data.items, postId, patch);
    return items === data.items ? data : { ...data, items };
  }
  return data;
}

const holdsPosts = (query: Query): boolean =>
  query.queryKey[0] === POSTS_ROOT && query.queryKey[1] !== COMMENTS_SEGMENT;

/** Muda o post em todo cache de posts. */
export function patchPostEverywhere(client: QueryClient, postId: string, patch: PostPatch): void {
  client.setQueriesData({ predicate: holdsPosts }, (data: unknown) => {
    if (data === undefined) return undefined;
    const next = patchData(data, postId, patch);
    // Sem mudança, nada é gravado (nem avisa quem observa).
    return next === data ? undefined : next;
  });
}

function findIn(data: unknown, postId: string): Post | undefined {
  if (isPost(data)) return data.id === postId ? data : undefined;
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.pages)
      ? data.pages
      : isRecord(data) && Array.isArray(data.items)
        ? data.items
        : [];
  for (const item of list as unknown[]) {
    const found = findIn(item, postId);
    if (found) return found;
  }
  return undefined;
}

/** O post como o app mostra agora: o do detalhe ou, sem ele, o de uma lista. */
export function readPost(client: QueryClient, postId: string): Post | undefined {
  const queries = client.getQueryCache().findAll({ predicate: holdsPosts });
  // O detalhe primeiro: é o que a tela aberta mostra.
  const detailFirst = [...queries].sort(
    (a, b) => Number(b.queryKey[1] === 'detail') - Number(a.queryKey[1] === 'detail'),
  );
  for (const query of detailFirst) {
    const found = findIn(query.state.data, postId);
    if (found) return found;
  }
  return undefined;
}

/** Curtida aplicada ao post, com a contagem acompanhando (nunca abaixo de zero). */
export function withLike(post: Post, liked: boolean): Post {
  if (post.likedByMe === liked) return post;
  return {
    ...post,
    likedByMe: liked,
    likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
  };
}

export function withCommentDelta(post: Post, delta: number): Post {
  return { ...post, commentCount: Math.max(0, post.commentCount + delta) };
}

/**
 * O comentário que o servidor gravou entra no topo da primeira página (a
 * lista é do mais novo ao mais antigo), se ele ainda não estiver lá. Sem a
 * lista em cache, nada a fazer: ela vem do servidor quando a tela abrir.
 * Devolve se o comentário está na lista depois disso.
 */
export function insertComment(
  client: QueryClient,
  key: readonly unknown[],
  comment: PostComment,
): boolean {
  let placed = false;
  client.setQueryData<InfiniteData<Page<PostComment>>>(key, (data) => {
    const [first, ...rest] = data?.pages ?? [];
    if (!data || !first) return data;
    placed = true;
    const known = data.pages.some((page) => page.items.some((item) => item.id === comment.id));
    if (known) return data;
    return { ...data, pages: [{ ...first, items: [comment, ...first.items] }, ...rest] };
  });
  return placed;
}

const holdsComments = (query: Query): boolean =>
  query.queryKey[0] === POSTS_ROOT && query.queryKey[1] === COMMENTS_SEGMENT;

/**
 * O fã bloqueou um autor: os comentários dele saem de todo cache de
 * comentários na hora (a lista buscada de novo já vem sem eles do servidor).
 */
export function removeAuthorComments(client: QueryClient, authorId: string): void {
  client.setQueriesData<InfiniteData<Page<PostComment>>>({ predicate: holdsComments }, (data) => {
    if (!data?.pages) return data;
    const found = data.pages.some((page) => page.items.some((item) => item.authorId === authorId));
    if (!found) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.authorId !== authorId),
      })),
    };
  });
}

/** Um comentário que já está no cache da lista do post (a sheet de opções lê daqui). */
export function findCachedComment(
  client: QueryClient,
  key: readonly unknown[],
  commentId: string,
): PostComment | undefined {
  const data = client.getQueryData<InfiniteData<Page<PostComment>>>(key);
  for (const page of data?.pages ?? []) {
    const found = page.items.find((item) => item.id === commentId);
    if (found) return found;
  }
  return undefined;
}
