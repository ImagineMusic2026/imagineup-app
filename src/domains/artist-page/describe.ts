import type { ArtistDetails } from '@/domains/artists';
import type { Post } from '@/domains/posts';
import { t, type TranslationKey } from '@/i18n';
import { formatRelativeAgoSpoken } from '@/utils/date';
import { formatCompact, formatNumber } from '@/utils/number';

/**
 * Textos da página do artista (1d), visíveis e lidos, fora dos componentes
 * para os testes em tabela. Os números vêm do servidor; aqui só se escreve.
 */

/** "Netto Brito, artista verificado, gestão oficial Imagine": o nome da capa para o leitor. */
export function artistHeadingLabel(
  artist: Pick<ArtistDetails, 'name' | 'verified' | 'managedByImagine'>,
): string {
  return [
    artist.verified ? t('artist.heading.verified', { name: artist.name }) : artist.name,
    artist.managedByImagine ? t('artist.heading.managed') : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Um número grande por extenso, para o leitor de tela: "412 mil", "8,4
 * milhões", "1 milhão". `of` diz se o substantivo leva "de" depois dele
 * ("8,4 milhões de fãs", mas "412 mil fãs").
 */
export function compactSpoken(value: number): { amount: string; of: boolean } {
  const shown = formatCompact(value);
  const unit = / (mi|bi)$/.exec(shown);
  if (!unit) return { amount: shown, of: false };
  const number = shown.slice(0, -unit[0].length);
  const one = number === '1';
  const key: TranslationKey =
    unit[1] === 'mi'
      ? one
        ? 'artist.stats.million'
        : 'artist.stats.millions'
      : one
        ? 'artist.stats.billion'
        : 'artist.stats.billions';
  return { amount: t(key, { value: number }), of: true };
}

export type ArtistStat = 'fans' | 'posts' | 'points';

const STAT_KEYS: Record<
  ArtistStat,
  { label: TranslationKey; labelOf: TranslationKey; one: TranslationKey }
> = {
  fans: {
    label: 'artist.stats.fansLabel',
    labelOf: 'artist.stats.fansLabelOf',
    one: 'artist.stats.fansLabelOne',
  },
  posts: {
    label: 'artist.stats.postsLabel',
    labelOf: 'artist.stats.postsLabelOf',
    one: 'artist.stats.postsLabelOne',
  },
  points: {
    label: 'artist.stats.pointsLabel',
    labelOf: 'artist.stats.pointsLabelOf',
    one: 'artist.stats.pointsLabelOne',
  },
};

/** "412 mil fãs", "1.284 posts", "8,4 milhões de pontos da central". */
export function statLabel(stat: ArtistStat, value: number): string {
  const keys = STAT_KEYS[stat];
  if (value === 1) return t(keys.one);
  // Posts mostram o número inteiro ("1.284"), e o leitor ouve o mesmo.
  if (stat === 'posts') return t(keys.label, { amount: formatNumber(value) });
  const { amount, of } = compactSpoken(value);
  return t(of ? keys.labelOf : keys.label, { amount });
}

/** O número como a capa mostra: "412 mil", "1.284", "8,4 mi". */
export function statValue(stat: ArtistStat, value: number): string {
  return stat === 'posts' ? formatNumber(value) : formatCompact(value);
}

const POST_LABEL: Record<Post['kind'], TranslationKey> = {
  photo: 'artist.posts.photoLabel',
  video: 'artist.posts.videoLabel',
  event: 'artist.posts.showLabel',
  text: 'artist.posts.textLabel',
};

/** Foto e vídeo podem vir sem legenda (bloco 6); texto e show sempre têm texto. */
const POST_LABEL_NO_TEXT: Partial<Record<Post['kind'], TranslationKey>> = {
  photo: 'artist.posts.photoLabelNoText',
  video: 'artist.posts.videoLabelNoText',
};

/**
 * Uma célula da grade: "Vídeo de Netto Brito, há 2 horas: Saiu o clipe...".
 * Sem legenda, sem os dois-pontos: "Vídeo de Netto Brito, há 2 horas".
 */
export function postCellLabel(post: Post, now: Date): string {
  const params = { name: post.artist.name, time: formatRelativeAgoSpoken(post.createdAt, now) };
  const noText = post.text ? undefined : POST_LABEL_NO_TEXT[post.kind];
  return noText ? t(noText, params) : t(POST_LABEL[post.kind], { ...params, text: post.text });
}

/**
 * O nome da capa em duas linhas a partir do primeiro espaço ("Netto" /
 * "Brito"), como no protótipo; com uma palavra só ("Nenho"), uma linha.
 */
export function splitCoverName(name: string): string {
  const trimmed = name.trim();
  const space = trimmed.indexOf(' ');
  if (space < 0) return trimmed;
  return `${trimmed.slice(0, space)}\n${trimmed.slice(space + 1)}`;
}
