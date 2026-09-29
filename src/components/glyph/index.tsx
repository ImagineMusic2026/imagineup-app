import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, layout } from '@/theme';

// Desenhos cheios que o lucide não tem (viewBox 24). `share` é a seta de
// compartilhar do protótipo; o `Forward` do lucide é o mesmo gesto, só contorno.
const GLYPHS = {
  share: 'M14 4.5v3.2C7.5 8 4.5 12 4 19.5c2.4-3.6 5.3-4.7 10-4.7v3.2l6-6.8z',
} as const;

export type GlyphName = keyof typeof GLYPHS;

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  /** Os navegadores entregam ColorValue; o app só usa cores em string. */
  color?: ColorValue;
}

/**
 * Ícones cheios do design, com a mesma API do `Icon` (tamanho e cor) para um
 * trocar pelo outro. Decorativo, como o `Icon`: quem descreve a ação para o
 * leitor de tela é o pressável em volta.
 */
export function Glyph({ name, size = layout.tabBarIconSize, color = colors.text }: GlyphProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Path d={GLYPHS[name]} fill={color} />
    </Svg>
  );
}
