import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isValid,
  setDefaultOptions,
} from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';

import { t } from '@/i18n';

// Toda formatação do app sai em pt-BR, inclusive quando alguém chama date-fns direto.
setDefaultOptions({ locale: ptBR });

/** Datas chegam do Firestore (Timestamp), da API (ISO) ou já como Date. */
export type DateInput = Date | string | number | { toDate: () => Date };

export function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'string' || typeof input === 'number') return new Date(input);
  return input.toDate();
}

function safe(input: DateInput): Date | null {
  const date = toDate(input);
  return isValid(date) ? date : null;
}

/** "21/06/2026" */
export function formatDate(input: DateInput): string {
  const date = safe(input);
  return date ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : '';
}

/** "14:02", como em "Concluída às 14:02". */
export function formatTime(input: DateInput): string {
  const date = safe(input);
  return date ? format(date, 'HH:mm', { locale: ptBR }) : '';
}

/** "21 jun" */
export function formatDayMonth(input: DateInput): string {
  const date = safe(input);
  return date ? format(date, 'd MMM', { locale: ptBR }).replace('.', '') : '';
}

/** Selo de data da agenda: { day: "21", month: "JUN" }. */
export function formatDateBadge(input: DateInput): { day: string; month: string } {
  const date = safe(input);
  if (!date) return { day: '', month: '' };
  return {
    day: format(date, 'dd', { locale: ptBR }),
    month: format(date, 'MMM', { locale: ptBR }).replace('.', '').toUpperCase(),
  };
}

/** "Junho", para os chips de mês. */
export function formatMonthName(input: DateInput): string {
  const date = safe(input);
  if (!date) return '';
  const month = format(date, 'MMMM', { locale: ptBR });
  return month.charAt(0).toUpperCase() + month.slice(1);
}

type RelativeTime =
  { kind: 'now' } | { kind: 'elapsed'; text: string } | { kind: 'date'; text: string };

/** Minutos, horas e dias até uma semana; depois disso, a data. */
function relativeTime(date: Date, now: Date): RelativeTime {
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return { kind: 'now' };
  if (minutes < 60) return { kind: 'elapsed', text: t('date.minutes', { count: minutes }) };
  const hours = differenceInHours(now, date);
  if (hours < 24) return { kind: 'elapsed', text: t('date.hours', { count: hours }) };
  const days = differenceInCalendarDays(now, date);
  if (days < 7) return { kind: 'elapsed', text: t('date.days', { count: days }) };
  return { kind: 'date', text: formatDayMonth(date) };
}

/**
 * Tempo curto do feed: "agora", "5 min", "2 h", "3 d" e, a partir de uma
 * semana, a data. O `formatDistanceToNowStrict` devolveria "2 horas".
 */
export function formatRelativeShort(input: DateInput, now: Date = new Date()): string {
  const date = safe(input);
  if (!date) return '';
  const relative = relativeTime(date, now);
  return relative.kind === 'now' ? t('date.now') : relative.text;
}

/**
 * Meta de autor e comentário: "há 2 h". O "há" só entra com minutos, horas e
 * dias; "há agora" e "há 21 jun" não existem, então esses saem puros.
 */
export function formatRelativeAgo(input: DateInput, now: Date = new Date()): string {
  const date = safe(input);
  if (!date) return '';
  const relative = relativeTime(date, now);
  if (relative.kind === 'now') return t('date.now');
  if (relative.kind === 'elapsed') return t('date.ago', { time: relative.text });
  return relative.text;
}

/**
 * Tempo que falta, como em "termina em 4 h": "35 min", "4 h", "2 d" e, no
 * último minuto, "menos de 1 min". Arredonda para baixo, para nunca prometer
 * mais tempo do que há. Depois do prazo devolve vazio: quem chama mostra o
 * estado de encerrada.
 */
export function formatTimeLeft(endsAtInput: DateInput, now: Date = new Date()): string {
  const endsAt = safe(endsAtInput);
  if (!endsAt || endsAt.getTime() <= now.getTime()) return '';
  const minutes = differenceInMinutes(endsAt, now);
  if (minutes < 1) return t('date.lessThanMinute');
  if (minutes < 60) return t('date.minutes', { count: minutes });
  const hours = differenceInHours(endsAt, now);
  if (hours < 24) return t('date.hours', { count: hours });
  return t('date.days', { count: Math.floor(hours / 24) });
}

/**
 * Fim da temporada por dia do calendário: "encerra em 12 dias", "encerra
 * amanhã", "encerra hoje" e, passado o horário, "encerrada".
 */
export function formatSeasonCountdown(endsAtInput: DateInput, now: Date = new Date()): string {
  const endsAt = safe(endsAtInput);
  if (!endsAt) return '';
  if (endsAt.getTime() <= now.getTime()) return t('date.season.ended');
  const days = differenceInCalendarDays(endsAt, now);
  if (days === 0) return t('date.season.endsToday');
  if (days === 1) return t('date.season.endsTomorrow');
  return t('date.season.endsInDays', { count: days });
}

/** Hora do show: "22 h" e, com minutos, "22 h 30". */
export function formatShowTime(input: DateInput): string {
  const date = safe(input);
  if (!date) return '';
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (minutes === 0) return t('date.showTime', { hours });
  return t('date.showTimeWithMinutes', { hours, minutes: String(minutes).padStart(2, '0') });
}

/** "21 de junho", para o leitor de tela (o selo "21 JUN" é lido assim). */
export function formatLongDate(input: DateInput): string {
  const date = safe(input);
  return date ? format(date, "d 'de' MMMM", { locale: ptBR }) : '';
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** Período do dia para a saudação da home ("Bom dia", "Boa tarde", "Boa noite"). */
export function dayPeriod(input: DateInput = new Date()): DayPeriod {
  const hour = toDate(input).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}
