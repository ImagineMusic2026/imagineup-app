import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { StorageKeys } from '@/storage/storage/keys';

interface FanClubPrizeState {
  /**
   * O último reconhecimento do fã-clube que o gestor já viu, por uid: o
   * `lastReward.at` que o "Meu fã-clube" mostrou (seção 34, decisão 51).
   */
  seen: Record<string, string>;
  hydrated: boolean;
  markSeen: (uid: string, at: string) => void;
}

/**
 * A marca de visto do prêmio do fã-clube, no aparelho, gravada quando o
 * gestor abre o "Meu fã-clube" (decisão 51). Até 26/10/2026, os Ajustes
 * mostravam "Novo prêmio" na linha até essa marca; desde então a linha só tem
 * o título, e a marca fica para quem voltar a mostrar o aviso. Fica num
 * arquivo e numa chave próprios, fora das preferências. Antes de o disco
 * responder (`hydrated`), ninguém deve mostrar "Novo prêmio".
 */
export const useFanClubPrizeStore = create<FanClubPrizeState>()(
  persist(
    (set) => ({
      seen: {},
      hydrated: false,
      markSeen: (uid, at) =>
        set((state) => (state.seen[uid] === at ? state : { seen: { ...state.seen, [uid]: at } })),
    }),
    {
      name: StorageKeys.FanClubPrizeSeen,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ seen }) => ({ seen }),
      onRehydrateStorage: () => () => {
        useFanClubPrizeStore.setState({ hydrated: true });
      },
    },
  ),
);
