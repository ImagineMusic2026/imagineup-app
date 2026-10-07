import { isArtistId } from '../../centrals';
import { isContentId } from '../../page-cursor';
import {
  ARTIST_POSTS_LIMIT_DEFAULT,
  commentOnPost,
  COMMENTS_LIMIT_DEFAULT,
  FEED_LIMIT_DEFAULT,
  likePost,
  parseCommentText,
  readArtistPosts,
  readComments,
  readFeed,
  readPostDetails,
  unlikePost,
} from '../../posts';
import { rewardsOf } from '../../points/award';
import type {
  ActionRewards,
  AddCommentResult,
  Page,
  PointsAward,
  Post,
  PostComment,
} from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';
import { pageQuery } from './paging';

// Rotas do mural (bloco 6): o mural das centrais do fã, a grade de uma
// central, o detalhe do post, os comentários, comentar, curtir e descurtir.
// As que gravam rodam no runIdempotent, com o perfil exigido e a atividade
// marcada. docs/arquitetura-api.md, seção 21.

/** Id do post fora do formato: o post não existe (404), como o artistParam do bloco 4. */
function postParam(input: RouteInput): void {
  if (!isContentId(input.params.postId)) throw apiError('post_not_found');
}

function artistParam(input: RouteInput): void {
  if (!isArtistId(input.params.artistId)) throw apiError('artist_not_found');
}

/** O texto limpo do comentário; texto que não é texto é 400, e o que não passa, comment_invalid. */
function commentText(input: RouteInput): string {
  const text = parseCommentText(input.body);
  if (text === undefined) throw apiError('invalid_request', { field: 'text' });
  return text;
}

export const postRoutes: ApiRoute[] = [
  {
    method: 'GET',
    pattern: '/feed',
    writes: false,
    validate: (input) => void pageQuery(input, FEED_LIMIT_DEFAULT),
    async handle(ctx): Promise<Page<Post>> {
      const config = await ctx.deps.config.get();
      return readFeed(ctx.deps.db, ctx.uid, {
        ...pageQuery(ctx, FEED_LIMIT_DEFAULT),
        now: ctx.now,
        sharePointsPerVisit: config.points.values.invite_visit,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/artists/:artistId/posts',
    writes: false,
    validate: (input) => {
      artistParam(input);
      pageQuery(input, ARTIST_POSTS_LIMIT_DEFAULT);
    },
    async handle(ctx): Promise<Page<Post>> {
      const config = await ctx.deps.config.get();
      return readArtistPosts(ctx.deps.db, ctx.uid, ctx.params.artistId!, {
        ...pageQuery(ctx, ARTIST_POSTS_LIMIT_DEFAULT),
        now: ctx.now,
        sharePointsPerVisit: config.points.values.invite_visit,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/posts/:postId',
    writes: false,
    validate: postParam,
    async handle(ctx): Promise<Post> {
      const config = await ctx.deps.config.get();
      return readPostDetails(ctx.deps.db, ctx.uid, ctx.params.postId!, {
        now: ctx.now,
        sharePointsPerVisit: config.points.values.invite_visit,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/posts/:postId/comments',
    writes: false,
    validate: (input) => {
      postParam(input);
      pageQuery(input, COMMENTS_LIMIT_DEFAULT);
    },
    async handle(ctx): Promise<Page<PostComment>> {
      return readComments(
        ctx.deps.db,
        ctx.uid,
        ctx.params.postId!,
        pageQuery(ctx, COMMENTS_LIMIT_DEFAULT),
      );
    },
  },
  {
    // Comentar: o texto é limpo e conferido igual ao app (21.1, decisão 20).
    method: 'POST',
    pattern: '/posts/:postId/comments',
    writes: true,
    validate: (input) => {
      postParam(input);
      commentText(input);
    },
    async handle(ctx) {
      const { plan, comment } = await commentOnPost(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
        text: commentText(ctx),
      });
      // Sem id fixo (só o seed passa), o comentário sempre nasce. As recompensas
      // vão junto (bloco 7, 22.2); o app tira as quatro antes do cache da lista.
      const body: AddCommentResult & ActionRewards = { ...comment!, ...rewardsOf(plan) };
      return { body, plan };
    },
  },
  {
    // Curtir: paga no máximo uma vez na vida; já curtido, sem efeito. A troca
    // para curtido anda as missões de curtida (bloco 7), com as recompensas na resposta.
    method: 'PUT',
    pattern: '/posts/:postId/like',
    writes: true,
    validate: postParam,
    async handle(ctx) {
      const { plan } = await likePost(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
      });
      const body: PointsAward & ActionRewards = {
        pointsAwarded: plan.pointsAwarded,
        ...rewardsOf(plan),
      };
      return { body, plan };
    },
  },
  {
    // Descurtir: em qualquer status do post; não tira ponto.
    method: 'DELETE',
    pattern: '/posts/:postId/like',
    writes: true,
    validate: postParam,
    async handle(ctx) {
      const { plan } = await unlikePost(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
      });
      const body: PointsAward = { pointsAwarded: 0 };
      return { body, plan };
    },
  },
];
