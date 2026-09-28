import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isValid,
  setDefaultOptions,
} from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';

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

/**
 * Tempo curto do feed: "agora", "5 min", "2 h", "3 d" e, a partir de uma
 * semana, a data. O `formatDistanceToNowStrict` devolveria "2 horas".
 */
export function formatRelativeShort(input: DateInput, now: Date = new Date()): string {
  const date = safe(input);
  if (!date) return '';
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours} h`;
  const days = differenceInCalendarDays(now, date);
  if (days < 7) return `${days} d`;
  return formatDayMonth(date);
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** Período do dia para a saudação da home ("Bom dia", "Boa tarde", "Boa noite"). */
export function dayPeriod(input: DateInput = new Date()): DayPeriod {
  const hour = toDate(input).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}
