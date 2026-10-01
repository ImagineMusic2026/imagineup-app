import { Image, type ImageRef } from 'expo-image';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

// PNG branco do protótipo, 610 x 139.
const LOGO_SOURCE = require('@/assets/images/imagine-logo.png');
const LOGO_ASPECT_RATIO = 610 / 139;

// Altura do logo na abertura (1k) e nos formulários de conta.
const DEFAULT_HEIGHT = 17;

// O logo já decodificado na abertura do app (`preloadLogo`).
let preloaded: ImageRef | null = null;

/**
 * Carrega o logo na memória na abertura do app (chamado no `_layout` raiz,
 * logo depois das fontes, nunca junto: no Expo Go, carregar os dois ao mesmo
 * tempo atrasava as fontes até depois da primeira tela). O `Logo` que monta
 * depois desenha a imagem pronta no primeiro quadro, em vez de buscar e
 * decodificar o arquivo e aparecer depois do resto da tela (o vão na pílula
 * "gestão oficial" da 1d). Não segura a splash: se não chegar a tempo, o logo
 * entra em fade.
 */
export function preloadLogo(): void {
  if (preloaded) return;
  Image.loadAsync(LOGO_SOURCE).then(
    (ref) => {
      preloaded = ref;
    },
    () => undefined,
  );
}

export interface LogoProps {
  /** A largura sai da proporção do arquivo. A pílula "gestão oficial" (1d) usa 9. */
  height?: number;
  /** O protótipo apaga o logo um pouco: .75 na 1k, .9 na pílula da 1d. */
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Logo da Imagine Music. É decorativo em todo lugar em que aparece: o nome do
 * app está no título ao lado, e a pílula "gestão oficial" entra no rótulo do
 * artista.
 *
 * Já carregado (`preloadLogo`), sai inteiro no primeiro quadro. Se ainda não,
 * fica apagado e entra em fade quando a imagem chega (`onLoad`), em vez de
 * surgir seco depois do resto da tela: a `transition` do expo-image não
 * aparecia no Android. Com reduzir movimento, aparece sem o fade.
 */
export function Logo({ height = DEFAULT_HEIGHT, opacity = 1, style }: LogoProps) {
  const reducedMotion = usePrefersReducedMotion();
  // A fonte da montagem: trocar no meio recarregaria a imagem.
  const [ready] = useState(() => preloaded);
  const shown = useSharedValue(ready || reducedMotion ? 1 : 0);

  const onLoad = (): void => {
    shown.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  };

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity * shown.get() }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[style, fadeStyle]}
    >
      <Image
        source={ready ?? LOGO_SOURCE}
        contentFit="contain"
        onLoad={onLoad}
        style={{ height, width: height * LOGO_ASPECT_RATIO }}
      />
    </Animated.View>
  );
}
