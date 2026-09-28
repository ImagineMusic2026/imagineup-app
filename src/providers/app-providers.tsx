import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { registerPostMutationDefaults } from '@/domains/posts';
import { persistOptions, queryClient, setupReactQueryForReactNative } from '@/services/query';
import { colors, navigationTheme } from '@/theme';

// As funções das mutações offline precisam existir antes do cache ser restaurado.
registerPostMutationDefaults(queryClient);

function resumeOfflineMutations(): void {
  queryClient.resumePausedMutations().catch(() => undefined);
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => setupReactQueryForReactNative(), []);

  return (
    <GestureHandlerRootView style={styles.root}>
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
