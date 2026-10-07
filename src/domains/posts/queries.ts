import {
  notifyManager,
  onlineManager,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// As centrais pelo arquivo, fora do index: o `artists/queries` lê as chaves dos
// posts, e pelo index seria um ciclo.
import { artistKeys } from '@/domains/artists/queries';
import { describeRewards, missionKeys, rewardsRefresh } from '@/domains/missions';
import { profileKeys, useFanIdentity } from '@/domains/profile';
// O "+N" das recompensas e o festejo das ações pelos arquivos, fora do index.
import { rewardsToast } from '@/domains/profile/action-rewards';
import { noteActionCelebrated } from '@/domains/profile/level-celebrated';
import { rankingKeys } from '@/domains/ranking';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics, type HapticEvent } from '@/services/haptics';
import { queryOptionsFor } from '@/services/query/client';
import { createIdempotencyKey } from '@/utils/id';

import {
  addComment,
  blockFan,
  fetchArtistPosts,
  fetchComments,
  fetchFeed,
  fetchPost,
  reportComment,
  setPostLike,
  type AddCommentResult,
  type AddCommentVariables,
  type BlockFanVariables,
  type ReportCommentVariables,
  type SetLikeVariables,
} from './api';
import {
  findCachedComment,
  insertComment,
  patchPostEverywhere,
  readPost,
  removeAuthorComments,
  withCommentDelta,
  withLike,
} from './cache';
import { postKeys } from './keys';
import type {
  BlockFanResult,
  CommentReportReason,
  CommentStatus,
  PointsAward,
  PostComment,
  ReportCommentResult,
} from './types';

export { postKeys };

export const postMutationKeys = {
  like: ['posts', 'like'] as const,
  comment: ['posts', 'comment'] as const,
  report: ['posts', 'report'] as const,
  block: ['posts', 'block'] as const,
};

/**
 * O comentário que falhou fica na tela como "Não enviado" até o fã tentar de
 * novo. A mutação que ninguém observa (o fã mandou outro depois, ou fechou a
 * tela) sairia do cache em 5 min, e a linha sumiria com o texto dela. As que
 * dão certo saem na hora (`forgetComment`), e sair da conta limpa o resto.
 */
const COMMENT_MUTATION_GC_TIME = Infinity;

function countComment(client: QueryClient, postId: string, delta: number): void {
  patchPostEverywhere(client, postId, (post) => withCommentDelta(post, delta));
}

function commentVariables(mutation: { state: { variables: unknown } }) {
  return mutation.state.variables as AddCommentVariables | undefined;
}

function forgetComment(client: QueryClient, localId: string): void {
  const cache = client.getMutationCache();
  cache
    .findAll({
      mutationKey: postMutationKeys.comment,
      predicate: (mutation) => commentVariables(mutation)?.localId === localId,
    })
    .forEach((mutation) => cache.remove(mutation));
}

/**
 * Falha de resultado incerto (rede, tempo esgotado, servidor): o comentário
 * pode ter sido gravado, e tentar de novo leva a mesma chave de idempotência.
 */
function isUncertain(error: unknown): boolean {
  return !(error instanceof ApiError) || error.isRetryable;
}

/**
 * A lista de comentários não pode perder o que acabou de ser gravado: uma
 * busca que saiu antes da gravação (a primeira página ainda vindo, a página
 * seguinte, uma busca de novo) voltaria sem ele, por cima dele. Ela é
 * cancelada e sai de novo, já com ele.
 */
function refetchComments(client: QueryClient, postId: string): void {
  const queryKey = postKeys.comments(postId);
  void client
    .cancelQueries({ queryKey, exact: true })
    .then(() => client.invalidateQueries({ queryKey, exact: true }));
}

/**
 * Comentar e curtir podem andar uma missão (de comentário, de curtida), mesmo
 * sem render pontos: as missões buscam de novo quando a resposta diz que
 * alguma andou (`missionsChanged`, bloco 7), e sempre quando o campo não vem
 * (as fixtures). As conquistas da 1e buscam de novo com conquista nova ou
 * subida de nível. O saldo (1e, 1h), o extrato, o ranking (1f), a posição e
 * os pontos nas centrais ("você é #12" da 1b, "Suas centrais" da 1e) e o "PTS
 * DA CENTRAL" da 1d (os pontos vão para a central do post) só mudam quando
 * rendeu.
 */
function refreshAfterPoints(client: QueryClient, result: PointsAward): void {
  const refresh = rewardsRefresh(result);
  if (refresh.missions) void client.invalidateQueries({ queryKey: missionKeys.all });
  if (refresh.achievements) {
    void client.invalidateQueries({ queryKey: profileKeys.achievements() });
  }
  if (result.pointsAwarded <= 0) return;
  void client.invalidateQueries({ queryKey: profileKeys.wallet() });
  void client.invalidateQueries({ queryKey: rankingKeys.all });
  void client.invalidateQueries({ queryKey: artistKeys.centrals() });
  void client.invalidateQueries({ queryKey: artistKeys.details() });
}

const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.kind === 'notFound';

/**
 * O post (ou a central dele) saiu do ar entre a lista e o toque: o servidor
 * recusa curtir e comentar com 404. O mural, a grade, o detalhe e o "N posts"
 * da 1d buscam de novo, e a tela do post, com o detalhe ainda no cache, passa
 * a dizer "Este post não existe mais." (o molde é o `refreshAfterGoneEvent`
 * da agenda).
 */
function refreshAfterGonePost(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: postKeys.all });
  void client.invalidateQueries({ queryKey: artistKeys.details() });
}

/**
 * O servidor gravou: o comentário entra no topo da lista com o id local de
 * quando ia, para a linha seguir a mesma na tela, e a contagem do post sobe
 * em todo cache, no mesmo aviso (a tela soma os que ainda vão, e não pode
 * contar este duas vezes nem por um quadro). A contagem só sobe aqui: o
 * comentário que volta do disco com o app reaberto não passa pelo
 * `onMutate`, e um +1 dado antes de fechar o app não estaria mais no post que
 * a tela buscou de novo.
 */
function commitComment(
  client: QueryClient,
  variables: AddCommentVariables,
  result: AddCommentResult,
): void {
  // A lista guarda só o comentário: os pontos e as recompensas ficam fora do cache.
  const {
    pointsAwarded: _points,
    completedMissions: _missions,
    levelUp: _level,
    unlockedAchievements: _achievements,
    missionsChanged: _changed,
    ...comment
  } = result;
  const { postId } = variables;
  notifyManager.batch(() => {
    const placed = insertComment(client, postKeys.comments(postId), {
      ...comment,
      localId: variables.localId,
    });
    countComment(client, postId, 1);
    const listQuery = client
      .getQueryCache()
      .find({ queryKey: postKeys.comments(postId), exact: true });
    if (listQuery && (!placed || listQuery.state.fetchStatus !== 'idle')) {
      refetchComments(client, postId);
    }
  });
  refreshAfterPoints(client, result);
}

/**
 * A contagem certa vem do servidor, mas com outro comentário ainda indo ela
 * voltaria sem ele: o último a terminar busca o post de novo. Sem esperar a
 * busca, para a linha não ficar "enviando…" até ela chegar.
 */
function refreshPostAfterComment(client: QueryClient, variables: AddCommentVariables): void {
  const othersGoing = client.getMutationCache().findAll({
    mutationKey: postMutationKeys.comment,
    status: 'pending',
    predicate: (mutation) => commentVariables(mutation)?.localId !== variables.localId,
  });
  if (othersGoing.length > 0) return;
  void client.invalidateQueries({ queryKey: postKeys.detail(variables.postId) });
}

/**
 * Mutações feitas offline ficam salvas e voltam a rodar quando o app reabre.
 * Para isso a função precisa estar registrada aqui, fora do componente, com o
 * que ela muda nas outras telas (a do componente só vale com ele montado). O
 * hook de comentar repete estes passos e soma os da tela (toque, anúncio,
 * "+N", texto de volta ao campo).
 */
export function registerPostMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults(postMutationKeys.like, {
    mutationFn: (variables: SetLikeVariables) => setPostLike(variables),
    onSuccess: (result: PointsAward) => refreshAfterPoints(client, result),
    onError: (error: unknown) => {
      if (isNotFound(error)) refreshAfterGonePost(client);
    },
  });
  client.setMutationDefaults<AddCommentResult, ApiError, AddCommentVariables>(
    postMutationKeys.comment,
    {
      mutationFn: (variables) => addComment(variables),
      gcTime: COMMENT_MUTATION_GC_TIME,
      onSuccess: (result, variables) => {
        commitComment(client, variables, result);
        forgetComment(client, variables.localId);
      },
      onError: (error) => {
        if (isNotFound(error)) refreshAfterGonePost(client);
      },
      onSettled: (_data, _error, variables) => refreshPostAfterComment(client, variables),
    },
  );
}

export function useFeedQuery() {
  return useInfiniteQuery({
    ...queryOptionsFor('posts'),
    queryKey: postKeys.feed(),
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/**
 * Posts de uma central (grade da 1d), uma página por vez. A lista mora debaixo
 * de `postKeys.all`: curtir e comentar no detalhe chegam a ela.
 */
export function useArtistPostsQuery(artistId: string) {
  return useInfiniteQuery({
    ...queryOptionsFor('posts'),
    queryKey: postKeys.byArtist(artistId),
    queryFn: ({ pageParam }) => fetchArtistPosts(artistId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!artistId,
  });
}

export function usePostQuery(postId: string) {
  return useQuery({
    ...queryOptionsFor('posts'),
    queryKey: postKeys.detail(postId),
    queryFn: () => fetchPost(postId),
    enabled: !!postId,
  });
}

/** Comentários do servidor, do mais novo ao mais antigo, uma página por vez. */
export function useCommentsQuery(postId: string) {
  return useInfiniteQuery({
    ...queryOptionsFor('posts'),
    queryKey: postKeys.comments(postId),
    queryFn: ({ pageParam }) => fetchComments(postId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!postId,
  });
}

/**
 * Os pontos de uma curtida, para o "+N" do botão, com a frase e o toque do
 * que ela rendeu (`describeRewards`). Muda a cada ganho.
 */
export interface LikeAward {
  id: string;
  points: number;
  announcement?: string;
  haptic?: HapticEvent;
}

/**
 * Curtir aparece na hora (otimista), no detalhe e em toda lista com o post
 * (home, grade da central), e desfaz se a API recusar. O toque de "like"
 * acompanha só o curtir, não o descurtir.
 *
 * A curtida pode andar uma missão de curtida: as missões buscam de novo, e a
 * que concluiu rende pontos, que sobem no "+N" do botão (`award`, para o
 * `PointsToast`, que dá o toque `pointsEarned` e o anúncio) e mudam o saldo, o
 * ranking e as centrais.
 */
export function useToggleLikeMutation() {
  const queryClient = useQueryClient();
  const [award, setAward] = useState<LikeAward | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation({
    mutationKey: postMutationKeys.like,
    // Mutações pausadas voltam todas juntas quando a rede volta. O scope põe as
    // curtidas em fila (inclusive as restauradas do disco), para o servidor
    // receber curtir e descurtir na ordem em que o fã tocou.
    scope: { id: 'posts-like' },
    mutationFn: (variables: SetLikeVariables) => setPostLike(variables),
    onMutate: async ({ postId, liked }) => {
      await queryClient.cancelQueries({ queryKey: postKeys.detail(postId) });
      patchPostEverywhere(queryClient, postId, (post) => withLike(post, liked));
      if (liked) haptics.trigger('like');
    },
    onSuccess: (result, { idempotencyKey }) => {
      refreshAfterPoints(queryClient, result);
      // Chegou com a tela fechada (a rede voltou depois): sem o "+N".
      if (!mounted.current) return;
      const toast = rewardsToast(result.pointsAwarded, result);
      if (toast) setAward({ id: idempotencyKey, points: result.pointsAwarded, ...toast });
    },
    onError: (error, { postId, liked }) => {
      // Volta só se nada mudou depois: com curtir e descurtir em fila, o toque
      // seguinte já deixou o post como o fã quer.
      if (readPost(queryClient, postId)?.likedByMe === liked) {
        patchPostEverywhere(queryClient, postId, (post) => withLike(post, !liked));
      }
      if (isNotFound(error)) refreshAfterGonePost(queryClient);
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('post.likeError'));
    },
    onSettled: (_data, _error, { postId }) => {
      // Com outra curtida na fila, a busca traria o post sem ela, e o coração piscaria.
      if (queryClient.isMutating({ mutationKey: postMutationKeys.like }) > 1) return undefined;
      return queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) });
    },
  });

  return {
    ...mutation,
    award,
    toggle: (postId: string, liked: boolean) =>
      mutation.mutate({ postId, liked, idempotencyKey: createIdempotencyKey() }),
  };
}

/** A linha do comentário do fã enquanto ele não está na lista do servidor. */
function localComment(variables: AddCommentVariables, status: CommentStatus): PostComment {
  return {
    id: variables.localId,
    postId: variables.postId,
    authorId: variables.author.id,
    authorName: variables.author.name,
    authorAvatarUrl: variables.author.photoURL,
    authorIsArtist: false,
    text: variables.text,
    createdAt: variables.sentAt,
    status,
  };
}

export interface LocalComments {
  /** Indo, esperando a rede ou recusados, do mais novo ao mais antigo. */
  comments: PostComment[];
  /** Algum está indo agora (não só esperando a rede). */
  sending: boolean;
}

/**
 * Os comentários do fã que ainda não estão na lista do servidor saem das
 * próprias mutações: aparecem na hora, continuam na tela se a lista buscar de
 * novo (puxar, voltar ao app) e voltam do disco com o app reaberto sem rede. O
 * que o servidor gravou sai daqui e entra na lista.
 */
export function useLocalComments(postId: string): LocalComments {
  const entries = useMutationState({
    filters: {
      mutationKey: postMutationKeys.comment,
      predicate: (mutation) =>
        commentVariables(mutation)?.postId === postId &&
        (mutation.state.status === 'pending' || mutation.state.status === 'error'),
    },
    select: (mutation) => ({
      variables: commentVariables(mutation) as AddCommentVariables,
      status: (mutation.state.status === 'error' ? 'failed' : 'pending') as CommentStatus,
      sending: mutation.state.status === 'pending' && !mutation.state.isPaused,
    }),
  });

  return {
    // A fila guarda do mais antigo ao mais novo; a lista é ao contrário.
    comments: entries.map((entry) => localComment(entry.variables, entry.status)).reverse(),
    sending: entries.some((entry) => entry.sending),
  };
}

export interface CommentAward {
  /** Muda a cada ganho: dispara o "+N". */
  id: string;
  points: number;
  /** A frase do que o comentário rendeu além dos pontos (missões, nível, conquistas). */
  rewards?: string;
  haptic?: HapticEvent;
}

export interface AddCommentOptions {
  /**
   * O servidor recusou o comentário com a tela aberta: devolve o texto ao
   * campo se o fã não começou outro. `true` quando devolveu (a linha some);
   * senão ela fica como "Não enviado", para tocar e tentar de novo.
   */
  restoreDraft?: (text: string) => boolean;
}

/**
 * Sem rede, o comentário espera na fila calado: o campo limpa e o "enviando…"
 * fica longe do foco. O leitor de tela ouve que ele vai quando a rede voltar.
 */
function announceIfQueued(): void {
  if (onlineManager.isOnline()) return;
  AccessibilityInfo.announceForAccessibilityWithOptions(t('post.composer.queued'), {
    queue: true,
  });
}

/**
 * Comentar num post. A linha aparece na hora (`useLocalComments`), e a tela
 * soma à contagem os que ainda vão; o que o servidor devolve entra no topo da
 * lista e na contagem, com toque, anúncio e o "+N" dos pontos. Sem rede, o
 * comentário espera na fila (com um aviso ao leitor de tela) e sobrevive ao
 * app fechado (`mutationKey` registrada no `AppProviders`); o `scope` por post
 * manda os comentários na ordem em que o fã escreveu.
 *
 * Recusado pelo servidor, com o campo vazio, o texto volta para ele (a linha
 * some) e o próximo envio leva chave nova. Falha de resultado incerto (rede,
 * servidor), ou recusa com outro texto no campo, deixa a linha "Não enviado",
 * e tocar tenta de novo: com a mesma chave de idempotência depois da falha
 * incerta (o servidor pode ter gravado, e mandar de novo com chave nova
 * duplicaria o comentário e os pontos), com chave nova depois de recusa.
 */
export function useAddCommentMutation(postId: string, { restoreDraft }: AddCommentOptions = {}) {
  const queryClient = useQueryClient();
  const identity = useFanIdentity();
  const [award, setAward] = useState<CommentAward | null>(null);
  const restoreRef = useRef(restoreDraft);
  const mounted = useRef(false);

  useEffect(() => {
    restoreRef.current = restoreDraft;
  }, [restoreDraft]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation({
    mutationKey: postMutationKeys.comment,
    scope: { id: `posts-comment-${postId}` },
    gcTime: COMMENT_MUTATION_GC_TIME,
    mutationFn: (variables: AddCommentVariables) => addComment(variables),
    onSuccess: (result, variables) => {
      commitComment(queryClient, variables, result);
      forgetComment(queryClient, variables.localId);
      // Chegou com a tela fechada (a rede voltou depois): nada de toque nem anúncio.
      if (!mounted.current) return;
      haptics.trigger('commentSent');
      // Com pontos, o "+N" anuncia tudo numa frase só ("Comentário enviado. Mais 2 pontos.").
      const { announcement, haptic } = describeRewards(result.pointsAwarded, result);
      noteActionCelebrated(result, identity.uid);
      if (result.pointsAwarded > 0) {
        setAward({
          id: result.id,
          points: result.pointsAwarded,
          rewards: announcement ?? undefined,
          haptic,
        });
      } else {
        AccessibilityInfo.announceForAccessibility(
          announcement ? `${t('post.composer.sent')} ${announcement}` : t('post.composer.sent'),
        );
      }
    },
    onError: (error, variables) => {
      if (isNotFound(error)) refreshAfterGonePost(queryClient);
      if (!mounted.current) return;
      haptics.trigger('error');
      if (!isUncertain(error) && restoreRef.current?.(variables.text)) {
        forgetComment(queryClient, variables.localId);
        AccessibilityInfo.announceForAccessibility(t('post.composer.error'));
      } else {
        AccessibilityInfo.announceForAccessibility(t('post.comments.failedAnnouncement'));
      }
    },
    onSettled: (_data, _error, variables) => refreshPostAfterComment(queryClient, variables),
  });

  /** Manda o texto (já validado); devolve o id local da linha nova. */
  const send = (text: string): string => {
    const localId = createIdempotencyKey();
    mutation.mutate({
      postId,
      text,
      idempotencyKey: createIdempotencyKey(),
      localId,
      sentAt: new Date().toISOString(),
      author: {
        id: identity.uid ?? '',
        name: identity.name ?? t('post.comments.fallbackName'),
        photoURL: identity.photoURL,
      },
    });
    announceIfQueued();
    return localId;
  };

  /** Toque na linha "Não enviado". */
  const retry = (localId: string): void => {
    const failed = queryClient.getMutationCache().findAll({
      mutationKey: postMutationKeys.comment,
      status: 'error',
      predicate: (item) => commentVariables(item)?.localId === localId,
    });
    const last = failed.at(-1);
    const variables = last && commentVariables(last);
    if (!last || !variables) return;
    forgetComment(queryClient, localId);
    mutation.mutate({
      ...variables,
      idempotencyKey: isUncertain(last.state.error)
        ? variables.idempotencyKey
        : createIdempotencyKey(),
    });
    announceIfQueued();
  };

  return { send, retry, award };
}

/**
 * O comentário que a sheet "Opções do comentário" mostra, lido do cache da
 * lista do post na abertura (o conteúdo fica fixo, para a altura da sheet não
 * mudar). Aberta a frio, sem a lista no cache: `undefined`, e a sheet fecha.
 */
export function useCachedComment(postId: string, commentId: string): PostComment | undefined {
  const client = useQueryClient();
  const [comment] = useState(() =>
    postId && commentId
      ? findCachedComment(client, postKeys.comments(postId), commentId)
      : undefined,
  );
  return comment;
}

/** Os retornos da sheet: só rodam com o hook montado. */
export interface ModerationCallbacks<T> {
  /** O servidor confirmou: a sheet fecha e avisa. */
  onDone?: (result: T) => void;
  /** Recusa ou falha: a sheet fica, com o erro acima dos botões. */
  onError?: (error: Error) => void;
}

function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

const holdsCommentLists = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === postKeys.all[0] && query.queryKey[1] === 'comments';

/**
 * Denunciar o comentário de outro fã (a sheet "Opções do comentário",
 * provisória até a UP-48). Não é otimista e não entra na fila offline
 * (`networkMode: 'always'`, sem tentar de novo sozinha), como o sair da
 * central: o fã confirma na sheet e espera. A chave é da tentativa: a mesma
 * depois de uma falha incerta com o mesmo motivo, nova depois de uma recusa
 * (ou com outro motivo, que o servidor recusaria com a chave de antes).
 * Denunciar não muda cache nenhum: a denúncia não esconde o comentário.
 * `onDone` e `onError` só rodam com a sheet montada; a resposta que chega com
 * ela fechada só avisa.
 */
export function useReportCommentMutation(
  postId: string,
  commentId: string,
  { onDone, onError }: ModerationCallbacks<ReportCommentResult> = {},
) {
  const mounted = useMounted();
  const mutation = useMutation<ReportCommentResult, Error, ReportCommentVariables>({
    mutationKey: postMutationKeys.report,
    mutationFn: (variables) => reportComment(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: (result) => {
      if (mounted.current) {
        onDone?.(result);
        return;
      }
      AccessibilityInfo.announceForAccessibility(t('post.moderation.reported'));
    },
    onError: (error) => {
      if (mounted.current) {
        onError?.(error);
        return;
      }
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('post.moderation.reportError'));
    },
  });

  const report = (reason: CommentReportReason | null): void => {
    if (mutation.isPending) return;
    const failed = mutation.isError ? mutation.variables : undefined;
    const idempotencyKey =
      failed &&
      failed.commentId === commentId &&
      failed.reason === reason &&
      isUncertain(mutation.error)
        ? failed.idempotencyKey
        : createIdempotencyKey();
    mutation.mutate({ postId, commentId, reason, idempotencyKey });
  };

  return {
    report,
    isPending: mutation.isPending,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}

/**
 * Bloquear um fã (a mesma sheet). Como a denúncia: não é otimista, não entra
 * na fila, a chave é da tentativa. No sucesso, os comentários do bloqueado
 * saem de todo cache de comentários na hora, e as listas buscam de novo (já
 * sem ele, do servidor), com a sheet montada ou não.
 */
export function useBlockFanMutation(
  fanId: string,
  { onDone, onError }: ModerationCallbacks<BlockFanResult> = {},
) {
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const mutation = useMutation<BlockFanResult, Error, BlockFanVariables>({
    mutationKey: postMutationKeys.block,
    mutationFn: (variables) => blockFan(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: (result) => {
      removeAuthorComments(queryClient, result.fanId);
      void queryClient.invalidateQueries({ predicate: holdsCommentLists });
      if (mounted.current) {
        onDone?.(result);
        return;
      }
      AccessibilityInfo.announceForAccessibility(t('post.moderation.blockedShort'));
    },
    onError: (error) => {
      if (mounted.current) {
        onError?.(error);
        return;
      }
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('post.moderation.blockError'));
    },
  });

  const block = (): void => {
    if (mutation.isPending) return;
    const failed = mutation.isError ? mutation.variables : undefined;
    const idempotencyKey =
      failed && failed.fanId === fanId && isUncertain(mutation.error)
        ? failed.idempotencyKey
        : createIdempotencyKey();
    mutation.mutate({ fanId, idempotencyKey });
  };

  return {
    block,
    isPending: mutation.isPending,
    isError: mutation.isError,
    reset: mutation.reset,
  };
}
