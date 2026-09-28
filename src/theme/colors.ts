/**
 * Paleta do protótipo (ImagineUP.dc.html). A regra escrita no próprio design:
 * fundo escuro, rosa para ação e lima só para pontos.
 *
 * O app é só escuro. Se um tema claro entrar um dia, estes nomes semânticos
 * continuam valendo e só os valores mudam.
 */
const palette = {
  ink: '#0B0B10',
  surface: '#14141B',
  surfaceRaised: '#16161E',
  surfaceSunken: '#1D1D27',
  pink: '#FF2D6F',
  // Rosa mais fechado que passa em contraste AA com texto branco (5,03:1).
  // O site já usa este valor para texto rosa.
  pinkStrong: '#D9105A',
  lime: '#D6FF3F',
  cyan: '#3DDCFF',
  white: '#FFFFFF',
  // O design não define cor de erro. Provisória, longe do rosa de ação.
  orange: '#FF7A45',
} as const;

export const colors = {
  background: palette.ink,
  surface: palette.surface,
  surfaceRaised: palette.surfaceRaised,
  surfaceSunken: palette.surfaceSunken,

  accent: palette.pink,
  accentStrong: palette.pinkStrong,
  onAccent: palette.white,

  points: palette.lime,
  onPoints: palette.ink,

  events: palette.cyan,

  text: palette.white,
  textBody: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textTertiary: 'rgba(255, 255, 255, 0.55)',
  // O protótipo usa .42 em rótulos inativos e meta, que dá 4,04:1 e reprova AA.
  // .5 é o mínimo que passa sobre o fundo.
  textMuted: 'rgba(255, 255, 255, 0.5)',

  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.1)',
  borderGlass: 'rgba(255, 255, 255, 0.14)',
  divider: 'rgba(255, 255, 255, 0.07)',
  glass: 'rgba(255, 255, 255, 0.06)',

  danger: palette.orange,

  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;
