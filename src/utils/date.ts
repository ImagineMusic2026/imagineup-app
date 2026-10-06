import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isValid,
  setDefaultOptions,
} from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';

import { t, type TranslationKey } from '@/i18n';

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

/**
 * "sex., 3 out": a sobrelinha de um dia do extrato. O dia da semana curto são
 * as três primeiras letras do nome: no pt-BR do date-fns 4, o `EEE` sai por
 * extenso ("sábado") e o `EEEEEE` perde o acento ("sab").
 */
export function formatWeekdayDayMonth(input: DateInput): string {
  const date = safe(input);
  if (!date) return '';
  const weekday = format(date, 'EEE', { locale: ptBR }).slice(0, 3);
  return `${weekday}., ${formatDayMonth(date)}`;
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

type DurationUnit = 'minute' | 'hour' | 'day';

const SHORT_UNIT: Record<DurationUnit, TranslationKey> = {
  minute: 'date.minutes',
  hour: 'date.hours',
  day: 'date.days',
};

// Por extenso, para o leitor de tela: "2 h" seria lido letra a letra.
const SPOKEN_UNIT: Record<DurationUnit, { one: TranslationKey; many: TranslationKey }> = {
  minute: { one: 'date.spoken.minuteOne', many: 'date.spoken.minutes' },
  hour: { one: 'date.spoken.hourOne', many: 'date.spoken.hours' },
  day: { one: 'date.spoken.dayOne', many: 'date.spoken.days' },
};

function shortDuration(unit: DurationUnit, count: number): string {
  return t(SHORT_UNIT[unit], { count });
}

function spokenDuration(unit: DurationUnit, count: number): string {
  const keys = SPOKEN_UNIT[unit];
  return count === 1 ? t(keys.one) : t(keys.many, { count });
}

type RelativeTime =
  | { kind: 'now' }
  | { kind: 'elapsed'; unit: DurationUnit; count: number }
  | { kind: 'date'; date: Date };

/** Minutos, horas e dias até uma semana; depois disso, a data. */
function relativeTime(date: Date, now: Date): RelativeTime {
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return { kind: 'now' };
  if (minutes < 60) return { kind: 'elapsed', unit: 'minute', count: minutes };
  const hours = differenceInHours(now, date);
  if (hours < 24) return { kind: 'elapsed', unit: 'hour', count: hours };
  const days = differenceInCalendarDays(now, date);
  if (days < 7) return { kind: 'elapsed', unit: 'day', count: days };
  return { kind: 'date', date };
}

/**
 * Tempo curto do feed: "agora", "5 min", "2 h", "3 d" e, a partir de uma
 * semana, a data. O `formatDistanceToNowStrict` devolveria "2 horas".
 */
export function formatRelativeShort(input: DateInput, now: Date = new Date()): string {
  const date = safe(input);
  if (!date) return '';
  const relative = relativeTime(date, now);
  if (relative.kind === 'now') return t('date.now');
  if (relative.kind === 'elapsed') return shortDuration(relative.unit, relative.count);
  return formatDayMonth(relative.date);
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
  if (relative.kind === 'elapsed') {
    return t('date.ago', { time: shortDuration(relative.unit, relative.count) });
  }
  return formatDayMonth(relative.date);
}

/**
 * O `formatRelativeAgo` por extenso, para o leitor de tela: "há 2 horas",
 * "há 1 dia", "agora" e, a partir de uma semana, "21 de junho".
 */
export function formatRelativeAgoSpoken(input: DateInput, now: Date = new Date()): string {
  const date = safe(input);
  if (!date) return '';
  const relative = relativeTime(date, now);
  if (relative.kind === 'now') return t('date.now');
  if (relative.kind === 'elapsed') {
    return t('date.ago', { time: spokenDuration(relative.unit, relative.count) });
  }
  return formatLongDate(relative.date);
}

type TimeLeft =
  { kind: 'over' } | { kind: 'underMinute' } | { kind: 'left'; unit: DurationUnit; count: number };

/** Arredonda para baixo, para nunca prometer mais tempo do que há. */
function timeLeft(endsAt: Date, now: Date): TimeLeft {
  if (endsAt.getTime() <= now.getTime()) return { kind: 'over' };
  const minutes = differenceInMinutes(endsAt, now);
  if (minutes < 1) return { kind: 'underMinute' };
  if (minutes < 60) return { kind: 'left', unit: 'minute', count: minutes };
  const hours = differenceInHours(endsAt, now);
  if (hours < 24) return { kind: 'left', unit: 'hour', count: hours };
  return { kind: 'left', unit: 'day', count: Math.floor(hours / 24) };
}

/**
 * Tempo que falta, como em "termina em 4 h": "35 min", "4 h", "2 d" e, no
 * último minuto, "menos de 1 min". Depois do prazo devolve vazio: quem chama
 * mostra o estado de encerrada.
 */
export function formatTimeLeft(endsAtInput: DateInput, now: Date = new Date()): string {
  const endsAt = safe(endsAtInput);
  if (!endsAt) return '';
  const left = timeLeft(endsAt, now);
  if (left.kind === 'over') return '';
  if (left.kind === 'underMinute') return t('date.lessThanMinute');
  return shortDuration(left.unit, left.count);
}

/**
 * O `formatTimeLeft` por extenso, para o leitor de tela: "4 horas", "1 minuto",
 * "menos de 1 minuto". Depois do prazo, vazio.
 */
export function formatTimeLeftSpoken(endsAtInput: DateInput, now: Date = new Date()): string {
  const endsAt = safe(endsAtInput);
  if (!endsAt) return '';
  const left = timeLeft(endsAt, now);
  if (left.kind === 'over') return '';
  if (left.kind === 'underMinute') return t('date.spoken.lessThanMinute');
  return spokenDuration(left.unit, left.count);
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

/**
 * O `formatShowTime` por extenso, para o leitor de tela: "22 horas", "1 hora"
 * e, com minutos, "22 horas e 30 minutos" ("22 h" seria lido letra a letra).
 */
export function formatShowTimeSpoken(input: DateInput): string {
  const date = safe(input);
  if (!date) return '';
  const hours = spokenDuration('hour', date.getHours());
  const minutes = date.getMinutes();
  if (minutes === 0) return hours;
  return t('date.spoken.showTimeWithMinutes', {
    hours,
    minutes: spokenDuration('minute', minutes),
  });
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
