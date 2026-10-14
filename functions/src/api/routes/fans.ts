import { readFanPublicProfile } from '../../fan-profile';
import { reportFan } from '../../moderation';
import type { FanPublicProfile, ReportFanResult } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute } from '../types';
import { fanParam, reportReason } from './params';

// O perfil público de outro fã (seção 28 de docs/arquitetura-api.md): a foto,
// o nome e o @ sempre, e a bio e as redes quando o perfil não sai fechado
// (conta privada, suspensa ou que bloqueou quem pede, com o mesmo corpo nos
// três casos). Só lê: sem chave, sem exigir o perfil de quem chama e sem olhar
// a suspensão de quem chama. Desde as exigências das lojas (seção 29), o
// `blockedByMe` e a denúncia de perfil.

export const fanRoutes: ApiRoute[] = [
  {
    // O perfil do alvo e a lista de quem pede (o `blockedByMe`) num getAll e,
    // só quando o perfil não sai fechado por si, a lista de quem o alvo
    // bloqueou. Sem o perfil (conta excluída, só da equipe ou id que não
    // existe): 404.
    method: 'GET',
    pattern: '/fans/:fanId',
    writes: false,
    validate: fanParam,
    async handle({ deps, uid, params }): Promise<FanPublicProfile> {
      const profile = await readFanPublicProfile(deps.db, uid, params.fanId!);
      if (!profile) throw apiError('fan_not_found');
      return profile;
    },
  },
  {
    // Denunciar um perfil (seção 29, 29.2 e 29.4): grava no runIdempotent,
    // com o perfil exigido e sem `allowSuspended` (o suspenso recebe 403). O
    // próprio uid é 400 `own_profile`; o alvo sem perfil, 404. A resposta é a
    // mesma para o perfil aberto e o fechado (o bloqueado não fica sabendo).
    method: 'POST',
    pattern: '/fans/:fanId/report',
    writes: true,
    validate: (input) => {
      fanParam(input);
      reportReason(input);
    },
    async handle(ctx) {
      const fanId = ctx.params.fanId!;
      const { plan, status } = await reportFan(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        fanId,
        reason: reportReason(ctx),
      });
      const body: ReportFanResult = { fanId, status };
      return { body, plan };
    },
  },
];
