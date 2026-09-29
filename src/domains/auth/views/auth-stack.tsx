import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useStackScreenOptions } from '@/hooks/use-stack-screen-options';
import { colors } from '@/theme';

import { AuthBackdrop } from '../components/auth-backdrop';
import { useAuthStackFade } from '../hooks/use-auth-exit';

/**
 * Pilha do grupo `(auth)`: abertura (1k), entrar com e-mail e cadastro. O fundo
 * da 1k fica atrás da pilha e as telas são transparentes, então a foto e o logo
 * ficam parados e só o conteúdo troca, em fade (sem animação com reduzir
 * movimento). A pilha inteira entra e sai do fundo escuro em fade, porque a
 * troca de grupo na pilha raiz é seca (`useAuthStackFade`).
 */
export function AuthStack() {
  const screenOptions = useStackScreenOptions();
  const reducedMotion = usePrefersReducedMotion();
  const fade = useAuthStackFade();
  return (
    <View style={styles.root}>
      {/* No Android, sem a composição fora da tela, cada camada apagaria
          sozinha e a foto vazaria pelo véu do formulário no meio do fade. */}
      <Animated.View
        needsOffscreenAlphaCompositing
        onLayout={fade.onLayout}
        style={[styles.fill, fade.style]}
      >
        <AuthBackdrop />
        <Stack
          screenOptions={{
            ...screenOptions,
            contentStyle: styles.screen,
            animation: reducedMotion ? 'none' : 'fade',
          }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  screen: {
    backgroundColor: colors.transparent,
  },
});
