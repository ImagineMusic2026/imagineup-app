import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createIdempotencyKey } from '@/utils/id';

import { fetchArtists, fetchFanCentrals, followArtists } from './api';
import type { FollowArtistsResult, FollowArtistsVariables } from './types';

/** A chave inclui tudo que muda o resultado. */
export const artistKeys = {
  all: ['artists'] as const,
  list: () => [...artistKeys.all, 'list'] as const,
  centrals: () => [...artistKeys.all, 'centrals'] as const,
};

/** Todos os artistas da Imagine, na ordem de destaque. */
export function useArtistsQuery() {
  return useQuery({
    queryKey: artistKeys.list(),
    queryFn: fetchArtists,
  });
}

/** Centrais que o fã segue, com a posição dele em cada uma (carrossel da 1b). */
export function useFanCentralsQuery() {
  return useQuery({
    queryKey: artistKeys.centrals(),
    queryFn: fetchFanCentrals,
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
 * as centrais que ele segue (carrossel da 1b), sim. O feed também depende, mas
 * nasce depois da escolha de artistas (nenhuma tela o busca antes dela).
 */
export function useFollowArtistsMutation({ onFollowed, onError }: FollowArtistsOptions = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (variables: FollowArtistsVariables) => followArtists(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: artistKeys.centrals() });
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
