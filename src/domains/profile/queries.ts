import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { sourceOf } from '@/config/data-source';
import { refreshRanking } from '@/domains/ranking/queries';
import { ApiError } from '@/services/api';
import { queryOptionsFor } from '@/services/query/client';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';

import {
  applyEditableProfile,
  fanPhotoPath,
  fetchFanProfile,
  fetchLedgerPage,
  fetchMyAchievements,
  fetchMyInvite,
  fetchMyProfile,
  fetchMyProgress,
  fetchUsernameAvailability,
  fetchWallet,
  photoUploaded,
  registerInviteLink,
  removeMyPhoto,
  reservePhotoUpload,
  setMyPhoto,
  updateMyProfile,
  uploadFanPhoto,
  watchMyProfile,
} from './api';
import { PROFILE_SAVE_TIMEOUT_MS } from './consts';
import { fanKeys, profileKeys, profileMutationKeys } from './keys';
import { PhotoPickError, preparePhoto, type PickedPhoto } from './photo';
import type {
  EditableProfile,
  FanProfile,
  PhotoChange,
  ProfileChanges,
  UsernameAvailability,
} from './types';

export { fanKeys, profileKeys, profileMutationKeys };

/** Uid da sessão que o Firebase já confirmou; `null` enquanto ela é só presumida. */
function useConfirmedUid(): string | null {
  return useSessionStore((state) =>
    state.status === 'signedIn' ? (state.user?.uid ?? null) : null,
  );
}

/**
 * Perfil do fã (`users/{uid}`), do Firestore de verdade (emuladores em dev),
 * também no modo fixtures. Só lê com a sessão confirmada: aberto com a sessão
 * presumida (`lastSessionUid`), mostra o que estiver salvo e busca quando o
 * Firebase confirmar. Por ser dado de verdade, vai para o disco também no modo
 * fixtures (`meta.realData`). `networkMode: 'online'` explícito, porque o
 * padrão das consultas no modo fixtures é `always`, e o Firestore sem rede
 * falharia em vez de esperar.
 *
 * `data` é `null` enquanto a função de cadastro não criou o perfil.
 */
export function useMyProfileQuery() {
  const confirmedUid = useConfirmedUid();
  const lastSessionUid = usePreferencesStore((state) => state.lastSessionUid);
  const uid = confirmedUid ?? lastSessionUid ?? '';

  return useQuery<FanProfile | null>({
    queryKey: profileKeys.me(uid),
    queryFn: confirmedUid ? () => fetchMyProfile(confirmedUid) : skipToken,
    networkMode: 'online',
    meta: { realData: true },
  });
}

/**
 * Mantém o perfil em cache igual ao do Firestore enquanto a tela está aberta:
 * ele nasce depois do cadastro, e a foto chega depois de o servidor validar o
 * upload. Uma escuta só por documento no SDK, mesmo com mais de uma tela.
 */
export function useWatchMyProfile(): void {
  const uid = useConfirmedUid();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!uid) return undefined;
    return watchMyProfile(uid, (profile) => {
      queryClient.setQueryData(profileKeys.me(uid), profile);
    });
  }, [uid, queryClient]);
}

/**
 * Saldo, nível e temporada. Da API quando ela está configurada (o emulador em
 * desenvolvimento), das fixtures no resto; com a API, pausa sem rede e vai
 * para o disco (`queryOptionsFor`).
 */
export function useWalletQuery() {
  return useQuery({
    queryKey: profileKeys.wallet(),
    queryFn: fetchWallet,
    ...queryOptionsFor('wallet'),
  });
}

/** Nível, XP de nível, ganhos da semana e números do fã (1e), da mesma fonte da carteira. */
export function useMyProgressQuery() {
  return useQuery({
    queryKey: profileKeys.progress(),
    queryFn: fetchMyProgress,
    ...queryOptionsFor('wallet'),
  });
}

/**
 * Conquistas do fã: a contagem e as que o perfil mostra (1e). Do servidor com
 * o emulador (bloco 7), com rede e disco; das fixtures no resto.
 */
export function useMyAchievementsQuery() {
  return useQuery({
    ...queryOptionsFor('achievements'),
    queryKey: profileKeys.achievements(),
    queryFn: fetchMyAchievements,
  });
}

/**
 * O extrato de pontos (a tela provisória do bloco 7), uma página por vez, da
 * mesma fonte da carteira. A chave fica debaixo da dela: quem invalida a
 * carteira depois de ganhar ou gastar pontos (e o puxar para atualizar da 1e)
 * busca o extrato de novo.
 */
export function useLedgerInfiniteQuery() {
  return useInfiniteQuery({
    ...queryOptionsFor('wallet'),
    queryKey: profileKeys.ledger(),
    queryFn: ({ pageParam }) => fetchLedgerPage({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/**
 * Código de convite do fã, para os links que ele compartilha. Da API com o
 * emulador (`sourceOf('invite')`), com rede e disco: o código não muda, e o
 * salvo serve sem rede.
 */
export function useMyInviteQuery() {
  return useQuery({
    queryKey: profileKeys.invite(),
    queryFn: fetchMyInvite,
    ...queryOptionsFor('invite'),
  });
}

export type RegisterInviteLinkVariables = {
  linkId: string;
  /** A mesma nas novas tentativas da mutação. */
  idempotencyKey: string;
};

/**
 * Conta o link compartilhado quando a folha de compartilhar voltou
 * compartilhada. Sem fila offline e sem aviso na tela: o fã já compartilhou,
 * e um link que não contou não muda nada para ele. Link novo faz o Perfil
 * buscar os números de novo ("links criados").
 */
export function useRegisterInviteLinkMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, idempotencyKey }: RegisterInviteLinkVariables) =>
      registerInviteLink(linkId, idempotencyKey),
    networkMode: 'always',
    retry: 2,
    onSuccess: (result) => {
      if (result.created) void queryClient.invalidateQueries({ queryKey: profileKeys.progress() });
    },
  });
}

// --- Editar perfil (bloco 9 e seção 28 de docs/arquitetura-api.md) ----------------

/**
 * O @ que o fã digita está livre? Só liga com a API, com o @ no formato,
 * diferente do de agora e com o prazo livre (quem decide é a tela, por
 * `enabled`). Retrato de 30 s, fora do disco.
 */
export function useUsernameAvailabilityQuery(username: string, enabled: boolean) {
  const options = queryOptionsFor('profile');
  return useQuery({
    ...options,
    queryKey: profileKeys.usernameAvailability(username),
    queryFn: () => fetchUsernameAvailability(username),
    enabled: enabled && sourceOf('profile') === 'api',
    staleTime: 30_000,
    retry: false,
    meta: { ...options.meta, persist: false },
  });
}

/**
 * O perfil público de outro fã (`GET /fans/:fanId`, seção 28), aberto pelo
 * ranking, pelo pódio, pelos top fãs e pelos comentários. Da API com ela (o
 * domínio `profile`), das fixtures no resto. Retrato de 30 s e fora do disco:
 * o perfil de outro fã, que pode ter fechado a conta ou a conta privada
 * depois, não fica guardado no aparelho.
 */
export function useFanProfileQuery(fanId: string) {
  const options = queryOptionsFor('profile');
  return useQuery({
    ...options,
    queryKey: fanKeys.profile(fanId),
    queryFn: () => fetchFanProfile(fanId),
    staleTime: 30_000,
    meta: { ...options.meta, persist: false },
  });
}

/** Põe no perfil em cache o que a resposta do servidor já trouxe, antes da escuta. */
function patchMyProfile(
  client: QueryClient,
  uid: string,
  patch: (profile: FanProfile) => FanProfile,
): void {
  client.setQueryData<FanProfile | null>(profileKeys.me(uid), (profile) =>
    profile ? patch(profile) : profile,
  );
}

/**
 * A foto nova (ou a falta dela) no perfil em cache, e o próprio perfil público
 * busca de novo (a foto dele é a mesma).
 */
function patchPhoto(client: QueryClient, uid: string, change: PhotoChange): void {
  patchMyProfile(client, uid, (profile) => ({ ...profile, ...change }));
  void client.invalidateQueries({ queryKey: fanKeys.profile(uid) });
}

/**
 * Corre a tentativa contra o prazo: passado o prazo, cancela o pedido pelo
 * `signal` e rejeita com `ApiError('timeout')`, que é falha incerta. O prazo
 * cobre também a espera da sessão e do token, que vêm antes do `timeout` do
 * axios.
 */
async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError('timeout', 'O perfil não respondeu a tempo.'));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Uma tentativa do ✓: o corpo que foi e a chave dele. */
type ProfileAttempt = { body: string; key: string };

/**
 * O ✓ da tela "Editar perfil" (`PUT /me/profile`, seção 28): nome, @, bio,
 * cidade, gênero, conta privada e redes num pedido só. Sem fila offline (o ✓
 * fica apagado sem internet) e sem nova tentativa automática. A chave é da
 * tentativa, `profile-<id>`, guardada com o corpo que foi: depois de uma falha
 * incerta (rede, servidor, o prazo), o mesmo corpo vai com a mesma chave; o fã
 * mexeu num campo, chave nova; a recusa definitiva fecha a tentativa. A
 * tentativa inteira tem o prazo de `PROFILE_SAVE_TIMEOUT_MS` (28.5).
 *
 * No sucesso, o perfil em cache recebe a resposta antes da escuta, e o perfil
 * público do próprio fã (`fanKeys.profile(uid)`) busca de novo; o ranking
 * busca de novo quando o nome ou a cidade mudaram (a linha do fã mostra os
 * dois); com o @, as consultas de disponibilidade saem do cache. A recusa de @
 * com dono, reservado ou fora do formato vai para o retrato da
 * disponibilidade desse @: senão, por até 30 s, o mesmo @ voltaria
 * "Disponível".
 */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  const uid = useConfirmedUid();
  const attempt = useRef<ProfileAttempt | null>(null);
  return useMutation({
    mutationKey: profileMutationKeys.update,
    mutationFn: (changes: ProfileChanges): Promise<EditableProfile> => {
      const body = JSON.stringify(changes);
      if (attempt.current?.body !== body) {
        attempt.current = { body, key: `profile-${createIdempotencyKey()}` };
      }
      const { key } = attempt.current;
      return withDeadline(PROFILE_SAVE_TIMEOUT_MS, (signal) =>
        updateMyProfile(changes, key, signal),
      );
    },
    networkMode: 'always',
    retry: false,
    onSuccess: (edited, changes) => {
      attempt.current = null;
      if (uid) {
        patchMyProfile(queryClient, uid, (profile) => applyEditableProfile(profile, edited));
        // O próprio perfil público (aberto pelo ranking ou por um comentário dele).
        void queryClient.invalidateQueries({ queryKey: fanKeys.profile(uid) });
      }
      if (changes.displayName !== undefined || changes.city !== undefined) {
        refreshRanking(queryClient);
      }
      if (changes.username !== undefined) {
        void queryClient.invalidateQueries({ queryKey: profileKeys.username() });
      }
    },
    onError: (error, changes) => {
      if (!isUncertainFailure(error)) attempt.current = null;
      const refused = refusedUsernameStatus(error);
      if (refused && changes.username !== undefined) {
        queryClient.setQueryData<UsernameAvailability>(
          profileKeys.usernameAvailability(changes.username),
          { username: changes.username, status: refused },
        );
      }
    },
  });
}

/**
 * Falha de resultado incerto (rede, servidor): a nova tentativa leva a mesma
 * chave (e, na foto, o mesmo arquivo). As mutações abaixo guardam a tentativa
 * só nesse caso, e a tela da foto só oferece "Tentar de novo" com ela.
 */
export function isUncertainFailure(error: unknown): boolean {
  return error instanceof ApiError
    ? error.isRetryable
    : !(error instanceof PhotoPickError) && !isStorageRefusal(error);
}

/** Recusa do Storage (regra, sessão trocada): uma nova tentativa não muda nada. */
function isStorageRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'storage/unauthorized' || code === 'storage/unauthenticated';
}

/** A API respondeu este código (`ApiError.code`). */
export function apiErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** Um texto do `details` do erro da API (`field`, `reason`, `action`), ou `null`. */
export function apiErrorDetail(error: unknown, key: string): string | null {
  const value = error instanceof ApiError ? error.details?.[key] : undefined;
  return typeof value === 'string' ? value : null;
}

/**
 * A recusa definitiva do @, como status do @: `username_taken` é `taken`; o
 * `username_invalid` de formato (`details.reason`), `invalid`; o resto dele
 * (reservado ou automático, o formato o aparelho já conferiu), `reserved`.
 */
export function refusedUsernameStatus(error: unknown): 'taken' | 'reserved' | 'invalid' | null {
  const code = apiErrorCode(error);
  if (code === 'username_taken') return 'taken';
  if (code === 'username_invalid') {
    return apiErrorDetail(error, 'reason') === 'format' ? 'invalid' : 'reserved';
  }
  return null;
}

/** Uma tentativa de troca de foto: o arquivo preparado e o id (o nome do arquivo e a chave). */
type PhotoAttempt = {
  photo: PickedPhoto;
  id: string;
  prepared: string | null;
  /** O envio já começou uma vez: a nova tentativa confere antes se ele chegou. */
  sent: boolean;
};

/**
 * Troca a foto: prepara (recorte e redução), abre a vaga do envio na API
 * (`POST /me/photo/upload`, com uma chave nova a cada chamada: a vaga do mesmo
 * arquivo só renova o prazo), envia ao Storage e grava pela API
 * (`PUT /me/photo`), numa tentativa só. A chave é `photo-<id>`, com o mesmo
 * `id` do nome do arquivo: na nova tentativa depois de uma falha incerta (a
 * mesma foto escolhida de novo), antes de enviar, confere pelos metadados se o
 * envio já chegou; com o arquivo lá, segue para o `PUT`, que com a mesma chave
 * devolve a resposta guardada. Um erro do envio nunca é tomado por "já subiu".
 * O `photo_not_found` (o arquivo sumiu, passou de 10 min ou é de antes da
 * última troca) abre sozinho uma tentativa nova, uma vez, com id e chave novos
 * e o mesmo arquivo preparado. Sem fila offline.
 */
export function useChangePhotoMutation() {
  const queryClient = useQueryClient();
  const uid = useConfirmedUid();
  const attempt = useRef<PhotoAttempt | null>(null);

  const send = async (fanUid: string, current: PhotoAttempt): Promise<PhotoChange> => {
    current.prepared ??= (await preparePhoto(current.photo)).uri;
    const path = fanPhotoPath(fanUid, current.id);
    const uploaded = current.sent && (await photoUploaded(path));
    if (!uploaded) {
      await reservePhotoUpload(path, `photo-upload-${createIdempotencyKey()}`);
      current.sent = true;
      await uploadFanPhoto(fanUid, current.prepared, current.id);
    }
    return setMyPhoto(path, `photo-${current.id}`);
  };

  return useMutation({
    mutationKey: profileMutationKeys.photo,
    mutationFn: async (photo: PickedPhoto) => {
      if (!uid) throw new Error('Sem sessão confirmada para trocar a foto.');
      if (attempt.current?.photo !== photo) {
        attempt.current = { photo, id: createIdempotencyKey(), prepared: null, sent: false };
      }
      const current = attempt.current;
      try {
        return await send(uid, current);
      } catch (error) {
        if (apiErrorCode(error) !== 'photo_not_found') throw error;
        const fresh: PhotoAttempt = {
          photo,
          id: createIdempotencyKey(),
          prepared: current.prepared,
          sent: false,
        };
        attempt.current = fresh;
        return send(uid, fresh);
      }
    },
    networkMode: 'always',
    retry: false,
    onSuccess: (change) => {
      attempt.current = null;
      if (uid) patchPhoto(queryClient, uid, change);
      refreshRanking(queryClient);
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
    },
  });
}

/**
 * Tira a foto (`DELETE /me/photo`), com a chave `photo-remove-<id>` da
 * tentativa (a mesma depois de uma falha incerta). Sem fila offline.
 */
export function useRemovePhotoMutation() {
  const queryClient = useQueryClient();
  const uid = useConfirmedUid();
  const attempt = useRef<string | null>(null);
  return useMutation({
    mutationKey: profileMutationKeys.removePhoto,
    mutationFn: () => {
      attempt.current ??= `photo-remove-${createIdempotencyKey()}`;
      return removeMyPhoto(attempt.current);
    },
    networkMode: 'always',
    retry: false,
    onSuccess: (change) => {
      attempt.current = null;
      if (uid) patchPhoto(queryClient, uid, change);
      refreshRanking(queryClient);
    },
    onError: (error) => {
      if (!isUncertainFailure(error)) attempt.current = null;
    },
  });
}
