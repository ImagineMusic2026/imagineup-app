import {
  claimInvite,
  ensureInviteCode,
  INVITE_LINK_BASE,
  inviteUrl,
  parseClaimBody,
  parseLinkId,
  parseVisitBody,
  recordInviteLink,
  recordInviteVisit,
  type ClaimInput,
  type Parsed,
  type SharedLink,
  type VisitInput,
} from '../../invites';
import type { InviteClaimResult, InviteLinkResult, InviteVisitResult, MyInvite } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// Rotas do bloco 5: o código de convite do fã, o claim depois do cadastro, a
// visita ao link no app e o link compartilhado. As três que gravam rodam no
// runIdempotent, com o perfil exigido e a atividade marcada; o e-mail da chave
// da pessoa sai do ID token. docs/arquitetura-api.md, seção 20.

/** O valor conferido, ou 400 invalid_request com o campo. */
function valueOf<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/**
 * Os corpos levam o `openedAt` do aparelho, que vira null fora da faixa em
 * volta do "agora" do pedido: a validação de antes do relógio só confere o
 * formato (com o relógio da máquina), e a rota confere de novo com o `now`.
 */
const claimBody = (input: RouteInput, now: number = Date.now()): ClaimInput =>
  valueOf(parseClaimBody(input.body, now));

const visitBody = (input: RouteInput, now: number = Date.now()): VisitInput =>
  valueOf(parseVisitBody(input.body, now));

function linkParam(input: RouteInput): SharedLink {
  const link = parseLinkId(input.params.linkId);
  if (!link) throw apiError('invalid_request', { field: 'linkId' });
  return link;
}

export const inviteRoutes: ApiRoute[] = [
  {
    // A sheet "Gerar meu link": o código (criado na primeira chamada, com o
    // perfil exigido), o link do atalho Convidar e os valores da configuração.
    method: 'GET',
    pattern: '/me/invite',
    writes: false,
    async handle({ uid, email, now, deps }): Promise<MyInvite> {
      const [code, config] = await Promise.all([
        ensureInviteCode(
          deps.db,
          { uid, email },
          { inviteKey: deps.inviteKey(), random: deps.random, now },
        ),
        deps.config.get(),
      ]);
      return {
        code,
        url: inviteUrl(code),
        linkBase: INVITE_LINK_BASE,
        pointsPerVisit: config.points.values.invite_visit,
        pointsPerSignup: config.points.values.invite_signup,
      };
    },
  },
  {
    // Depois do cadastro (ou com o código digitado nele): quem trouxe quem.
    method: 'POST',
    pattern: '/invites/claim',
    writes: true,
    validate: (input) => void claimBody(input),
    async handle(ctx) {
      const outcome = await claimInvite(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        email: ctx.email,
        inviteKey: ctx.deps.inviteKey(),
        input: claimBody(ctx, ctx.now),
      });
      const body: InviteClaimResult = { status: outcome.status };
      return { body, plan: outcome.plan };
    },
  },
  {
    // Link de convite que abriu o app de uma conta logada (o app não mostra
    // nada). O corpo é sempre o mesmo: contou ou não, pelo dono ou não, para
    // a resposta não servir de teste do e-mail de ninguém (20.6).
    method: 'POST',
    pattern: '/invites/visit',
    writes: true,
    validate: (input) => void visitBody(input),
    async handle(ctx) {
      const outcome = await recordInviteVisit(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        email: ctx.email,
        inviteKey: ctx.deps.inviteKey(),
        input: visitBody(ctx, ctx.now),
      });
      const body: InviteVisitResult = { status: 'received' };
      return { body, plan: outcome.plan };
    },
  },
  {
    // A folha de compartilhar voltou compartilhada: um link por destino.
    method: 'PUT',
    pattern: '/me/invite/links/:linkId',
    writes: true,
    validate: (input) => void linkParam(input),
    async handle(ctx) {
      const link = linkParam(ctx);
      const outcome = await recordInviteLink(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        link,
      });
      const body: InviteLinkResult = { linkId: link.linkId, created: outcome.created };
      return { body, plan: outcome.plan };
    },
  },
];
