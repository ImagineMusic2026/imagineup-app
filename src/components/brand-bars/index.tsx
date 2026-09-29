import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { colors } from '@/theme';

/**
 * Tamanho das barras, cada um de um lugar do protótipo:
 * - `pill`: pílula de saldo (1h), sobre lima;
 * - `badge`: selo de nível (1e);
 * - `title`: ao lado do nome do artista (1d);
 * - `hero`: ao lado do "ImagineUP" (1k).
 */
export type BrandBarsSize = 'pill' | 'badge' | 'title' | 'hero';

/** `soft` (1, .6, .3) nas pequenas; `bold` (1, .6, .28) nas grandes em rosa. */
export type BrandBarsOpacities = 'soft' | 'bold';

export interface BrandBarsProps {
  color?: string;
  size?: BrandBarsSize;
  /** Sem valor, segue o protótipo: `bold` em `title` e `hero`, `soft` nas outras. */
  opacities?: BrandBarsOpacities;
  style?: StyleProp<ViewStyle>;
}

const OPACITIES = {
  soft: [1, 0.6, 0.3],
  bold: [1, 0.6, 0.28],
} as const satisfies Record<BrandBarsOpacities, readonly number[]>;

const DEFAULT_OPACITIES: Record<BrandBarsSize, BrandBarsOpacities> = {
  pill: 'soft',
  badge: 'soft',
  title: 'bold',
  hero: 'bold',
};

// Medidas do próprio desenho da marca, como o path de um ícone.
const MEASURES: Record<BrandBarsSize, { width: number; height: number; gap: number }> = {
  pill: { width: 2.5, height: 10, gap: 1.5 },
  badge: { width: 2.5, height: 9, gap: 1.5 },
  title: { width: 4, height: 20, gap: 2.5 },
  hero: { width: 4, height: 21, gap: 2.5 },
};

/** Largura da caixa das barras no layout (a inclinação passa para fora dela). */
export function brandBarsWidth(size: BrandBarsSize, count = OPACITIES.soft.length): number {
  const { width, gap } = MEASURES[size];
  return count * width + (count - 1) * gap;
}

/** A inclinação do logo: `skewX(-22deg)` no protótipo. */
const SLANT = Math.tan((22 * Math.PI) / 180);

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * As três barras inclinadas do logo, a marca de pontos do design. Desenho, não
 * texto: quem está em volta (pílula, selo, título) diz o que é para o leitor.
 *
 * Cada barra é um paralelogramo em SVG: o `skewX` numa View não tem efeito no
 * Android, que só aplica translação, rotação e escala. Como o `skewX` do
 * protótipo (em torno do centro), o topo anda metade da inclinação para a
 * direita e o pé, metade para a esquerda, e a caixa do layout não muda.
 */
export function BrandBars({
  color = colors.accent,
  size = 'pill',
  opacities,
  style,
}: BrandBarsProps) {
  const levels = OPACITIES[opacities ?? DEFAULT_OPACITIES[size]];
  const { width, height, gap } = MEASURES[size];
  const boxWidth = brandBarsWidth(size, levels.length);
  // Quanto o topo de cada barra anda para a direita em relação ao pé.
  const lean = height * SLANT;

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width: boxWidth, height }, style]}
    >
      {/* O desenho passa metade da inclinação de cada lado da caixa. */}
      <Svg
        width={round(boxWidth + lean)}
        height={height}
        style={[styles.drawing, { left: round(-lean / 2) }]}
      >
        {levels.map((opacity, index) => {
          const foot = index * (width + gap);
          const corners: [x: number, y: number][] = [
            [foot + lean, 0],
            [foot + width + lean, 0],
            [foot + width, height],
            [foot, height],
          ];
          const points = corners.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
          return <Polygon key={index} points={points} fill={color} fillOpacity={opacity} />;
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  drawing: {
    position: 'absolute',
    top: 0,
  },
});
