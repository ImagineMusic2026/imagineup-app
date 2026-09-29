import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { haptics } from '@/services/haptics';
import { createIdempotencyKey } from '@/utils/id';

import {
  addComment,
  fetchComments,
  fetchFeed,
  fetchPost,
  setPostLike,
  type AddCommentVariables,
  type SetLikeVariables,
} from './api';
import type { Post } from './types';

/** A chave inclui tudo que muda o resultado. */
export const postKeys = {
  all: ['posts'] as const,
  feed: () => [...postKeys.all, 'feed'] as const,
  detail: (postId: string) => [...postKeys.all, 'detail', postId] as const,
  comments: (postId: string) => [...postKeys.all, 'comments', postId] as const,
};

export const postMutationKeys = {
  like: ['posts', 'like'] as const,
  comment: ['posts', 'comment'] as const,
};

/**
 * Mutações feitas offline ficam salvas e voltam a rodar quando o app reabre.
 * Para isso a função precisa estar registrada aqui, fora do componente.
 */
export function registerPostMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults(postMutationKeys.like, {
    mutationFn: (variables: SetLikeVariables) => setPostLike(variables),
  });
  client.setMutationDefaults(postMutationKeys.comment, {
    mutationFn: (variables: AddCommentVariables) => addComment(variables),
  });
}

export function useFeedQuery() {
  return useInfiniteQuery({
    queryKey: postKeys.feed(),
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function usePostQuery(postId: string) {
  return useQuery({
    queryKey: postKeys.detail(postId),
    queryFn: () => fetchPost(postId),
    enabled: !!postId,
  });
}

export function useCommentsQuery(postId: string) {
  return useInfiniteQuery({
    queryKey: postKeys.comments(postId),
    queryFn: ({ pageParam }) => fetchComments(postId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!postId,
  });
}

/**
 * Curtir aparece na hora (otimista) e desfaz se a API recusar. O toque de
 * "like" acompanha só o curtir, não o descurtir.
 */
export function useToggleLikeMutation() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: postMutationKeys.like,
    // Mutações pausadas voltam todas juntas quando a rede volta. O scope põe as
    // curtidas em fila (inclusive as restauradas do disco), para o servidor
    // receber curtir e descurtir na ordem em que o fã tocou.
    scope: { id: 'posts-like' },
    mutationFn: (variables: SetLikeVariables) => setPostLike(variables),
    onMutate: async ({ postId, liked }) => {
      await queryClient.cancelQueries({ queryKey: postKeys.detail(postId) });
      const previous = queryClient.getQueryData<Post>(postKeys.detail(postId));
      queryClient.setQueryData<Post>(postKeys.detail(postId), (post) =>
        post
          ? { ...post, likedByMe: liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) }
          : post,
      );
      if (liked) haptics.trigger('like');
      return { previous };
    },
    onError: (_error, { postId }, context) => {
      if (context?.previous) queryClient.setQueryData(postKeys.detail(postId), context.previous);
      haptics.trigger('error');
    },
    onSettled: (_data, _error, { postId }) =>
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) }),
  });

  return {
    ...mutation,
    toggle: (postId: string, liked: boolean) =>
      mutation.mutate({ postId, liked, idempotencyKey: createIdempotencyKey() }),
  };
}
