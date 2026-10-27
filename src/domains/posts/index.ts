// O coração do curtir e as cores das pílulas de ação saem também para as
// reações do fã-clube (seção 37, 37.9). Da etapa 6 de 37.13, o campo, o
// esqueleto e os ajudantes da lista de comentários, para a tela da publicação
// do fã-clube; os ajudantes são genéricos no tipo.
export { commentKey, mergeComments, type CommentListItem } from './comment-list';
export {
  CommentComposer,
  type CommentComposerHandle,
  type CommentComposerProps,
  type ComposerReply,
  type ComposerSelection,
} from './components/comment-composer';
export { CommentRowsSkeleton } from './components/comment-row';
export {
  ACTION_COUNT_COLOR,
  ACTION_ICON_COLOR,
  ACTION_ICON_SIZE,
  LikeHeart,
} from './components/like-heart';
export { openArtistOverStack } from './components/post-author-row';
export { PostDivider, PostRow, PostRowsSkeleton, type PostRowProps } from './components/post-row';
export { useSharePost } from './hooks/use-share-post';
export {
  moderationKeys,
  postKeys,
  postMutationKeys,
  registerPostMutationDefaults,
  useAddCommentMutation,
  useArtistPostsQuery,
  useBlockedFansInfiniteQuery,
  useBlockFanMutation,
  useCachedComment,
  useCommentsQuery,
  useFeedQuery,
  useLocalComments,
  usePostQuery,
  useReportCommentMutation,
  useReportFanMutation,
  useToggleLikeMutation,
  useUnblockFanMutation,
  type ModerationCallbacks,
} from './queries';
export { postPath, sharePost } from './share-post';
export type {
  BlockedFan,
  BlockedFansPage,
  BlockFanResult,
  CommentAuthor,
  CommentReportReason,
  CommentStatus,
  Post,
  PostArtist,
  PostComment,
  PostEvent,
  PostKind,
  PostMedia,
  ReportCommentResult,
  ReportFanResult,
} from './types';
export { CommentOptionsSheetScreen } from './views/comment-options-sheet';
export { PostDetailsScreen } from './views/post-details';
