import { withAlpha } from '@/utils/color';

import { colors, palette, photoFallbackPairs } from './colors';

/** Duas cores ou mais, como o `expo-linear-gradient` e o Skia pedem. */
export type GradientStops = readonly [string, string, ...string[]];
export type GradientLocations = readonly [number, number, ...number[]];

/** Ponto em fração da caixa: `{ x: 0, y: 0.5 }` é o meio da borda esquerda. */
export interface GradientPoint {
  x: number;
  y: number;
}

/**
 * Gradiente linear. Sem `start` e `end`, vai de cima para baixo (o 180° do CSS),
 * que é o padrão do `expo-linear-gradient`. `angle` (graus do CSS) fica nos que
 * o Skia desenha, porque lá os pontos dependem do tamanho da peça.
 */
export interface LinearGradientToken {
  colors: GradientStops;
  locations: GradientLocations;
  start?: GradientPoint;
  end?: GradientPoint;
  angle?: number;
}

/**
 * Transparente sempre com a cor do véu a 0, nunca a string 'transparent': no
 * iOS ela passa por preto transparente e cria uma faixa cinza no meio.
 */
const ink = (alpha: number) => withAlpha(palette.ink, alpha);

/**
 * Véus escuros sobre foto, de cima para baixo, com as paradas do protótipo.
 * O texto por cima fica na faixa quase opaca do fim.
 */
const scrims = {
  // 1k, tela cheia.
  auth: { colors: [ink(0.55), ink(0.4), ink(0.97)], locations: [0, 0.32, 0.74] },
  // Entrar com e-mail e cadastro, por cima do `auth`.
  authForm: { colors: [ink(0.25), ink(0.88), ink(1)], locations: [0, 0.24, 0.38] },
  // Card de artista da 1l.
  artistTile: { colors: [ink(0), ink(0.99)], locations: [0.26, 0.52] },
  // Capa da 1d: escurece em cima (botões) e embaixo (nome).
  cover: { colors: [ink(0.7), ink(0), ink(0.55), ink(1)], locations: [0, 0.34, 0.66, 1] },
  // Destaque da 1h.
  rewardHero: {
    colors: [ink(0.15), ink(0.5), ink(0.99), ink(0.99)],
    locations: [0, 0.34, 0.54, 1],
  },
  // Destaque da 1m.
  eventHero: { colors: [ink(0.1), ink(0.5), ink(0.99)], locations: [0, 0.36, 0.56] },
  // Rodapé fixo com o botão (1l, `BottomActionBar`).
  bottomBar: { colors: [ink(0), ink(1)], locations: [0, 0.34] },
} as const satisfies Record<string, LinearGradientToken>;

export type ScrimPreset = keyof typeof scrims;

export const gradients = {
  scrims,
  // Barra de nível da 1e (90°).
  progress: {
    colors: [colors.accent, colors.points],
    locations: [0, 1],
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
  } as const satisfies LinearGradientToken,
  // Anel do avatar da 1b (135° numa peça quadrada vai de canto a canto).
  brandRing: {
    colors: [colors.accent, colors.points],
    locations: [0, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  } as const satisfies LinearGradientToken,
  // Foto de show ausente (1m): ciano é a cor de shows.
  eventsTile: {
    colors: [palette.eventsDeep, palette.eventsDeeper],
    locations: [0, 1],
    angle: 150,
  } as const satisfies LinearGradientToken,
  // Fundo da abertura (1k) enquanto a foto não é entregue: o rosa para roxo do
  // placeholder, fixo (não sai do id), sob o véu e as listras da 1k.
  authPhotoFallback: [palette.pink, palette.purple] as const,
  /**
   * Placeholder de foto, igual ao do site: listras `stripes.placeholder`, um
   * brilho branco no canto de cima e um gradiente de 150° com um par escolhido
   * pelo id (`pickStable(id, gradients.photoFallback.pairs)`).
   */
  photoFallback: {
    pairs: photoFallbackPairs,
    locations: [0, 1],
    angle: 150,
    // radial-gradient(120% 80% at 18% 12%, branco .3, transparente 48%)
    sheen: {
      colors: [withAlpha(palette.white, 0.3), withAlpha(palette.white, 0)],
      center: { x: 0.18, y: 0.12 },
      radius: { x: 1.2, y: 0.8 },
      stop: 0.48,
    },
  },
} as const;

/** Listras diagonais da marca, na inclinação das barras do logo. */
export interface StripeToken {
  color: string;
  alpha: number;
  /** Espessura da listra, em pt. */
  width: number;
  /** De uma listra à seguinte, medido ao longo do eixo do gradiente. */
  period: number;
  /** Graus do CSS (0 é para cima, sentido horário): 114 deixa as listras como "/". */
  angle: number;
}

export const STRIPE_ANGLE = 114;

export const stripes = {
  // Capa da 1d.
  photo: { color: palette.white, alpha: 0.05, width: 2, period: 12, angle: STRIPE_ANGLE },
  // 1k.
  auth: { color: palette.white, alpha: 0.05, width: 2, period: 13, angle: STRIPE_ANGLE },
  // Brilho do topo da 1e.
  profile: { color: palette.white, alpha: 0.045, width: 2, period: 12, angle: STRIPE_ANGLE },
  // Card lima da missão do dia (1b); a 1g usa alfa .08 por prop.
  onPoints: { color: palette.ink, alpha: 0.09, width: 3, period: 11, angle: STRIPE_ANGLE },
  // Placeholder de foto, igual ao do site.
  placeholder: { color: palette.white, alpha: 0.07, width: 2, period: 13, angle: STRIPE_ANGLE },
} as const satisfies Record<string, StripeToken>;

export type StripePreset = keyof typeof stripes;

/**
 * Brilho radial no topo da página, atrás do conteúdo (Skia `RadialGradient`).
 * Em CSS: `radial-gradient(120% 100% at 50% 0%, cor, transparente <stop>)`
 * numa faixa de `height` pt a partir do topo da tela.
 */
export interface GlowToken {
  colors: readonly [string, string];
  /** Onde o brilho some, em fração do raio. */
  stop: number;
  height: number;
  /** Raios da elipse em fração da largura e da altura da faixa. */
  radius: { x: number; y: number };
  center: GradientPoint;
  stripes: StripePreset | null;
  /** Pt no fim da faixa em que as listras somem (o dono recusa corte seco). */
  stripesFade: number;
}

export const glows = {
  // 1e: rosa com as listras da marca.
  profile: {
    colors: [withAlpha(colors.accent, 0.28), withAlpha(colors.accent, 0)],
    stop: 0.62,
    height: 250,
    radius: { x: 1.2, y: 1 },
    center: { x: 0.5, y: 0 },
    stripes: 'profile',
    stripesFade: 50,
  },
  // 1f: lima, porque a página é de pontos. Sem listras.
  ranking: {
    colors: [withAlpha(colors.points, 0.16), withAlpha(colors.points, 0)],
    stop: 0.6,
    height: 300,
    radius: { x: 1.2, y: 1 },
    center: { x: 0.5, y: 0 },
    stripes: null,
    stripesFade: 0,
  },
} as const satisfies Record<string, GlowToken>;

export type GlowPreset = keyof typeof glows;
