import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';

import { registerAgendaMutationDefaults } from '@/domains/agenda';
import { registerPostMutationDefaults } from '@/domains/posts';
import { useAnnounceOffline } from '@/hooks/use-announce-offline';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { persistOptions, queryClient, setupReactQueryForReactNative } from '@/services/query';
import { colors, navigationTheme } from '@/theme';

// As funções das mutações offline precisam existir antes do cache ser restaurado.
registerPostMutationDefaults(queryClient);
registerAgendaMutationDefaults(queryClient);

function resumeOfflineMutations(): void {
  queryClient.resumePausedMutations().catch(() => undefined);
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => setupReactQueryForReactNative(), []);
  useAnnounceOffline();
  // O Reanimated lê "reduzir movimento" só na abertura do app. Espelhar o valor
  // atual aqui faz a mudança feita com o app aberto valer para todas as
  // animações. O Never é global e só reflete o sistema; não é o Never por
  // animação que o CLAUDE.md proíbe.
  const reducedMotion = usePrefersReducedMotion();

  return (
    <GestureHandlerRootView style={styles.root}>
      <ReducedMotionConfig mode={reducedMotion ? ReduceMotion.Always : ReduceMotion.Never} />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
        onSuccess={resumeOfflineMutations}
      >
        <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
