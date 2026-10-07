import { describe, expect, it } from 'vitest';

import { dayKey, monthKey, nextDayStart, nextWeekStart, shiftDay, weekKey } from './day';
import * as model from './points/model';

describe('dias de São Paulo', () => {
  it.each([
    ['2026-10-05T02:59:59.999Z', '2026-10-04'],
    ['2026-10-05T03:00:00.000Z', '2026-10-05'],
    ['2026-10-01T02:59:00.000Z', '2026-09-30'],
    ['2027-01-01T02:00:00.000Z', '2026-12-31'],
  ])('%s é o dia %s em São Paulo', (iso, day) => {
    expect(dayKey(Date.parse(iso))).toBe(day);
  });

  it.each([
    ['2026-10-04', '2026-W40'],
    ['2026-10-05', '2026-W41'],
    ['2026-12-31', '2026-W53'],
    ['2027-01-01', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2026-01-01', '2026-W01'],
  ])('semana ISO de %s é %s', (day, week) => {
    expect(weekKey(day)).toBe(week);
  });

  it('mês e a conta de dias atravessam o fim do mês e do ano', () => {
    expect(monthKey('2026-09-30')).toBe('2026-09');
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it.each([
    ['2026-10-05T15:00:00.000Z', '2026-10-06T03:00:00.000Z'],
    ['2026-10-06T02:59:59.999Z', '2026-10-06T03:00:00.000Z'],
    ['2026-10-06T03:00:00.000Z', '2026-10-07T03:00:00.000Z'],
    ['2026-12-31T23:00:00.000Z', '2027-01-01T03:00:00.000Z'],
  ])('o dia de São Paulo seguinte a %s começa em %s', (iso, next) => {
    expect(new Date(nextDayStart(Date.parse(iso))).toISOString()).toBe(next);
  });

  it.each([
    // Domingo 23:59 de São Paulo: a semana vira em um minuto.
    ['2026-10-12T02:59:00.000Z', '2026-10-12T03:00:00.000Z'],
    // Segunda 0:00 de São Paulo: a semana que vem é a da outra segunda.
    ['2026-10-12T03:00:00.000Z', '2026-10-19T03:00:00.000Z'],
    // Quarta à tarde.
    ['2026-10-07T18:00:00.000Z', '2026-10-12T03:00:00.000Z'],
    // A virada do ano ISO: a semana 2026-W53 vai até domingo, 3 de janeiro.
    ['2027-01-01T15:00:00.000Z', '2027-01-04T03:00:00.000Z'],
  ])('a semana de São Paulo seguinte a %s começa em %s', (iso, next) => {
    const now = Date.parse(iso);
    const start = nextWeekStart(now);
    expect(new Date(start).toISOString()).toBe(next);
    expect(weekKey(dayKey(start))).not.toBe(weekKey(dayKey(now)));
    expect(weekKey(dayKey(start - 1))).toBe(weekKey(dayKey(now)));
  });

  it('o points/model.ts reexporta os dias (nenhum import de antes muda)', () => {
    expect(model.dayKey).toBe(dayKey);
    expect(model.weekKey).toBe(weekKey);
    expect(model.nextDayStart).toBe(nextDayStart);
    expect(model.TIME_ZONE).toBe('America/Sao_Paulo');
  });
});
