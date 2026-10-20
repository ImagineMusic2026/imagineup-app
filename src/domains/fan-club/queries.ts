import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useRef } from 'react';

import { inviteLinkId } from '@/domains/invites';
import {
  profileKeys,
  useMyInviteQuery,
  useRegisterInviteLinkMutation,
  type FanContact,
  type PreparedFanClubPhoto,
} from '@/domains/profile';
import { ApiError } from '@/services/api/errors';
import { queryOptionsFor } from '@/services/query/client';
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';
import { parseWhatsapp } from '@/utils/whatsapp';

import {
  acceptFanClubRules,
  applyForFanClub,
  createFanClubPost,
  fanClubFileUploaded,
  fetchFanClubArtists,
  fetchMyFanClub,
  fetchMyFanClubNumbers,
  fetchMyFanClubPosts,
  openFanClubUpload,
  removeFanClubPost,
  uploadFanClubFile,
  withdrawApplication,
} from './api';
import { FAN_CLUB_ERROR_CODES } from './consts';
import { shownFanClub } from './entry';
import { fanClubKeys } from './keys';
import { shareFanClub } from './share';
import type {
  FanClubApplicationBody,
  FanClubListPage,
  FanClubUploadSlot,
  MyFanClub,
  MyFanClubClub,
  OwnFanClubPost,
} from './types';

// As consultas e as gravações das telas do fã-clube da etapa 7 de 34.14 (os
// Ajustes, a candidatura e o "Meu fã-clube"), pelo `api.ts`. Toda gravação
// fica fora da fila e do disco: `networkMode: 'always'`, sem nova tentativa
// automática e com a chave da tentativa (34.22, etapa 6): a mesma depois de
// uma falha incerta, nova depois de uma recusa definitiva. A tela mostra a
// frase do suspenso, sem o `Alert` (`suspendedAlert: false`).

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
 * "Compartilhar meu fã-clube" (34.9, item 5): a folha do sistema com o link do
 * fã-clube, o código de convite do gestor e o código escrito na mensagem; com
 * o código e a folha voltando compartilhada, o link conta como `fanclub:<id>`
 * (decisão 22), no molde do `useShareArtist`. Sem o código, o link puro.
 */
export function useShareMyFanClub(): (
  club: Pick<MyFanClubClub, 'id' | 'name' | 'artistName'>,
) => void {
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
