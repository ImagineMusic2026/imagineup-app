import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { haptics } from '@/services/haptics';
import { StorageKeys } from '@/storage/storage/keys';

interface PreferencesState {
  hapticsEnabled: boolean;
  /**
   * Provisório: quando o perfil do fã existir na API, "onboarding concluído"
   * passa a vir de lá, e este campo sai.
   */
  hasCompletedOnboarding: boolean;
  /**
   * Uid da última sessão aberta neste aparelho. Deixa o app abrir direto nas
   * abas, com o cache salvo, sem esperar o Firebase ir à rede confirmar a
   * sessão (até 60 s com sinal ruim). Se a sessão tiver caído, o guard corrige.
   */
  lastSessionUid: string | null;
  hydrated: boolean;
  setHapticsEnabled: (value: boolean) => void;
  setLastSessionUid: (uid: string | null) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

/** Preferências do aparelho, salvas localmente. Estado do servidor não entra aqui. */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      hapticsEnabled: true,
      hasCompletedOnboarding: false,
      lastSessionUid: null,
      hydrated: false,
      setHapticsEnabled: (value) => {
        haptics.setEnabled(value);
        set({ hapticsEnabled: value });
      },
      setLastSessionUid: (uid) => set({ lastSessionUid: uid }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false }),
    }),
    {
      name: StorageKeys.Preferences,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hapticsEnabled, hasCompletedOnboarding, lastSessionUid }) => ({
        hapticsEnabled,
        hasCompletedOnboarding,
        lastSessionUid,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) haptics.setEnabled(state.hapticsEnabled);
        usePreferencesStore.setState({ hydrated: true });
      },
    },
  ),
);
