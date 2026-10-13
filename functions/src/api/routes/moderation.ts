import { blockFan, readBlockedFans, reportComment, unblockFan } from '../../moderation';
import { isContentId } from '../../page-cursor';
import type { BlockedFansPage, BlockFanResult, ReportCommentResult } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';
import { blocksQuery } from './paging';
import { fanParam, reportReason } from './params';

// Rotas da moderação mínima (bloco 6, provisória até a UP-48): denunciar o
// comentário de outro fã e bloquear ou desbloquear um fã. Gravam no
// runIdempotent, com o perfil exigido. docs/arquitetura-api.md, 21.2 e 21.8.
// Desde as exigências das lojas (seção 29, 29.2), a lista de bloqueados, só
// lendo; a denúncia de perfil mora em fans.ts.

function commentParams(input: RouteInput): void {
  if (!isContentId(input.params.postId) || !isContentId(input.params.commentId)) {
    throw apiError('comment_not_found');
  }
}

export const moderationRoutes: ApiRoute[] = [
  {
    method: 'POST',
    pattern: '/posts/:postId/comments/:commentId/report',
    writes: true,
    validate: (input) => {
      commentParams(input);
      reportReason(input);
    },
    async handle(ctx) {
      const commentId = ctx.params.commentId!;
      const { plan, status } = await reportComment(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
        commentId,
        reason: reportReason(ctx),
      });
      const body: ReportCommentResult = { commentId, status };
      return { body, plan };
    },
  },
  {
    // A lista para desbloquear (seção 29, decisão 8): só lê, sem chave e sem
    // exigir o perfil (a conta só da equipe recebe a lista vazia) nem olhar a
    // suspensão (desbloquear é livre). Do mais novo ao mais antigo.
    method: 'GET',
    pattern: '/me/blocks',
    writes: false,
    validate: (input) => {
      blocksQuery(input);
    },
    async handle({ deps, uid, query, params, body }): Promise<BlockedFansPage> {
      return readBlockedFans(deps.db, uid, blocksQuery({ query, params, body }));
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
    // Desbloquear: a tela "Fãs bloqueados" e o perfil público (seção 29).
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
