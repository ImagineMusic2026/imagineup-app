import { api } from '@/services/api';

import type { Page, PointsAward, Post, PostComment } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchFeed(cursor: string | null): Promise<Page<Post>> {
  const { data } = await api.get<Page<Post>>('/feed', { params: { cursor } });
  return data;
}

export async function fetchPost(postId: string): Promise<Post> {
  const { data } = await api.get<Post>(`/posts/${postId}`);
  return data;
}

export async function fetchComments(
  postId: string,
  cursor: string | null,
): Promise<Page<PostComment>> {
  const { data } = await api.get<Page<PostComment>>(`/posts/${postId}/comments`, {
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
  const { data } = await api.request<PointsAward>({
    method: liked ? 'PUT' : 'DELETE',
    url: `/posts/${postId}/like`,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

export interface AddCommentVariables {
  postId: string;
  text: string;
  idempotencyKey: string;
}

export async function addComment({
  postId,
  text,
  idempotencyKey,
}: AddCommentVariables): Promise<PostComment & PointsAward> {
  const { data } = await api.post<PostComment & PointsAward>(
    `/posts/${postId}/comments`,
    { text },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}
