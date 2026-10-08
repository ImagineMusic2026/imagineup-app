import { blockFan, parseReportReason, reportComment, unblockFan } from '../../moderation';
import { isContentId } from '../../page-cursor';
import type { BlockFanResult, ReportCommentResult } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';
import { fanParam } from './params';

// Rotas da moderação mínima (bloco 6, provisória até a UP-48): denunciar o
// comentário de outro fã e bloquear ou desbloquear um fã. Gravam no
// runIdempotent, com o perfil exigido. docs/arquitetura-api.md, 21.2 e 21.8.

function commentParams(input: RouteInput): void {
  if (!isContentId(input.params.postId) || !isContentId(input.params.commentId)) {
    throw apiError('comment_not_found');
  }
}

function reasonOf(input: RouteInput) {
  const reason = parseReportReason(input.body);
  if (reason === undefined) throw apiError('invalid_request', { field: 'reason' });
  return reason;
}

export const moderationRoutes: ApiRoute[] = [
  {
    method: 'POST',
    pattern: '/posts/:postId/comments/:commentId/report',
    writes: true,
    validate: (input) => {
      commentParams(input);
      reasonOf(input);
    },
    async handle(ctx) {
      const commentId = ctx.params.commentId!;
      const { plan, status } = await reportComment(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
        commentId,
        reason: reasonOf(ctx),
      });
      const body: ReportCommentResult = { commentId, status };
      return { body, plan };
    },
  },
  {
    method: 'PUT',
    pattern: '/me/blocks/:fanId',
    writes: true,
    allowSuspended: true,
    validate: fanParam,
    async handle(ctx) {
      const fanId = ctx.params.fanId!;
      const { plan } = await blockFan(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        fanId,
      });
      const body: BlockFanResult = { fanId, blocked: true };
      return { body, plan };
    },
  },
  {
    // Desbloquear: ainda sem tela no app (pergunta 8 de 21.16).
    method: 'DELETE',
    pattern: '/me/blocks/:fanId',
    writes: true,
    allowSuspended: true,
    validate: fanParam,
    async handle(ctx) {
      const fanId = ctx.params.fanId!;
      const { plan } = await unblockFan(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        fanId,
      });
      const body: BlockFanResult = { fanId, blocked: false };
      return { body, plan };
    },
  },
];
