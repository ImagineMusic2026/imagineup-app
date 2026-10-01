import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { StaticPhotoFallback } from '@/components/remote-image';
import { Scrim } from '@/components/scrim';
import { Stripes } from '@/components/stripes';
import { useIsOnline } from '@/hooks/use-is-online';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { StackEntrance } from '@/hooks/use-stack-fade';
import { colors, gradients, motion } from '@/theme';

// O logo fica a 22 da área segura (76 no frame do protótipo), com 17 de altura, a .75.
const LOGO_TOP = 22;
const LOGO_HEIGHT = 17;
const LOGO_OPACITY = 0.75;

/** Onde o logo do fundo termina, medido da área segura de cima. */
export const AUTH_LOGO_BOTTOM = LOGO_TOP + LOGO_HEIGHT;

// A foto entra um pouco maior e assenta devagar, por trás do fade da pilha.
const PHOTO_START_SCALE = 1.04;

/**
 * Escala da foto quando o fundo aparece: de 1,04 a 1 em 1,2 s, a partir do
 * fade da pilha `(auth)` (`entrance`), enquanto o texto da 1k sobe. Na
 * montagem, a pilha ainda está apagada e a foto assentaria escondida. Uma vez
 * só: o fundo fica montado enquanto o fã vai e volta entre as telas de conta.
 * Com reduzir movimento, a foto fica parada.
 */
function usePhotoSettle(entrance: StackEntrance) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = useSharedValue(reducedMotion ? 1 : PHOTO_START_SCALE);

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
 * e-mail, cadastro): foto, véu, listras da marca e logo. Mora atrás da pilha
 * do grupo `(auth)`, então fica parado enquanto as telas trocam em fade.
 *
 * A foto (slot `up-1k-bg`) ainda não foi entregue: até lá, o placeholder rosa
 * para roxo. Quando chegar, entra como asset do binário (funciona na primeira
 * abertura e offline), com `contentPosition="top"`.
 *
 * Sem internet, o aviso de offline ocupa o topo, e o logo sai em fade em vez
 * de ficar meio coberto por ele.
 *
 * `entrance` é o início do fade da pilha (`useStackFade`): a foto assenta a
 * partir dele.
 */
export function AuthBackdrop({ entrance }: { entrance: StackEntrance }) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const photoStyle = usePhotoSettle(entrance);
  // O fundo ocupa a tela toda: a foto (em SVG) sai no primeiro quadro, junto com o fade da pilha.
  const frame = useSafeAreaFrame();
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, styles.container]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
        <StaticPhotoFallback
          seed="auth"
          pair={gradients.authPhotoFallback}
          stripes={null}
          width={frame.width}
          height={frame.height}
        />
      </Animated.View>
      <Scrim preset="auth" />
      <Stripes preset="auth" />
      {online ? (
        <Animated.View
          entering={FadeIn.duration(motion.duration.base)}
          exiting={FadeOut.duration(motion.duration.base)}
          style={[styles.logo, { top: insets.top + LOGO_TOP }]}
        >
          <Logo height={LOGO_HEIGHT} opacity={LOGO_OPACITY} />
        </Animated.View>
      ) : null}
    </View>
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
