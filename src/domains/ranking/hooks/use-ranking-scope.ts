import { router, useLocalSearchParams } from 'expo-router';

import { useArtistsQuery, useFanCentralsQuery } from '@/domains/artists';

import type { ScopeArtist } from '../components/ranking-scope-chips';
import { artistIdOf, GLOBAL_SCOPE, scopeFromParam } from '../scope';
import type { RankingScope } from '../types';

export interface RankingScopeState {
  /** O recorte escolhido. */
  scope: RankingScope;
  /** As centrais com chip, depois do "Geral". */
  artists: ScopeArtist[];
  select: (scope: RankingScope) => void;
}

/**
 * O recorte do ranking mora no parâmetro de rota `?artista=<id>`, que o chip
 * tocado muda. O link a frio `/ranking?artista=<id>` já abre com o chip da
 * central escolhido, pronto para o "Ver ranking" da página do artista (1d,
 * fatia F12; a pergunta 7.1.6, aba interna da 1d ou esta tela, segue em aberto).
 *
 * Os chips são as centrais que o fã segue, na ordem dele. Aberto pela página
 * de uma central que ele não segue, o chip dela entra no fim, com o nome da
 * lista de artistas; um id que não existe cai no Geral.
 */
export function useRankingScope(): RankingScopeState {
  const { artista } = useLocalSearchParams<{ artista?: string }>();
  const requested = scopeFromParam(artista);
  const centrals = useFanCentralsQuery();
  const followed: ScopeArtist[] = (centrals.data ?? []).map(({ artistId, name }) => ({
    artistId,
    name,
  }));

  const requestedId = artistIdOf(requested);
  const outside =
    requestedId !== undefined &&
    !centrals.isPending &&
    !followed.some((artist) => artist.artistId === requestedId);
  const catalog = useArtistsQuery({ enabled: outside });
  const extra = outside ? catalog.data?.find((artist) => artist.id === requestedId) : undefined;
  const unknown = outside && catalog.isSuccess && !extra;

  const artists = extra ? [...followed, { artistId: extra.id, name: extra.name }] : followed;

  const select = (next: RankingScope): void => {
    router.setParams({ artista: artistIdOf(next) });
  };

  return { scope: unknown ? GLOBAL_SCOPE : requested, artists, select };
}
