import type { ViewStyle } from 'react-native';

/**
 * No design, toda sombra é um brilho colorido; não existe elevação neutra.
 * `boxShadow` (Nova Arquitetura) tinge nos dois sistemas, `elevation` não.
 */
export const shadows = {
  glowAccentSmall: { boxShadow: '0px 6px 18px rgba(255, 45, 111, 0.45)' },
  glowAccent: { boxShadow: '0px 8px 22px rgba(255, 45, 111, 0.32)' },
  glowAccentLarge: { boxShadow: '0px 10px 30px rgba(255, 45, 111, 0.4)' },
  glowPoints: { boxShadow: '0px 8px 26px rgba(214, 255, 63, 0.35)' },
} as const satisfies Record<string, ViewStyle>;
