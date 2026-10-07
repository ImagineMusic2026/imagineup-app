import { isArtistId } from '../../centrals/model';
import {
  decodeRankCursor,
  GLOBAL_SCOPE,
  type RankCursor,
  type RankScope,
} from '../../ranking/model';
import { readLeaderboard, readMyRank, readSeason } from '../../ranking/service';
import type { LeaderboardPage, MyRank, Season } from '../contract';
import { apiError } from '../errors';
import type { ReadRoute, RouteInput } from '../types';
import { queryText } from './paging';

// Rotas do bloco 8: a temporada mostrada, o ranking geral ou de uma central
// (só membros), em páginas de 20 com cursor, e a posição do fã com a meta do
// card "Você". Só leem: sem Idempotency-Key e sem exigir o perfil (fã sem
// carteira recebe o ranking com `position: null`). docs/arquitetura-api.md, 23.2.

/**
 * O recorte pelo `artistId` da busca: ausente, o geral; fora do formato do @
 * (ou um id `__.*__`), a central não existe (404 sem ler nada).
 */
function scopeOf(input: RouteInput): RankScope {
  const artistId = queryText(input.query, 'artistId');
  if (artistId === undefined || artistId === '') return GLOBAL_SCOPE;
  if (!isArtistId(artistId)) throw apiError('artist_not_found');
  return { kind: 'artist', artistId };
}

/** O cursor opaco; fora do formato, 400. O `limit` é ignorado (página de 20). */
function cursorOf(input: RouteInput): RankCursor | null {
  const text = queryText(input.query, 'cursor');
  if (text === undefined || text === '') return null;
  const cursor = decodeRankCursor(text);
  if (!cursor) throw apiError('invalid_request', { field: 'cursor' });
  return cursor;
}

export const rankingRoutes: ReadRoute[] = [
  {
    method: 'GET',
    pattern: '/ranking/season',
    writes: false,
    async handle({ now, deps }): Promise<{ season: Season | null }> {
      return readSeason((await deps.config.get()).season, now);
    },
  },
  {
    method: 'GET',
    pattern: '/ranking',
    writes: false,
    validate: (input) => {
      scopeOf(input);
      cursorOf(input);
    },
    async handle(ctx): Promise<LeaderboardPage> {
      const config = await ctx.deps.config.get();
      return readLeaderboard(
        ctx.deps.db,
        ctx.uid,
        config.season,
        ctx.now,
        scopeOf(ctx),
        cursorOf(ctx),
      );
    },
  },
  {
    method: 'GET',
    pattern: '/me/rank',
    writes: false,
    validate: (input) => void scopeOf(input),
    async handle(ctx): Promise<MyRank> {
      const config = await ctx.deps.config.get();
      return readMyRank(ctx.deps.db, ctx.uid, config.season, ctx.now, scopeOf(ctx));
    },
  },
];
