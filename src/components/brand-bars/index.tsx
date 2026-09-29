import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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

/**
 * As três barras inclinadas do logo, a marca de pontos do design. Desenho, não
 * texto: quem está em volta (pílula, selo, título) diz o que é para o leitor.
 * A inclinação não muda a caixa do layout, como no protótipo.
 */
export function BrandBars({
  color = colors.accent,
  size = 'pill',
  opacities,
  style,
}: BrandBarsProps) {
  const levels = OPACITIES[opacities ?? DEFAULT_OPACITIES[size]];
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.group, gaps[size], style]}
    >
      {levels.map((opacity, index) => (
        <View key={index} style={[bars[size], { backgroundColor: color, opacity }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    // A inclinação das barras do logo.
    transform: [{ skewX: '-22deg' }],
  },
});

// Medidas do próprio desenho da marca, como o path de um ícone.
const bars = StyleSheet.create({
  pill: { width: 2.5, height: 10 },
  badge: { width: 2.5, height: 9 },
  title: { width: 4, height: 20 },
  hero: { width: 4, height: 21 },
});

const gaps = StyleSheet.create({
  pill: { gap: 1.5 },
  badge: { gap: 1.5 },
  title: { gap: 2.5 },
  hero: { gap: 2.5 },
});
