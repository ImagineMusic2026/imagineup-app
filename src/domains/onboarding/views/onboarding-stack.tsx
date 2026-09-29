import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useStackFade } from '@/hooks/use-stack-fade';
import { useStackScreenOptions } from '@/hooks/use-stack-screen-options';
import { colors, radii } from '@/theme';

/**
 * Pilha do grupo `(onboarding)`: a escolha de artistas (1l) e a sheet de todos
 * os artistas. Sem gesto de voltar na 1l (não há para onde voltar); a sheet
 * fecha arrastando. A pilha entra do fundo escuro em fade e sai para ele antes
 * de o guard trocar para as abas (`playStackExit('onboarding')`), porque a
 * troca de grupo na pilha raiz é seca.
 */
export function OnboardingStack() {
  const screenOptions = useStackScreenOptions();
  const fade = useStackFade('onboarding');

  return (
    <View style={styles.root}>
      {/* No Android, sem a composição fora da tela, cada camada dos cards
          apagaria sozinha e a foto vazaria pelo véu no meio do fade. */}
      <Animated.View
        needsOffscreenAlphaCompositing
        onLayout={fade.onLayout}
        style={[styles.fill, fade.style]}
      >
        <Stack screenOptions={{ ...screenOptions, gestureEnabled: false }}>
          <Stack.Screen name="artistas" />
          <Stack.Screen
            name="todos-artistas"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [1],
              sheetGrabberVisible: true,
              sheetCornerRadius: radii.sheet,
              gestureEnabled: true,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
        </Stack>
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
});
