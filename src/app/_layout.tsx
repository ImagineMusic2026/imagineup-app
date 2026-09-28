import '@/config/zod';

import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useAuthListener } from '@/domains/auth';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { AppProviders } from '@/providers/app-providers';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { colors, radii } from '@/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 300, fade: true });

export default function RootLayout() {
  useAuthListener();
  const [fontsLoaded, fontError] = useFonts({
    Sora_700Bold,
    Sora_800ExtraBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const status = useSessionStore((state) => state.status);
  const preferencesReady = usePreferencesStore((state) => state.hydrated);
  const hasCompletedOnboarding = usePreferencesStore((state) => state.hasCompletedOnboarding);
  const reducedMotion = usePrefersReducedMotion();

  const ready = (fontsLoaded || !!fontError) && status !== 'loading' && preferencesReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  const signedIn = status === 'signedIn';

  return (
    <AppProviders>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: reducedMotion ? 'none' : 'default',
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !hasCompletedOnboarding}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && hasCompletedOnboarding}>
          <Stack.Screen name="(tabs)" />
          {/* Post fica fora das abas: a tela de comentários tem teclado e não leva tab bar. */}
          <Stack.Screen name="post/[postId]" />
          <Stack.Screen
            name="convidar"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.5, 1],
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
        </Stack.Protected>
        <Stack.Screen name="convite/[codigo]" options={{ animation: 'none' }} />
      </Stack>
    </AppProviders>
  );
}
