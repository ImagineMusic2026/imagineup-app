import { t } from '@/i18n';
import { formatCompact } from '@/utils/number';
import { matchesSearch } from '@/utils/text';

import type { Artist } from './types';

/**
 * A lista de artistas como as telas mostram: a escolha da 1l, a sheet de
 * todos os artistas e a vitrine da Explorar (seção 29, frente G).
 */

/** Os artistas na ordem de destaque que a API dá (cópia; a lista do cache não muda). */
export function sortByOrder(artists: readonly Artist[]): Artist[] {
  return [...artists].sort((a, b) => a.order - b.order);
}

/** Busca pelo nome, sem acento nem maiúscula. */
export function filterArtists(artists: readonly Artist[], query: string): Artist[] {
  return artists.filter((artist) => matchesSearch(artist.name, query));
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
