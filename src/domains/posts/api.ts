import { sourceOf } from '@/config/data-source';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import {
  buildArtistPostsPageFixture,
  buildCommentsPageFixture,
  buildFeedPageFixture,
  findPostFixture,
  moderationFixture,
  postsFixture,
} from './fixtures';
import type {
  BlockedFansPage,
  BlockFanResult,
  CommentAuthor,
  CommentReportReason,
  Page,
  PointsAward,
  Post,
  PostComment,
  ReportCommentResult,
  ReportFanResult,
} from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */

const postUrl = (postId: string) => `/posts/${encodeURIComponent(postId)}`;

export async function fetchFeed(cursor: string | null): Promise<Page<Post>> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return buildFeedPageFixture(fixtureNow(), cursor);
  }
  const { data } = await api.get<Page<Post>>('/feed', { params: { cursor } });
  return data;
}

/** Posts de uma central (grade da 1d), do mais novo ao mais antigo. */
export async function fetchArtistPosts(
  artistId: string,
  cursor: string | null,
): Promise<Page<Post>> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return buildArtistPostsPageFixture(fixtureNow(), artistId, cursor);
  }
  const { data } = await api.get<Page<Post>>(`/artists/${encodeURIComponent(artistId)}/posts`, {
    params: { cursor },
  });
  return data;
}

export async function fetchPost(postId: string): Promise<Post> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return findPostFixture(fixtureNow(), postId);
  }
  const { data } = await api.get<Post>(postUrl(postId));
  return data;
}

/** Comentários do mais novo ao mais antigo, uma página por vez. */
export async function fetchComments(
  postId: string,
  cursor: string | null,
): Promise<Page<PostComment>> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return buildCommentsPageFixture(fixtureNow(), postId, cursor);
  }
  const { data } = await api.get<Page<PostComment>>(`${postUrl(postId)}/comments`, {
    params: { cursor },
  });
  return data;
}

export interface SetLikeVariables {
  postId: string;
  liked: boolean;
  idempotencyKey: string;
}

export async function setPostLike({
  postId,
  liked,
  idempotencyKey,
}: SetLikeVariables): Promise<PointsAward> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return postsFixture.setLike(postId, liked, idempotencyKey, fixtureNow());
  }
  const { data } = await api.request<PointsAward>({
    method: liked ? 'PUT' : 'DELETE',
    url: `${postUrl(postId)}/like`,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

export interface AddCommentVariables {
  postId: string;
  /** Já limpo e validado como o servidor (`commentSchema`). */
  text: string;
  idempotencyKey: string;
  /** Id da linha no app enquanto o comentário vai; o mesmo nas novas tentativas. */
  localId: string;
  /** ISO, de quando o fã mandou: a hora da linha enquanto ela vai. */
  sentAt: string;
  /**
   * Nome e foto do perfil do fã, para a linha aparecer na hora. Não vai para a
   * API, que tira os dois da sessão.
   */
  author: CommentAuthor;
}

export type AddCommentResult = PostComment & PointsAward;

export async function addComment({
  postId,
  text,
  idempotencyKey,
  author,
}: AddCommentVariables): Promise<AddCommentResult> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return postsFixture.addComment({ postId, text, idempotencyKey, author }, fixtureNow());
  }
  const { data } = await api.post<AddCommentResult>(
    `${postUrl(postId)}/comments`,
    { text },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

export interface ReportCommentVariables {
  postId: string;
  commentId: string;
  /** Sem motivo, `null`. */
  reason: CommentReportReason | null;
  idempotencyKey: string;
}

/**
 * Denuncia o comentário de outro fã (moderação provisória, UP-48). A
 * denúncia não esconde nada: vai para a fila da equipe.
 */
export async function reportComment({
  postId,
  commentId,
  reason,
  idempotencyKey,
}: ReportCommentVariables): Promise<ReportCommentResult> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return moderationFixture.report(postId, commentId, reason, idempotencyKey, fixtureNow());
  }
  const { data } = await api.post<ReportCommentResult>(
    `${postUrl(postId)}/comments/${encodeURIComponent(commentId)}/report`,
    { reason },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

export interface BlockFanVariables {
  /** O uid do fã: o autor do comentário (`PostComment.authorId`) ou o do perfil público. */
  fanId: string;
  idempotencyKey: string;
}

/**
 * Bloqueia um fã: os comentários dele somem para quem bloqueou, em todos os
 * posts, e ele não fica sabendo. Pela sheet do comentário e pelo perfil
 * público (seção 29).
 */
export async function blockFan({
  fanId,
  idempotencyKey,
}: BlockFanVariables): Promise<BlockFanResult> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return moderationFixture.block(fanId, idempotencyKey);
  }
  const { data } = await api.put<BlockFanResult>(
    `/me/blocks/${encodeURIComponent(fanId)}`,
    undefined,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

/**
 * Desbloqueia um fã (`DELETE /me/blocks/:fanId`, seção 29): pelo perfil
 * público e pela tela "Fãs bloqueados". Quem não está na lista responde
 * `blocked: false` sem gravar.
 */
export async function unblockFan({
  fanId,
  idempotencyKey,
}: BlockFanVariables): Promise<BlockFanResult> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return moderationFixture.unblock(fanId, idempotencyKey);
  }
  const { data } = await api.delete<BlockFanResult>(`/me/blocks/${encodeURIComponent(fanId)}`, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

export interface ReportFanVariables {
  /** O uid do fã denunciado (o do perfil público). */
  fanId: string;
  /** Sem motivo, `null`. */
  reason: CommentReportReason | null;
  idempotencyKey: string;
}

/**
 * Denuncia o perfil de outro fã (seção 29): a foto, o nome, o @, a bio e as
 * redes vão para a fila da equipe, sem esconder nada. Mora nos posts, com a
 * denúncia de comentário, e lê o mesmo seletor (`sourceOf('posts')`).
 */
export async function reportFan({
  fanId,
  reason,
  idempotencyKey,
}: ReportFanVariables): Promise<ReportFanResult> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return moderationFixture.reportFan(fanId, reason, idempotencyKey);
  }
  const { data } = await api.post<ReportFanResult>(
    `/fans/${encodeURIComponent(fanId)}/report`,
    { reason },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

/**
 * A lista de quem o fã bloqueou (`GET /me/blocks`, seção 29), do mais novo ao
 * mais antigo, uma página por vez. Só lê.
 */
export async function fetchBlockedFans(cursor: string | null): Promise<BlockedFansPage> {
  if (sourceOf('posts') === 'fixtures') {
    await fixtureDelay();
    return moderationFixture.blockedPage(cursor);
  }
  const { data } = await api.get<BlockedFansPage>('/me/blocks', { params: { cursor } });
  return data;
}
