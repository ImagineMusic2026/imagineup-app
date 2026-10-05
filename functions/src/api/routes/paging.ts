import { decodePageCursor, type PageCursor } from '../../page-cursor';
import { PAGE_LIMIT_MAX } from '../../posts/model';
import { apiError } from '../errors';
import type { RouteInput } from '../types';

// Parâmetros comuns das listas do bloco 6 (mural, grade, comentários e
// agenda): `limit` de 1 a 50, com o padrão de cada rota, e o `cursor` opaco.
// Fora disso, 400 invalid_request com o campo. docs/arquitetura-api.md, 21.2.

/** Parâmetro de busca como texto: ausente é undefined; lista ou objeto é inválido. */
export function queryText(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw apiError('invalid_request', { field: name });
  return value;
}

export type PageQuery = { limit: number; cursor: PageCursor | null };

export function pageQuery(input: RouteInput, defaultLimit: number): PageQuery {
  const limitText = queryText(input.query, 'limit');
  let limit = defaultLimit;
  if (limitText !== undefined) {
    if (!/^\d{1,3}$/.test(limitText)) throw apiError('invalid_request', { field: 'limit' });
    limit = Number(limitText);
    if (limit < 1 || limit > PAGE_LIMIT_MAX) throw apiError('invalid_request', { field: 'limit' });
  }
  const cursorText = queryText(input.query, 'cursor');
  const cursor =
    cursorText === undefined || cursorText === '' ? null : decodePageCursor(cursorText);
  if (cursorText && !cursor) throw apiError('invalid_request', { field: 'cursor' });
  return { limit, cursor };
}
