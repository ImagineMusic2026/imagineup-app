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
import { useAuthListener, useInviteSync } from '@/domains/auth';
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
  // Manda o convite amarrado à conta da sessão e a visita do link que abriu o app.
  useInviteSync();
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
          {/* Perfil público de outro fã, aberto pelo ranking e pelos comentários:
              tela empilhada, sem tab bar, no modelo do post, com denunciar e
              bloquear (seção 29). */}
          <Stack.Screen name="fa/[fanId]" />
          {/* "Editar perfil" fora das abas, com o header fixo (X, título e ✓). Push
              padrão: o "sem animação" de reduzir movimento vem da pilha. */}
          <Stack.Screen name="editar-perfil" />
          {/* "Trocar senha" e "Trocar e-mail", abertas pelos Ajustes (seção 29):
              formulários com teclado, fora das abas e com push padrão, como o
              "Editar perfil". */}
          <Stack.Screen name="trocar-senha" />
          <Stack.Screen name="trocar-email" />
          {/* O fã-clube gerido pelo fã (seção 34): o estado do fã ou o "Meu
              fã-clube", a candidatura e a nova publicação, abertos pelos
              Ajustes, fora das abas e com push padrão (as duas últimas têm
              teclado). Sem o programa aberto no servidor, só dizem que o
              fã-clube não está disponível. */}
          <Stack.Screen name="meu-fa-clube/index" />
          <Stack.Screen name="meu-fa-clube/candidatura" />
          <Stack.Screen name="meu-fa-clube/nova-publicacao" />
          {/* A página pública do fã-clube (seção 34, etapa 8): fora das abas, no
              modelo do perfil público e do post, o destino do link de convite.
              Sem a resposta do servidor novo, só diz que não está disponível. */}
          <Stack.Screen name="fa-clube/[clubeId]" />
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
          {/* "Opções do comentário" do post (denunciar e bloquear), provisória
              (UP-48), na altura do conteúdo, no visual das outras sheets. */}
          <Stack.Screen
            name="comentario/[comentarioId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          {/* "Denunciar perfil", aberta pelo perfil público (seção 29), na altura
              do conteúdo, no molde da "Opções do comentário". */}
          <Stack.Screen
            name="denunciar-perfil/[fanId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          {/* "Denunciar publicação" e "Deixar de seguir?" do fã-clube (seção 34),
              na altura do conteúdo, no molde da "Denunciar perfil". */}
          <Stack.Screen
            name="denunciar-publicacao/[publicacaoId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          <Stack.Screen
            name="deixar-de-seguir/[clubeId]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
          {/* "Regras do fã-clube", aberta pela apresentação: as condições e o
              texto do reconhecimento dentro do app (seção 34, decisão 47), na
              altura do conteúdo, no molde do "Gerar meu link". */}
          <Stack.Screen
            name="meu-fa-clube/regras"
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
