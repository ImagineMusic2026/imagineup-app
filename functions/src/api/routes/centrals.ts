import {
  centralPointsAggregate,
  followedAfter,
  isArtistId,
  joinCentrals,
  leaveCentral,
  parseFollowArtistIds,
  readArtistDetails,
  readFanCentrals,
  readFollow,
  readJoin,
  readPublishedArtists,
} from '../../centrals';
import { rewardsOf } from '../../points/award';
import { countArtistPosts } from '../../posts';
import type {
  ActionRewards,
  Artist,
  ArtistDetails,
  FanCentral,
  FollowArtistsResult,
  JoinCentralResult,
  LeaveCentralResult,
} from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// Rotas do bloco 4: as centrais publicadas, a página de uma central, "Suas
// centrais" e seguir, entrar e sair. As três que gravam rodam no
// runIdempotent, com o perfil exigido e a atividade marcada.
// docs/arquitetura-api.md, seção 19.

/**
 * Id da central na rota: fora do formato do @ (ou um id `__.*__`), a central
 * não existe, e a resposta é 404 artist_not_found, como o parseArtistId das
 * callables do painel.
 */
function artistParam(input: RouteInput): void {
  if (!isArtistId(input.params.artistId)) throw apiError('artist_not_found');
}

function followIds(input: RouteInput): string[] {
  const ids = parseFollowArtistIds(input.body);
  if (!ids) throw apiError('invalid_request', { field: 'artistIds' });
  return ids;
}

export const centralRoutes: ApiRoute[] = [
  {
    method: 'GET',
    pattern: '/artists',
    writes: false,
    async handle({ deps }): Promise<Artist[]> {
      return readPublishedArtists(deps.db);
    },
  },
  {
    method: 'GET',
    pattern: '/artists/:artistId',
    writes: false,
    validate: artistParam,
    async handle({ deps, uid, params }): Promise<ArtistDetails> {
      return readArtistDetails(
        deps.db,
        uid,
        params.artistId!,
        centralPointsAggregate(deps.db),
        (artistId) => countArtistPosts(deps.db, artistId),
      );
    },
  },
  {
    method: 'GET',
    pattern: '/me/centrals',
    writes: false,
    async handle({ deps, uid, now }): Promise<FanCentral[]> {
      const config = await deps.config.get();
      return readFanCentrals(deps.db, uid, config.season, now);
    },
  },
  {
    // Escolha de artistas (1l): segue várias de uma vez, tudo ou nada.
    method: 'POST',
    pattern: '/me/artists',
    writes: true,
    validate: (input) => void followIds(input),
    async handle(ctx) {
      const artistIds = followIds(ctx);
      const read = await readFollow(ctx.tx, ctx.deps.db, ctx.fan.uid, artistIds);
      const { plan, joined } = await joinCentrals(ctx.tx, ctx.deps.db, read, {
        fan: ctx.fan,
        award: ctx.award,
        artistIds,
        via: 'onboarding',
      });
      const body: FollowArtistsResult & ActionRewards = {
        followedArtistIds: followedAfter(read, joined, ctx.award.now),
        pointsAwarded: plan.pointsAwarded,
        ...rewardsOf(plan),
      };
      return { body, plan };
    },
  },
  {
    // "Entrar na central" da página do artista (1d).
    method: 'PUT',
    pattern: '/me/centrals/:artistId',
    writes: true,
    validate: artistParam,
    async handle(ctx) {
      const artistId = ctx.params.artistId!;
      const read = await readJoin(ctx.tx, ctx.deps.db, ctx.fan.uid, [artistId]);
      const { plan } = await joinCentrals(ctx.tx, ctx.deps.db, read, {
        fan: ctx.fan,
        award: ctx.award,
        artistIds: [artistId],
        via: 'page',
      });
      const body: JoinCentralResult & ActionRewards = {
        artistId,
        pointsAwarded: plan.pointsAwarded,
        ...rewardsOf(plan),
      };
      return { body, plan };
    },
  },
  {
    // Sair da central: sem vínculo, sucesso sem efeito; em qualquer status da central.
    method: 'DELETE',
    pattern: '/me/centrals/:artistId',
    writes: true,
    validate: artistParam,
    async handle(ctx) {
      const artistId = ctx.params.artistId!;
      const { plan } = await leaveCentral(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        artistId,
      });
      const body: LeaveCentralResult = { artistId };
      return { body, plan };
    },
  },
];
