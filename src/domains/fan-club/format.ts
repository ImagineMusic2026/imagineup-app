import { t, type TranslationKey } from '@/i18n';
import { formatDate } from '@/utils/date';
import { formatCompact, formatNumber } from '@/utils/number';

import type { FanClubReaction } from './consts';
import type { NextRound } from './entry';
import type { FanClubPerson } from './types';

/** O nome de cada reação para o leitor de tela, sem o emoji (37.9, item 2). */
const REACTION_NAMES: Record<FanClubReaction, TranslationKey> = {
  heart: 'fanClub.reactions.names.heart',
  fire: 'fanClub.reactions.names.fire',
  laugh: 'fanClub.reactions.names.laugh',
  wow: 'fanClub.reactions.names.wow',
  clap: 'fanClub.reactions.names.clap',
};

/** "coração", "fogo", "risada", "espanto" e "aplauso". */
export function reactionName(reaction: FanClubReaction): string {
  return t(REACTION_NAMES[reaction]);
}

// A partir daqui, o total vira "12 mil" para caber na pílula (como no mural).
const COMPACT_FROM = 10_000;

/** O total na pílula: "4.812", ou "12 mil" a partir de 10 mil. */
export function countText(count: number): string {
  return count >= COMPACT_FROM ? formatCompact(count) : formatNumber(count);
}

/** "12 reações", "1 reação": o total para o leitor, sem dizer quem reagiu (R8). */
export function reactionsSpoken(count: number): string {
  if (count === 1) return t('fanClub.reactions.countOne');
  return t('fanClub.reactions.count', { count: formatNumber(count) });
}

/** "571 seguidores", "1 seguidor": o número de agora, inteiro (o arredondado é o `roundFollowersText`). */
export function followersText(count: number): string {
  if (count === 1) return t('fanClub.page.followersOne');
  return t('fanClub.page.followers', { count: formatNumber(count) });
}

const rateFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A taxa de engajamento com uma casa decimal e a vírgula (37.11): "4,2%". */
export function rateText(rate: number): string {
  return t('fanClub.manager.panel.engagementRate', { rate: rateFormatter.format(rate) });
}

/** "4 comentários", "1 comentário". */
export function commentsSpoken(count: number): string {
  if (count === 1) return t('fanClub.comments.countOne');
  return t('fanClub.comments.count', { count: formatNumber(count) });
}

/**
 * Quem gere o fã-clube nas frases ("feito por @camilarib"): o @, que a equipe
 * reconhece (decisão 8); sem ele, o nome; sem os dois, "Fã".
 */
export function personName(person: Pick<FanClubPerson, 'name' | 'username'>): string {
  if (person.username) return `@${person.username}`;
  return person.name ?? t('profile.fallbackName');
}

/**
 * O nome do fã-clube para o leitor de tela: com o selo, "Netto de Coração,
 * fã-clube oficial" (34.23); sem ele, só o nome, sem dizer que não é oficial.
 */
export function clubNameLabel(name: string, official: boolean): string {
  return official ? t('fanClub.officialName', { name }) : name;
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
