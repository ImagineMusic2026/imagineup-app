import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import {
  fetchMyAchievements,
  fetchMyInvite,
  fetchMyProfile,
  fetchMyProgress,
  fetchWallet,
  watchMyProfile,
} from './api';
import type { FanProfile } from './types';

/** A chave inclui tudo que muda o resultado. */
export const profileKeys = {
  all: ['profile'] as const,
  me: (uid: string) => [...profileKeys.all, 'me', uid] as const,
  wallet: () => [...profileKeys.all, 'wallet'] as const,
  /**
   * Nível e ganhos da semana saem do mesmo XP da carteira. A chave fica debaixo
   * da dela: quem invalida a carteira depois de um ganho (o "Eu vou" da agenda)
   * ou de um resgate invalida o progresso junto, e o anel nunca fica com o
   * nível de antes.
   */
  progress: () => [...profileKeys.wallet(), 'progress'] as const,
  achievements: () => [...profileKeys.all, 'achievements'] as const,
  invite: () => [...profileKeys.all, 'invite'] as const,
};

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

/** Saldo, nível e temporada (fixtures até a API do M2). */
export function useWalletQuery() {
  return useQuery({
    queryKey: profileKeys.wallet(),
    queryFn: fetchWallet,
  });
}

/** Nível, XP de nível, ganhos da semana e números do fã (1e). */
export function useMyProgressQuery() {
  return useQuery({
    queryKey: profileKeys.progress(),
    queryFn: fetchMyProgress,
  });
}

/** Conquistas do fã: a contagem e as que o perfil mostra (1e). */
export function useMyAchievementsQuery() {
  return useQuery({
    queryKey: profileKeys.achievements(),
    queryFn: fetchMyAchievements,
  });
}

/** Código de convite do fã, para os links que ele compartilha. */
export function useMyInviteQuery() {
  return useQuery({
    queryKey: profileKeys.invite(),
    queryFn: fetchMyInvite,
  });
}
