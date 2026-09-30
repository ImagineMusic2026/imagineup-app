import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, layout } from '@/theme';

/** Um traço do desenho: cheio, ou em linha com a espessura do protótipo. */
type GlyphPart = { d: string; strokeWidth?: undefined } | { d: string; strokeWidth: number };

// Desenhos do protótipo que o lucide não tem (viewBox 24):
// - `share`: a seta cheia de compartilhar; o `Forward` do lucide é o mesmo
//   gesto, só contorno.
// - `goblet`: a taça fina da conquista "Top 20" (1e), com o copo cheio e o pé
//   em traço; o `Trophy` do lucide cheio vira um bloco largo, com as alças.
const GLYPHS = {
  share: [{ d: 'M14 4.5v3.2C7.5 8 4.5 12 4 19.5c2.4-3.6 5.3-4.7 10-4.7v3.2l6-6.8z' }],
  goblet: [{ d: 'M8 4h8v5a4 4 0 0 1-8 0z' }, { d: 'M12 13v4M9.5 20.5h5', strokeWidth: 1.9 }],
} as const satisfies Record<string, readonly GlyphPart[]>;

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
  const parts: readonly GlyphPart[] = GLYPHS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {parts.map((part) =>
        part.strokeWidth === undefined ? (
          <Path key={part.d} d={part.d} fill={color} />
        ) : (
          <Path
            key={part.d}
            d={part.d}
            fill="none"
            stroke={color}
            strokeWidth={part.strokeWidth}
            strokeLinecap="round"
          />
        ),
      )}
    </Svg>
  );
}
