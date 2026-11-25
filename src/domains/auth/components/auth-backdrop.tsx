import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { Scrim } from '@/components/scrim';
import { Stripes } from '@/components/stripes';
import { useIsOnline } from '@/hooks/use-is-online';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { StackEntrance } from '@/hooks/use-stack-fade';
import { colors, isLargeText, motion } from '@/theme';

import { PhotoWall } from './photo-wall';

// O logo fica a 22 da área segura (76 no frame do protótipo), com 17 de altura, a .75.
const LOGO_TOP = 22;
const LOGO_HEIGHT = 17;
const LOGO_OPACITY = 0.75;

/** Onde o logo do fundo termina, medido da área segura de cima. */
export const AUTH_LOGO_BOTTOM = LOGO_TOP + LOGO_HEIGHT;

// A parede entra um pouco maior e assenta devagar, por trás do fade da pilha.
const WALL_START_SCALE = 1.04;

/**
 * Escala da parede quando o fundo aparece: de 1,04 a 1 em 1,2 s, a partir do
 * fade da pilha `(auth)` (`entrance`), enquanto o texto da 1k sobe. Na
 * montagem, a pilha ainda está apagada e a parede assentaria escondida. Uma
 * vez só, e depois ela fica parada: o fundo segue montado enquanto o fã vai e
 * volta entre as telas de conta. Com reduzir movimento, nem assenta.
 */
function useWallSettle(entrance: StackEntrance) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = useSharedValue(reducedMotion ? 1 : WALL_START_SCALE);

  useEffect(() => {
    if (reducedMotion) {
      scale.set(1);
      return undefined;
    }
    return entrance.onEnter(() => {
      scale.set(withTiming(1, { duration: motion.duration.settle, easing: motion.easing.out }));
    });
  }, [entrance, reducedMotion, scale]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
}

/**
 * Fundo da 1k, compartilhado pelas telas de conta (abertura, entrar com
 * e-mail, cadastro): a parede de fotos, o véu, as listras da marca e o logo.
 * Mora atrás da pilha do grupo `(auth)`, então fica parado enquanto as telas
 * trocam em fade.
 *
 * O véu deixa a parede à vista em cima e fecha antes do meio da tela, onde
 * começam o nome e a frase da abertura. Com a fonte grande, o texto da abertura
 * passa da altura da tela e sobe para cima da parede: o véu fecha desde o topo
 * (`authLarge`). As perguntas do cadastro e do entrar põem o véu delas por
 * cima deste.
 *
 * `entrance` é o início do fade da pilha (`useStackFade`): a parede assenta a
 * partir dele.
 */
export function AuthBackdrop({ entrance }: { entrance: StackEntrance }) {
  const wallStyle = useWallSettle(entrance);
  // A parede é medida pela tela, que já se sabe na montagem: os cartões saem
  // no lugar no primeiro quadro, junto com o fade da pilha.
  const frame = useSafeAreaFrame();
  const { fontScale } = useWindowDimensions();
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, styles.container]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, wallStyle]}>
        <PhotoWall width={frame.width} height={frame.height} />
      </Animated.View>
      <Scrim preset={isLargeText(fontScale) ? 'authLarge' : 'auth'} />
      <Stripes preset="auth" />
      <AuthLogo />
    </View>
  );
}

/**
 * O logo do topo das telas de conta, a .75, decorativo. O fundo o desenha
 * atrás da pilha, e as perguntas e o momento da conta o desenham de novo, no
 * mesmo lugar, por cima do véu delas, que o apagaria: na troca em fade, os
 * dois se somam e o logo fica parado.
 *
 * Sem internet, o aviso de offline ocupa o topo, e o logo sai em fade em vez
 * de ficar meio coberto por ele.
 */
export function AuthLogo() {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  if (!online) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(motion.duration.base)}
      exiting={FadeOut.duration(motion.duration.base)}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.logo, { top: insets.top + LOGO_TOP }]}
    >
      <Logo height={LOGO_HEIGHT} opacity={LOGO_OPACITY} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
  },
  logo: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
