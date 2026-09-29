import { Image } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';

// PNG branco do protótipo, 610 x 139.
const LOGO_SOURCE = require('@/assets/images/imagine-logo.png');
const LOGO_ASPECT_RATIO = 610 / 139;

// Altura do logo na abertura (1k) e nos formulários de conta.
const DEFAULT_HEIGHT = 17;

export interface LogoProps {
  /** A largura sai da proporção do arquivo. A pílula "gestão oficial" (1d) usa 9. */
  height?: number;
  /** O protótipo apaga o logo um pouco: .75 na 1k, .9 na pílula da 1d. */
  opacity?: number;
  style?: StyleProp<ImageStyle>;
}

/**
 * Logo da Imagine Music. É decorativo em todo lugar em que aparece: o nome do
 * app está no título ao lado, e a pílula "gestão oficial" entra no rótulo do
 * artista.
 */
export function Logo({ height = DEFAULT_HEIGHT, opacity = 1, style }: LogoProps) {
  return (
    <Image
      source={LOGO_SOURCE}
      contentFit="contain"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ height, width: height * LOGO_ASPECT_RATIO, opacity }, style]}
    />
  );
}
