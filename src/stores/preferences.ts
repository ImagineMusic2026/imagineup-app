import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { haptics } from '@/services/haptics';
import { StorageKeys } from '@/services/storage/keys';

interface PreferencesState {
  hapticsEnabled: boolean;
  /**
   * Provisório: quando o perfil do fã existir na API, "onboarding concluído"
   * passa a vir de lá, e este campo sai.
   */
  hasCompletedOnboarding: boolean;
  hydrated: boolean;
  setHapticsEnabled: (value: boolean) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

/** Preferências do aparelho, salvas localmente. Estado do servidor não entra aqui. */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      hapticsEnabled: true,
      hasCompletedOnboarding: false,
      hydrated: false,
      setHapticsEnabled: (value) => {
        haptics.setEnabled(value);
        set({ hapticsEnabled: value });
      },
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false }),
    }),
    {
      name: StorageKeys.Preferences,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hapticsEnabled, hasCompletedOnboarding }) => ({
        hapticsEnabled,
        hasCompletedOnboarding,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) haptics.setEnabled(state.hapticsEnabled);
        usePreferencesStore.setState({ hydrated: true });
      },
    },
  ),
);
