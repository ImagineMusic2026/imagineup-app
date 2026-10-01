import { isSameDay } from 'date-fns';

import { t } from '@/i18n';
import {
  formatDateBadge,
  formatLongDate,
  formatShowTime,
  formatShowTimeSpoken,
} from '@/utils/date';
import { formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import { BRAZIL_STATE_NAMES } from './consts';
import type { AgendaEvent } from './types';

/**
 * Textos de um show: o que a tela mostra ("Netto Brito + Nenho · Irará, BA ·
 * 22 h") e o que o leitor de tela lê ("Netto Brito e Nenho, Irará, Bahia, 22
 * horas"), para os dois contarem a mesma coisa.
 */

export function isEventToday(event: AgendaEvent, now: Date): boolean {
  return isSameDay(new Date(event.startsAt), now);
}

/** Selo de data: "21" e "OUT"; no dia do show, "Hoje" no lugar do mês. */
export function eventDateBadge(event: AgendaEvent, now: Date): { day: string; month: string } {
  const badge = formatDateBadge(event.startsAt);
  return isEventToday(event, now) ? { ...badge, month: t('agenda.today') } : badge;
}

/** "Netto Brito + Nenho". */
export function eventArtists(event: AgendaEvent): string {
  return event.artists.map((artist) => artist.name).join(t('agenda.artistsSeparator'));
}

/** "Netto Brito e Nenho", "Netto Brito, Nenho e Juninho Moraes". */
export function eventArtistsSpoken(event: AgendaEvent): string {
  const names = event.artists.map((artist) => artist.name);
  const last = names.pop();
  if (last === undefined) return '';
  if (names.length === 0) return last;
  return t('agenda.a11y.and', { first: names.join(', '), last });
}

/** "Irará, BA". */
export function eventPlace(event: AgendaEvent): string {
  return t('agenda.place', { city: event.city, state: event.state });
}

/** "Irará, Bahia"; UF que a tabela não conhece fica como veio. */
export function eventPlaceSpoken(event: AgendaEvent): string {
  return t('agenda.place', {
    city: event.city,
    state: BRAZIL_STATE_NAMES[event.state.toUpperCase()] ?? event.state,
  });
}

/** Meta do destaque: "Netto Brito + Nenho · Irará, BA · 22 h". */
export function eventMeta(event: AgendaEvent): string {
  const params = { city: event.city, state: event.state, time: formatShowTime(event.startsAt) };
  if (event.artists.length === 0) return t('agenda.metaNoArtists', params);
  return t('agenda.meta', { ...params, artists: eventArtists(event) });
}

function spokenDate(event: AgendaEvent, now: Date): string {
  return isEventToday(event, now) ? t('agenda.a11y.today') : formatLongDate(event.startsAt);
}

/**
 * O destaque num rótulo só: "Show em destaque. 21 de outubro, São João de
 * Irará, Netto Brito e Nenho, Irará, Bahia, 22 horas".
 */
export function featuredEventLabel(event: AgendaEvent, now: Date): string {
  const params = {
    date: spokenDate(event, now),
    show: event.title,
    place: eventPlaceSpoken(event),
    time: formatShowTimeSpoken(event.startsAt),
  };
  if (event.artists.length === 0) return t('agenda.a11y.featuredNoArtists', params);
  return t('agenda.a11y.featured', { ...params, artists: eventArtistsSpoken(event) });
}

/** A linha lê o que mostra: "28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia". */
export function eventRowLabel(event: AgendaEvent, now: Date): string {
  return t('agenda.a11y.row', {
    date: spokenDate(event, now),
    show: event.title,
    place: eventPlaceSpoken(event),
  });
}

/**
 * "Chamar amigos +10" e o nome lido, com o show e o que o convite rende:
 * "Chamar amigos para São João de Irará, 10 pontos por cadastro". Sem a regra
 * de pontos (ou zerada no painel), o botão sai sem o "+N".
 */
export function inviteButtonText(event: AgendaEvent): {
  label: string;
  accessibilityLabel: string;
} {
  const points = event.invitePointsPerSignup;
  if (points === null || points <= 0) {
    return {
      label: t('agenda.invite.labelPlain'),
      accessibilityLabel: t('agenda.invite.a11yPlain', { show: event.title }),
    };
  }
  return {
    label: t('agenda.invite.label', { points: formatPointsDelta(points) }),
    accessibilityLabel: t('agenda.invite.a11y', {
      show: event.title,
      points: formatPointsSpoken(points),
    }),
  };
}
