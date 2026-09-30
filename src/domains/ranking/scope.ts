import type { RankingScope } from './types';

export const GLOBAL_SCOPE: RankingScope = { kind: 'global' };

/**
 * O recorte em texto, para o valor do chip e a chave do cache. O id do
 * artista vai com prefixo: um @ de central que fosse "global" não se
 * confunde com o ranking geral.
 */
export type ScopeKey = 'global' | `artist:${string}`;

export function scopeKey(scope: RankingScope): ScopeKey {
  return scope.kind === 'global' ? 'global' : `artist:${scope.artistId}`;
}

export function scopeFromKey(key: ScopeKey): RankingScope {
  return key === 'global'
    ? GLOBAL_SCOPE
    : { kind: 'artist', artistId: key.slice('artist:'.length) };
}

/** O id do artista do recorte, para a API; `undefined` no geral. */
export function artistIdOf(scope: RankingScope): string | undefined {
  return scope.kind === 'artist' ? scope.artistId : undefined;
}

/**
 * O recorte pelo parâmetro de rota `?artista=<id>`, que o chip muda e que abre
 * o ranking com o chip daquela central escolhido. Sem parâmetro, o geral.
 */
export function scopeFromParam(artistId: string | string[] | undefined): RankingScope {
  const id = Array.isArray(artistId) ? artistId[0] : artistId;
  return id ? { kind: 'artist', artistId: id } : GLOBAL_SCOPE;
}
