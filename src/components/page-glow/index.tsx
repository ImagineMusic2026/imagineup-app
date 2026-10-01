import { useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';

import { StripesPattern } from '@/components/stripes';
import { colors, glows, stripes, type GlowPreset } from '@/theme';

export interface PageGlowProps {
  preset: GlowPreset;
  /** Ajuste da faixa (a altura acompanha o topo real do título, se a tela pedir). */
  style?: StyleProp<ViewStyle>;
}

interface Size {
  width: number;
  height: number;
}

// Só a luminância da máscara conta: branco mostra a listra, transparente apaga.
const MASK_COLOR = colors.text;

/**
 * Brilho radial no topo da página, atrás do conteúdo: rosa com as listras da
 * marca no perfil (1e), lima no ranking (1f). Fica no y 0 da tela, por baixo da
 * barra de status, e é só fundo: sem toque e fora do leitor de tela.
 *
 * O brilho é uma elipse (120% da largura por 100% da faixa, como o
 * `radial-gradient` do protótipo). As listras somem nos últimos pontos da faixa
 * (máscara em degradê) em vez do corte seco do protótipo.
 *
 * Em SVG, e não no Skia: no Android, o `Canvas` do Skia só fica pronto alguns
 * quadros depois de a tela aparecer, e o brilho entrava seco depois do
 * conteúdo. O SVG desenha no primeiro quadro, junto com ele.
 */
export function PageGlow({ preset, style }: PageGlowProps) {
  const glow = glows[preset];
  const { width: windowWidth } = useWindowDimensions();
  // Começa na largura da janela para o primeiro quadro já sair certo; o
  // onLayout corrige quando a tela não ocupa a janela toda.
  const [size, setSize] = useState<Size>({ width: windowWidth, height: glow.height });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };

  const { width, height } = size;
  const stripe = glow.stripes ? stripes[glow.stripes] : null;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onLayout={onLayout}
      style={[styles.band, { height: glow.height }, style]}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient
            id="glow"
            gradientUnits="userSpaceOnUse"
            cx={glow.center.x * width}
            cy={glow.center.y * height}
            rx={glow.radius.x * width}
            ry={glow.radius.y * height}
          >
            <Stop offset={0} stopColor={glow.color} stopOpacity={glow.alphas[0]} />
            <Stop offset={glow.stop} stopColor={glow.color} stopOpacity={glow.alphas[1]} />
          </RadialGradient>
          {stripe ? (
            <>
              <StripesPattern id="stripes" stripe={stripe} />
              <LinearGradient
                id="fade"
                gradientUnits="userSpaceOnUse"
                x1={0}
                y1={height - glow.stripesFade}
                x2={0}
                y2={height}
              >
                <Stop offset={0} stopColor={MASK_COLOR} stopOpacity={1} />
                <Stop offset={1} stopColor={MASK_COLOR} stopOpacity={0} />
              </LinearGradient>
              <Mask
                id="fadeOut"
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={width}
                height={height}
              >
                <Rect width={width} height={height} fill="url(#fade)" />
              </Mask>
            </>
          ) : null}
        </Defs>
        <Rect width={width} height={height} fill="url(#glow)" />
        {stripe ? (
          <Rect width={width} height={height} fill="url(#stripes)" mask="url(#fadeOut)" />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
