import { sourceOf } from '@/config/data-source';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import {
  buildArtistPostsPageFixture,
  buildCommentsPageFixture,
  buildFeedPageFixture,
  findPostFixture,
  postsFixture,
} from './fixtures';
import type { CommentAuthor, Page, PointsAward, Post, PostComment } from './types';

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
  /** Já validado e sem espaço nas pontas (`commentSchema`). */
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
