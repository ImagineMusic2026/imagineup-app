import { layout, spacing } from '@/theme';

/**
 * Abas internas da página do artista (1d). "Playlists" do protótipo virou
 * "Missões": o montador de playlist está fora do contrato.
 */
export type ArtistTab = 'mural' | 'missions' | 'agenda' | 'ranking';

export const ARTIST_TABS: readonly ArtistTab[] = ['mural', 'missions', 'agenda', 'ranking'];

/** Colunas da grade de posts (Mural). */
export const GRID_COLUMNS = 3;

// Área segura a partir da qual o aparelho tem ilha ou entalhe: os botões da
// capa sobem para dentro dela, como no protótipo (54 com a barra de 62).
const NOTCHED_INSET = 44;
const NOTCHED_LIFT = spacing.sm;
const PLAIN_DROP = spacing.xs;

/** Topo do círculo de 38 dos botões da capa, medido do topo da tela. */
export function coverButtonsTop(insetTop: number): number {
  return insetTop >= NOTCHED_INSET ? insetTop - NOTCHED_LIFT : insetTop + PLAIN_DROP;
}

/**
 * Altura do header compacto: os botões e 8 embaixo deles. Com ilha ou
 * entalhe dá a área segura mais 38 (100 no protótipo). É também onde as abas
 * grudam.
 */
export function compactHeaderHeight(insetTop: number): number {
  return coverButtonsTop(insetTop) + layout.coverButtonSize + spacing.sm;
}

/** Altura da capa: 234 abaixo da área segura (296 no protótipo). */
export function coverHeight(insetTop: number): number {
  return insetTop + layout.coverHeight;
}

/**
 * O fundo e o nome do header compacto aparecem nos últimos 40 pt antes de a
 * capa sumir embaixo dele.
 */
export const COMPACT_FADE_DISTANCE = 40;
/** O nome do header compacto sobe 6 pt enquanto aparece. */
export const COMPACT_NAME_RISE = 6;
/** A foto da capa rola na metade da velocidade da página. */
export const COVER_PARALLAX = 0.5;
