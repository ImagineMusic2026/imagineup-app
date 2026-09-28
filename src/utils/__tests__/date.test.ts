import {
  dayPeriod,
  formatDate,
  formatDateBadge,
  formatDayMonth,
  formatMonthName,
  formatRelativeShort,
  formatTime,
} from '../date';

const JUNE_21 = new Date(2026, 5, 21, 22, 5);

describe('datas em pt-BR', () => {
  it('formata dia, hora e mês como o protótipo', () => {
    expect(formatDate(JUNE_21)).toBe('21/06/2026');
    expect(formatTime(JUNE_21)).toBe('22:05');
    expect(formatDayMonth(JUNE_21)).toBe('21 jun');
    expect(formatDateBadge(JUNE_21)).toEqual({ day: '21', month: 'JUN' });
    expect(formatMonthName(JUNE_21)).toBe('Junho');
  });

  it('aceita ISO e Timestamp do Firestore', () => {
    expect(formatDate('2026-06-21T12:00:00')).toBe('21/06/2026');
    expect(formatDate({ toDate: () => JUNE_21 })).toBe('21/06/2026');
  });

  it('devolve vazio para data inválida em vez de quebrar a tela', () => {
    expect(formatDate('não é data')).toBe('');
  });

  it.each([
    [0, 'agora'],
    [5, '5 min'],
    [120, '2 h'],
    [60 * 24 * 3, '3 d'],
    [60 * 24 * 10, '11 jun'],
  ])('tempo curto do feed com %i minutos de diferença', (minutesAgo, expected) => {
    const posted = new Date(JUNE_21.getTime() - minutesAgo * 60_000);
    expect(formatRelativeShort(posted, JUNE_21)).toBe(expected);
  });

  it.each([
    [8, 'morning'],
    [14, 'afternoon'],
    [21, 'evening'],
    [2, 'evening'],
  ])('às %i h a saudação é %s', (hour, expected) => {
    expect(dayPeriod(new Date(2026, 5, 21, hour))).toBe(expected);
  });
});
