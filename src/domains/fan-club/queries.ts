import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { artistKeys, useJoinCelebration } from '@/domains/artists';
import { inviteLinkId } from '@/domains/invites';
import { postKeys } from '@/domains/posts';
import {
  profileKeys,
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
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';
import { parseWhatsapp } from '@/utils/whatsapp';

import {
  acceptFanClubRules,
  applyForFanClub,
  createFanClubPost,
  fanClubFileUploaded,
  fetchArtistFanClubs,
  fetchFanClub,
  fetchFanClubArtists,
  fetchFanClubFeed,
  fetchFanClubPosts,
  fetchFollowedFanClubs,
  fetchMyFanClub,
  fetchMyFanClubNumbers,
  fetchMyFanClubPosts,
  followFanClub,
  openFanClubUpload,
  removeFanClubPost,
  reportFanClubPost,
  unfollowFanClub,
  uploadFanClubFile,
  withdrawApplication,
} from './api';
import { FAN_CLUB_ERROR_CODES } from './consts';
import { fanClubErrorText } from './describe';
import { isDefinitiveRefusal, leaveCentralNotes, liveFanClub, shownFanClub } from './entry';
import { fanClubKeys } from './keys';
import { shareFanClub, type ShareableFanClub } from './share';
import type {
  FanClubApplicationBody,
  FanClubCard,
  FanClubListPage,
  FanClubPage,
  FanClubPerson,
  FanClubPost,
  FanClubReportReason,
  FanClubUploadSlot,
  FollowedFanClubs,
  FollowFanClubResult,
  MyFanClub,
  OwnFanClubPost,
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
 * das páginas já carregadas (a página do fã-clube e a Início), no molde do
 * `useCachedComment`. Aberta a frio, sem ela, `undefined`, e a sheet fecha:
 * nada do fã-clube abre antes da trava.
 */
export function useCachedFanClubPost(postId: string): FanClubPost | undefined {
  const client = useQueryClient();
  const [post] = useState(() => {
    if (!postId) return undefined;
    for (const [, data] of client.getQueriesData({ queryKey: fanClubKeys.public() })) {
      if (!isPostPages(data)) continue;
      for (const page of data.pages) {
        const found = page.items.find((item) => isPost(item) && item.id === postId);
        if (found) return found;
      }
    }
    return undefined;
  });
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
 * O gestor do fã-clube, para o "Bloquear e denunciar" da página (decisão 19):
 * a sheet "Denunciar perfil" lê o nome dele daqui, da página em cache, quando
 * o perfil público não está no cache. Só o gestor desta página: outro id não
 * acha nada.
 */
export function useCachedFanClubOwner(clubId: string, fanId: string): FanClubPerson | undefined {
  const client = useQueryClient();
  const [owner] = useState(() => {
    if (!clubId || !fanId) return undefined;
    const page = client.getQueryData<FanClubPage>(fanClubKeys.club(clubId));
    return page?.owner.uid === fanId ? page.owner : undefined;
  });
  return owner;
}

/** O seguir de agora na página e nas listas do artista em cache, sem buscar de novo. */
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
