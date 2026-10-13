import { isUpcoming, type AgendaEvent, type AgendaPage } from '@/domains/agenda';
import { filterArtists, sortByOrder, type Artist, type FanCentral } from '@/domains/artists';

/** Quantos shows a vitrine lista embaixo do destaque. */
export const SHOW_ROWS = 3;

export interface Showcase {
  /** O show marcado no painel (`featured` da primeira página), se ainda está por vir. */
  featured: AgendaEvent | null;
  /** Os próximos shows da primeira página, sem o destaque, em ordem de data. */
  rows: AgendaEvent[];
}

/**
 * "Próximos shows" da Explorar (seção 29, frente G): só a primeira página da
 * agenda, o mesmo cache da 1m. O destaque é só o marcado no painel: sem ele,
 * ficam só as linhas (a 1m, que mostra a agenda toda, promove o próximo show).
 * Show passado sai (o cache do disco pode trazer um), e o destaque não se
 * repete nas linhas.
 */
export function showcaseOf(page: AgendaPage, now: Date, max = SHOW_ROWS): Showcase {
  const featured = page.featured && isUpcoming(page.featured, now) ? page.featured : null;
  const seen = new Set<string>(featured ? [featured.id] : []);
  const rows = page.items
    .filter((event) => {
      if (seen.has(event.id) || !isUpcoming(event, now)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, max);
  return { featured, rows };
}

/** Uma central da grade, com a marca de quem já está nela. */
export interface ExploreCentral {
  artist: Artist;
  member: boolean;
}

/**
 * A grade "Todas as centrais": todos os artistas na ordem de destaque,
 * filtrados pela busca. Nas centrais do fã, o número de fãs é o de "Suas
 * centrais" (`/me/centrals`, que já soma o próprio fã), e o card leva a marca
 * "Na central".
 */
export function exploreCentrals(
  artists: readonly Artist[],
  mine: readonly FanCentral[] | undefined,
  query: string,
): ExploreCentral[] {
  const joined = new Map((mine ?? []).map((central) => [central.artistId, central]));
  return filterArtists(sortByOrder(artists), query).map((artist) => {
    const central = joined.get(artist.id);
    return central
      ? { artist: { ...artist, fanCount: central.fanCount }, member: true }
      : { artist, member: false };
  });
}
