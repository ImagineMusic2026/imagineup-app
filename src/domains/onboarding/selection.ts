import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';
import { formatCompact } from '@/utils/number';
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

/**
 * O mínimo da escolha: 3, ou todas as centrais publicadas quando há menos de
 * 3 (a 1l nunca pede mais do que o fã pode escolher).
 */
export function minimumArtists(available: number, min = MIN_ARTISTS): number {
  return Math.max(0, Math.min(min, available));
}

/** Quantos artistas ainda faltam para o mínimo. */
export function missingArtists(selectedCount: number, min = MIN_ARTISTS): number {
  return Math.max(0, min - selectedCount);
}

/**
 * Rótulo do botão da 1l: quantos faltam enquanto ele está travado, e com
 * quantos o fã segue quando libera ("Continuar com 1 artista" só quando o
 * painel publicou uma central só).
 */
export function continueLabel(selectedCount: number, min = MIN_ARTISTS): string {
  const missing = missingArtists(selectedCount, min);
  if (missing === 1) return t('onboarding.chooseArtists.needMoreOne');
  if (missing > 1) return t('onboarding.chooseArtists.needMore', { count: missing });
  if (selectedCount === 1) return t('onboarding.chooseArtists.continueOne');
  return t('onboarding.chooseArtists.continue', { count: selectedCount });
}

/** Dica do botão travado: "Escolha pelo menos 3 artistas.", ou "1 artista" com uma central só. */
export function needMoreHint(min = MIN_ARTISTS): string {
  return min === 1
    ? t('onboarding.chooseArtists.needMoreHintOne')
    : t('onboarding.chooseArtists.needMoreHint', { min });
}

/** "412 mil fãs", com "1 fã" no singular (as centrais de verdade começam pequenas). */
export function fansText(fanCount: number): string {
  return fanCount === 1
    ? t('onboarding.chooseArtists.fansOne')
    : t('onboarding.chooseArtists.fans', { count: formatCompact(fanCount) });
}

/** O card lido pelo leitor de tela: "Netto Brito, 412 mil fãs" ou "Nenho, 1 fã". */
export function artistCardLabel(artist: Pick<Artist, 'name' | 'fanCount'>): string {
  return artist.fanCount === 1
    ? t('onboarding.chooseArtists.cardLabelOne', { name: artist.name })
    : t('onboarding.chooseArtists.cardLabel', {
        name: artist.name,
        fans: formatCompact(artist.fanCount),
      });
}

/** Busca da sheet de todos os artistas: pelo nome, sem acento nem maiúscula. */
export function filterArtists(artists: readonly Artist[], query: string): Artist[] {
  return artists.filter((artist) => matchesSearch(artist.name, query));
}
