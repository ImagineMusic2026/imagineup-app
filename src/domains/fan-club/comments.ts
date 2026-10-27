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
