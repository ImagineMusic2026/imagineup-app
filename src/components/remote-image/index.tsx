import { Image, type ImageContentFit, type ImageContentPosition } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import { mediaUrl } from '@/config/server';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import {
  avatarFallbacks,
  colors,
  motion,
  type StripePreset,
  type TypographyVariant,
} from '@/theme';
import { assertNever } from '@/utils/assert-never';
import { pickStable } from '@/utils/pick-stable';
import { initialsOf } from '@/utils/text';

import { PhotoFallback } from './photo-fallback';
import { StaticPhotoFallback } from './static-photo-fallback';

export {
  PhotoFallback,
  photoFallbackPair,
  type PhotoFallbackProps,
  type PhotoFallbackVariant,
} from './photo-fallback';
export { StaticPhotoFallback, type StaticPhotoFallbackProps } from './static-photo-fallback';

/**
 * O que aparece sem foto, enquanto ela carrega ou se ela falhar:
 * - `brand`: placeholder de marca (artista, post, recompensa);
 * - `events`: foto de show ausente, no azul de shows;
 * - `surface`: só o fundo neutro;
 * - `initials`: iniciais sobre a cor estável do id (miniatura de central).
 *
 * `stripes` troca as listras de `brand` e `events` (`null` tira, para a tela
 * desenhar as suas por cima, como a capa da 1d).
 */
export type RemoteImageFallback =
  | { kind: 'brand' | 'events'; seed: string; stripes?: StripePreset | null }
  | { kind: 'surface'; seed: string }
  | { kind: 'initials'; seed: string; name: string };

export interface RemoteImageProps {
  uri: string | null | undefined;
  fallback: RemoteImageFallback;
  contentFit?: ImageContentFit;
  contentPosition?: ImageContentPosition;
  /** Fade da foto quando ela chega, em ms. */
  transition?: number;
  /** Tamanho das iniciais do fallback `initials`. */
  initialsVariant?: TypographyVariant;
  /**
   * Medida que a tela já sabe (capa da 1d, destaques da 1h e da 1m): o
   * placeholder de marca ou de show sai em SVG no primeiro quadro
   * (`StaticPhotoFallback`), com as listras, junto com a transição da tela, em
   * vez de esperar a superfície do Skia. Se o espaço real for outro, ele se
   * corrige no `onLayout`.
   */
  fallbackSize?: { width: number; height: number };
  /** Só quando a foto é o conteúdo; por padrão ela é decorativa e o card em volta descreve. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Duração do fade de foto: zero com "reduzir movimento". */
export function useImageFade(duration: number = motion.duration.base): number {
  return usePrefersReducedMotion() ? 0 : duration;
}

function FallbackLayer({
  fallback,
  initialsVariant,
  size,
}: {
  fallback: RemoteImageFallback;
  initialsVariant: TypographyVariant;
  size: RemoteImageProps['fallbackSize'];
}) {
  switch (fallback.kind) {
    case 'brand':
    case 'events':
      if (size) {
        return (
          <StaticPhotoFallback
            seed={fallback.seed}
            variant={fallback.kind}
            stripes={fallback.stripes}
            width={size.width}
            height={size.height}
          />
        );
      }
      return (
        <PhotoFallback seed={fallback.seed} variant={fallback.kind} stripes={fallback.stripes} />
      );
    case 'initials':
      return (
        <View
          style={[styles.initials, { backgroundColor: pickStable(fallback.seed, avatarFallbacks) }]}
        >
          {/* Parte da imagem: a caixa não cresce, e o nome está em texto ao lado. */}
          <Text variant={initialsVariant} color={colors.textBody} maxFontSizeMultiplier={1}>
            {initialsOf(fallback.name)}
          </Text>
        </View>
      );
    case 'surface':
      return null;
    default:
      return assertNever(fallback);
  }
}

/**
 * Toda foto que vem da API (artista, post, recompensa, show). Sem foto, ou até
 * ela carregar, mostra o fallback; a foto entra por cima com o fade do
 * expo-image, e o fallback só sai depois do fade, para o fundo não piscar no meio.
 * Se a foto falhar, o fallback fica.
 */
export function RemoteImage({
  uri,
  fallback,
  contentFit = 'cover',
  contentPosition,
  transition = motion.duration.base,
  initialsVariant = 'titleGreeting',
  fallbackSize,
  accessibilityLabel,
  style,
  testID,
}: RemoteImageProps) {
  const fade = useImageFade(transition);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [coveredUri, setCoveredUri] = useState<string | null>(null);

  useEffect(() => {
    if (loadedUri === null) return;
    const timer = setTimeout(() => setCoveredUri(loadedUri), fade);
    return () => clearTimeout(timer);
  }, [loadedUri, fade]);

  // Com os emuladores, a URL do Storage troca para o host que o aparelho alcança.
  const photo = uri ? mediaUrl(uri) : null;
  const showFallback = photo === null || coveredUri !== photo;
  const described = !!accessibilityLabel;

  return (
    <View
      testID={testID}
      style={[styles.frame, style]}
      accessible={described}
      accessibilityRole={described ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={described ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!described}
    >
      {showFallback ? (
        <FallbackLayer fallback={fallback} initialsVariant={initialsVariant} size={fallbackSize} />
      ) : null}
      {photo ? (
        <Image
          source={{ uri: photo }}
          recyclingKey={photo}
          contentFit={contentFit}
          contentPosition={contentPosition}
          transition={fade}
          accessible={false}
          onLoad={() => setLoadedUri(photo)}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  initials: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
