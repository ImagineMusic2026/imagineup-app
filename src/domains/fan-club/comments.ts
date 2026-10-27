import type { FanClubComment, FanClubCommentLine } from './types';

// As contas da lista de comentários da tela da publicação (seção 37, 37.9,
// itens 3 e 4), puras. Os comentários de cima usam o `mergeComments` do
// Mural (genérico no tipo); as respostas, as daqui.

/**
 * Quantas respostas o "Ver N respostas" promete: as visíveis e, para o gestor
 * no próprio fã-clube, também as que ele ocultou, para achar a resposta que
 * ocultou e poder reexibir.
 */
export function replyTotal(comment: FanClubComment, isOwner: boolean): number {
  return comment.replyCount + (isOwner ? (comment.hiddenReplyCount ?? 0) : 0);
}

/**
 * As respostas de uma conversa: as carregadas, da mais antiga para a mais
 * nova, e as do fã que ainda não chegaram, no fim, sem repetir. O que o
 * servidor gravou (com o `localId` da linha) esconde a linha local dele, e a
 * resposta que a página seguinte traz de novo aparece uma vez só, no lugar
 * que o servidor dá a ela: a cópia gravada, posta no fim das carregadas, cede
 * à do servidor, para a nova não ficar antes das mais antigas.
 */
export function mergeReplies(
  server: readonly FanClubCommentLine[],
  local: readonly FanClubCommentLine[],
): FanClubCommentLine[] {
  const delivered = new Set(server.filter((line) => !line.localId).map((line) => line.id));
  const seen = new Set<string>();
  const merged: FanClubCommentLine[] = [];
  for (const line of [...server, ...local]) {
    if (line.localId && delivered.has(line.id)) {
      // A linha local do mesmo envio continua escondida.
      seen.add(line.localId);
      continue;
    }
    const keys = line.localId ? [line.id, line.localId] : [line.id];
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    merged.push(line);
  }
  return merged;
}

/** A linha entregue (sem o `status` da linha local). */
export const isDelivered = (line: FanClubCommentLine): boolean => line.status === undefined;

// --- A moderação na lista (seção 37, 37.6 e 37.9, item 4; a etapa 7 de 37.13) ---------

const timeOf = (comment: FanClubComment): number => Date.parse(comment.createdAt);

/** Os comentários do fã ocultos pelo gestor, já postos na lista (o `ownHidden`, 37.3). */
export interface OwnHiddenPlacement<T extends FanClubComment> {
  /** Os de cima, do mais novo, com os ocultos do fã que entram entre eles. */
  top: T[];
  /** As respostas ocultas do fã cujo comentário de cima está na lista, da mais antiga. */
  replies: ReadonlyMap<string, T[]>;
}

/**
 * Onde entram os comentários do fã ocultos pelo gestor (37.9, item 4): pela
 * data. O de cima, entre os de cima; a resposta, embaixo do comentário de cima
 * dela quando ele está na lista carregada e, quando não está, entre os de cima
 * pela data dela, sem recuo (o texto já começa pelo @ de quem foi respondido,
 * R7). O mais antigo que todos os carregados vai ao fim deles. Sem repetir o
 * que a lista já tem.
 */
export function placeOwnHidden<T extends FanClubComment>(
  top: readonly T[],
  ownHidden: readonly T[] | undefined,
): OwnHiddenPlacement<T> {
  const hidden = ownHidden ?? [];
  const listed = new Set(top.map((comment) => comment.id));
  const tops = new Set([
    ...listed,
    ...hidden.filter((comment) => comment.replyToId === null).map((comment) => comment.id),
  ]);
  const replies = new Map<string, T[]>();
  const loose: T[] = [];
  for (const comment of hidden) {
    if (listed.has(comment.id)) continue;
    if (comment.replyToId !== null && tops.has(comment.replyToId)) {
      replies.set(comment.replyToId, [...(replies.get(comment.replyToId) ?? []), comment]);
    } else {
      loose.push(comment);
    }
  }
  for (const [threadId, lines] of replies) {
    replies.set(
      threadId,
      [...lines].sort((a, b) => timeOf(a) - timeOf(b)),
    );
  }
  const merged = [...top];
  for (const comment of loose) {
    const at = merged.findIndex((item) => timeOf(item) < timeOf(comment));
    if (at === -1) merged.push(comment);
    else merged.splice(at, 0, comment);
  }
  return { top: merged, replies };
}

/**
 * As respostas carregadas com as do fã ocultas pelo gestor, pela data, da mais
 * antiga, sem repetir (a que o gestor reexibiu volta na lista do servidor).
 */
export function withHiddenReplies<T extends FanClubComment>(
  server: readonly T[],
  hidden: readonly T[],
): T[] {
  const listed = new Set(server.map((comment) => comment.id));
  const merged = [...server];
  for (const comment of hidden) {
    if (listed.has(comment.id)) continue;
    const at = merged.findIndex((item) => timeOf(item) > timeOf(comment));
    if (at === -1) merged.push(comment);
    else merged.splice(at, 0, comment);
  }
  return merged;
}

/** Quem vê o comentário, para as ações dele. */
export interface CommentActionViewer {
  uid: string | null;
  /** O gestor do fã-clube da publicação. */
  isOwner: boolean;
  suspended: boolean;
}

/** As ações de moderação de uma linha (37.6 e 37.9, itens 4 e 10). */
export interface CommentActions {
  /** O botão de opções (Denunciar e Bloquear), nos comentários dos outros, à vista. */
  options: boolean;
  /** "Ocultar", do gestor, no comentário de outro, à vista. */
  hide: boolean;
  /** "Reexibir", do gestor, no que ele ocultou. */
  unhide: boolean;
  /** "Pedir revisão", do autor, no oculto pelo gestor, uma vez por ocultar. */
  review: boolean;
}

const NO_ACTIONS: CommentActions = { options: false, hide: false, unhide: false, review: false };

/**
 * O que a linha oferece a quem vê. A linha local não tem nenhuma. O gestor não
 * oculta o próprio comentário (decisão 21 de 37.1); o que a equipe reexibiu
 * ele só descobre pela recusa (`staff_decided`), porque o comentário não diz.
 * O oculto pelo gestor não se denuncia (a denúncia pede o visível), e o autor
 * suspenso não pede revisão (o 403 da suspensão).
 */
export function commentActions(
  line: FanClubCommentLine,
  viewer: CommentActionViewer,
): CommentActions {
  if (!isDelivered(line)) return NO_ACTIONS;
  const mine = viewer.uid !== null && line.author.uid === viewer.uid;
  const hidden = line.hidden === 'manager';
  return {
    options: !mine && !hidden,
    hide: viewer.isOwner && !mine && !hidden,
    unhide: viewer.isOwner && !mine && hidden,
    review: mine && !viewer.isOwner && hidden && line.review === null && !viewer.suspended,
  };
}

/** O que muda nos contadores quando um comentário sai do visível ou volta a ele. */
export interface HiddenCounterDelta {
  /** No `commentCount` da publicação. */
  commentCount: number;
  /** No `replyCount` do comentário de cima (só na resposta). */
  replyCount: number;
  /** No `hiddenReplyCount` do comentário de cima, que só o gestor recebe (só na resposta). */
  hiddenReplyCount: number;
}

/**
 * Os contadores no ocultar e no reexibir do gestor (37.6), as mesmas contas do
 * servidor: o comentário de cima que sai do visível tira `1 + replyCount` do
 * total da publicação, porque as respostas saem da vista com ele; a resposta
 * que sai tira 1 do `replyCount` do comentário de cima (e passa às ocultas
 * dele) e, se ele está visível, 1 do total. O reexibir faz o contrário. Sem o
 * comentário de cima no cache, ele conta como visível.
 */
export function hiddenCounterDelta(
  comment: FanClubComment,
  top: FanClubComment | undefined,
  hide: boolean,
): HiddenCounterDelta {
  const sign = hide ? -1 : 1;
  if (comment.replyToId === null) {
    return { commentCount: sign * (1 + comment.replyCount), replyCount: 0, hiddenReplyCount: 0 };
  }
  const topVisible = top?.hidden !== 'manager';
  return {
    commentCount: topVisible ? sign : 0,
    replyCount: sign,
    hiddenReplyCount: -sign,
  };
}
