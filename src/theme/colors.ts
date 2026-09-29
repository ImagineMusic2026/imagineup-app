/**
 * Paleta do protótipo (ImagineUP.dc.html). A regra escrita no próprio design:
 * fundo escuro, rosa para ação e lima só para pontos. Ciano é shows e agenda.
 *
 * O app é só escuro. Se um tema claro entrar um dia, estes nomes semânticos
 * continuam valendo e só os valores mudam.
 *
 * `palette` é exportada só para os outros arquivos do tema (gradientes, efeitos);
 * componentes usam os nomes semânticos de `colors`.
 */
export const palette = {
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
  black: '#000000',
  // O design não define cor de erro. Provisória, longe do rosa de ação.
  orange: '#FF7A45',

  // Fundos de avatar com iniciais, na ordem de uso do protótipo.
  avatarSlate: '#2A2A38',
  avatarPlum: '#3B2A44',
  avatarSteel: '#243848',
  avatarGraphite: '#22222E',

  // Miniatura de show sem foto (o site reusa a da playlist do protótipo).
  eventsDeep: '#123645',
  eventsDeeper: '#0E2430',

  // Segunda cor dos pares do placeholder de foto, os mesmos do site.
  purple: '#6A1B9A',
  navy: '#23237A',
  tangerine: '#FF8A3D',
  magenta: '#C2185B',
  violet: '#9D6BFF',
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

  // Fundo branco (chip selecionado, botão branco da 1k) e o texto que vai nele.
  // Mesmos valores de `text` e `onPoints`, papéis diferentes.
  inverse: palette.white,
  onInverse: palette.ink,

  text: palette.white,
  textBody: 'rgba(255, 255, 255, 0.9)',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  // Chip não selecionado, meta sobre foto, números secundários (7,05:1 no chip).
  textSubtle: 'rgba(255, 255, 255, 0.6)',
  textTertiary: 'rgba(255, 255, 255, 0.55)',
  // O protótipo usa .42 em rótulos inativos e meta, que dá 4,04:1 e reprova AA.
  // .5 é o mínimo que passa sobre o fundo: nenhum texto fica abaixo disto.
  textMuted: 'rgba(255, 255, 255, 0.5)',

  // Card bloqueado (1g), recompensa sem saldo (1h) e linha do ranking (1f).
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  divider: 'rgba(255, 255, 255, 0.07)',
  border: 'rgba(255, 255, 255, 0.08)',
  // Trilho de barra, divisória vertical da agenda, borda do degrau do pódio.
  track: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.1)',
  // Etapa não feita e trilho do anel do avatar.
  trackStrong: 'rgba(255, 255, 255, 0.13)',
  borderGlass: 'rgba(255, 255, 255, 0.14)',
  // Botão contornado, selo de data sobre foto, pílula "gestão oficial".
  borderOutline: 'rgba(255, 255, 255, 0.16)',
  // Alvos tracejados de "adicionar" (1l).
  borderDashed: 'rgba(255, 255, 255, 0.18)',
  // Botão de vidro da 1k.
  borderGlassStrong: 'rgba(255, 255, 255, 0.22)',
  glass: 'rgba(255, 255, 255, 0.06)',
  // Barras de texto do esqueleto dentro de um card (o valor da borda, outro papel).
  skeletonLine: 'rgba(255, 255, 255, 0.08)',

  // Vidro escuro sobre foto. No Android, sem blur, o `Glass` troca a opacidade
  // pela de `blurFallback` (effects.ts) para manter o contraste.
  glassDark: 'rgba(11, 11, 16, 0.5)',
  // Selos com texto sobre foto (data da 1m, "gestão oficial" da 1d). O protótipo
  // usa .68 com blur(8px), mas o desfoque não escurece foto clara: ali o "JUN"
  // rosa de 9 pt ficava em 3,1:1 no iOS. Com .9, o mesmo do Android, ele passa
  // (4,8:1 sobre foto branca com o véu da 1m) e o desfoque fica como textura.
  glassDarkStrong: 'rgba(11, 11, 16, 0.9)',

  danger: palette.orange,

  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Tintas da marca por opacidade: fundo e borda na cor a este alfa, texto ou
 * ícone na cor cheia. Uso: `withAlpha(colors.points, tints.soft.fill)`.
 * Texto rosa sobre rosa tingido reprova (4,48:1): ali o rótulo vai em `colors.text`.
 */
export const tints = {
  soft: { fill: 0.14, border: 0.4 },
  faint: { fill: 0.1, border: 0.32 },
  strong: { fill: 0.16, border: 0.4 },
} as const;

export type TintIntensity = keyof typeof tints;

/** Fundos de avatar e miniatura sem foto; a cor sai estável pelo id (`pickStable`). */
export const avatarFallbacks = [
  palette.avatarSlate,
  palette.avatarPlum,
  palette.avatarSteel,
  palette.avatarGraphite,
] as const;

/**
 * Pares do placeholder de foto (150°), nas posições do site (`render-telas.js`),
 * para o mesmo id cair no mesmo par nos dois lugares (`hash % 6`). O lima com
 * verde do site (posição 2) vira rosa para roxo, porque no app lima é só para
 * pontos: 5 de cada 6 ids batem com o site.
 */
export const photoFallbackPairs = [
  [palette.pink, palette.purple],
  [palette.cyan, palette.navy],
  [palette.pink, palette.purple],
  [palette.tangerine, palette.magenta],
  [palette.violet, palette.pink],
  [palette.cyan, palette.pink],
] as const;
