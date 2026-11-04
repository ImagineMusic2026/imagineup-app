import { parseSupportMessage, sendSupportMessage, type SupportMessageInput } from '../../support';
import type { SupportMessageResult } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// O Suporte dos Ajustes (seção 38 de docs/arquitetura-api.md, 38.2; pedido do
// dono de 03/11/2026): o fã manda à equipe um problema, uma sugestão ou um
// feedback, e a equipe lê na seção Suporte do painel. Grava no runIdempotent,
// com o perfil exigido, o teto do dia `support_message` e sem ponto.

/** O corpo conferido, ou 400 `invalid_request` com o campo. */
function bodyMessage(input: RouteInput): SupportMessageInput {
  const parsed = parseSupportMessage(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

export const supportRoutes: ApiRoute[] = [
  {
    // O suspenso também manda (`allowSuspended`, 38.1, decisão 6): é um
    // caminho dele até a equipe, como o "Escrever para a equipe" do aviso. O
    // teto do dia segura o abuso.
    method: 'POST',
    pattern: '/me/support',
    writes: true,
    allowSuspended: true,
    validate: (input) => void bodyMessage(input),
    async handle(ctx) {
      const { plan, id } = await sendSupportMessage(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        input: bodyMessage(ctx),
      });
      const body: SupportMessageResult = { id, status: 'sent' };
      return { body, plan };
    },
  },
];
