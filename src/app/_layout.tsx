import '@/config/zod';

import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import { isRunningInExpoGo } from 'expo';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { preloadLogo } from '@/components/logo';
import { useAuthListener } from '@/domains/auth';
import { useSessionGate } from '@/hooks/use-session-gate';
import { useStackScreenOptions } from '@/hooks/use-stack-screen-options';
import { AppProviders } from '@/providers/app-providers';
import { colors, radii } from '@/theme';

export { ErrorBoundary } from '@/components/error-boundary';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
// O Expo Go não aceita opções de splash e avisa a cada abertura.
if (!isRunningInExpoGo()) SplashScreen.setOptions({ duration: 300, fade: true });

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
  const { ready: sessionReady, signedIn, onboarded } = useSessionGate();
  const stackScreenOptions = useStackScreenOptions();

  const fontsSettled = fontsLoaded || !!fontError;
  const ready = fontsSettled && sessionReady;

  // O logo da 1k e da 1d decodifica depois das fontes: junto com elas, no
  // Expo Go, as fontes chegavam depois da primeira tela (título cortado e
  // texto na fonte do sistema).
  useEffect(() => {
    if (fontsSettled) preloadLogo();
  }, [fontsSettled]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <AppProviders>
      <StatusBar style="light" />
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          {/* Post fica fora das abas: a tela de comentários tem teclado e não leva tab bar. */}
          <Stack.Screen name="post/[postId]" />
          {/* "Gerar meu link" na altura do conteúdo: o link, as regras e o botão
              aparecem sem o fã puxar a sheet. */}
          <Stack.Screen
            name="convidar"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          {/* "Sair da central" da 1d, provisória (UP-48), na altura do conteúdo,
              no visual do "Gerar meu link". */}
          <Stack.Screen
            name="sair-da-central/[artistaId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          {/* Detalhe, confirmação e instruções do resgate (1h), em altura cheia:
              a foto, o quadro de pontos e o botão preso no pé. */}
          <Stack.Screen
            name="recompensa/[recompensaId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [1],
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
        </Stack.Protected>
        {/* Fora dos guards: guarda o código do convite e segue para uma rota permitida. */}
        <Stack.Screen name="convite/[codigo]" options={{ animation: 'none' }} />
      </Stack>
    </AppProviders>
  );
}
