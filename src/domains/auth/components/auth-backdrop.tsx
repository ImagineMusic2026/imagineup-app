import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { PhotoFallback } from '@/components/remote-image';
import { Scrim } from '@/components/scrim';
import { Stripes } from '@/components/stripes';
import { useIsOnline } from '@/hooks/use-is-online';
import { colors, gradients, motion } from '@/theme';

// O logo fica a 22 da área segura (76 no frame do protótipo), com 17 de altura, a .75.
const LOGO_TOP = 22;
const LOGO_HEIGHT = 17;
const LOGO_OPACITY = 0.75;

/** Onde o logo do fundo termina, medido da área segura de cima. */
export const AUTH_LOGO_BOTTOM = LOGO_TOP + LOGO_HEIGHT;

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
 */
export function AuthBackdrop() {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, styles.container]}
    >
      <PhotoFallback seed="auth" pair={gradients.authPhotoFallback} stripes={null} />
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
