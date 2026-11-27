import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { StorageKeys } from '@/storage/storage/keys';

interface InviteSettledState {
  /**
   * As contas que já resolveram o convite neste aparelho, por uid, com a data
   * em que resolveram: o claim voltou `claimed` ou `already_claimed` (20.18).
   */
  settled: Record<string, string>;
  hydrated: boolean;
  markSettled: (uid: string, at?: string) => void;
}

/**
 * A marca de convite resolvido, no aparelho, gravada quando um claim é aceito:
 * no cadastro, na sincronização e na tela "Código de convite" dos Ajustes. Ela
 * só esconde a linha "Tenho um código de convite"; quem decide se o convite
 * vale é o servidor (uma vez por conta, nos 7 primeiros dias). Noutro
 * aparelho, sem a marca, a linha aparece e o servidor responde que a conta já
 * tem convite. Antes de o disco responder (`hydrated`), ninguém mostra a
 * linha.
 */
export const useInviteSettledStore = create<InviteSettledState>()(
  persist(
    (set) => ({
      settled: {},
      hydrated: false,
      markSettled: (uid, at = new Date().toISOString()) =>
        set((state) => (state.settled[uid] ? state : { settled: { ...state.settled, [uid]: at } })),
    }),
    {
      name: StorageKeys.InviteSettled,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ settled }) => ({ settled }),
      onRehydrateStorage: () => () => {
        useInviteSettledStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Marca a conta, fora do React (o cadastro e a sincronização). */
export function markInviteSettled(uid: string): void {
  useInviteSettledStore.getState().markSettled(uid);
}
