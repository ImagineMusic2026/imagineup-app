import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Chaves de outros domínios pelo arquivo, fora do index: o perfil, os posts e
// o ranking leem as centrais daqui (ou o perfil, que lê), e pelo index seria um ciclo.
import { missionKeys, rewardsRefresh, type ActionRewards } from '@/domains/missions';
import { postKeys } from '@/domains/posts/keys';
// O "+N" das recompensas, pelo arquivo (fora do index), como o do curtir.
import { rewardsToast } from '@/domains/profile/action-rewards';
import { profileKeys } from '@/domains/profile/keys';
import { rankingKeys } from '@/domains/ranking/queries';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics, type HapticEvent } from '@/services/haptics';
import { queryOptionsFor } from '@/services/query/client';
import { createIdempotencyKey } from '@/utils/id';

import {
  fetchArtist,
  fetchArtists,
  fetchFanCentrals,
  followArtists,
  joinCentral,
  leaveCentral,
} from './api';
import type {
  ArtistDetails,
  FanCentral,
  FollowArtistsResult,
  FollowArtistsVariables,
  JoinCentralResult,
  JoinCentralVariables,
  LeaveCentralResult,
  LeaveCentralVariables,
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
  leave: ['artists', 'leave'] as const,
};

/**
 * Todos os artistas da Imagine, na ordem de destaque. `enabled: false` deixa
 * para buscar só quando precisar (o nome de uma central que o fã não segue,
 * no chip do ranking).
 */
export function useArtistsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...queryOptionsFor('artists'),
    queryKey: artistKeys.list(),
    queryFn: fetchArtists,
    enabled,
  });
}

/** Centrais que o fã segue, com os pontos dele em cada uma (1b, 1e e os chips da 1f). */
export function useFanCentralsQuery() {
  return useQuery({
    ...queryOptionsFor('artists'),
    queryKey: artistKeys.centrals(),
    queryFn: fetchFanCentrals,
  });
}

/** A central de um artista (página 1d): capa, números e se o fã está nela. */
export function useArtistQuery(artistId: string) {
  return useQuery({
    ...queryOptionsFor('artists'),
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
 * artistas (nenhuma tela o busca antes dela). Seguir rende os pontos de
 * entrada no servidor (uma vez por central): com pontos, carteira, nível e
 * ranking buscam de novo; as missões e as conquistas, pela regra das
 * recompensas (`refreshRewards`, bloco 7). Central que saiu do ar entre a lista e o toque
 * (`notFound`): a lista busca de novo, e a 1l tira da escolha o que sumiu.
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
      refreshRewards(queryClient, result);
      if ((result.pointsAwarded ?? 0) > 0) {
        void queryClient.invalidateQueries({ queryKey: profileKeys.wallet() });
        void queryClient.invalidateQueries({ queryKey: rankingKeys.all });
      }
      await onFollowed?.(result);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.kind === 'notFound') {
        void queryClient.invalidateQueries({ queryKey: artistKeys.list() });
      }
      onError?.(error);
    },
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

/**
 * Marca o fã dentro ou fora da central na página. `fanDelta` acompanha a
 * troca no otimista da entrada (+1, e -1 no erro), para a 1d não mostrar "Na
 * central" com "0 fãs" enquanto o pedido vai.
 */
function setMember(client: QueryClient, artistId: string, isMember: boolean, fanDelta = 0): void {
  client.setQueryData<ArtistDetails>(artistKeys.detail(artistId), (artist) =>
    artist && artist.isMember !== isMember
      ? { ...artist, isMember, fanCount: Math.max(0, artist.fanCount + fanDelta) }
      : artist,
  );
}

/** O `artistId` das variáveis de uma entrada guardada, sem supor o tipo (pode vir do disco). */
export function joinArtistIdOf(variables: unknown): string | null {
  if (typeof variables !== 'object' || variables === null) return null;
  const artistId = (variables as { artistId?: unknown }).artistId;
  return typeof artistId === 'string' ? artistId : null;
}

/**
 * Há entrada desta central esperando o servidor: indo, pausada na fila
 * offline ou restaurada do disco (todas ficam `pending`). O `isPending` do
 * hook da página não basta: ele é do hook, e com a página reaberta não vê a
 * entrada da fila. O "Na central" fica sem toque enquanto isso, senão o sair
 * chegaria antes da entrada, e a entrada recriaria o vínculo depois.
 */
export function useIsJoinPending(artistId: string): boolean {
  return (
    useIsMutating({
      mutationKey: artistMutationKeys.join,
      predicate: (mutation) => joinArtistIdOf(mutation.state.variables) === artistId,
    }) > 0
  );
}

/**
 * Entrar e seguir podem andar uma missão de entrada (bloco 7): as missões
 * buscam de novo com `missionsChanged: true` e sem o campo (as fixtures), e
 * as conquistas da 1e, com conquista nova ou subida de nível.
 */
function refreshRewards(client: QueryClient, result: ActionRewards): void {
  const refresh = rewardsRefresh(result);
  if (refresh.missions) void client.invalidateQueries({ queryKey: missionKeys.all });
  if (refresh.achievements) {
    void client.invalidateQueries({ queryKey: profileKeys.achievements() });
  }
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
  refreshRewards(client, result);
  if (result.pointsAwarded <= 0) return;
  void client.invalidateQueries({ queryKey: profileKeys.wallet() });
  void client.invalidateQueries({ queryKey: rankingKeys.all });
}

/**
 * A entrada não valeu e a tela não tem o que desfazer no lugar: a página e
 * "Suas centrais" buscam de novo, e o servidor diz o que vale. Central fora do
 * ar (`notFound`) faz a 1d mostrar "Esta central não existe mais".
 */
function refreshAfterJoinFailed(client: QueryClient, artistId: string): void {
  void client.invalidateQueries({ queryKey: artistKeys.detail(artistId) });
  void client.invalidateQueries({ queryKey: artistKeys.centrals() });
}

const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.kind === 'notFound';

/**
 * Entrar numa central feito offline fica salvo e volta a rodar quando o app
 * reabre. Para isso a função precisa estar registrada aqui, fora do
 * componente, com o que ela muda nas outras telas. Restaurada do disco, a
 * entrada não tem o contexto do otimista para desfazer: no erro, a página e
 * as centrais buscam de novo.
 */
export function registerArtistMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults<JoinCentralResult, Error, JoinCentralVariables>(
    artistMutationKeys.join,
    {
      mutationFn: (variables) => joinCentral(variables),
      onSuccess: (result) => refreshAfterJoin(client, result),
      onError: (_error, variables) => refreshAfterJoinFailed(client, variables.artistId),
    },
  );
}

export interface JoinAward {
  /** Muda a cada ganho: dispara o "+N". */
  id: number;
  points: number;
  /** A frase do que a entrada rendeu (pontos, missão, nível, conquistas). */
  announcement?: string;
  haptic?: HapticEvent;
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
      setMember(queryClient, id, true, 1);
      // Já com o fã contado (o setMember acima): "Suas centrais" leva o mesmo número.
      const artist = queryClient.getQueryData<ArtistDetails>(artistKeys.detail(id));
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
      if (!mounted.current) return;
      const toast = rewardsToast(result.pointsAwarded, result);
      if (!toast) return;
      awards.current += 1;
      setAward({ id: awards.current, points: result.pointsAwarded, ...toast });
    },
    onError: (error, { artistId: id }, context) => {
      setMember(queryClient, id, false, -1);
      if (context?.inserted) {
        queryClient.setQueryData<FanCentral[]>(artistKeys.centrals(), (centrals) =>
          centrals?.filter((central) => central.artistId !== id),
        );
      }
      // Central que saiu do ar com a página aberta: tentar de novo daria 404
      // para sempre. A página busca de novo e diz que a central não existe
      // mais (o anúncio é dela), e a central sai de "Suas centrais".
      const gone = isNotFound(error);
      if (gone) refreshAfterJoinFailed(queryClient, id);
      if (!mounted.current) return;
      haptics.trigger('error');
      if (!gone) AccessibilityInfo.announceForAccessibility(t('artist.join.error'));
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

/**
 * Sair da central (a sheet provisória "Sair da central" da 1d, UP-48). Não é
 * otimista e não entra na fila offline: o fã confirma na sheet e espera o
 * resultado, como no resgate (`networkMode: 'always'`, sem tentar de novo
 * sozinha). A chave de idempotência é da tentativa: a mesma depois de uma
 * falha incerta, nova depois de uma recusa. No sucesso, a página mostra
 * "Entrar na central", a central sai de "Suas centrais" e as centrais, a
 * página e o mural da home buscam de novo. Carteira e ranking ficam: sair não
 * muda ponto. A página buscada logo depois pode contar o fã por uns 20 s (a
 * cópia do fanCount no servidor); sem desconto local, que a busca desfaria.
 *
 * `onLeft` e `onError` são da sheet (fechar, o aviso na tela) e só rodam com
 * ela montada: a resposta que chega com a sheet já fechada (o arrasto do
 * Android, que não trava) não navega, senão o `router.back()` dela tiraria a
 * 1d da pilha. Aí o hook só avisa o resultado, com o toque de erro na falha.
 */
export interface LeaveCentralOptions {
  /** O servidor confirmou: a sheet fecha e avisa. */
  onLeft?: (result: LeaveCentralResult) => void;
  /** Recusa ou falha: a sheet fica, com o erro acima dos botões. */
  onError?: (error: Error) => void;
}

export function useLeaveCentralMutation(
  artistId: string,
  { onLeft, onError }: LeaveCentralOptions = {},
) {
  const queryClient = useQueryClient();
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation<LeaveCentralResult, Error, LeaveCentralVariables>({
    mutationKey: artistMutationKeys.leave,
    mutationFn: (variables) => leaveCentral(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: (result) => {
      const id = result.artistId;
      setMember(queryClient, id, false);
      queryClient.setQueryData<FanCentral[]>(artistKeys.centrals(), (centrals) =>
        centrals?.filter((central) => central.artistId !== id),
      );
      void queryClient.invalidateQueries({ queryKey: artistKeys.centrals() });
      void queryClient.invalidateQueries({ queryKey: artistKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: postKeys.feed() });
      // A missão de entrar nesta central some para quem é membro (alvo único,
      // 22.2): fora dela, volta na 1g e na aba Missões da 1d.
      void queryClient.invalidateQueries({ queryKey: missionKeys.all });
      if (mounted.current) onLeft?.(result);
      else AccessibilityInfo.announceForAccessibility(t('artist.leave.left'));
    },
    onError: (error) => {
      if (mounted.current) {
        onError?.(error);
        return;
      }
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('artist.leave.error'));
    },
  });

  const leave = (): void => {
    if (mutation.isPending) return;
    const failed = mutation.isError ? mutation.variables : undefined;
    const idempotencyKey =
      failed && failed.artistId === artistId && isUncertain(mutation.error)
        ? failed.idempotencyKey
        : createIdempotencyKey();
    mutation.mutate({ artistId, idempotencyKey });
  };

  return {
    leave,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}
