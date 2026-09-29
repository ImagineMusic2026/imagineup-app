import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';
import { matchesSearch } from '@/utils/text';

import { FEATURED_COUNT, MIN_ARTISTS } from './consts';

export interface ArtistGrid {
  /** Os cards da grade da 1l, na ordem de destaque. */
  featured: Artist[];
  /** O que fica no "+N artistas" e na busca. */
  rest: Artist[];
}

/** Os artistas na ordem de destaque que a API dá (cópia; a lista do cache não muda). */
export function sortByOrder(artists: readonly Artist[]): Artist[] {
  return [...artists].sort((a, b) => a.order - b.order);
}

/** Separa os artistas em destaque dos outros. */
export function splitFeatured(artists: readonly Artist[], count = FEATURED_COUNT): ArtistGrid {
  const ordered = sortByOrder(artists);
  return { featured: ordered.slice(0, count), rest: ordered.slice(count) };
}

/** Quantos artistas ainda faltam para o mínimo. */
export function missingArtists(selectedCount: number, min = MIN_ARTISTS): number {
  return Math.max(0, min - selectedCount);
}

/**
 * Rótulo do botão da 1l: quantos faltam enquanto ele está travado, e com
 * quantos o fã segue quando libera. "Continuar com 1 artista" não acontece,
 * porque o mínimo é 3.
 */
export function continueLabel(selectedCount: number, min = MIN_ARTISTS): string {
  const missing = missingArtists(selectedCount, min);
  if (missing === 1) return t('onboarding.chooseArtists.needMoreOne');
  if (missing > 1) return t('onboarding.chooseArtists.needMore', { count: missing });
  return t('onboarding.chooseArtists.continue', { count: selectedCount });
}

/** Busca da sheet de todos os artistas: pelo nome, sem acento nem maiúscula. */
export function filterArtists(artists: readonly Artist[], query: string): Artist[] {
  return artists.filter((artist) => matchesSearch(artist.name, query));
}
