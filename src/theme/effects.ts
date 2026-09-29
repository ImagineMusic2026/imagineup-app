import type { TextStyle } from 'react-native';

import { withAlpha } from '@/utils/color';

import { palette } from './colors';

/**
 * Intensidade do `BlurView` (expo-blur), só no iOS. O protótipo fala em px de
 * `backdrop-filter`; a intensidade 20 é o `blur(10px)` a olho, a 16 o `blur(8px)`.
 */
export const blur = {
  tabBar: 30,
  // Botões da capa (1d) e botão de vidro (1k).
  glass: 20,
  // Selo de data (1m) e pílula "gestão oficial" (1d).
  badge: 16,
} as const;

export type BlurStrength = keyof typeof blur;

/**
 * O Android não desfoca: o vidro escuro fica mais opaco para manter o
 * contraste. A conta é a do pior caso, o "JUN" rosa de 9 pt do selo (precisa
 * de 4,5:1) sobre foto branca, com o véu da 1m a ~.38 na altura do selo: com
 * .85 dá 4,4:1, com .9 dá 4,8:1 (e .68 sem desfoque, 1,94:1 sem o véu).
 * Os selos com texto usam .9 também no iOS (`colors.glassDarkStrong`).
 * Uso: `withAlpha(colors.background, blurFallback.glassDark)`.
 */
export const blurFallback = {
  glassDark: 0.72,
  glassDarkStrong: 0.9,
} as const;

/** Opacidade de peça desativada (botões, links, pílulas). */
export const opacities = {
  disabled: 0.5,
} as const;

/** Sombra do nome do artista sobre a capa (1d). */
export const textShadows = {
  hero: {
    textShadowColor: withAlpha(palette.black, 0.5),
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
  },
} as const satisfies Record<string, TextStyle>;
