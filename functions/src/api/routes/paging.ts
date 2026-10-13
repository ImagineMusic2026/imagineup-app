import { BLOCKED_PAGE_MAX, parseBlockCursor, type BlockCursor } from '../../moderation';
import { decodePageCursor, type PageCursor } from '../../page-cursor';
import { PAGE_LIMIT_MAX } from '../../posts/model';
import { apiError } from '../errors';
import type { RouteInput } from '../types';

// Parâmetros comuns das listas do bloco 6 (mural, grade, comentários e
// agenda): `limit` de 1 a 20 (50 até a proteção contra abuso, 27.2), com o
// padrão de cada rota, e o `cursor` opaco.
// Fora disso, 400 invalid_request com o campo. docs/arquitetura-api.md, 21.2.
// A lista de bloqueados (seção 29) usa o mesmo `limit` e o cursor dela,
// `<índice>:<uid>`, porque a lista não guarda datas.

/** Parâmetro de busca como texto: ausente é undefined; lista ou objeto é inválido. */
export function queryText(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw apiError('invalid_request', { field: name });
  return value;
}

export type PageQuery = { limit: number; cursor: PageCursor | null };

/** O `limit` de 1 a 20 (27.2), ou o padrão da rota sem ele. */
export function limitQuery(input: RouteInput, defaultLimit: number): number {
  const limitText = queryText(input.query, 'limit');
  if (limitText === undefined) return defaultLimit;
  if (!/^\d{1,3}$/.test(limitText)) throw apiError('invalid_request', { field: 'limit' });
  const limit = Number(limitText);
  if (limit < 1 || limit > PAGE_LIMIT_MAX) throw apiError('invalid_request', { field: 'limit' });
  return limit;
}

export function pageQuery(input: RouteInput, defaultLimit: number): PageQuery {
  const limit = limitQuery(input, defaultLimit);
  const cursorText = queryText(input.query, 'cursor');
  const cursor =
    cursorText === undefined || cursorText === '' ? null : decodePageCursor(cursorText);
  if (cursorText && !cursor) throw apiError('invalid_request', { field: 'cursor' });
  return { limit, cursor };
}

export type BlocksQuery = { limit: number; cursor: BlockCursor | null };

/**
 * Os parâmetros do `GET /me/blocks` (seção 29, 29.2): o `limit` de sempre
 * (padrão 20) e o cursor `<índice>:<uid>` do `parseBlockCursor`; fora do
 * formato, 400 com o campo.
 */
export function blocksQuery(input: RouteInput): BlocksQuery {
  const limit = limitQuery(input, BLOCKED_PAGE_MAX);
  const cursorText = queryText(input.query, 'cursor');
  if (cursorText === undefined || cursorText === '') return { limit, cursor: null };
  const cursor = parseBlockCursor(cursorText);
  if (!cursor) throw apiError('invalid_request', { field: 'cursor' });
  return { limit, cursor };
}
