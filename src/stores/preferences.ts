import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { haptics } from '@/services/haptics';
import { StorageKeys } from '@/storage/storage/keys';

import type { SignInMethod } from './session';

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
  /**
   * O jeito da última entrada que deu certo neste aparelho, dito na abertura
   * (1k): "Da última vez, você entrou com o Google." (seção 33, decisão 9).
   * Gravado em toda entrada, fica depois de "Sair" e sai na exclusão da conta.
   */
  lastSignInMethod: SignInMethod | null;
  hydrated: boolean;
  setHapticsEnabled: (value: boolean) => void;
  setLastSessionUid: (uid: string | null) => void;
  setLastSignInMethod: (method: SignInMethod | null) => void;
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
      lastSignInMethod: null,
      hydrated: false,
      setHapticsEnabled: (value) => {
        haptics.setEnabled(value);
        set({ hapticsEnabled: value });
      },
      setLastSessionUid: (uid) => set({ lastSessionUid: uid }),
      setLastSignInMethod: (method) => set({ lastSignInMethod: method }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false }),
    }),
    {
      name: StorageKeys.Preferences,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({
        hapticsEnabled,
        hasCompletedOnboarding,
        lastSessionUid,
        lastSignInMethod,
      }) => ({
        hapticsEnabled,
        hasCompletedOnboarding,
        lastSessionUid,
        lastSignInMethod,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) haptics.setEnabled(state.hapticsEnabled);
        usePreferencesStore.setState({ hydrated: true });
      },
    },
  ),
);
