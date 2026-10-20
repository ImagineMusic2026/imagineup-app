import { t } from '@/i18n';
import { formatDate } from '@/utils/date';
import { formatCompact, formatNumber } from '@/utils/number';

import type { NextRound } from './entry';
import type { FanClubPerson } from './types';

/**
 * Quem gere o fã-clube nas frases ("feito por @camilarib"): o @, que a equipe
 * reconhece (decisão 8); sem ele, o nome; sem os dois, "Fã".
 */
export function personName(person: Pick<FanClubPerson, 'name' | 'username'>): string {
  if (person.username) return `@${person.username}`;
  return person.name ?? t('profile.fallbackName');
}

/** "41 seguidores", "1 seguidor": o número exato da página (o `count()`, decisão 28). */
export function followersText(count: number): string {
  if (count === 1) return t('fanClub.page.followersOne');
  return t('fanClub.page.followers', { count: formatNumber(count) });
}

/** "4,8 mil seguidores": o número da cópia da noite, arredondado, no card da 1d e na lista. */
export function roundFollowersText(count: number): string {
  if (count === 1) return t('fanClub.page.followersOne');
  return t('fanClub.page.followers', { count: formatCompact(count) });
}

const EXCERPT_MAX = 40;

/**
 * O começo do texto de uma publicação, para o rótulo do botão de cada uma
 * ("Retirar", "Denunciar", "Compartilhar") não ser igual ao das outras.
 */
export function excerptOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > EXCERPT_MAX ? `${line.slice(0, EXCERPT_MAX).trimEnd()}...` : line;
}

/** "3 publicações", "1 publicação": as publicações no ar. */
export function postsCountText(count: number): string {
  if (count === 1) return t('fanClub.artistCard.postsOne');
  return t('fanClub.artistCard.posts', { count: formatNumber(count) });
}

/**
 * Um dia `AAAA-MM-DD` de São Paulo (o fim do Destaque, decisão 35) como
 * "25/10/2026", sem passar pelo `Date`: o `new Date('2026-10-25')` é a
 * meia-noite UTC, que no fuso do Brasil ainda é o dia anterior.
 */
export function formatDayKey(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** A frase da próxima candidatura, na recusa e no fã-clube encerrado (34.9, item 4). */
export function nextRoundText(next: NextRound): string {
  switch (next.kind) {
    case 'now':
      return t('fanClub.state.againNow');
    case 'date': {
      const date = formatDate(next.date);
      return date
        ? t('fanClub.errors.refused.cooldown', { date })
        : t('fanClub.errors.refused.cooldownLater');
    }
    case 'roundsOver':
      return t('fanClub.errors.refused.tooManyRounds');
    case 'programClosed':
      return t('fanClub.errors.refused.applicationsClosed');
    case 'never':
      return t('fanClub.errors.refused.notAllowed');
  }
}
