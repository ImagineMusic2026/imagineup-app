import { format, isValid, startOfDay } from 'date-fns';

import { formatMonthName } from '@/utils/date';

import type { AgendaEvent } from './types';

/**
 * A agenda (1m) montada a partir da lista da API: o destaque no topo, os
 * outros shows por mês, cada mês com a sua sobrelinha (proposta padrão; no
 * protótipo só agosto tinha), e os chips dos meses. Tudo no fuso do aparelho.
 */

export interface AgendaMonth {
  /** "2026-10". */
  key: string;
  /** "Outubro". */
  label: string;
  events: AgendaEvent[];
}

export interface AgendaChip {
  key: string;
  label: string;
}

export interface AgendaSections {
  /** O marcado no painel ou, sem marcação, o próximo show. Fica fora da lista. */
  featured: AgendaEvent | null;
  months: AgendaMonth[];
  /**
   * Os meses da lista, em ordem. O primeiro é o do topo, onde fica o destaque:
   * o mês da primeira linha ou, se o destaque vem antes dela, o dele. O mês do
   * destaque que não tem outra linha e não é o primeiro fica sem chip: não há
   * para onde rolar.
   */
  chips: AgendaChip[];
}

/** Mês do show no fuso do aparelho: "2026-10". */
export function monthKeyOf(event: AgendaEvent): string {
  return format(new Date(event.startsAt), 'yyyy-MM');
}

function startsAtOf(event: AgendaEvent): number {
  return Date.parse(event.startsAt);
}

/**
 * Show passado some da agenda. O de hoje fica até o dia virar, com "Hoje" no
 * selo: a hora de começo não diz quando o show acaba.
 */
export function isUpcoming(event: AgendaEvent, now: Date): boolean {
  const date = new Date(event.startsAt);
  return isValid(date) && date.getTime() >= startOfDay(now).getTime();
}

/** Shows futuros, sem repetir e em ordem de data. */
function upcomingOf(events: readonly AgendaEvent[], now: Date): AgendaEvent[] {
  // Páginas que se sobrepõem (a lista mudou entre uma e outra) não repetem show.
  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (seen.has(event.id) || !isUpcoming(event, now)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => startsAtOf(a) - startsAtOf(b));
}

/** Shows já em ordem, agrupados por mês. */
function monthsOf(events: readonly AgendaEvent[]): AgendaMonth[] {
  const months: AgendaMonth[] = [];
  for (const event of events) {
    const key = monthKeyOf(event);
    const month = months.at(-1);
    if (month?.key === key) month.events.push(event);
    else months.push({ key, label: formatMonthName(event.startsAt), events: [event] });
  }
  return months;
}

/**
 * Só os meses, sem destaque: os shows de uma central (aba Agenda da 1d), com a
 * sobrelinha de cada mês como na 1m.
 */
export function groupUpcomingByMonth(events: readonly AgendaEvent[], now: Date): AgendaMonth[] {
  return monthsOf(upcomingOf(events, now));
}

/**
 * `marked` é o destaque que a API manda (`AgendaPage.featured`); sem ele, ou
 * com ele já passado, o destaque é o próximo show.
 */
export function groupByMonth(
  events: readonly AgendaEvent[],
  now: Date,
  marked: AgendaEvent | null = null,
): AgendaSections {
  const upcoming = upcomingOf(events, now);
  const featured = marked && isUpcoming(marked, now) ? marked : (upcoming[0] ?? null);
  const rest = upcoming.filter((event) => event.id !== featured?.id);
  const months = monthsOf(rest);

  const chips: AgendaChip[] = months.map(({ key, label }) => ({ key, label }));
  const first = rest[0];
  if (featured && (!first || startsAtOf(featured) <= startsAtOf(first))) {
    const key = monthKeyOf(featured);
    if (chips[0]?.key !== key) chips.unshift({ key, label: formatMonthName(featured.startsAt) });
  }

  return { featured, months, chips };
}

/**
 * Itens da lista, numa FlashList só: a linha de chips (que gruda no topo ao
 * rolar), o destaque e, para cada mês, a sobrelinha e as linhas. O `month` de
 * cada item é o chip a que ele pertence: o destaque fica com o primeiro, que
 * é o mês do topo, mesmo quando o show dele é de outro mês.
 */
export type AgendaListItem =
  | { type: 'chips'; key: 'chips' }
  | { type: 'featured'; key: string; month: string; event: AgendaEvent }
  | { type: 'month'; key: string; month: string; label: string }
  | { type: 'event'; key: string; month: string; event: AgendaEvent };

export function buildAgendaItems({ featured, months, chips }: AgendaSections): AgendaListItem[] {
  if (!featured) return [];
  const items: AgendaListItem[] = [];
  if (chips.length > 0) items.push({ type: 'chips', key: 'chips' });
  items.push({
    type: 'featured',
    key: `featured-${featured.id}`,
    month: chips[0]?.key ?? monthKeyOf(featured),
    event: featured,
  });
  for (const month of months) {
    items.push({ type: 'month', key: `month-${month.key}`, month: month.key, label: month.label });
    for (const event of month.events) {
      items.push({ type: 'event', key: `event-${event.id}`, month: month.key, event });
    }
  }
  return items;
}

/**
 * Até onde o chip de um mês rola a lista: o primeiro mês, até o topo (o
 * destaque), para o fã ver o show em destaque junto das primeiras linhas; os
 * outros, até a sobrelinha deles. `-1` sem nada daquele mês.
 */
export function monthTargetIndex(items: readonly AgendaListItem[], month: string): number {
  const featured = items.findIndex((item) => item.type === 'featured' && item.month === month);
  if (featured >= 0) return featured;
  return items.findIndex((item) => item.type === 'month' && item.month === month);
}

/** O que a FlashList diz que está à vista (`onViewableItemsChanged`). */
export interface ViewableAgendaItem {
  item: AgendaListItem;
  index: number | null;
  isViewable: boolean;
}

/**
 * O mês em vista: o do primeiro item à vista, fora a linha de chips. `null`
 * quando só ela aparece, para o chip não mudar.
 */
export function monthInView(viewable: readonly ViewableAgendaItem[]): string | null {
  let first: { index: number; month: string } | null = null;
  for (const { item, index, isViewable } of viewable) {
    if (!isViewable || index === null || item.type === 'chips') continue;
    if (!first || index < first.index) first = { index, month: item.month };
  }
  return first?.month ?? null;
}
