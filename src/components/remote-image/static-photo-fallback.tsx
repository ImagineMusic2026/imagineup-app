import { useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { StripesPattern } from '@/components/stripes';
import { gradients, stripes as stripePresets, type StripePreset } from '@/theme';

import { cssGradientLine, photoFallbackPair, type PhotoFallbackVariant } from './photo-fallback';

export interface StaticPhotoFallbackProps {
  /** Id do dono da foto: decide o par de cores, como no `PhotoFallback`. */
  seed: string;
  /** `events` é a foto de show ausente (1m): ciano é a cor de shows. */
  variant?: PhotoFallbackVariant;
  /** Par fixo no lugar do escolhido pelo id (o rosa para roxo da 1k). */
  pair?: readonly [string, string];
  /** Como no `PhotoFallback`: as do placeholder do site, ou `null` sem listras. */
  stripes?: StripePreset | null;
  /**
   * A medida que a tela já sabe, para o primeiro quadro sair certo (o fundo de
   * tela cheia da 1k, a capa da 1d, a largura do destaque da 1m). Se o espaço
   * real for outro (fonte grande, que estica o card), o `onLayout` corrige.
   */
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
}

const { sheen } = gradients.photoFallback;

/**
 * O placeholder de marca do `PhotoFallback` (gradiente de 150°, o brilho do
 * canto e as listras), desenhado com react-native-svg numa medida já
 * conhecida. O Skia desenha numa superfície própria que, no Android, só fica
 * pronta alguns quadros depois de a tela aparecer: no fundo da 1k, na capa da
 * 1d e no destaque da 1m, o placeholder surgia seco depois da transição. O SVG
 * entra no primeiro quadro, junto com o fade e a escala da tela. Para o fundo
 * grande que entra numa transição; nas listas e nos cards fica o
 * `PhotoFallback`. Decorativo.
 */
export function StaticPhotoFallback({
  seed,
  variant = 'brand',
  pair,
  stripes = 'placeholder',
  width: expectedWidth,
  height: expectedHeight,
  style,
}: StaticPhotoFallbackProps) {
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const width = measured?.width ?? expectedWidth;
  const height = measured?.height ?? expectedHeight;

  const handleLayout = (event: LayoutChangeEvent): void => {
    const layout = event.nativeEvent.layout;
    if (layout.width === width && layout.height === height) return;
    if (layout.width > 0 && layout.height > 0) {
      setMeasured({ width: layout.width, height: layout.height });
    }
  };

  const brand = variant === 'brand';
  const base = brand
    ? {
        colors: pair ?? photoFallbackPair(seed),
        locations: gradients.photoFallback.locations,
        angle: gradients.photoFallback.angle,
      }
    : gradients.eventsTile;
  const [from, to] = base.colors;
  const line = cssGradientLine(base.angle, width, height);
  const stripe = stripes ? stripePresets[stripes] : null;

  return (
    <View
      onLayout={handleLayout}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, style]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="base" gradientUnits="userSpaceOnUse" {...line}>
            <Stop offset={base.locations[0]} stopColor={from} />
            <Stop offset={base.locations[1]} stopColor={to} />
          </LinearGradient>
          {/* radial-gradient(120% 80% at 18% 12%): a elipse do CSS, medida na caixa. */}
          {brand ? (
            <RadialGradient
              id="sheen"
              gradientUnits="userSpaceOnUse"
              cx={width * sheen.center.x}
              cy={height * sheen.center.y}
              rx={width * sheen.radius.x}
              ry={height * sheen.radius.y}
            >
              <Stop offset={0} stopColor={sheen.color} stopOpacity={sheen.alphas[0]} />
              <Stop offset={sheen.stop} stopColor={sheen.color} stopOpacity={sheen.alphas[1]} />
            </RadialGradient>
          ) : null}
          {stripe ? <StripesPattern id="stripes" stripe={stripe} /> : null}
        </Defs>
        <Rect width={width} height={height} fill="url(#base)" />
        {brand ? <Rect width={width} height={height} fill="url(#sheen)" /> : null}
        {stripe ? <Rect width={width} height={height} fill="url(#stripes)" /> : null}
      </Svg>
    </View>
  );
}
