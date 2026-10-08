import {
  AGENDA_LIMIT_DEFAULT,
  readAgenda,
  readMyRsvps,
  rsvpEvent,
  unrsvpEvent,
} from '../../agenda';
import { isArtistId } from '../../centrals';
import { isContentId } from '../../page-cursor';
import { rewardsOf } from '../../points/award';
import type { ActionRewards, AgendaPage, MyRsvps, RsvpResult } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';
import { pageQuery, queryText } from './paging';

// Rotas da agenda (bloco 6): a agenda (geral ou de uma central), as presenças
// do fã e o "Eu vou", o mesmo do post de show. As que gravam rodam no
// runIdempotent, com o perfil exigido. docs/arquitetura-api.md, seção 21.

function eventParam(input: RouteInput): void {
  if (!isContentId(input.params.eventId)) throw apiError('event_not_found');
}

/** `artistId` opcional: fora do formato, a central não existe (404). */
function artistFilter(input: RouteInput): string | null {
  const artistId = queryText(input.query, 'artistId');
  if (artistId === undefined) return null;
  if (!isArtistId(artistId)) throw apiError('artist_not_found');
  return artistId;
}

export const agendaRoutes: ApiRoute[] = [
  {
    method: 'GET',
    pattern: '/agenda',
    writes: false,
    validate: (input) => {
      artistFilter(input);
      pageQuery(input, AGENDA_LIMIT_DEFAULT);
    },
    async handle(ctx): Promise<AgendaPage> {
      const config = await ctx.deps.config.get();
      return readAgenda(ctx.deps.db, {
        artistId: artistFilter(ctx),
        ...pageQuery(ctx, AGENDA_LIMIT_DEFAULT),
        now: ctx.now,
        invitePointsPerSignup: config.points.values.invite_signup,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/me/rsvps',
    writes: false,
    async handle(ctx): Promise<MyRsvps> {
      return readMyRsvps(ctx.deps.db, ctx.uid, ctx.now);
    },
  },
  {
    // "Eu vou": paga uma vez por show, só em show no ar e não encerrado.
    method: 'PUT',
    pattern: '/events/:eventId/rsvp',
    writes: true,
    validate: eventParam,
    async handle(ctx) {
      const eventId = ctx.params.eventId!;
      const { plan } = await rsvpEvent(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        eventId,
      });
      const body: RsvpResult & ActionRewards = {
        eventId,
        going: true,
        pointsAwarded: plan.pointsAwarded,
        ...rewardsOf(plan),
      };
      return { body, plan };
    },
  },
  {
    // Desfazer: em qualquer status do show; não tira ponto.
    method: 'DELETE',
    pattern: '/events/:eventId/rsvp',
    writes: true,
    allowSuspended: true,
    validate: eventParam,
    async handle(ctx) {
      const eventId = ctx.params.eventId!;
      const { plan } = await unrsvpEvent(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        eventId,
      });
      const body: RsvpResult = { eventId, going: false, pointsAwarded: 0 };
      return { body, plan };
    },
  },
];
