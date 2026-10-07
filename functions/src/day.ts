// Dias, semanas e meses de São Paulo, puro: o limite diário, o `days` da
// carteira, o extrato, os agregados e os períodos das missões (bloco 7) contam
// pelo mesmo relógio. O points/model.ts reexporta tudo daqui (nenhum import de
// antes muda). docs/arquitetura-api.md, seções 5 e 22.

/** Fuso dos dias de pontos: o limite diário, o `days` da carteira, o extrato e os agregados. */
export const TIME_ZONE = 'America/Sao_Paulo';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** O dia de São Paulo de um instante, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  return dayFormatter.format(new Date(ms));
}

function dayParts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year!, month!, date!];
}

/** `day` andando `delta` dias no calendário (conta de calendário, sem fuso). */
export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date) + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * O instante em que começa o dia de São Paulo `day`, depois de `after`.
 * Procura a hora cheia, a partir da meia-noite UTC do dia, em que o `dayKey`
 * vira (os fusos do Brasil são de horas cheias), sem supor o deslocamento.
 */
function dayStartAfter(day: string, after: number): number {
  const [year, month, date] = dayParts(day);
  const utcMidnight = Date.UTC(year, month - 1, date);
  for (let hour = -14; hour <= 14; hour += 1) {
    const at = utcMidnight + hour * HOUR_MS;
    if (at > after && dayKey(at) === day) return at;
  }
  throw new RangeError(`Não achei o começo do dia ${day}.`);
}

/** O instante em que começa o dia de São Paulo seguinte ao de `now`. */
export function nextDayStart(now: number): number {
  return dayStartAfter(shiftDay(dayKey(now), 1), now);
}

/** Dia da semana ISO do dia de calendário: 1 é segunda, 7 é domingo. */
function isoWeekday(day: string): number {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay() || 7;
}

/**
 * O instante em que começa a semana ISO de São Paulo seguinte à de `now`: a
 * meia-noite da próxima segunda-feira (a semana das missões semanais, de
 * segunda a domingo, bloco 7).
 */
export function nextWeekStart(now: number): number {
  const today = dayKey(now);
  return dayStartAfter(shiftDay(today, 8 - isoWeekday(today)), now);
}

/**
 * O instante em que começa a semana ISO de São Paulo de `now`: a meia-noite
 * da segunda-feira do calendário (o retrato semanal do ranking, bloco 8). Sai
 * do calendário e do `dayStartAfter`, sem supor o deslocamento do fuso.
 */
export function weekStart(now: number): number {
  const today = dayKey(now);
  const monday = shiftDay(today, 1 - isoWeekday(today));
  // O começo do dia de segunda vem depois de um instante dentro do dia anterior.
  return dayStartAfter(monday, Date.parse(`${shiftDay(monday, -1)}T12:00:00.000Z`));
}

/** A semana ISO de São Paulo anterior à de `now`, `2026-W40` (a seta do ranking, bloco 8). */
export function previousWeekKey(now: number): string {
  return weekKey(shiftDay(dayKey(now), -7));
}

/** Semana ISO do dia de calendário, `2026-W41`. */
export function weekKey(day: string): string {
  const [year, month, date] = dayParts(day);
  const thursday = new Date(Date.UTC(year, month - 1, date));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Mês do dia de calendário, `2026-10`. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}
