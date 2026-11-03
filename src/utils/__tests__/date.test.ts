import {
  dayPeriod,
  formatDate,
  formatDateBadge,
  formatDayMonth,
  formatLongDate,
  formatMonthName,
  formatPostTime,
  formatPostTimeSpoken,
  formatRelativeAgo,
  formatRelativeAgoSpoken,
  formatRelativeShort,
  formatSeasonCountdown,
  formatShowTime,
  formatShowTimeSpoken,
  formatTime,
  formatTimeLeft,
  formatTimeLeftSpoken,
  formatWeekdayDayMonth,
} from '../date';

const JUNE_21 = new Date(2026, 5, 21, 22, 5);
const MINUTE = 60_000;

describe('datas em pt-BR', () => {
  it('formata dia, hora e mês como o protótipo', () => {
    expect(formatDate(JUNE_21)).toBe('21/06/2026');
    expect(formatTime(JUNE_21)).toBe('22:05');
    expect(formatDayMonth(JUNE_21)).toBe('21 jun');
    expect(formatDateBadge(JUNE_21)).toEqual({ day: '21', month: 'JUN' });
    expect(formatMonthName(JUNE_21)).toBe('Junho');
  });

  it.each([
    [new Date(2026, 8, 27, 12), 'dom., 27 set'],
    [new Date(2026, 9, 2, 9), 'sex., 2 out'],
    [new Date(2026, 9, 3, 23, 59), 'sáb., 3 out'],
    [new Date(2026, 8, 28, 0, 0), 'seg., 28 set'],
    [new Date(2026, 8, 29, 8), 'ter., 29 set'],
  ])('a sobrelinha do dia no extrato tem o dia da semana curto (%s)', (date, expected) => {
    expect(formatWeekdayDayMonth(date)).toBe(expected);
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

  it.each([
    [0, 'agora'],
    [5, 'há 5 min'],
    [120, 'há 2 h'],
    [60 * 24 * 3, 'há 3 d'],
    [60 * 24 * 10, '11 jun'],
  ])('meta de autor com %i minutos de diferença', (minutesAgo, expected) => {
    const posted = new Date(JUNE_21.getTime() - minutesAgo * MINUTE);
    expect(formatRelativeAgo(posted, JUNE_21)).toBe(expected);
  });

  it.each([
    [0, 'agora'],
    [5, '5 min'],
    [3 * 60, '3 h'],
    [23 * 60 + 59, '23 h'],
    [24 * 60, '20 de jun'],
    [60 * 24 * 3, '18 de jun'],
    [60 * 24 * 10, '11 de jun'],
  ])('o horário da publicação, no estilo do X, com %i minutos', (minutesAgo, expected) => {
    const posted = new Date(JUNE_21.getTime() - minutesAgo * MINUTE);
    expect(formatPostTime(posted, JUNE_21)).toBe(expected);
  });

  it('o horário da publicação de outro ano leva o ano, e o "2 d" do comentário segue igual', () => {
    expect(formatPostTime(new Date(2025, 10, 2, 12), JUNE_21)).toBe('2 de nov de 2025');
    expect(formatPostTime(new Date(2026, 0, 2, 12), JUNE_21)).toBe('2 de jan');
    // Na mesma tela, o comentário de 2 dias diz "2 d" e a publicação de 2 dias, a data.
    const twoDays = new Date(JUNE_21.getTime() - 60 * 24 * 2 * MINUTE);
    expect(formatRelativeShort(twoDays, JUNE_21)).toBe('2 d');
    expect(formatPostTime(twoDays, JUNE_21)).toBe('19 de jun');
  });

  it.each([
    [0, 'agora'],
    [1, 'há 1 minuto'],
    [3 * 60, 'há 3 horas'],
    [24 * 60, '20 de junho'],
    [60 * 24 * 10, '11 de junho'],
  ])(
    'o horário da publicação por extenso, para o leitor, com %i minutos',
    (minutesAgo, expected) => {
      const posted = new Date(JUNE_21.getTime() - minutesAgo * MINUTE);
      expect(formatPostTimeSpoken(posted, JUNE_21)).toBe(expected);
    },
  );

  it('o horário da publicação de outro ano, por extenso, leva o ano', () => {
    expect(formatPostTimeSpoken(new Date(2025, 10, 2, 12), JUNE_21)).toBe('2 de novembro de 2025');
  });

  it.each([
    [4 * 60, '4 h'],
    [4 * 60 + 59, '4 h'],
    [35, '35 min'],
    [0.5, 'menos de 1 min'],
    [60 * 24 * 2 + 30, '2 d'],
    [0, ''],
    [-10, ''],
  ])('tempo que falta com %d minutos até o fim', (minutesLeft, expected) => {
    const endsAt = new Date(JUNE_21.getTime() + minutesLeft * MINUTE);
    expect(formatTimeLeft(endsAt, JUNE_21)).toBe(expected);
  });

  it.each([
    [4 * 60 + 30, '4 horas'],
    [60, '1 hora'],
    [35, '35 minutos'],
    [1, '1 minuto'],
    [0.5, 'menos de 1 minuto'],
    [60 * 24, '1 dia'],
    [60 * 24 * 2 + 30, '2 dias'],
    [0, ''],
  ])('tempo que falta por extenso, para o leitor, com %d minutos', (minutesLeft, expected) => {
    const endsAt = new Date(JUNE_21.getTime() + minutesLeft * MINUTE);
    expect(formatTimeLeftSpoken(endsAt, JUNE_21)).toBe(expected);
  });

  it.each([
    [0, 'agora'],
    [1, 'há 1 minuto'],
    [5, 'há 5 minutos'],
    [60, 'há 1 hora'],
    [120, 'há 2 horas'],
    [60 * 24, 'há 1 dia'],
    [60 * 24 * 3, 'há 3 dias'],
    [60 * 24 * 10, '11 de junho'],
  ])('meta de autor por extenso, para o leitor, com %i minutos', (minutesAgo, expected) => {
    const posted = new Date(JUNE_21.getTime() - minutesAgo * MINUTE);
    expect(formatRelativeAgoSpoken(posted, JUNE_21)).toBe(expected);
  });

  it.each([
    ['daqui a 12 dias', new Date(2026, 6, 3, 23, 59), 'encerra em 12 dias'],
    ['amanhã de madrugada', new Date(2026, 5, 22, 0, 30), 'encerra amanhã'],
    ['hoje mais tarde', new Date(2026, 5, 21, 23, 59), 'encerra hoje'],
    ['hoje, horário já passado', new Date(2026, 5, 21, 22, 0), 'encerrada'],
    ['no mês passado', new Date(2026, 4, 30), 'encerrada'],
  ])('temporada que termina %s', (_when, endsAt, expected) => {
    expect(formatSeasonCountdown(endsAt, JUNE_21)).toBe(expected);
  });

  it.each([
    ['22:00', new Date(2026, 5, 21, 22, 0), '22 h'],
    ['22:30', new Date(2026, 5, 21, 22, 30), '22 h 30'],
    ['09:05', new Date(2026, 5, 21, 9, 5), '9 h 05'],
    ['00:00', new Date(2026, 5, 22, 0, 0), '0 h'],
  ])('hora do show às %s', (_clock, startsAt, expected) => {
    expect(formatShowTime(startsAt)).toBe(expected);
  });

  it.each([
    ['22:00', new Date(2026, 5, 21, 22, 0), '22 horas'],
    ['22:30', new Date(2026, 5, 21, 22, 30), '22 horas e 30 minutos'],
    ['01:01', new Date(2026, 5, 21, 1, 1), '1 hora e 1 minuto'],
    ['00:00', new Date(2026, 5, 22, 0, 0), '0 horas'],
  ])('hora do show às %s, por extenso para o leitor de tela', (_clock, startsAt, expected) => {
    expect(formatShowTimeSpoken(startsAt)).toBe(expected);
  });

  it('escreve a data por extenso para o leitor de tela', () => {
    expect(formatLongDate(JUNE_21)).toBe('21 de junho');
    expect(formatLongDate(new Date(2026, 9, 1))).toBe('1 de outubro');
  });

  it('os formatadores novos devolvem vazio para data inválida', () => {
    expect(formatRelativeAgo('não é data', JUNE_21)).toBe('');
    expect(formatTimeLeft('não é data', JUNE_21)).toBe('');
    expect(formatTimeLeftSpoken('não é data', JUNE_21)).toBe('');
    expect(formatRelativeAgoSpoken('não é data', JUNE_21)).toBe('');
    expect(formatSeasonCountdown('não é data', JUNE_21)).toBe('');
    expect(formatShowTime('não é data')).toBe('');
    expect(formatShowTimeSpoken('não é data')).toBe('');
    expect(formatLongDate('não é data')).toBe('');
    expect(formatPostTime('não é data', JUNE_21)).toBe('');
    expect(formatPostTimeSpoken('não é data', JUNE_21)).toBe('');
  });
});
