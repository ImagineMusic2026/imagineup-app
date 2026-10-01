import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Chaves de outros domínios pelo arquivo, fora do index: o perfil, os posts e
// o ranking leem as centrais daqui (ou o perfil, que lê), e pelo index seria um ciclo.
import { postKeys } from '@/domains/posts/keys';
import { profileKeys } from '@/domains/profile/keys';
import { rankingKeys } from '@/domains/ranking/queries';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { createIdempotencyKey } from '@/utils/id';

import { fetchArtist, fetchArtists, fetchFanCentrals, followArtists, joinCentral } from './api';
import type {
  ArtistDetails,
  FanCentral,
  FollowArtistsResult,
  FollowArtistsVariables,
  JoinCentralResult,
  JoinCentralVariables,
} from './types';

/** A chave inclui tudo que muda o resultado. */
export const artistKeys = {
  all: ['artists'] as const,
  list: () => [...artistKeys.all, 'list'] as const,
  centrals: () => [...artistKeys.all, 'centrals'] as const,
  details: () => [...artistKeys.all, 'detail'] as const,
  detail: (artistId: string) => [...artistKeys.details(), artistId] as const,
};

export const artistMutationKeys = {
  join: ['artists', 'join'] as const,
};

/**
 * Todos os artistas da Imagine, na ordem de destaque. `enabled: false` deixa
 * para buscar só quando precisar (o nome de uma central que o fã não segue,
 * no chip do ranking).
 */
export function useArtistsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: artistKeys.list(),
    queryFn: fetchArtists,
    enabled,
  });
}

/** Centrais que o fã segue, com a posição dele em cada uma (carrossel da 1b). */
export function useFanCentralsQuery() {
  return useQuery({
    queryKey: artistKeys.centrals(),
    queryFn: fetchFanCentrals,
  });
}

/** A central de um artista (página 1d): capa, números e se o fã está nela. */
export function useArtistQuery(artistId: string) {
  return useQuery({
    queryKey: artistKeys.detail(artistId),
    queryFn: () => fetchArtist(artistId),
    enabled: !!artistId,
  });
}

export interface FollowArtistsOptions {
  /**
   * Roda depois de a API confirmar e antes de a mutação terminar: a ação segue
   * "salvando" até ele acabar (a saída em fade da escolha de artistas, por exemplo).
   */
  onFollowed?: (result: FollowArtistsResult) => Promise<void> | void;
  onError?: (error: Error) => void;
}

function sameArtists(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Seguir centrais. Não entra na fila offline nem tenta de novo sozinha: quem
 * segue na escolha de artistas (1l) espera a resposta para entrar no app, e
 * sem rede o erro aparece na hora para ele tentar de novo (como entrar e
 * cadastrar). Tentar de novo com a mesma escolha, depois de um erro, leva a
 * mesma chave de idempotência: se a rede caiu depois de o servidor gravar, ele
 * não segue duas vezes. Escolha nova é ação nova, com chave nova.
 *
 * A lista de artistas não depende de quem o fã segue, então não é invalidada;
 * as centrais que ele segue (carrossel da 1b) e a página de cada uma (o "Na
 * central" da 1d), sim. O feed também depende, mas nasce depois da escolha de
 * artistas (nenhuma tela o busca antes dela).
 */
export function useFollowArtistsMutation({ onFollowed, onError }: FollowArtistsOptions = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (variables: FollowArtistsVariables) => followArtists(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: artistKeys.centrals() });
      void queryClient.invalidateQueries({ queryKey: artistKeys.details() });
      await onFollowed?.(result);
    },
    onError,
  });

  return {
    ...mutation,
    follow: (artistIds: readonly string[]) => {
      const failed = mutation.isError ? mutation.variables : undefined;
      const idempotencyKey =
        failed && sameArtists(failed.artistIds, artistIds)
          ? failed.idempotencyKey
          : createIdempotencyKey();
      mutation.mutate({ artistIds, idempotencyKey });
    },
  };
}

/**
 * Falha de resultado incerto (rede, tempo esgotado, servidor): o fã pode ter
 * entrado, e tentar de novo leva a mesma chave de idempotência.
 */
function isUncertain(error: unknown): boolean {
  return !(error instanceof ApiError) || error.isRetryable;
}

/** A central como "Suas centrais" (1b, 1e) e os chips do ranking mostram, antes de ter posição. */
function centralOf(artist: ArtistDetails): FanCentral {
  return {
    artistId: artist.id,
    name: artist.name,
    shortName: null,
    photoURL: artist.photoURL,
    fanCount: artist.fanCount,
    fanRank: null,
    seasonPoints: 0,
  };
}

function setMember(client: QueryClient, artistId: string, isMember: boolean): void {
  client.setQueryData<ArtistDetails>(artistKeys.detail(artistId), (artist) =>
    artist && artist.isMember !== isMember ? { ...artist, isMember } : artist,
  );
}

/**
 * O servidor confirmou: a página e as centrais buscam de novo (a posição do
 * fã na central nova vem de lá), e o mural da home também, que mostra os
 * posts das centrais do fã. Com pontos, o saldo, o nível e o ranking também
 * mudaram.
 */
function refreshAfterJoin(client: QueryClient, result: JoinCentralResult): void {
  void client.invalidateQueries({ queryKey: artistKeys.centrals() });
  void client.invalidateQueries({ queryKey: artistKeys.detail(result.artistId) });
  void client.invalidateQueries({ queryKey: postKeys.feed() });
  if (result.pointsAwarded <= 0) return;
  void client.invalidateQueries({ queryKey: profileKeys.wallet() });
  void client.invalidateQueries({ queryKey: rankingKeys.all });
}

/**
 * Entrar numa central feito offline fica salvo e volta a rodar quando o app
 * reabre. Para isso a função precisa estar registrada aqui, fora do
 * componente, com o que ela muda nas outras telas.
 */
export function registerArtistMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults<JoinCentralResult, Error, JoinCentralVariables>(
    artistMutationKeys.join,
    {
      mutationFn: (variables) => joinCentral(variables),
      onSuccess: (result) => refreshAfterJoin(client, result),
    },
  );
}

export interface JoinAward {
  /** Muda a cada ganho: dispara o "+N". */
  id: number;
  points: number;
}

interface JoinContext {
  /** A central entrou em "Suas centrais" aqui, e sai se a API recusar. */
  inserted: boolean;
}

/**
 * "Entrar na central" da página do artista (1d). Aparece na hora (otimista):
 * o botão vira "Na central", e a central entra em "Suas centrais" da home e
 * do perfil e nos chips do ranking, que leem a mesma lista. Os pontos que a
 * API devolver sobem num "+N" (`award`, para o `PointsToast`, que dá o toque e
 * o anúncio). Se a API recusar, tudo volta, com toque de erro e aviso.
 *
 * Sem rede, a entrada espera na fila, com o estado otimista na tela, e
 * sobrevive ao app fechado (`mutationKey` registrada no `AppProviders`). O
 * `scope` por central põe as tentativas em fila. Tentar de novo depois de uma
 * falha incerta leva a mesma chave de idempotência; depois de uma recusa, chave nova.
 */
export function useJoinCentralMutation(artistId: string) {
  const queryClient = useQueryClient();
  const [award, setAward] = useState<JoinAward | null>(null);
  const awards = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation<JoinCentralResult, Error, JoinCentralVariables, JoinContext>({
    mutationKey: artistMutationKeys.join,
    scope: { id: `artists-join-${artistId}` },
    mutationFn: (variables) => joinCentral(variables),
    onMutate: async ({ artistId: id }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: artistKeys.detail(id) }),
        queryClient.cancelQueries({ queryKey: artistKeys.centrals() }),
      ]);
      const artist = queryClient.getQueryData<ArtistDetails>(artistKeys.detail(id));
      setMember(queryClient, id, true);
      let inserted = false;
      if (artist) {
        queryClient.setQueryData<FanCentral[]>(artistKeys.centrals(), (centrals) => {
          if (!centrals || centrals.some((central) => central.artistId === id)) return centrals;
          inserted = true;
          return [...centrals, centralOf(artist)];
        });
        AccessibilityInfo.announceForAccessibility(t('artist.join.joined', { name: artist.name }));
      }
      return { inserted };
    },
    onSuccess: (result) => {
      refreshAfterJoin(queryClient, result);
      // Chegou com a página fechada (a rede voltou depois): nada de "+N".
      if (!mounted.current || result.pointsAwarded <= 0) return;
      awards.current += 1;
      setAward({ id: awards.current, points: result.pointsAwarded });
    },
    onError: (_error, { artistId: id }, context) => {
      setMember(queryClient, id, false);
      if (context?.inserted) {
        queryClient.setQueryData<FanCentral[]>(artistKeys.centrals(), (centrals) =>
          centrals?.filter((central) => central.artistId !== id),
        );
      }
      if (!mounted.current) return;
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('artist.join.error'));
    },
  });

  const join = (): void => {
    if (mutation.isPending) return;
    const failed = mutation.isError ? mutation.variables : undefined;
    const idempotencyKey =
      failed && failed.artistId === artistId && isUncertain(mutation.error)
        ? failed.idempotencyKey
        : createIdempotencyKey();
    mutation.mutate({ artistId, idempotencyKey });
  };

  return { join, award, isPending: mutation.isPending };
}
