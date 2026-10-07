// Mural (bloco 6): posts das centrais, curtidas e comentários com as contagens
// em shards copiadas pela fila syncPostCounts, as callables do painel e o
// seed. A API (src/api/routes/posts.ts) usa daqui; o seed dos emuladores
// carrega o build (functions/lib/posts). docs/arquitetura-api.md, seção 21.
export { postPanelError, type PostPanelErrorReason } from './errors';
export {
  ARTIST_POSTS_LIMIT_DEFAULT,
  COMMENT_FALLBACK_NAME,
  COMMENT_MAX,
  COMMENTS_LIMIT_DEFAULT,
  FEED_IN_BLOCK,
  FEED_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  parseCommentText,
  POST_MEDIA_SIZES,
  POST_SHARD_COUNT,
  POST_TEXT_MAX,
  PostError,
  type PostErrorReason,
  type PostKind,
  type PostRecord,
} from './model';
export {
  addPost,
  changePostStatus,
  editPost,
  PANEL_CONTENT_SECTION,
  removePost,
  type ContentDeps,
} from './panel';
export {
  CAMILA_SEED_LIKES,
  SEED_ENGAGEMENT,
  SEED_ENGAGEMENT_CONFIG,
  SEED_POSTS,
  seedCamilaLikes,
  seedEngagement,
  seedPosts,
  type SeedEngagementResult,
  type SeedFanKey,
} from './seed';
export {
  commentOnPost,
  countArtistPosts,
  ENGAGEMENT_DELETE_PAGE,
  likePost,
  readArtistPosts,
  readComments,
  readFeed,
  readPostDetails,
  removeFanEngagement,
  runComment,
  runLikePost,
  syncPostCounts,
  unlikePost,
  type CommentOutcome,
  type LikeOutcome,
  type PostCountsSync,
} from './service';
export {
  commentRef,
  commentsRef,
  countShardRef,
  countShardsRef,
  postLikeRef,
  postLikesRef,
  postRef,
  postsRef,
  readVisiblePost,
} from './store';
export {
  POST_COUNTS_MAX_ATTEMPTS,
  POST_COUNTS_QUEUE,
  postCountsSyncTask,
  queuePostCountSync,
  runPostCountSync,
  type PostCountsQueue,
} from './sync';
