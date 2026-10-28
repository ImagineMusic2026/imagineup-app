import {
  keepPreviousData,
  notifyManager,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import { artistKeys, useJoinCelebration } from '@/domains/artists';
import { inviteLinkId } from '@/domains/invites';
import { describeRewards, missionKeys, rewardsRefresh } from '@/domains/missions';
import { postKeys } from '@/domains/posts';
import {
  profileKeys,
  useFanIdentity,
  useMyInviteQuery,
  useRegisterInviteLinkMutation,
  type FanContact,
  type PreparedFanClubPhoto,
} from '@/domains/profile';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { queryOptionsFor } from '@/services/query/client';
import { alertActionRefusal } from '@/services/refusal-alert';
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';
import { parseWhatsapp } from '@/utils/whatsapp';

import {
  acceptFanClubRules,
  addFanClubComment,
  applyForFanClub,
  clearFanClubReaction,
  createFanClubPost,
  fanClubFileUploaded,
  fetchArtistFanClubs,
  fetchFanClub,
  fetchFanClubArtists,
  fetchFanClubComments,
  fetchFanClubFeed,
  fetchFanClubMentions,
  fetchFanClubPost,
  fetchFanClubPosts,
  fetchFollowedFanClubs,
  fetchMyFanClub,
  fetchMyFanClubNumbers,
  fetchMyFanClubPosts,
  followFanClub,
  hideFanClubComment,
  openFanClubUpload,
  removeFanClubPost,
  reportFanClubComment,
  reportFanClubPost,
  requestFanClubCommentReview,
  setFanClubReaction,
  unfollowFanClub,
  unhideFanClubComment,
  uploadFanClubFile,
  withdrawApplication,
} from './api';
import { hiddenCounterDelta } from './comments';
import { FAN_CLUB_ERROR_CODES, type FanClubReaction } from './consts';
import { fanClubErrorText } from './describe';
import { isDefinitiveRefusal, leaveCentralNotes, liveFanClub, shownFanClub } from './entry';
import { fanClubKeys } from './keys';
import { withReaction } from './reactions';
import { shareFanClub, type ShareableFanClub } from './share';
import type {
  AddFanClubCommentResult,
  FanClubApplicationBody,
  FanClubCard,
  FanClubComment,
  FanClubCommentHiddenResult,
  FanClubCommentLine,
  FanClubCommentLineStatus,
  FanClubCommentPage,
  FanClubCommentReportReason,
  FanClubCommentReviewResult,
  FanClubListPage,
  FanClubPage,
  FanClubPerson,
  FanClubPost,
  FanClubPostDetails,
  FanClubReactionResult,
  FanClubReportReason,
  FanClubUploadSlot,
  FollowedFanClubs,
  FollowFanClubResult,
  MyFanClub,
  OwnFanClubPost,
  ReportFanClubCommentResult,
  ReportFanClubPostResult,
  UnfollowFanClubResult,
} from './types';

// As consultas e as gravações das telas do fã-clube, pelo `api.ts`: as da
// etapa 7 de 34.14 (os Ajustes, a candidatura e o "Meu fã-clube") e as da
// etapa 8 (a página, o seguir, a denúncia, o card da 1d, a Início e os
// seguidos). Toda gravação fica fora da fila e do disco: `networkMode:
// 'always'`, sem nova tentativa automática e com a chave da tentativa (34.22,
// etapa 6): a mesma depois de uma falha incerta, nova depois de uma recusa
// definitiva. A tela mostra a frase do suspenso, sem o `Alert`
// (`suspendedAlert: false`).

/**
 * Falha de resultado incerto (rede, prazo, servidor): o servidor pode ter
 * gravado, e a nova tentativa leva a mesma chave (e, na foto, os mesmos
 * arquivos). A recusa do Storage (a regra, a sessão trocada) é definitiva.
 */
export function isUncertainFailure(error: unknown): boolean {
  if (error instanceof ApiError) return error.isRetryable;
  const code = (error as { code?: unknown } | null)?.code;
  return code !== 'storage/unauthorized' && code !== 'storage/unauthenticated';
}

/** O 409 `fan_club_refused` com este motivo. */
function isRefused(error: unknown, reason: string): boolean {
  return (
    error instanceof ApiError &&
    error.code === FAN_CLUB_ERROR_CODES.refused &&
    error.details?.reason === reason
  );
}

/** A sessão que pediu, guardada no `onMutate` de cada gravação. */
type StartedBy = { uid: string | null };

const sessionUid = (): string | null => useSessionStore.getState().user?.uid ?? null;

/** O `onMutate`: quem pediu, na hora do pedido (e não a do último render). */
const startedBy = (): StartedBy => ({ uid: sessionUid() });

/** A sessão que pediu ainda é a de agora: a resposta de outra não vai ao cache do fã seguinte. */
const sameSession = (started: StartedBy | undefined): boolean => started?.uid === sessionUid();

/**
 * Se a tela da gravação ainda está montada. Com a sheet fechada (o arrasto do
 * Android não trava), os callbacks do `mutate` não rodam, e quem anuncia a
 * resposta é o hook, no molde da denúncia de perfil.
 */
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

/**
 * Uma recusa definitiva do fã-clube (o 409, os dois 404, a versão das regras
 * que mudou) pode dizer que o estado mudou noutro aparelho, pela equipe ou no
 * servidor: o estado do fã busca de novo (e, com ele, a `rulesVersion` nova).
 */
function refreshAfterRefusal(client: QueryClient, error: unknown): void {
  if (!(error instanceof ApiError)) return;
  const changed =
    error.code === FAN_CLUB_ERROR_CODES.refused ||
    error.code === FAN_CLUB_ERROR_CODES.notFound ||
    error.code === FAN_CLUB_ERROR_CODES.postNotFound ||
    (error.code === FAN_CLUB_ERROR_CODES.invalid && error.details?.field === 'rulesVersion');
  if (changed) void client.invalidateQueries({ queryKey: fanClubKeys.mine() });
}

/**
 * Depois de uma falha incerta, o servidor pode ter gravado: o estado do fã (e
 * as publicações, quando for o caso) busca de novo, para a tela não seguir
 * com o que era antes, no molde do resgate.
 */
function refreshAfterUncertain(client: QueryClient, error: unknown, posts = false): void {
  if (!isUncertainFailure(error)) return;
  void client.invalidateQueries({ queryKey: fanClubKeys.mine() });
  if (posts) void client.invalidateQueries({ queryKey: fanClubKeys.myPosts() });
}

/**
 * O estado do fã (`GET /me/fan-club`): a candidatura, o fã-clube e o programa.
 * É a única rota do fã-clube que os Ajustes chamam, a cada abertura (34.3):
 * com a `api` de antes da publicação, responde 404, que não tenta de novo, e
 * nada aparece. Fica fora do disco: sem a resposta desta abertura do app, nada
 * do fã-clube aparece, nem o que um servidor publicado e depois desfeito (ou a
 * chave `FAN_CLUB_OPEN` desligada depois) respondeu antes.
 */
export function useMyFanClubQuery() {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.mine(),
    queryFn: fetchMyFanClub,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * O estado que as telas podem mostrar (`shownFanClub`): `null` sem resposta,
 * com a recusa definitiva (a `api` de antes) ou com o programa fechado para
 * quem nunca se candidatou. Com `null`, nenhuma outra rota do fã-clube é
 * chamada.
 */
export function useShownFanClub() {
  const query = useMyFanClubQuery();
  return { query, mine: shownFanClub(query.data, query.error) };
}

/**
 * Os números do "Meu fã-clube" (`GET /me/fan-club/numbers`), só com o fã-clube
 * aprovado. Fora do disco, como o estado do fã, que os mostra.
 */
export function useMyFanClubNumbersQuery(enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.numbers(),
    queryFn: fetchMyFanClubNumbers,
    enabled,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * As centrais que aceitam fã-clubes, só na candidatura (34.3: para não ler os
 * `artistPrivate` a cada Ajustes aberto). Busca de novo a cada abertura e
 * fica fora do disco.
 */
export function useFanClubArtistsQuery(enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.artists(),
    queryFn: fetchFanClubArtists,
    enabled,
    staleTime: 0,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * "Minhas publicações" (`GET /me/fan-club/posts`), 10 por página, da mais nova.
 * Fora do disco: as URLs da foto levam o token, que a equipe troca ao ocultar.
 */
export function useMyFanClubPostsQuery(enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useInfiniteQuery({
    ...options,
    queryKey: fanClubKeys.myPosts(),
    queryFn: ({ pageParam }) => fetchMyFanClubPosts(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * As chaves das gravações que a tela espera: o voltar do título fica preso
 * enquanto uma delas vai (`useIsMutating`).
 */
export const fanClubMutationKeys = {
  apply: ['fanClub', 'apply'] as const,
  post: ['fanClub', 'post'] as const,
  follow: ['fanClub', 'follow'] as const,
  unfollow: ['fanClub', 'unfollow'] as const,
  report: ['fanClub', 'report'] as const,
  /** As reações (seção 37), em fila por publicação (o `scope`). */
  react: ['fanClub', 'react'] as const,
  /** Os comentários e as respostas (seção 37), em fila por publicação, só na memória. */
  comment: ['fanClub', 'comment'] as const,
  /**
   * A moderação dos comentários (seção 37, 37.6): a denúncia, o "Pedir
   * revisão" do autor e o ocultar e o reexibir do gestor.
   */
  commentReport: ['fanClub', 'commentReport'] as const,
  commentReview: ['fanClub', 'commentReview'] as const,
  commentHide: ['fanClub', 'commentHide'] as const,
};

/** Uma tentativa: o corpo que foi (em texto, para comparar) e a chave dele. */
type Attempt = { body: string; key: string };

/**
 * A chave da tentativa: a mesma enquanto o corpo é o mesmo e a tentativa
 * está aberta (a falha incerta), nova com outro corpo.
 */
function attemptKey(ref: { current: Attempt | null }, prefix: string, body: unknown): string {
  const text = JSON.stringify(body ?? null);
  if (ref.current?.body !== text) {
    ref.current = { body: text, key: `${prefix}-${createIdempotencyKey()}` };
  }
  return ref.current.key;
}

/**
 * Candidatar (`POST /me/fan-club/application`, decisão 8). No sucesso, o estado
 * novo do fã vai ao cache (a tela mostra "Em análise"), e o WhatsApp, que o
 * servidor gravou no contato do fã (decisão 14), também.
 */
export function useApplyForFanClubMutation() {
  const client = useQueryClient();
  const attempt = useRef<Attempt | null>(null);
  // Um toque só por vez (o `inFlight` do resgate): o `isPending` desliga o
  // botão só depois do aviso do Query e de um render; o `onSettled` solta.
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationKey: fanClubMutationKeys.apply,
    mutationFn: (body: FanClubApplicationBody) =>
      applyForFanClub({ body, idempotencyKey: attemptKey(attempt, 'club-apply', body) }),
    networkMode: 'always',
    retry: false,
    meta: { suspendedAlert: false },
    onMutate: startedBy,
    onSuccess: (mine, body, started) => {
      attempt.current = null;
      if (!sameSession(started)) return;
      client.setQueryData<MyFanClub>(fanClubKeys.mine(), mine);
      client.setQueryData<FanContact>(profileKeys.contact(), {
        whatsapp: parseWhatsapp(body.whatsapp),
      });
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
      refreshAfterRefusal(client, error);
      refreshAfterUncertain(client, error);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const mutate: typeof mutation.mutate = (body, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(body, options);
  };
  return { ...mutation, mutate };
}

/** Desistir da candidatura em análise (`DELETE /me/fan-club/application`). */
export function useWithdrawApplicationMutation() {
  const client = useQueryClient();
  const attempt = useRef<Attempt | null>(null);
  return useMutation({
    mutationFn: () =>
      withdrawApplication({ idempotencyKey: attemptKey(attempt, 'club-withdraw', 'withdraw') }),
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (mine, _variables, started) => {
      attempt.current = null;
      if (sameSession(started)) client.setQueryData<MyFanClub>(fanClubKeys.mine(), mine);
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
    },
  });
}

/** O novo aceite do regulamento (`PUT /me/fan-club/rules`), com a versão de agora. */
export function useAcceptFanClubRulesMutation() {
  const client = useQueryClient();
  const attempt = useRef<Attempt | null>(null);
  return useMutation({
    mutationFn: (rulesVersion: string) =>
      acceptFanClubRules({
        rulesVersion,
        idempotencyKey: attemptKey(attempt, 'club-rules', rulesVersion),
      }),
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (mine, _variables, started) => {
      attempt.current = null;
      if (sameSession(started)) client.setQueryData<MyFanClub>(fanClubKeys.mine(), mine);
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
      refreshAfterRefusal(client, error);
    },
  });
}

/** A publicação de agora no lugar dela, nas páginas de "Minhas publicações". */
function patchMyPost(client: QueryClient, post: OwnFanClubPost): void {
  client.setQueryData<InfiniteData<FanClubListPage<OwnFanClubPost>, string | null>>(
    fanClubKeys.myPosts(),
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => (item.id === post.id ? post : item)),
            })),
          }
        : data,
  );
}

/**
 * Retirar a em análise ou tirar do ar a publicada
 * (`DELETE /me/fan-club/posts/:postId`). Uma tentativa por publicação. No
 * sucesso, a linha troca de status na lista, e o estado do fã busca de novo
 * (as contagens de no ar e em análise).
 */
export function useRemoveFanClubPostMutation() {
  const client = useQueryClient();
  const attempts = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: (postId: string) => {
      let key = attempts.current.get(postId);
      if (!key) {
        key = `club-remove-${createIdempotencyKey()}`;
        attempts.current.set(postId, key);
      }
      return removeFanClubPost({ postId, idempotencyKey: key });
    },
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (post, postId, started) => {
      attempts.current.delete(postId);
      if (!sameSession(started)) return;
      patchMyPost(client, post);
      void client.invalidateQueries({ queryKey: fanClubKeys.mine() });
      // A que estava no ar sai também do que os fãs veem (o "Ver como os fãs
      // veem", a contagem da lista do artista).
      if (post.status === 'removed') {
        void client.invalidateQueries({ queryKey: fanClubKeys.public() });
      }
    },
    onError: (error, postId) => {
      if (!isUncertainFailure(error)) attempts.current.delete(postId);
      if (error instanceof ApiError && error.code === FAN_CLUB_ERROR_CODES.postNotFound) {
        void client.invalidateQueries({ queryKey: fanClubKeys.myPosts() });
      }
      refreshAfterRefusal(client, error);
    },
  });
}

/** O que a "Nova publicação" manda: o texto e, só com `photosAllowed`, a foto preparada em 4:5. */
export interface NewFanClubPost {
  text: string;
  photo: PreparedFanClubPhoto | null;
}

/** O passo do envio em que a tentativa parou, para a frase da recusa. */
export type FanClubPostStep = 'slot' | 'upload' | 'post';

/**
 * Uma tentativa de publicar: o que foi, as duas chaves (a vaga e a
 * publicação), a vaga aberta, os arquivos que já começaram a subir e se o
 * `POST` já foi.
 */
type PostAttempt = {
  post: NewFanClubPost;
  slotKey: string;
  postKey: string;
  slot: FanClubUploadSlot | null;
  sent: { photo: boolean; thumb: boolean };
  posted: boolean;
};

const freshPostAttempt = (post: NewFanClubPost): PostAttempt => ({
  post,
  slotKey: `club-upload-${createIdempotencyKey()}`,
  postKey: `club-post-${createIdempotencyKey()}`,
  slot: null,
  sent: { photo: false, thumb: false },
  posted: false,
});

/**
 * Publicar (34.9, item 6): sem foto, o `POST /me/fan-club/posts`; com foto,
 * três passos, como a foto do perfil: a vaga (`POST /me/fan-club/upload`), os
 * dois arquivos no Storage e o `POST` com `photo: true`. A tentativa é guardada
 * (o mesmo texto e a mesma foto): depois de uma falha incerta, a vaga aberta
 * serve de novo, o arquivo que já chegou não sobe outra vez (o Storage não
 * sobrescreve) e o `POST` leva a mesma chave. Depois que o `POST` foi, a nova
 * tentativa vai direto a ele, com a mesma chave: se ele gravou, o servidor
 * apagou a vaga, e a regra do Storage já não deixa o dono ler os arquivos; a
 * chave devolve a publicação que nasceu. A vaga vencida (10 minutos) abre
 * outra; o `upload_missing` (o `POST` que não gravou e cuja vaga venceu)
 * abre sozinho uma tentativa nova, uma vez, com a mesma foto preparada. Sempre
 * em análise: no sucesso, e também depois de uma falha incerta, "Minhas
 * publicações" e o estado do fã buscam de novo.
 */
export function useCreateFanClubPostMutation() {
  const client = useQueryClient();
  const attempt = useRef<PostAttempt | null>(null);
  const step = useRef<FanClubPostStep>('post');
  // Um toque só por vez: dois toques antes do render dividiriam a mesma
  // tentativa (a mesma vaga e os mesmos arquivos). O `onSettled` solta.
  const inFlight = useRef(false);

  const sendFile = async (
    current: PostAttempt,
    which: 'photo' | 'thumb',
    path: string,
    localUri: string,
  ): Promise<void> => {
    if (current.sent[which] && (await fanClubFileUploaded(path))) return;
    current.sent[which] = true;
    await uploadFanClubFile(path, localUri);
  };

  const send = async (current: PostAttempt): Promise<OwnFanClubPost> => {
    const { photo } = current.post;
    if (photo && !current.posted) {
      if (current.slot && Date.parse(current.slot.expiresAt) <= Date.now()) {
        current.slot = null;
        current.slotKey = `club-upload-${createIdempotencyKey()}`;
        current.sent = { photo: false, thumb: false };
      }
      step.current = 'slot';
      current.slot ??= await openFanClubUpload({ idempotencyKey: current.slotKey });
      step.current = 'upload';
      await sendFile(current, 'photo', current.slot.photoPath, photo.photo.uri);
      await sendFile(current, 'thumb', current.slot.thumbPath, photo.thumb.uri);
    }
    step.current = 'post';
    current.posted = true;
    return createFanClubPost({
      text: current.post.text,
      photo: photo !== null,
      idempotencyKey: current.postKey,
    });
  };

  const mutation = useMutation({
    mutationKey: fanClubMutationKeys.post,
    mutationFn: async (post: NewFanClubPost) => {
      const open = attempt.current;
      if (!open || open.post.text !== post.text || open.post.photo !== post.photo) {
        attempt.current = freshPostAttempt(post);
      }
      const current = attempt.current!;
      try {
        return await send(current);
      } catch (error) {
        if (post.photo === null || !isRefused(error, 'upload_missing')) throw error;
        const fresh = freshPostAttempt(post);
        attempt.current = fresh;
        return send(fresh);
      }
    },
    networkMode: 'always',
    retry: false,
    meta: { suspendedAlert: false },
    onMutate: startedBy,
    onSuccess: (_post, _variables, started) => {
      attempt.current = null;
      if (!sameSession(started)) return;
      void client.invalidateQueries({ queryKey: fanClubKeys.myPosts() });
      void client.invalidateQueries({ queryKey: fanClubKeys.mine() });
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
      refreshAfterRefusal(client, error);
      refreshAfterUncertain(client, error, true);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  // O passo em que a última tentativa parou: a vaga e o envio têm a frase da
  // foto (`clubUpload`), o `POST` a da publicação (`clubPost`).
  const failedStep = (): FanClubPostStep => step.current;
  const mutate: typeof mutation.mutate = (post, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(post, options);
  };
  return { ...mutation, mutate, failedStep };
}

/**
 * Compartilhar um fã-clube: "Compartilhar meu fã-clube" do gestor (34.9, item
 * 5) e o Compartilhar da página e das publicações (item 7), sempre com o
 * código de quem compartilha. A folha do sistema leva o link do fã-clube, o
 * código de convite e o código escrito na mensagem; com o código e a folha
 * voltando compartilhada, o link conta como `fanclub:<id>` (decisão 22), no
 * molde do `useShareArtist`. Sem o código, o link puro.
 */
export function useShareFanClub(): (club: ShareableFanClub) => void {
  const invite = useMyInviteQuery();
  const register = useRegisterInviteLinkMutation();
  const code = invite.data?.code ?? null;
  const linkBase = invite.data?.linkBase;
  return (club) => {
    shareFanClub(club, code, linkBase)
      .then((shared) => {
        if (!shared || !code) return;
        register.mutate({
          linkId: inviteLinkId({ kind: 'fanclub', clubId: club.id }),
          idempotencyKey: createIdempotencyKey(),
        });
      })
      .catch(() => undefined);
  };
}

// --- O que os fãs veem (etapa 8 de 34.14) -----------------------------------------

/**
 * A trava do que os fãs veem (a página, o card da 1d, a Início, os seguidos e
 * o link do fã-clube): o mesmo `GET /me/fan-club` dos Ajustes, na mesma chave
 * e fora do disco, e o `liveFanClub` da resposta. Nenhuma outra rota do
 * fã-clube sai antes de ele responder; com a `api` de antes da publicação (o
 * 404), nada aparece. A recusa definitiva já vista nesta abertura do app não
 * pergunta de novo a cada tela que monta (a Início, cada 1d); os Ajustes, sim
 * (etapa 7), e a resposta nova chega a todas pelo cache. A resposta que veio
 * vale a abertura inteira: só os Ajustes e as gravações a buscam de novo.
 */
export function useFanClubGate() {
  const client = useQueryClient();
  const options = queryOptionsFor('fanClub');
  const cached = client.getQueryState<MyFanClub, Error>(fanClubKeys.mine());
  const refused = cached?.status === 'error' && isDefinitiveRefusal(cached.error);
  const query = useQuery({
    ...options,
    queryKey: fanClubKeys.mine(),
    queryFn: fetchMyFanClub,
    enabled: !refused,
    staleTime: Infinity,
    meta: { ...options.meta, persist: false },
  });
  return { query, live: liveFanClub(query.data, query.error) };
}

/**
 * As frases do fã-clube na sheet "Sair da central" (34.9, item 11, e decisão
 * 27), só depois da trava: quem sai deixa de seguir os fã-clubes do artista,
 * e o gestor de um fã-clube dele fica sem publicar até voltar.
 */
export function useLeaveCentralNotes(artistId: string): TranslationKey[] {
  const { live } = useFanClubGate();
  return leaveCentralNotes(live, artistId);
}

/**
 * A página pública (`GET /fan-clubs/:clubId`), só depois da trava. Fora do
 * disco: o fã-clube pode sair do ar, e o gestor pode ser bloqueado depois. O
 * 404 não tenta de novo (`shouldRetry`).
 */
export function useFanClubPageQuery(clubId: string, enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.club(clubId),
    queryFn: () => fetchFanClub(clubId),
    enabled: enabled && clubId !== '',
    staleTime: 30_000,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * As publicações no ar da página, 10 por página, da mais nova. Fora do disco:
 * as URLs da foto levam o token, que a equipe troca ao ocultar.
 */
export function useFanClubPostsQuery(clubId: string, enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useInfiniteQuery({
    ...options,
    queryKey: fanClubKeys.clubPosts(clubId),
    queryFn: ({ pageParam }) => fetchFanClubPosts(clubId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && clubId !== '',
    meta: { ...options.meta, persist: false },
  });
}

/**
 * Os fã-clubes do artista (o card da 1d e o "Ver todos"), 20 por página: os
 * destacados primeiro, depois pelos seguidores da cópia da noite. Fora do
 * disco, como a página.
 */
export function useArtistFanClubsQuery(artistId: string, enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useInfiniteQuery({
    ...options,
    queryKey: fanClubKeys.byArtist(artistId),
    queryFn: ({ pageParam }) => fetchArtistFanClubs(artistId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && artistId !== '',
    meta: { ...options.meta, persist: false },
  });
}

/** "Fã-clubes que sigo" (`GET /me/fan-club-follows`): até 50, do mais novo. Fora do disco. */
export function useFollowedFanClubsQuery(enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.follows(),
    queryFn: fetchFollowedFanClubs,
    enabled,
    meta: { ...options.meta, persist: false },
  });
}

/** "Dos seus fã-clubes" da Início (`GET /me/fan-club-feed`), 10 por página. Fora do disco. */
export function useFanClubFeedQuery(enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useInfiniteQuery({
    ...options,
    queryKey: fanClubKeys.feed(),
    queryFn: ({ pageParam }) => fetchFanClubFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    meta: { ...options.meta, persist: false },
  });
}

type PostPages = InfiniteData<FanClubListPage<FanClubPost>, string | null>;

const isPostPages = (data: unknown): data is PostPages => {
  const pages = (data as { pages?: unknown } | undefined)?.pages;
  return Array.isArray(pages);
};

const isPost = (item: unknown): item is FanClubPost =>
  typeof item === 'object' && item !== null && 'publishedAt' in item && 'clubName' in item;

/**
 * A publicação que a sheet "Denunciar publicação" mostra, lida na abertura
 * das páginas já carregadas (a página do fã-clube e a Início) ou da tela da
 * publicação (seção 37, 37.9), no molde do `useCachedComment`. Aberta a frio,
 * sem ela, `undefined`, e a sheet fecha: nada do fã-clube abre antes da trava.
 */
export function useCachedFanClubPost(postId: string): FanClubPost | undefined {
  const client = useQueryClient();
  const [post] = useState(() => (postId ? readCachedPost(client, postId) : undefined));
  return post;
}

/** O fã-clube que a sheet "Deixar de seguir" mostra: o nome e o artista. */
export interface CachedFanClub {
  id: string;
  name: string | null;
  artistId: string;
  artistName: string;
}

/**
 * O fã-clube da sheet "Deixar de seguir", lido na abertura: da página dele ou
 * de "Fã-clubes que sigo", de onde a sheet abre. Aberta a frio, sem ele,
 * `undefined`, e a sheet fecha.
 */
export function useCachedFanClub(clubId: string): CachedFanClub | undefined {
  const client = useQueryClient();
  const [club] = useState(() => cachedFanClubOf(client, clubId));
  return club;
}

/** O fã-clube em cache, da página dele ou de "Fã-clubes que sigo". */
function cachedFanClubOf(client: QueryClient, clubId: string): CachedFanClub | undefined {
  if (!clubId) return undefined;
  const page = client.getQueryData<FanClubPage>(fanClubKeys.club(clubId));
  if (page) {
    return {
      id: page.id,
      name: page.name,
      artistId: page.artist.id,
      artistName: page.artist.name,
    };
  }
  const followed = client
    .getQueryData<FollowedFanClubs>(fanClubKeys.follows())
    ?.items.find((item) => item.id === clubId);
  return followed
    ? {
        id: followed.id,
        name: followed.name,
        artistId: followed.artistId,
        artistName: followed.artistName,
      }
    : undefined;
}

/**
 * O gestor do fã-clube, para o "Bloquear e denunciar" da página (decisão 19)
 * e do comentário do gestor (seção 37, 37.9, item 10): a sheet "Denunciar
 * perfil" lê o nome dele daqui quando o perfil público não está no cache. Da
 * página em cache; sem ela (a tela da publicação aberta pela Início), de uma
 * publicação daquele fã-clube em cache, que traz o gestor como autor, ou de
 * um comentário dele marcado como do gestor. Só o gestor deste fã-clube:
 * outro id não acha nada.
 */
export function useCachedFanClubOwner(clubId: string, fanId: string): FanClubPerson | undefined {
  const client = useQueryClient();
  const [owner] = useState(() =>
    clubId && fanId ? cachedClubOwnerOf(client, clubId, fanId) : undefined,
  );
  return owner;
}

/** O gestor do fã-clube no cache do que os fãs veem: a página, as publicações e os comentários. */
function cachedClubOwnerOf(
  client: QueryClient,
  clubId: string,
  fanId: string,
): FanClubPerson | undefined {
  const page = client.getQueryData<FanClubPage>(fanClubKeys.club(clubId));
  if (page) return page.owner.uid === fanId ? page.owner : undefined;
  for (const [, data] of client.getQueriesData({ queryKey: fanClubKeys.public() })) {
    // As páginas de publicações e as de comentários; ou a publicação da tela dela.
    const items: unknown[] = isPostPages(data) ? data.pages.flatMap(itemsOfPage) : [data];
    for (const item of items) {
      if (isPost(item) && item.clubId === clubId && item.author.uid === fanId) {
        return item.author;
      }
      if (
        isComment(item) &&
        item.clubId === clubId &&
        item.isManager &&
        item.author.uid === fanId
      ) {
        return item.author;
      }
    }
  }
  return undefined;
}

/** Os itens de uma página em cache, com os ocultos do fã da página dos comentários. */
const itemsOfPage = (page: { items: unknown[]; ownHidden?: unknown[] }): unknown[] => [
  ...page.items,
  ...(page.ownHidden ?? []),
];

const isComment = (item: unknown): item is FanClubComment =>
  typeof item === 'object' && item !== null && 'replyToId' in item && 'isManager' in item;

/**
 * O seguir de agora na página, nas publicações abertas daquele fã-clube (a
 * tela da publicação, seção 37, 37.9) e nas listas do artista em cache, sem
 * buscar de novo.
 */
function setFollowing(
  client: QueryClient,
  clubId: string,
  following: boolean,
  joined: boolean,
): void {
  client.setQueryData<FanClubPage>(fanClubKeys.club(clubId), (page) => {
    if (!page) return page;
    const delta = page.isFollowing === following ? 0 : following ? 1 : -1;
    return {
      ...page,
      isFollowing: following,
      followerCount: Math.max(0, page.followerCount + delta),
      isMember: page.isMember || joined,
    };
  });
  for (const [queryKey, post] of client.getQueriesData<FanClubPostDetails>({
    queryKey: fanClubKeys.posts(),
  })) {
    if (post?.clubId !== clubId) continue;
    client.setQueryData<FanClubPostDetails>(queryKey, {
      ...post,
      isFollowing: following,
      isMember: post.isMember || joined,
    });
  }
  client.setQueriesData<InfiniteData<FanClubListPage<FanClubCard>, string | null>>(
    { queryKey: fanClubKeys.artistLists() },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === clubId ? { ...item, isFollowing: following } : item,
              ),
            })),
          }
        : data,
  );
}

/** A chave da tentativa por fã-clube: a mesma até uma resposta clara. */
function attemptKeyFor(attempts: Map<string, string>, prefix: string, id: string): string {
  let key = attempts.get(id);
  if (!key) {
    key = `${prefix}-${createIdempotencyKey()}`;
    attempts.set(id, key);
  }
  return key;
}

/** O fã-clube que o seguir manda: o id e o artista, para a comemoração da entrada. */
export interface FollowTarget {
  id: string;
  artistId: string;
}

/**
 * Seguir (`PUT /me/fan-club-follows/:clubId`, decisão 26): fora da central,
 * entra junto. Não é otimista e não entra na fila: o botão fica carregando até
 * a resposta. Um toque só por vez, com a chave da tentativa por fã-clube. No
 * sucesso, a página passa a "Seguindo" (com o número e a central), a lista do
 * artista também, e "Fã-clubes que sigo" e "Dos seus fã-clubes" buscam de
 * novo; o seguir que fez a entrada comemora como a entrada de sempre (o "+N"
 * do `award` e as invalidações das Suas centrais, da 1d, do mural, do ranking
 * e das missões, pelo `useJoinCelebration`). O 404 tira o fã-clube das telas
 * (ele saiu do ar ou o gestor foi bloqueado); a falha incerta busca de novo o
 * que o sucesso mudaria, porque o servidor pode ter gravado
 * (`refreshAfterUncertainFollow`). Quando a página mostra "Seguindo", a
 * tentativa aberta acaba (`closeAttempt`): o seguir seguinte, depois de
 * deixar de seguir, leva chave nova e não recebe a resposta guardada.
 */
export function useFollowFanClubMutation() {
  const client = useQueryClient();
  const { award, celebrate } = useJoinCelebration();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mutation = useMutation<FollowFanClubResult, Error, FollowTarget, StartedBy>({
    mutationKey: fanClubMutationKeys.follow,
    mutationFn: (club) =>
      followFanClub({
        clubId: club.id,
        idempotencyKey: attemptKeyFor(attempts.current, 'club-follow', club.id),
      }),
    networkMode: 'always',
    retry: false,
    meta: { suspendedAlert: false },
    onMutate: startedBy,
    onSuccess: (result, club, started) => {
      attempts.current.delete(club.id);
      if (!sameSession(started)) return;
      setFollowing(client, club.id, true, result.joined);
      void client.invalidateQueries({ queryKey: fanClubKeys.follows() });
      void client.invalidateQueries({ queryKey: fanClubKeys.feed() });
      if (!result.joined) return;
      const { completedMissions, levelUp, unlockedAchievements, missionsChanged } = result;
      celebrate({
        artistId: club.artistId,
        pointsAwarded: result.pointsAwarded,
        completedMissions,
        levelUp,
        unlockedAchievements,
        missionsChanged,
      });
    },
    onError: (error, club) => {
      const uncertain = isUncertainFailure(error);
      if (!uncertain) attempts.current.delete(club.id);
      if (error instanceof ApiError && error.code === FAN_CLUB_ERROR_CODES.notFound) {
        void client.invalidateQueries({ queryKey: fanClubKeys.public() });
      } else if (uncertain) {
        refreshAfterUncertainFollow(client, club.artistId);
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const mutate: typeof mutation.mutate = (club, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(club, options);
  };
  const closeAttempt = useCallback((clubId: string): void => {
    attempts.current.delete(clubId);
  }, []);
  return { ...mutation, mutate, award, closeAttempt };
}

/**
 * O seguir de resultado incerto: o servidor pode ter gravado e, fora da
 * central, feito a entrada. Busca de novo o que o sucesso mudaria, no molde do
 * resgate: o que os fãs veem dos fã-clubes (a página, as listas do artista, os
 * seguidos e a Início), as Suas centrais, a 1d do artista, o mural e o saldo.
 * O ranking e as missões ficam com o `staleTime` deles.
 */
function refreshAfterUncertainFollow(client: QueryClient, artistId: string): void {
  void client.invalidateQueries({ queryKey: fanClubKeys.public() });
  void client.invalidateQueries({ queryKey: artistKeys.centrals() });
  void client.invalidateQueries({ queryKey: artistKeys.detail(artistId) });
  void client.invalidateQueries({ queryKey: postKeys.feed() });
  void client.invalidateQueries({ queryKey: profileKeys.wallet() });
}

/**
 * Deixar de seguir (`DELETE /me/fan-club-follows/:clubId`), na sheet "Deixar
 * de seguir": nunca recusa e não mexe na central. Não é otimista, com a chave
 * da tentativa por fã-clube. No sucesso, a página e a lista do artista passam
 * a "Seguir", o fã-clube sai de "Fã-clubes que sigo" sem buscar de novo, e
 * "Dos seus fã-clubes" busca de novo. A falha incerta busca de novo o que os
 * fãs veem (o servidor pode ter gravado). Com a sheet já fechada, o hook
 * anuncia a resposta.
 */
export function useUnfollowFanClubMutation() {
  const client = useQueryClient();
  const mounted = useMounted();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mutation = useMutation<UnfollowFanClubResult, Error, string, StartedBy>({
    mutationKey: fanClubMutationKeys.unfollow,
    mutationFn: (clubId) =>
      unfollowFanClub({
        clubId,
        idempotencyKey: attemptKeyFor(attempts.current, 'club-unfollow', clubId),
      }),
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (_result, clubId, started) => {
      attempts.current.delete(clubId);
      if (!sameSession(started)) return;
      // O nome, antes de o fã-clube sair dos seguidos.
      const name = cachedFanClubOf(client, clubId)?.name;
      setFollowing(client, clubId, false, false);
      client.setQueryData<FollowedFanClubs>(fanClubKeys.follows(), (data) =>
        data ? { items: data.items.filter((item) => item.id !== clubId) } : data,
      );
      void client.invalidateQueries({ queryKey: fanClubKeys.feed() });
      if (mounted.current) return;
      AccessibilityInfo.announceForAccessibility(
        t('fanClub.unfollow.done', { name: name ?? t('fanClub.follows.unavailableName') }),
      );
    },
    onError: (error, clubId) => {
      const uncertain = isUncertainFailure(error);
      if (!uncertain) attempts.current.delete(clubId);
      if (uncertain) void client.invalidateQueries({ queryKey: fanClubKeys.public() });
      if (mounted.current) return;
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(actionRefusal(error, 'clubUnfollow').key));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const mutate: typeof mutation.mutate = (clubId, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(clubId, options);
  };
  return { ...mutation, mutate };
}

interface ReportVariables {
  postId: string;
  reason: FanClubReportReason | null;
}

/**
 * Denunciar uma publicação (`POST /fan-club-posts/:postId/report`, decisão
 * 18), na sheet "Denunciar publicação", no molde da denúncia de perfil: não é
 * otimista e não entra na fila. A chave é da tentativa: a mesma depois de uma
 * falha incerta com a mesma publicação e o mesmo motivo, nova com outro motivo
 * ou depois de uma recusa. A sheet diz a frase do suspenso, com o link, sem o
 * `Alert` por cima; com a sheet já fechada, o hook anuncia a resposta. A
 * publicação que saiu do ar (o 404) sai também das telas.
 */
export function useReportFanClubPostMutation() {
  const client = useQueryClient();
  const mounted = useMounted();
  const attempt = useRef<Attempt | null>(null);
  const inFlight = useRef(false);
  const mutation = useMutation<ReportFanClubPostResult, Error, ReportVariables>({
    mutationKey: fanClubMutationKeys.report,
    mutationFn: ({ postId, reason }) =>
      reportFanClubPost({
        postId,
        reason,
        idempotencyKey: attemptKey(attempt, `club-report-${postId}`, { postId, reason }),
      }),
    networkMode: 'always',
    retry: false,
    meta: { suspendedAlert: false },
    onSuccess: () => {
      attempt.current = null;
      if (mounted.current) return;
      AccessibilityInfo.announceForAccessibility(t('fanClub.report.sent'));
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
      if (error instanceof ApiError && error.code === FAN_CLUB_ERROR_CODES.postNotFound) {
        void client.invalidateQueries({ queryKey: fanClubKeys.public() });
      }
      if (mounted.current) return;
      haptics.trigger('error');
      const key = fanClubErrorText(error)?.key ?? actionRefusal(error, 'clubReport').key;
      AccessibilityInfo.announceForAccessibility(t(key));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const mutate: typeof mutation.mutate = (variables, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(variables, options);
  };
  return { ...mutation, mutate };
}

// --- As reações (seção 37, 37.9; a etapa 5 de 37.13) -----------------------------------

/** A publicação em cache: numa página de publicações, ou a da tela dela. */
function postIn(data: unknown, postId: string): FanClubPost | undefined {
  if (isPostPages(data)) {
    for (const page of data.pages) {
      const found = page.items.find((item) => isPost(item) && item.id === postId);
      if (found) return found;
    }
    return undefined;
  }
  return isPost(data) && data.id === postId ? data : undefined;
}

/** A publicação de agora no cache do que os fãs veem (a primeira achada). */
function readCachedPost(client: QueryClient, postId: string): FanClubPost | undefined {
  for (const [, data] of client.getQueriesData({ queryKey: fanClubKeys.public() })) {
    const found = postIn(data, postId);
    if (found) return found;
  }
  return undefined;
}

/**
 * A publicação trocada em todo cache do que os fãs veem: as páginas da
 * página do fã-clube, a Início e a tela dela. Só as consultas que têm a
 * publicação mudam (as outras ficam como estavam, sem contar como novas).
 */
function patchFanClubPost(
  client: QueryClient,
  postId: string,
  patch: <T extends FanClubPost>(post: T) => T,
): void {
  for (const [queryKey, data] of client.getQueriesData({ queryKey: fanClubKeys.public() })) {
    if (!postIn(data, postId)) continue;
    if (isPostPages(data)) {
      client.setQueryData<PostPages>(queryKey, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.id === postId ? patch(item) : item)),
        })),
      });
    } else if (isPost(data)) {
      client.setQueryData<FanClubPost>(queryKey, patch(data));
    }
  }
}

/**
 * A publicação de "Minhas publicações" do gestor, fora do `public()`: os
 * totais do `OwnPostCard` (o comentário, o ocultar e a reação dele).
 */
function patchOwnPost(
  client: QueryClient,
  postId: string,
  patch: (post: OwnFanClubPost) => OwnFanClubPost,
): void {
  client.setQueryData<InfiniteData<FanClubListPage<OwnFanClubPost>, string | null>>(
    fanClubKeys.myPosts(),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.id === postId ? patch(item) : item)),
        })),
      },
  );
}

/** As consultas que têm a publicação buscam de novo (a falha incerta pode ter gravado). */
function refreshPost(client: QueryClient, postId: string): void {
  void client.invalidateQueries({
    queryKey: fanClubKeys.public(),
    predicate: (query) => postIn(query.state.data, postId) !== undefined,
  });
}

/**
 * As buscas com a publicação ainda indo (o puxar para atualizar, a volta ao
 * app, o `refreshPost` de um toque anterior da fila) podem ter lido o servidor
 * antes da gravação e chegar por cima da resposta: recomeçam (o
 * `invalidateQueries` cancela a que está indo e busca de novo). As paradas não buscam.
 */
function restartPostFetches(client: QueryClient, postId: string): void {
  void client.invalidateQueries({
    queryKey: fanClubKeys.public(),
    refetchType: 'all',
    predicate: (query) =>
      query.state.fetchStatus === 'fetching' && postIn(query.state.data, postId) !== undefined,
  });
}

/** Um toque: a reação nova (null tira) e a chave dele. */
interface ReactVariables {
  postId: string;
  reaction: FanClubReaction | null;
  idempotencyKey: string;
}

/** A sessão que pediu e a reação de antes do toque, para voltar no erro. */
interface ReactContext extends StartedBy {
  before: FanClubReaction | null;
  /** O `before` é o otimista de um toque ainda indo, e não o que o servidor confirmou. */
  queued: boolean;
}

/**
 * As reações desta publicação ainda indo, contando a que chama (o
 * `onSuccess` roda com ela pendente).
 */
const reactionsGoing = (client: QueryClient, postId: string): number =>
  client.isMutating({
    mutationKey: fanClubMutationKeys.react,
    predicate: (mutation) =>
      (mutation.state.variables as ReactVariables | undefined)?.postId === postId,
  });

/**
 * Reagir, trocar de emoji e tirar a reação (`PUT` e `DELETE
 * /fan-club-posts/:postId/reaction`, R1), otimista na memória (decisão 23 de
 * 37.1): o toque troca o card na hora, em todas as páginas do `public()` com
 * a publicação e na tela dela, no molde do `setFollowing`. As reações da mesma
 * publicação vão em fila (o `scope` por publicação, como o comentário do
 * Mural), e cada toque leva a chave dele (o corpo entra na chave). A resposta
 * acerta os números, também no card do gestor em "Minhas publicações", menos
 * com outro toque da mesma publicação ainda na fila (ele já deixou o card
 * como o fã quer), e a busca que estava indo recomeça
 * (ela pode ter lido o servidor antes da gravação). No erro, volta ao que
 * era, se nada mudou depois, e diz a recusa: o teto do dia e a conta suspensa
 * no `Alert` (o do suspenso pelo `SuspensionWatcher`), o `not_following`
 * (deixou de seguir noutro aparelho) no `Alert` com a frase, e o resto
 * anunciado. Sem fila offline e sem disco: `networkMode: 'always'`, sem nova
 * tentativa e o toque da fila fora do cache salvo. A publicação que saiu do
 * ar some das telas; o `not_following`, a falha incerta e a volta ao
 * otimista de um toque da fila buscam de novo. Sempre 0 ponto (37.5): só as
 * missões e as conquistas buscam de novo quando a resposta pede.
 */
export function useReactToFanClubPostMutation(postId: string) {
  const client = useQueryClient();
  const mutation = useMutation<FanClubReactionResult, Error, ReactVariables, ReactContext>({
    mutationKey: fanClubMutationKeys.react,
    scope: { id: `fan-club-react-${postId}` },
    // O toque que espera na fila do `scope` fica pausado; a fila é só na memória (decisão 23 de 37.1).
    meta: { persist: false },
    mutationFn: (variables) =>
      variables.reaction === null
        ? clearFanClubReaction({
            postId: variables.postId,
            idempotencyKey: variables.idempotencyKey,
          })
        : setFanClubReaction({
            postId: variables.postId,
            reaction: variables.reaction,
            idempotencyKey: variables.idempotencyKey,
          }),
    networkMode: 'always',
    retry: false,
    onMutate: ({ postId: id, reaction }) => {
      const before = readCachedPost(client, id)?.myReaction ?? null;
      patchFanClubPost(client, id, (post) => withReaction(post, reaction));
      // Reagir vibra pelo evento `like`; tirar, com o toque comum do botão.
      if (reaction !== null) haptics.trigger('like');
      // O `onMutate` roda com esta já pendente: ela entra na conta.
      return { ...startedBy(), before, queued: reactionsGoing(client, id) > 1 };
    },
    onSuccess: (result, { postId: id }, context) => {
      if (!sameSession(context)) return;
      const refresh = rewardsRefresh(result);
      if (refresh.missions) void client.invalidateQueries({ queryKey: missionKeys.all });
      if (refresh.achievements) {
        void client.invalidateQueries({ queryKey: profileKeys.achievements() });
      }
      if (reactionsGoing(client, id) > 1) return;
      patchFanClubPost(client, id, (post) => ({
        ...post,
        myReaction: result.reaction,
        reactionCount: result.reactionCount,
        reactionCounts: result.reactionCounts,
      }));
      // O gestor reagiu na própria publicação: o total do card dele em "Minhas publicações".
      patchOwnPost(client, id, (item) =>
        item.reactionCount === undefined
          ? item
          : { ...item, reactionCount: result.reactionCount, reactionCounts: result.reactionCounts },
      );
      restartPostFetches(client, id);
    },
    onError: (error, { postId: id, reaction }, context) => {
      if (context && sameSession(context)) {
        // Volta só se nada mudou depois: o toque seguinte já deixou o card como o fã quer.
        if ((readCachedPost(client, id)?.myReaction ?? null) === reaction) {
          patchFanClubPost(client, id, (post) => withReaction(post, context.before));
        }
        const gone =
          error instanceof ApiError &&
          (error.code === FAN_CLUB_ERROR_CODES.postNotFound ||
            error.code === FAN_CLUB_ERROR_CODES.notFound);
        if (gone || isRefused(error, 'not_following')) {
          void client.invalidateQueries({ queryKey: fanClubKeys.public() });
        } else if (isUncertainFailure(error)) {
          refreshPost(client, id);
        } else if (reactionsGoing(client, id) === 1) {
          // A volta foi ao otimista do toque de antes, que o servidor pode não ter gravado.
          if (context.queued) refreshPost(client, id);
          else restartPostFetches(client, id);
        }
      }
      haptics.trigger('error');
      const refusal = actionRefusal(error, 'clubReact');
      if (alertActionRefusal(refusal.type, 'clubReact')) return;
      if (isRefused(error, 'not_following')) {
        Alert.alert(t('fanClub.errors.refused.notFollowing'));
        return;
      }
      AccessibilityInfo.announceForAccessibility(t(fanClubErrorText(error)?.key ?? refusal.key));
    },
  });
  return {
    ...mutation,
    /** Um toque: o emoji (null tira a reação), com a chave dele. */
    react: (reaction: FanClubReaction | null) =>
      mutation.mutate({
        postId,
        reaction,
        idempotencyKey: `club-react-${createIdempotencyKey()}`,
      }),
  };
}

// --- A tela da publicação (seção 37, 37.9; a etapa 6 de 37.13) -------------------------

/**
 * A publicação no ar (`GET /fan-club-posts/:postId`), só depois da trava. Fora
 * do disco, como a página: a publicação sai do ar, e o gestor pode ser
 * bloqueado. O 404 não tenta de novo (`shouldRetry`).
 */
export function useFanClubPostQuery(postId: string, enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.post(postId),
    queryFn: () => fetchFanClubPost(postId),
    enabled: enabled && postId !== '',
    staleTime: 30_000,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * Os comentários de cima (`replyTo` null), do mais novo, ou as respostas de um
 * deles, da mais antiga, 20 por página. Fora do disco, como tudo o que os fãs
 * veem do fã-clube.
 */
export function useFanClubCommentsQuery(postId: string, replyTo: string | null, enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useInfiniteQuery({
    ...options,
    queryKey: fanClubKeys.comments(postId, replyTo),
    queryFn: ({ pageParam }) => fetchFanClubComments({ postId, replyTo, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && postId !== '',
    meta: { ...options.meta, persist: false },
  });
}

/**
 * A conversa da sugestão do @ (`GET /fan-clubs/:clubId/mentions`, sem o `q`,
 * 37.7): pedida uma vez, quando o campo ganha o foco, e guardada só enquanto
 * a tela está aberta (sai do cache quando ninguém a observa).
 */
export function useFanClubMentionsQuery(clubId: string, postId: string | null, enabled: boolean) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.mentions(clubId, postId),
    queryFn: () => fetchFanClubMentions({ clubId, postId, q: null }),
    enabled: enabled && clubId !== '',
    staleTime: Infinity,
    gcTime: 0,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * A busca do @ pelo começo (`?q=`, de 2 letras em diante, 37.7). Enquanto a
 * próxima não chega, a de antes fica na barra (filtrada pelo começo de agora).
 */
export function useFanClubMentionSearchQuery(
  clubId: string,
  postId: string | null,
  q: string,
  enabled: boolean,
) {
  const options = queryOptionsFor('fanClub');
  return useQuery({
    ...options,
    queryKey: fanClubKeys.mentionSearch(clubId, q),
    queryFn: () => fetchFanClubMentions({ clubId, postId, q }),
    enabled: enabled && clubId !== '',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    meta: { ...options.meta, persist: false },
  });
}

/** O que o comentário leva, e o que a linha local mostra enquanto ele vai. */
interface AddCommentVariables {
  postId: string;
  clubId: string;
  text: string;
  /** O comentário respondido (o de cima ou uma resposta); null no comentário de cima. */
  replyToId: string | null;
  /** O comentário de cima da conversa, embaixo do qual a linha aparece; null no de cima. */
  threadId: string | null;
  idempotencyKey: string;
  /** O id da linha local, que fica na tela depois de o servidor gravar. */
  localId: string;
  sentAt: string;
  author: FanClubPerson;
  /** Quem comenta é o gestor: a marca "Gestor" na linha local. */
  isManager: boolean;
}

/** Para quem a resposta vai: o comentário respondido e o de cima da conversa dele. */
export interface FanClubReplyTarget {
  commentId: string;
  threadId: string;
}

/**
 * O comentário fica com a tentativa (a linha "Não enviado" e a mesma chave na
 * nova tentativa): na falha incerta, que pode ter gravado, e no ritmo depois
 * das novas tentativas, que não gravou nada, como no Mural.
 */
function keepsCommentAttempt(error: unknown): boolean {
  return isUncertainFailure(error) || (error instanceof ApiError && error.isRateLimited);
}

const commentVariables = (mutation: { state: { variables: unknown } }) =>
  mutation.state.variables as AddCommentVariables | undefined;

/** A mutação que deu certo, ou que foi trocada por outra, sai das linhas locais. */
function forgetComment(client: QueryClient, localId: string): void {
  const cache = client.getMutationCache();
  cache
    .findAll({
      mutationKey: fanClubMutationKeys.comment,
      predicate: (mutation) => commentVariables(mutation)?.localId === localId,
    })
    .forEach((mutation) => cache.remove(mutation));
}

/** A linha do comentário do fã enquanto ele não está na lista do servidor. */
function localCommentLine(
  variables: AddCommentVariables,
  status: FanClubCommentLineStatus,
): FanClubCommentLine {
  return {
    id: variables.localId,
    postId: variables.postId,
    clubId: variables.clubId,
    author: variables.author,
    isManager: variables.isManager,
    text: variables.text,
    mentions: [],
    replyToId: variables.threadId,
    replyCount: 0,
    createdAt: variables.sentAt,
    hidden: null,
    review: null,
    status,
  };
}

/**
 * O estado da linha pelo da mutação: o texto recusado pelo filtro é "Não
 * publicado", e o resto dos erros, "Não enviado".
 */
function localCommentStatus(state: { status: string; error: unknown }): FanClubCommentLineStatus {
  if (state.status !== 'error') return 'pending';
  return actionRefusal(state.error, 'clubComment').type === 'content' ? 'refused' : 'failed';
}

export interface LocalFanClubComments {
  /** Indo ou recusados, do mais novo ao mais antigo, os de cima e as respostas. */
  comments: FanClubCommentLine[];
  /** Algum está indo agora. */
  sending: boolean;
}

/**
 * Os comentários do fã que ainda não estão na lista do servidor saem das
 * próprias mutações (o `useMutationState`, como no Mural), só na memória: sem
 * fila offline e sem disco (decisão 23 de 37.1). O que o servidor gravou sai
 * daqui e entra na lista.
 */
export function useLocalFanClubComments(postId: string): LocalFanClubComments {
  const entries = useMutationState({
    filters: {
      mutationKey: fanClubMutationKeys.comment,
      predicate: (mutation) =>
        commentVariables(mutation)?.postId === postId &&
        (mutation.state.status === 'pending' || mutation.state.status === 'error'),
    },
    select: (mutation) => ({
      variables: commentVariables(mutation) as AddCommentVariables,
      status: localCommentStatus(mutation.state),
      sending: mutation.state.status === 'pending',
    }),
  });
  return {
    // O cache guarda do mais antigo ao mais novo; a lista é ao contrário.
    comments: entries.map((entry) => localCommentLine(entry.variables, entry.status)).reverse(),
    sending: entries.some((entry) => entry.sending),
  };
}

type CommentPages = InfiniteData<FanClubCommentPage, string | null>;

/**
 * A lista não pode perder o que acabou de ser gravado: a busca que saiu antes
 * da gravação voltaria sem ele, por cima dele. Ela é cancelada e sai de novo,
 * já com ele (o molde do Mural).
 */
function refetchCommentList(client: QueryClient, postId: string, replyTo: string | null): void {
  const queryKey = fanClubKeys.comments(postId, replyTo);
  void client
    .cancelQueries({ queryKey, exact: true })
    .then(() => client.invalidateQueries({ queryKey, exact: true }));
}

/** O comentário que o servidor gravou na lista: o de cima no topo; a resposta no fim das carregadas. */
function placeComment(data: CommentPages, line: FanClubCommentLine): CommentPages {
  if (data.pages.some((page) => page.items.some((item) => item.id === line.id))) return data;
  const target = line.replyToId === null ? 0 : data.pages.length - 1;
  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index !== target
        ? page
        : {
            ...page,
            items: line.replyToId === null ? [line, ...page.items] : [...page.items, line],
          },
    ),
  };
}

/**
 * O total de comentários da publicação muda em todo cache do que os fãs veem
 * e no "Ver comentários (N)" de "Minhas publicações" do gestor, fora do
 * `public()`. Nunca abaixo de zero; sem o contador (o servidor de antes), nada.
 */
function addToCommentCount(client: QueryClient, postId: string, delta: number): void {
  if (delta === 0) return;
  const add = (count: number) => Math.max(0, count + delta);
  patchFanClubPost(client, postId, (post) =>
    post.commentCount === undefined ? post : { ...post, commentCount: add(post.commentCount) },
  );
  patchOwnPost(client, postId, (item) =>
    item.commentCount === undefined ? item : { ...item, commentCount: add(item.commentCount) },
  );
}

/**
 * O servidor gravou: o comentário entra na lista com o id local de quando ia,
 * para a linha seguir a mesma na tela (o de cima no topo; a resposta no fim
 * das respostas carregadas da conversa dele, que ganha +1 no `replyCount`), e
 * o `commentCount` da publicação sobe em todo cache do que os fãs veem e em
 * "Minhas publicações" do gestor. Sem pontos (37.5): só as missões e as
 * conquistas buscam de novo quando pedem.
 */
function commitComment(
  client: QueryClient,
  variables: AddCommentVariables,
  result: AddFanClubCommentResult,
): void {
  const {
    completedMissions: _missions,
    levelUp: _level,
    unlockedAchievements: _achievements,
    missionsChanged: _changed,
    ...comment
  } = result;
  const line: FanClubCommentLine = { ...comment, localId: variables.localId };
  const { postId } = variables;
  const threadId = comment.replyToId;
  notifyManager.batch(() => {
    const listKey = fanClubKeys.comments(postId, threadId);
    let placed = false;
    client.setQueryData<CommentPages>(listKey, (data) => {
      if (!data || data.pages.length === 0) return data;
      placed = true;
      return placeComment(data, line);
    });
    if (threadId !== null) {
      client.setQueryData<CommentPages>(fanClubKeys.comments(postId, null), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === threadId ? { ...item, replyCount: item.replyCount + 1 } : item,
                ),
              })),
            }
          : data,
      );
    }
    addToCommentCount(client, postId, 1);
    const listQuery = client.getQueryCache().find({ queryKey: listKey, exact: true });
    if (listQuery && (!placed || listQuery.state.fetchStatus !== 'idle')) {
      refetchCommentList(client, postId, threadId);
    }
  });
  const refresh = rewardsRefresh(result);
  if (refresh.missions) void client.invalidateQueries({ queryKey: missionKeys.all });
  if (refresh.achievements) void client.invalidateQueries({ queryKey: profileKeys.achievements() });
}

export interface AddFanClubCommentOptions {
  /**
   * O servidor recusou com a tela aberta: devolve o texto ao campo se o fã não
   * começou outro. `true` quando devolveu (a linha some). O `localId` é o da
   * linha do envio, para a tela devolver também o modo resposta dele; null
   * quando o respondido saiu da vista (o modo resposta não volta).
   */
  restoreDraft?: (text: string, localId: string | null) => boolean;
  /** Leva o foco ao campo: o texto recusado pelo filtro volta para o fã revisar. */
  focusDraft?: () => void;
  /** A conta suspensa: o campo dá lugar à frase, e o texto não tem para onde voltar. */
  suspended?: boolean;
  /**
   * O comentário respondido saiu da vista (o `replyToId` do envio): a tela
   * sai do modo resposta, se ele ainda é para esse comentário.
   */
  onReplyGone?: (replyToId: string | null) => void;
}

/**
 * Por que o último comentário foi recusado, para a frase embaixo do campo: o
 * teto do dia, a conta suspensa, o texto fora dos Termos de uso ou o
 * comentário respondido que saiu da vista. A tela tira do tipo o link
 * "Escrever para a equipe".
 */
export interface FanClubCommentRefusal {
  key: TranslationKey;
  type: 'suspended' | 'dailyLimit' | 'content' | 'replyGone';
}

/** A publicação em que se comenta: o fã-clube e se quem comenta é o gestor. */
export interface CommentTarget {
  id: string;
  clubId: string;
  isOwner: boolean;
}

/**
 * Comentar e responder numa publicação do fã-clube (`POST
 * /fan-club-posts/:postId/comments`, 37.3). A linha aparece na hora
 * (`useLocalFanClubComments`), e o que o servidor devolve entra na lista e no
 * total, com o toque e o anúncio. Sem fila offline e sem disco (decisão 23 de
 * 37.1): `networkMode: 'always'` e a mutação fora do cache salvo; o `scope`
 * por publicação manda os comentários na ordem em que o fã escreveu, e a
 * falha fica na memória enquanto o app está aberto.
 *
 * Recusado pelo servidor, com o campo vazio, o texto volta para ele (a linha
 * some), e o próximo envio leva chave nova; a falha incerta e o ritmo deixam a
 * linha "Não enviado", e tocar tenta de novo com a mesma chave. O teto do dia
 * e a conta suspensa têm a frase embaixo do campo, anunciada; o texto barrado
 * pelo filtro, a frase com o foco no campo, ou a linha "Não publicado" quando
 * o campo já tem outro texto (como no Mural). O `not_following` (deixou de
 * seguir noutro aparelho) deixa a linha "Não enviado" e busca de novo o que os
 * fãs veem, como a reação: o campo dá lugar ao "Seguir o fã-clube", e, depois
 * de seguir, o toque na linha manda de novo. O comentário respondido que saiu
 * da vista (o 404 do comentário) devolve o texto sem o modo resposta e busca
 * de novo os de cima e a conversa dele; a publicação que saiu do ar some das
 * telas. O último comentário a terminar busca a publicação de novo, para o
 * total acertar com o servidor (o molde do Mural).
 */
export function useAddFanClubCommentMutation(
  target: CommentTarget,
  { restoreDraft, focusDraft, suspended = false, onReplyGone }: AddFanClubCommentOptions = {},
) {
  const client = useQueryClient();
  const identity = useFanIdentity();
  const [refusal, setRefusal] = useState<FanClubCommentRefusal | null>(null);
  const restoreRef = useRef(restoreDraft);
  const focusRef = useRef(focusDraft);
  const suspendedRef = useRef(suspended);
  const replyGoneRef = useRef(onReplyGone);
  const mounted = useMounted();
  const postId = target.id;

  useEffect(() => {
    restoreRef.current = restoreDraft;
    focusRef.current = focusDraft;
    suspendedRef.current = suspended;
    replyGoneRef.current = onReplyGone;
  }, [restoreDraft, focusDraft, suspended, onReplyGone]);

  /**
   * O texto recusado pelo filtro: com o campo vazio, ele volta, com a frase, o
   * toque de erro, o anúncio e o foco no campo; com o campo ocupado, a linha
   * fica "Não publicado"; com a conta suspensa, sem campo, o anúncio só diz o
   * motivo. No toque da linha (`retrying`), pede para esvaziar o campo.
   */
  const refuseContent = (
    variables: AddCommentVariables,
    key: TranslationKey,
    retrying: boolean,
  ): void => {
    if (suspendedRef.current) {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('post.comments.refusedLockedAnnouncement'));
      return;
    }
    if (restoreRef.current?.(variables.text, variables.localId)) {
      forgetComment(client, variables.localId);
      setRefusal({ key, type: 'content' });
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(key));
      focusRef.current?.();
      return;
    }
    haptics.trigger(retrying ? 'warning' : 'error');
    AccessibilityInfo.announceForAccessibility(
      t(retrying ? 'post.comments.refusedBusy' : 'post.comments.refusedAnnouncement'),
    );
  };

  /** A recusa que não é de conteúdo, com a tela aberta. */
  const refuse = (error: unknown, variables: AddCommentVariables): void => {
    haptics.trigger('error');
    if (isRefused(error, 'not_following')) {
      AccessibilityInfo.announceForAccessibility(t('fanClub.errors.refused.notFollowing'));
      return;
    }
    const replyGone =
      error instanceof ApiError && error.code === FAN_CLUB_ERROR_CODES.commentNotFound;
    const refused = actionRefusal(error, 'clubComment');
    let told: FanClubCommentRefusal | null = null;
    if (replyGone) {
      replyGoneRef.current?.(variables.replyToId);
      told = { key: 'fanClub.commentNotFound', type: 'replyGone' };
    } else if (refused.type === 'dailyLimit' || refused.type === 'suspended') {
      told = { key: refused.key, type: refused.type };
    }
    if (told) setRefusal(told);
    // O respondido que saiu não reabre o modo resposta: o texto volta como comentário de cima.
    if (
      !keepsCommentAttempt(error) &&
      restoreRef.current?.(variables.text, replyGone ? null : variables.localId)
    ) {
      forgetComment(client, variables.localId);
      AccessibilityInfo.announceForAccessibility(t(told ? told.key : 'post.composer.error'));
      return;
    }
    AccessibilityInfo.announceForAccessibility(
      t(told ? told.key : 'post.comments.failedAnnouncement'),
    );
  };

  const mutation = useMutation<AddFanClubCommentResult, Error, AddCommentVariables, StartedBy>({
    mutationKey: fanClubMutationKeys.comment,
    scope: { id: `fan-club-comment-${postId}` },
    // A falha fica na tela como "Não enviado" até o fã tentar de novo; as que
    // dão certo saem na hora (`forgetComment`), e sair da conta limpa o resto.
    gcTime: Infinity,
    networkMode: 'always',
    meta: { persist: false, suspendedAlert: false },
    mutationFn: ({ postId: id, text, replyToId, idempotencyKey }) =>
      addFanClubComment({ postId: id, text, replyToId, idempotencyKey }),
    onMutate: startedBy,
    onSuccess: (result, variables, started) => {
      if (!sameSession(started)) return;
      commitComment(client, variables, result);
      forgetComment(client, variables.localId);
      // A contagem certa vem do servidor, mas com outro comentário ainda indo
      // ela voltaria sem ele: o último a terminar busca a publicação de novo,
      // como no Mural (a busca que leu o servidor antes da resposta contaria
      // este duas vezes, com o +1 de cima).
      const othersGoing = client.getMutationCache().findAll({
        mutationKey: fanClubMutationKeys.comment,
        status: 'pending',
        predicate: (mutation) => {
          const other = commentVariables(mutation);
          return other?.postId === variables.postId && other.localId !== variables.localId;
        },
      });
      if (othersGoing.length === 0) refreshPost(client, variables.postId);
      if (!mounted.current) return;
      haptics.trigger('commentSent');
      const { announcement } = describeRewards(0, result);
      AccessibilityInfo.announceForAccessibility(
        announcement ? `${t('post.composer.sent')} ${announcement}` : t('post.composer.sent'),
      );
    },
    onError: (error, variables, started) => {
      if (!sameSession(started)) return;
      if (error instanceof ApiError && error.code === FAN_CLUB_ERROR_CODES.commentNotFound) {
        // O respondido pode ser uma resposta: a conversa aberta dele busca de novo também.
        refetchCommentList(client, variables.postId, null);
        if (variables.threadId !== null) {
          refetchCommentList(client, variables.postId, variables.threadId);
        }
      } else if (error instanceof ApiError && error.kind === 'notFound') {
        // A publicação saiu do ar (ou a rota não existe: o servidor de antes).
        void client.invalidateQueries({ queryKey: fanClubKeys.public() });
      } else if (isRefused(error, 'not_following')) {
        // Como na reação: a página, as listas, os seguidos e a Início dizem que segue.
        void client.invalidateQueries({ queryKey: fanClubKeys.public() });
      }
      if (!mounted.current) return;
      const refused = actionRefusal(error, 'clubComment');
      if (refused.type === 'content') {
        refuseContent(variables, refused.key, false);
        return;
      }
      refuse(error, variables);
    },
  });

  /** Manda o texto (já validado), de cima ou em resposta; devolve o id local da linha nova. */
  const send = (text: string, reply: FanClubReplyTarget | null): string => {
    setRefusal(null);
    const localId = `club-comment-local-${createIdempotencyKey()}`;
    mutation.mutate({
      postId,
      clubId: target.clubId,
      text,
      replyToId: reply?.commentId ?? null,
      threadId: reply?.threadId ?? null,
      idempotencyKey: `club-comment-${createIdempotencyKey()}`,
      localId,
      sentAt: new Date().toISOString(),
      author: {
        uid: identity.uid ?? '',
        name: identity.name ?? t('post.comments.fallbackName'),
        username: null,
        photoURL: identity.photoURL,
      },
      isManager: target.isOwner,
    });
    return localId;
  };

  /**
   * Toque na linha "Não enviado" ou "Não publicado". A recusa de conteúdo
   * nunca manda de novo: devolve o texto ao campo vazio, ou pede para
   * esvaziá-lo. O resto manda de novo, com a mesma chave depois da falha
   * incerta e do ritmo, e com chave nova depois de uma recusa.
   */
  const retry = (localId: string): void => {
    const failed = client.getMutationCache().findAll({
      mutationKey: fanClubMutationKeys.comment,
      status: 'error',
      predicate: (item) => commentVariables(item)?.localId === localId,
    });
    const last = failed.at(-1);
    const variables = last && commentVariables(last);
    if (!last || !variables) return;
    const refused = actionRefusal(last.state.error, 'clubComment');
    if (refused.type === 'content') {
      refuseContent(variables, refused.key, true);
      return;
    }
    forgetComment(client, localId);
    setRefusal(null);
    mutation.mutate({
      ...variables,
      idempotencyKey: keepsCommentAttempt(last.state.error)
        ? variables.idempotencyKey
        : `club-comment-${createIdempotencyKey()}`,
    });
  };

  /** O fã digitou: a frase de conteúdo e a do respondido que saiu somem; as outras ficam até o próximo envio. */
  const dismissEditableRefusal = (): void => {
    setRefusal((current) =>
      current?.type === 'content' || current?.type === 'replyGone' ? null : current,
    );
  };

  return { send, retry, refusal, dismissEditableRefusal };
}

// --- A moderação dos comentários (seção 37, 37.6 e 37.9; a etapa 7 de 37.13) -------------

/** Os comentários de uma página de comentários em cache, com os ocultos do fã (o `ownHidden`). */
const commentsOfPages = (data: CommentPages | undefined): FanClubComment[] =>
  data ? data.pages.flatMap((page) => [...page.items, ...(page.ownHidden ?? [])]) : [];

/**
 * O comentário numa das listas da publicação em cache: a dos de cima (com os
 * ocultos do fã) ou a das respostas de um deles.
 */
function findCachedFanClubComment(
  client: QueryClient,
  postId: string,
  commentId: string,
): FanClubComment | undefined {
  for (const [, data] of client.getQueriesData<CommentPages>({
    queryKey: fanClubKeys.postComments(postId),
  })) {
    const found = commentsOfPages(data).find((item) => item.id === commentId);
    if (found) return found;
  }
  return undefined;
}

/**
 * O comentário que a sheet "Opções do comentário" do fã-clube mostra (37.9,
 * item 10), lido na abertura das listas da tela da publicação, no molde do
 * `useCachedComment` do Mural. Aberta a frio, sem ele, `undefined`, e a sheet
 * fecha.
 */
export function useCachedFanClubComment(
  postId: string,
  commentId: string,
): FanClubComment | undefined {
  const client = useQueryClient();
  const [comment] = useState(() =>
    postId && commentId ? findCachedFanClubComment(client, postId, commentId) : undefined,
  );
  return comment;
}

/**
 * Se quem vê segue o fã-clube, para o texto do "Bloquear e denunciar" no
 * comentário do gestor (37.9, item 10): só quem segue deixa de seguir
 * (decisão 32 de 34.1). Lido na abertura, da tela da publicação em cache ou,
 * sem ela, da página.
 */
export function useCachedFanClubFollowing(postId: string, clubId: string): boolean {
  const client = useQueryClient();
  const [following] = useState(
    () =>
      client.getQueryData<FanClubPostDetails>(fanClubKeys.post(postId))?.isFollowing ??
      client.getQueryData<FanClubPage>(fanClubKeys.club(clubId))?.isFollowing ??
      false,
  );
  return following;
}

/**
 * Se quem vê é o gestor do fã-clube da publicação (o `isOwner` dela em
 * cache), para a sheet "Opções do comentário" (37.9, item 10): no próprio
 * fã-clube, a lista dele não filtra bloqueados (37.8), e o servidor aceita a
 * denúncia do comentário de quem ele bloqueou. Lido na abertura; sem a
 * publicação em cache, não é.
 */
export function useCachedFanClubPostOwner(postId: string): boolean {
  const client = useQueryClient();
  const [isOwner] = useState(
    () => client.getQueryData<FanClubPostDetails>(fanClubKeys.post(postId))?.isOwner ?? false,
  );
  return isOwner;
}

/**
 * O estado do pedido de revisão do comentário nas listas da publicação em
 * cache (`requested`, `kept` ou null), para a tela dizer o que a lista nova
 * trouxe depois do `already_requested`.
 */
export function cachedFanClubCommentReview(
  client: QueryClient,
  postId: string,
  commentId: string,
): FanClubComment['review'] {
  return findCachedFanClubComment(client, postId, commentId)?.review ?? null;
}

/**
 * O comentário trocado em todas as listas da publicação em cache (os de cima,
 * os ocultos do fã e as respostas), guardando o id local da linha. Só as
 * listas que têm o comentário mudam.
 */
function patchCachedComment(
  client: QueryClient,
  postId: string,
  commentId: string,
  patch: (comment: FanClubComment) => Partial<FanClubComment>,
): void {
  const swap = <T extends FanClubComment>(item: T): T =>
    item.id === commentId ? { ...item, ...patch(item) } : item;
  for (const [queryKey, data] of client.getQueriesData<CommentPages>({
    queryKey: fanClubKeys.postComments(postId),
  })) {
    if (!data || !commentsOfPages(data).some((item) => item.id === commentId)) continue;
    client.setQueryData<CommentPages>(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map(swap),
        ...(page.ownHidden ? { ownHidden: page.ownHidden.map(swap) } : {}),
      })),
    });
  }
}

/** As listas de comentários da publicação buscam de novo: o comentário mudou no servidor. */
function refetchPostComments(client: QueryClient, postId: string): void {
  void client.invalidateQueries({ queryKey: fanClubKeys.postComments(postId) });
}

/** Os retornos da sheet: só rodam com ela montada. */
export interface FanClubModerationCallbacks<T> {
  /** O servidor confirmou. */
  onDone?: (result: T) => void;
  /** Recusa ou falha: a sheet fica, com a frase acima dos botões. */
  onError?: (error: Error) => void;
}

/**
 * Denunciar o comentário de outro fã (`POST
 * /fan-club-comments/:commentId/report`, 37.3), na sheet "Opções do
 * comentário" do fã-clube (37.9, item 10), no molde da denúncia de comentário
 * do Mural e da de publicação do fã-clube: não é otimista e não entra na fila.
 * A chave é da tentativa: a mesma depois de uma falha incerta com o mesmo
 * motivo, nova com outro motivo ou depois de uma resposta clara. Denunciar não
 * esconde o comentário (os dois status, `reported` e `already_reported`, têm a
 * mesma frase). O 404 (o comentário saiu da vista) busca de novo as listas da
 * publicação. `onDone` e `onError` só rodam com a sheet montada; a resposta
 * que chega com ela fechada só anuncia. Um toque por vez.
 */
export function useReportFanClubCommentMutation(
  postId: string,
  commentId: string,
  { onDone, onError }: FanClubModerationCallbacks<ReportFanClubCommentResult> = {},
) {
  const client = useQueryClient();
  const mounted = useMounted();
  const attempt = useRef<Attempt | null>(null);
  const inFlight = useRef(false);
  const mutation = useMutation<
    ReportFanClubCommentResult,
    Error,
    FanClubCommentReportReason | null
  >({
    mutationKey: fanClubMutationKeys.commentReport,
    mutationFn: (reason) =>
      reportFanClubComment({
        commentId,
        reason,
        idempotencyKey: attemptKey(attempt, `club-comment-report-${commentId}`, {
          commentId,
          reason,
        }),
      }),
    networkMode: 'always',
    retry: false,
    // A sheet diz a frase do suspenso, com o link: sem o `Alert` por cima.
    meta: { suspendedAlert: false },
    onSuccess: (result) => {
      attempt.current = null;
      if (mounted.current) {
        onDone?.(result);
        return;
      }
      AccessibilityInfo.announceForAccessibility(t('post.moderation.reported'));
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
      if (error instanceof ApiError && error.kind === 'notFound') {
        refetchPostComments(client, postId);
      }
      if (mounted.current) {
        onError?.(error);
        return;
      }
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(actionRefusal(error, 'clubCommentReport').key));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const report = (reason: FanClubCommentReportReason | null): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(reason);
  };
  return { report, isPending: mutation.isPending };
}

/**
 * O "Pedir revisão" do autor do comentário oculto pelo gestor (`POST
 * /fan-club-comments/:commentId/review`, 37.3 e 37.6), uma vez por ocultar.
 * Não é otimista: a linha passa a "Revisão pedida" quando o servidor
 * responde, em todas as listas da publicação. O `already_requested` (pedido
 * noutro aparelho, ou já mantido oculto pela equipe) não marca nada: busca de
 * novo as listas, que dizem qual dos dois, e o sucesso só termina com elas,
 * para a tela dizer o estado que chegou (`cachedFanClubCommentReview`). A
 * chave é da tentativa, por comentário. O 404 (o gestor reexibiu, ou a equipe
 * ocultou) busca de novo as listas. O suspenso recebe o "Conta suspensa" do
 * `SuspensionWatcher`, com "Escrever para a equipe", e o teto do dia, o
 * "Limite de hoje" da tela. Um toque por vez; a tela diz a resposta.
 */
export function useRequestFanClubCommentReviewMutation(postId: string) {
  const client = useQueryClient();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mutation = useMutation<FanClubCommentReviewResult, Error, string, StartedBy>({
    mutationKey: fanClubMutationKeys.commentReview,
    mutationFn: (commentId) =>
      requestFanClubCommentReview({
        commentId,
        idempotencyKey: attemptKeyFor(attempts.current, 'club-comment-review', commentId),
      }),
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (result, commentId, started) => {
      attempts.current.delete(commentId);
      if (!sameSession(started)) return;
      if (result.status === 'requested') {
        patchCachedComment(client, postId, commentId, (comment) =>
          comment.review === null ? { review: 'requested' } : {},
        );
        return;
      }
      // Pedido noutro aparelho, ou mantido pela equipe: a lista nova diz qual.
      return client.invalidateQueries({ queryKey: fanClubKeys.postComments(postId) });
    },
    onError: (error, commentId, started) => {
      if (!isUncertainFailure(error)) attempts.current.delete(commentId);
      if (!sameSession(started)) return;
      if (error instanceof ApiError && error.kind === 'notFound') {
        refetchPostComments(client, postId);
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const mutate: typeof mutation.mutate = (commentId, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(commentId, options);
  };
  return { ...mutation, mutate };
}

/** O comentário que o gestor oculta (`hidden: true`) ou reexibe (`hidden: false`). */
export interface HideFanClubCommentVariables {
  comment: FanClubComment;
  hidden: boolean;
}

/** A tentativa do ocultar e a do reexibir são de rotas diferentes: cada uma tem a sua. */
const hideAttemptOf = ({ comment, hidden }: HideFanClubCommentVariables): string =>
  `${hidden ? 'hide' : 'unhide'}:${comment.id}`;

/**
 * O ocultar ou o reexibir que o servidor confirmou, no cache: a linha passa a
 * "Oculto por você" (ou volta ao visível) em todas as listas da publicação, e
 * os contadores mudam como no servidor (`hiddenCounterDelta`, 37.6): o total
 * da publicação em todo cache e em "Minhas publicações" e, na resposta, o
 * `replyCount` e o `hiddenReplyCount` do comentário de cima. O estado é o do
 * cache de agora: o que já estava como o servidor respondeu não conta de
 * novo. Depois, a publicação busca de novo, para o total acertar com o
 * servidor (o já oculto noutro aparelho responde sem gravar).
 */
function settleHidden(
  client: QueryClient,
  postId: string,
  commentId: string,
  hidden: boolean,
): void {
  const current = findCachedFanClubComment(client, postId, commentId);
  if (current && (current.hidden === 'manager') !== hidden) {
    const topId = current.replyToId;
    const top = topId === null ? undefined : findCachedFanClubComment(client, postId, topId);
    const delta = hiddenCounterDelta(current, top, hidden);
    notifyManager.batch(() => {
      patchCachedComment(client, postId, commentId, () => ({ hidden: hidden ? 'manager' : null }));
      if (topId !== null) {
        patchCachedComment(client, postId, topId, (comment) => ({
          replyCount: Math.max(0, comment.replyCount + delta.replyCount),
          hiddenReplyCount: Math.max(0, (comment.hiddenReplyCount ?? 0) + delta.hiddenReplyCount),
        }));
      }
      addToCommentCount(client, postId, delta.commentCount);
    });
  }
  refreshPost(client, postId);
}

/**
 * O ocultar e o reexibir do gestor (`PUT` e `DELETE
 * /me/fan-club/hidden-comments/:commentId`, 37.3 e 37.6), na tela da
 * publicação. Não é otimista: o comentário muda quando o servidor responde
 * (`settleHidden`). São rotas de estado, sem teto: a chave é da tentativa, por
 * comentário e por sentido, a mesma depois de uma falha incerta. O 404 (o
 * comentário saiu da vista, ou a equipe o ocultou) busca de novo as listas; o
 * `club_not_active` (o fã-clube parou), o estado do gestor e a publicação. O
 * suspenso recebe o "Conta suspensa" do `SuspensionWatcher`, com "Escrever
 * para a equipe". Um toque por vez; a tela confirma antes e diz a resposta.
 */
export function useHideFanClubCommentMutation(postId: string) {
  const client = useQueryClient();
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mutation = useMutation<
    FanClubCommentHiddenResult,
    Error,
    HideFanClubCommentVariables,
    StartedBy
  >({
    mutationKey: fanClubMutationKeys.commentHide,
    mutationFn: (variables) => {
      const request = {
        commentId: variables.comment.id,
        idempotencyKey: attemptKeyFor(
          attempts.current,
          variables.hidden ? 'club-comment-hide' : 'club-comment-unhide',
          hideAttemptOf(variables),
        ),
      };
      return variables.hidden ? hideFanClubComment(request) : unhideFanClubComment(request);
    },
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (_result, variables, started) => {
      attempts.current.delete(hideAttemptOf(variables));
      if (!sameSession(started)) return;
      settleHidden(client, postId, variables.comment.id, variables.hidden);
    },
    onError: (error, variables, started) => {
      if (!isUncertainFailure(error)) attempts.current.delete(hideAttemptOf(variables));
      if (!sameSession(started)) return;
      if (error instanceof ApiError && error.kind === 'notFound') {
        refetchPostComments(client, postId);
      } else if (isRefused(error, 'club_not_active')) {
        void client.invalidateQueries({ queryKey: fanClubKeys.mine() });
        refreshPost(client, postId);
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const mutate: typeof mutation.mutate = (variables, options) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(variables, options);
  };
  return { ...mutation, mutate };
}
