import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryOptionsFor } from '@/services/query/client';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import {
  fetchLedgerPage,
  fetchMyAchievements,
  fetchMyInvite,
  fetchMyProfile,
  fetchMyProgress,
  fetchWallet,
  registerInviteLink,
  watchMyProfile,
} from './api';
import { profileKeys } from './keys';
import type { FanProfile } from './types';

export { profileKeys };

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
