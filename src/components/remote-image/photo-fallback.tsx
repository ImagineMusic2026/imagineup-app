import { Canvas, Fill, LinearGradient, RadialGradient, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { StripesShader } from '@/components/stripes';
import { gradients, stripes as stripePresets, type StripePreset } from '@/theme';
import { pickStable } from '@/utils/pick-stable';

export type PhotoFallbackVariant = 'brand' | 'events';

export interface PhotoFallbackProps {
  /** Id do dono da foto (artista, post, recompensa): decide o par de cores. */
  seed: string;
  /** `events` é a foto de show ausente (1m): ciano é a cor de shows. */
  variant?: PhotoFallbackVariant;
  /** Par fixo no lugar do escolhido pelo id, como o rosa para roxo da abertura (1k). */
  pair?: readonly [string, string];
  /**
   * Listras da marca por cima; por padrão, as do placeholder do site. `null`
   * quando a tela desenha as próprias por cima (capa da 1d com `stripes.photo`,
   * 1k com `stripes.auth`): dois jogos de períodos diferentes fariam faixas.
   */
  stripes?: StripePreset | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** O par do placeholder para um id, o mesmo em toda tela (nunca o lima). */
export function photoFallbackPair(seed: string): readonly [string, string] {
  return pickStable(seed, gradients.photoFallback.pairs);
}

/**
 * Pontas de um `linear-gradient(<ângulo>deg)` do CSS numa caixa: a linha passa
 * pelo centro e tem o comprimento que faz os cantos caírem nas paradas 0 e 1.
 */
export function cssGradientLine(angle: number, width: number, height: number) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return {
    x1: width / 2 - dx * half,
    y1: height / 2 - dy * half,
    x2: width / 2 + dx * half,
    y2: height / 2 + dy * half,
  };
}

const sheen = gradients.photoFallback.sheen;

/**
 * Placeholder de marca, o mesmo das imagens do site (`render-telas.js`): gradiente
 * de 150° com um par estável pelo id, brilho branco no canto de cima e as listras
 * da marca, num Canvas só. Decorativo: quem descreve é o card em volta.
 */
export function PhotoFallback({
  seed,
  variant = 'brand',
  pair,
  stripes = 'placeholder',
  style,
  testID,
}: PhotoFallbackProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const handleLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const brand = variant === 'brand';
  const base = brand
    ? {
        colors: pair ?? photoFallbackPair(seed),
        locations: gradients.photoFallback.locations,
        angle: gradients.photoFallback.angle,
      }
    : gradients.eventsTile;
  const stripe = stripes ? stripePresets[stripes] : null;
  const { width, height } = size;
  const line = cssGradientLine(base.angle, width, height);

  // radial-gradient(120% 80% at 18% 12%): elipse, então o círculo do Skia achata em y.
  const sheenCenter = vec(width * sheen.center.x, height * sheen.center.y);
  const sheenRadius = width * sheen.radius.x;
  const sheenScaleY = sheenRadius > 0 ? (height * sheen.radius.y) / sheenRadius : 1;

  return (
    <View
      testID={testID}
      onLayout={handleLayout}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, style]}
    >
      {/* Sem medida, o gradiente sairia degenerado (uma cor só) por um quadro. */}
      {width > 0 && height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <LinearGradient
              start={vec(line.x1, line.y1)}
              end={vec(line.x2, line.y2)}
              colors={[...base.colors]}
              positions={[...base.locations]}
            />
          </Fill>
          {brand ? (
            <Fill>
              <RadialGradient
                c={sheenCenter}
                r={sheenRadius}
                colors={[...sheen.colors]}
                positions={[0, sheen.stop]}
                origin={sheenCenter}
                transform={[{ scaleY: sheenScaleY }]}
              />
            </Fill>
          ) : null}
          {stripe ? (
            <Fill>
              <StripesShader stripe={stripe} />
            </Fill>
          ) : null}
        </Canvas>
      ) : null}
    </View>
  );
}
