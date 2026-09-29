import {
  Canvas,
  Fill,
  Group,
  LinearGradient,
  RadialGradient,
  vec,
} from '@shopify/react-native-skia';
import { useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { StripesShader } from '@/components/stripes';
import { colors, glows, stripes, type GlowPreset } from '@/theme';
import { withAlpha } from '@/utils/color';

export interface PageGlowProps {
  preset: GlowPreset;
  /** Ajuste da faixa (a altura acompanha o topo real do título, se a tela pedir). */
  style?: StyleProp<ViewStyle>;
}

interface Size {
  width: number;
  height: number;
}

// Só o alfa da máscara conta; a cor é qualquer uma.
const MASK_SOLID = withAlpha(colors.text, 1);
const MASK_CLEAR = withAlpha(colors.text, 0);

/**
 * Brilho radial no topo da página, atrás do conteúdo: rosa com as listras da
 * marca no perfil (1e), lima no ranking (1f). Fica no y 0 da tela, por baixo da
 * barra de status, e é só fundo: sem toque e fora do leitor de tela.
 *
 * O brilho é uma elipse (120% da largura por 100% da faixa, como o
 * `radial-gradient` do protótipo). O Skia só desenha círculo, então o círculo de
 * raio igual à altura é esticado na horizontal. As listras somem nos últimos
 * pontos da faixa em vez do corte seco do protótipo.
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

  const center = vec(glow.center.x * size.width, glow.center.y * size.height);
  const radiusY = glow.radius.y * size.height;
  const stretchX = radiusY > 0 ? (glow.radius.x * size.width) / radiusY : 1;
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
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <RadialGradient
            c={center}
            r={radiusY}
            transform={[{ scaleX: stretchX }]}
            origin={center}
            colors={[...glow.colors]}
            positions={[0, glow.stop]}
          />
        </Fill>
        {stripe ? (
          <Group layer>
            <Fill>
              <StripesShader stripe={stripe} />
            </Fill>
            {/* dstIn deixa a listra só onde a máscara tem alfa: some no fim da faixa. */}
            <Fill blendMode="dstIn">
              <LinearGradient
                start={vec(0, size.height - glow.stripesFade)}
                end={vec(0, size.height)}
                colors={[MASK_SOLID, MASK_CLEAR]}
              />
            </Fill>
          </Group>
        ) : null}
      </Canvas>
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
