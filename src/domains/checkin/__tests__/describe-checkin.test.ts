import { ApiError } from '@/services/api/errors';

import {
  actionLabel,
  actionText,
  checkinAnnouncement,
  checkinCells,
  checkinRefusal,
  checkinRollover,
  checkinSummary,
  doneCycleDays,
  doneLabel,
  doneMeta,
  endsInText,
  isCheckinUnavailable,
  isDefinitiveRefusal,
  isMissingRoute,
  liveCheckin,
  nextCheckinPoints,
  streakPillLabel,
  streakText,
  trackLabel,
  type CheckinCellStatus,
} from '../describe-checkin';
import type { CheckinState } from '../types';

// O que o fã vê do check-in diário, do estado que o servidor manda: a trava,
// a virada do dia e os textos da tela e do leitor.

/** A meia-noite de São Paulo de 10 para 11 de novembro de 2026. */
const RESETS_AT = '2026-11-11T03:00:00.000Z';
const RESET = Date.parse(RESETS_AT);
/** 20 h de São Paulo: faltam 4 horas. */
const NOW = new Date('2026-11-10T23:00:00.000Z');
const CYCLE = [3, 3, 4, 4, 5, 6, 15];

/** O estado do seed: 4 dias seguidos até ontem, o de hoje por fazer (o dia 5 do ciclo). */
function state(fields: Partial<CheckinState> = {}): CheckinState {
  return {
    enabled: true,
    checkedInToday: false,
    streak: 4,
    best: 4,
    cycle: [...CYCLE],
    cycleDay: 5,
    todayPoints: 5,
    resetsAt: RESETS_AT,
    ...fields,
  };
}

/** O de hoje feito: 5 dias seguidos, no dia 5 do ciclo. */
const DONE = state({ checkedInToday: true, streak: 5, best: 5 });

const routeMissing = new ApiError('notFound', 'Rota não encontrada.', 404, 'not_found');
const disabled = new ApiError('validation', 'fora', 409, 'checkin_disabled');
const suspended = new ApiError('forbidden', 'suspensa', 403, 'account_suspended');
const rateLimited = new ApiError('rateLimited', 'ritmo', 429, 'rate_limited', null, 2000);
const network = new ApiError('network', 'sem rede');
const server = new ApiError('server', 'caiu', 503);

describe('a trava do check-in', () => {
  // Só o 404 de rota que não existe trava a consulta até o app reabrir.
  it.each<[string, unknown, boolean]>([
    ['o 404 da api de antes do check-in', routeMissing, true],
    ['um 404 sem código no corpo', new ApiError('notFound', 'x', 404), true],
    ['o 403 de quem não é fã', new ApiError('forbidden', 'x', 403, 'not_fan'), false],
    ['o 403 do App Check', new ApiError('forbidden', 'x', 403, 'app_check_failed'), false],
    ['o 401 da sessão que caiu', new ApiError('unauthorized', 'x', 401), false],
    ['a chave desligada (409 checkin_disabled)', disabled, false],
    ['a rede', network, false],
    ['o prazo', new ApiError('timeout', 'x'), false],
    ['o servidor fora do ar', server, false],
    ['o ritmo', rateLimited, false],
    ['o pedido que nem saiu (sem status)', new ApiError('unknown', 'x'), false],
    ['um erro que não é da API', new Error('x'), false],
    ['nenhum erro', null, false],
  ])('a rota não existe: %s', (_name, error, expected) => {
    expect(isMissingRoute(error)).toBe(expected);
  });

  // As outras recusas definitivas só escondem o card enquanto forem o erro da consulta.
  it.each<[string, unknown, boolean]>([
    ['o 404 da api de antes do check-in', routeMissing, true],
    ['o 403 de quem não é fã', new ApiError('forbidden', 'x', 403, 'not_fan'), true],
    ['o 401 da sessão que caiu', new ApiError('unauthorized', 'x', 401), true],
    ['a rede', network, false],
    ['o prazo', new ApiError('timeout', 'x'), false],
    ['o servidor fora do ar', server, false],
    ['o ritmo', rateLimited, false],
    ['o pedido que nem saiu (sem status)', new ApiError('unknown', 'x'), false],
    ['um erro que não é da API', new Error('x'), false],
    ['nenhum erro', null, false],
  ])('recusa definitiva: %s', (_name, error, expected) => {
    expect(isDefinitiveRefusal(error)).toBe(expected);
  });

  it.each<[string, CheckinState | undefined, unknown, boolean]>([
    ['sem resposta (carregando)', undefined, null, false],
    ['sem resposta e com a consulta falhando', undefined, network, false],
    ['a chave desligada', state({ enabled: false, cycle: [], cycleDay: 0 }), null, false],
    ['a chave ligada sem ciclo', state({ cycle: [] }), null, false],
    ['a chave ligada', state(), null, true],
    ['a busca de novo que falhou por rede: a resposta de antes fica', state(), network, true],
    ['o servidor fora do ar: a resposta de antes fica', state(), server, true],
    ['o ritmo: a resposta de antes fica', state(), rateLimited, true],
    [
      'a api que voltou a ser a de antes (404): nada, mesmo com a resposta',
      state(),
      routeMissing,
      false,
    ],
    [
      'o 403 de uma busca de novo: nada, enquanto ele for o erro da consulta',
      state(),
      new ApiError('forbidden', 'x', 403, 'app_check_failed'),
      false,
    ],
    [
      'o 401 de uma busca de novo: nada, enquanto ele for o erro da consulta',
      state(),
      new ApiError('unauthorized', 'x', 401),
      false,
    ],
  ])('o que aparece: %s', (_name, data, error, shown) => {
    expect(liveCheckin(data, error)).toBe(shown ? data : null);
  });
});

describe('a virada do dia', () => {
  it.each<[string, string, number, number, string]>([
    ['antes da meia-noite', RESETS_AT, RESET - 3_600_000, RESET - 1, 'current'],
    ['na meia-noite, com a resposta de antes', RESETS_AT, RESET - 3_600_000, RESET, 'stale'],
    [
      'no dia seguinte, com a resposta de ontem',
      RESETS_AT,
      RESET - 60_000,
      RESET + 7_200_000,
      'stale',
    ],
    [
      'o relógio do aparelho adiantado: a resposta acabou de chegar com o mesmo prazo',
      RESETS_AT,
      RESET + 5_000,
      RESET + 6_000,
      'current',
    ],
    [
      'o relógio adiantado, um minuto depois da resposta: pergunta de novo',
      RESETS_AT,
      RESET + 5_000,
      RESET + 65_000,
      'recheck',
    ],
    ['o prazo fora do formato não vence', 'amanhã', 0, RESET, 'current'],
  ])('%s', (_name, resetsAt, fetchedAt, now, expected) => {
    expect(checkinRollover(resetsAt, fetchedAt, new Date(now))).toBe(expected);
  });
});

describe('os textos do check-in', () => {
  it.each<[number, string]>([
    [0, 'Comece sua sequência'],
    [-1, 'Comece sua sequência'],
    [1, '1 dia seguido'],
    [2, '2 dias seguidos'],
    [4, '4 dias seguidos'],
    [1000, '1.000 dias seguidos'],
  ])('a sequência de %d: "%s"', (streak, text) => {
    expect(streakText(streak)).toBe(text);
  });

  it('o topo: "Termina em 4 h" na tela e as horas por extenso no cabeçalho', () => {
    expect(endsInText(state(), NOW)).toBe('Termina em 4 h');
    expect(checkinSummary(state(), NOW)).toBe(
      'Check-in diário. 4 dias seguidos. Termina em 4 horas.',
    );
    expect(checkinSummary(state({ streak: 0, cycleDay: 1, todayPoints: 3 }), NOW)).toBe(
      'Check-in diário. Comece sua sequência. Termina em 4 horas.',
    );
    expect(checkinSummary(state({ streak: 1 }), new Date(RESET - 30_000))).toBe(
      'Check-in diário. 1 dia seguido. Termina em menos de 1 minuto.',
    );
  });

  it('com o prazo vencido no relógio do aparelho, o topo sai sem o "Termina em"', () => {
    const late = new Date(RESET + 60_000);
    expect(endsInText(state(), late)).toBeNull();
    expect(checkinSummary(state(), late)).toBe('Check-in diário. 4 dias seguidos.');
  });

  it.each<[string, CheckinState, string, string]>([
    ['com o valor de hoje', state(), 'Fazer check-in +5', 'Fazer check-in, vale 5 pontos'],
    ['valendo 1', state({ todayPoints: 1 }), 'Fazer check-in +1', 'Fazer check-in, vale 1 ponto'],
    ['valendo 0 (o ciclo zerado)', state({ todayPoints: 0 }), 'Fazer check-in', 'Fazer check-in'],
    [
      'valendo mil',
      state({ todayPoints: 1000 }),
      'Fazer check-in +1.000',
      'Fazer check-in, vale 1.000 pontos',
    ],
  ])('o botão %s', (_name, value, text, label) => {
    expect(actionText(value)).toBe(text);
    expect(actionLabel(value)).toBe(label);
  });

  it('a pílula da 1e diz a sequência', () => {
    expect(streakPillLabel(4)).toBe('Sequência de check-in: 4 dias seguidos');
    expect(streakPillLabel(1)).toBe('Sequência de check-in: 1 dia seguido');
  });
});

describe('a trilha do ciclo', () => {
  const statuses = (value: CheckinState): CheckinCellStatus[] =>
    checkinCells(value).map((cell) => cell.status);

  it('uma célula por valor do servidor, com o "+N" e o dia; a de hoje diz "Hoje"', () => {
    expect(checkinCells(state())).toEqual([
      { day: 1, status: 'done', value: '+3', label: 'Dia 1' },
      { day: 2, status: 'done', value: '+3', label: 'Dia 2' },
      { day: 3, status: 'done', value: '+4', label: 'Dia 3' },
      { day: 4, status: 'done', value: '+4', label: 'Dia 4' },
      { day: 5, status: 'today', value: '+5', label: 'Hoje' },
      { day: 6, status: 'upcoming', value: '+6', label: 'Dia 6' },
      { day: 7, status: 'upcoming', value: '+15', label: 'Dia 7' },
    ]);
  });

  it.each<[string, CheckinState, CheckinCellStatus[], number]>([
    [
      'sem sequência, o dia 1 é o de hoje',
      state({ streak: 0, cycleDay: 1, todayPoints: 3 }),
      ['today', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      0,
    ],
    [
      'no último dia',
      state({ streak: 6, cycleDay: 7, todayPoints: 15 }),
      ['done', 'done', 'done', 'done', 'done', 'done', 'today'],
      6,
    ],
    [
      'depois do dia 7, o ciclo recomeça do 1 (a sequência segue em 7)',
      state({ streak: 7, best: 7, cycleDay: 1, todayPoints: 3 }),
      ['today', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      0,
    ],
    [
      'com o de hoje feito, o dia de hoje entra nos feitos',
      DONE,
      ['done', 'done', 'done', 'done', 'done', 'upcoming', 'upcoming'],
      5,
    ],
    [
      'um ciclo de outro tamanho, do painel: tantas células quantos valores',
      state({ cycle: [1, 2, 9], cycleDay: 2, todayPoints: 2, streak: 1 }),
      ['done', 'today', 'upcoming'],
      1,
    ],
  ])('%s', (_name, value, expected, done) => {
    expect(statuses(value)).toEqual(expected);
    expect(doneCycleDays(value)).toBe(done);
  });

  it.each<[string, CheckinState, string]>([
    [
      'no meio do ciclo, com o valor do último dia',
      state(),
      'Dia 5 de 7. O check-in de hoje vale 5 pontos. O dia 7 vale 15 pontos.',
    ],
    [
      'no primeiro dia',
      state({ streak: 0, cycleDay: 1, todayPoints: 3 }),
      'Dia 1 de 7. O check-in de hoje vale 3 pontos. O dia 7 vale 15 pontos.',
    ],
    [
      'no último dia, sem repetir o valor',
      state({ streak: 6, cycleDay: 7, todayPoints: 15 }),
      'Dia 7 de 7. O check-in de hoje vale 15 pontos.',
    ],
    [
      'num ciclo de 3 valendo 1',
      state({ cycle: [1, 2, 9], cycleDay: 1, todayPoints: 1, streak: 0 }),
      'Dia 1 de 3. O check-in de hoje vale 1 ponto. O dia 3 vale 9 pontos.',
    ],
  ])('a trilha num rótulo só: %s', (_name, value, label) => {
    expect(trackLabel(value)).toBe(label);
  });
});

describe('o check-in feito', () => {
  it.each<[string, CheckinState, number]>([
    ['no dia 5, amanhã é o dia 6', DONE, 6],
    [
      'no dia 7, amanhã o ciclo recomeça',
      state({ checkedInToday: true, streak: 7, cycleDay: 7 }),
      3,
    ],
    ['no dia 1', state({ checkedInToday: true, streak: 1, cycleDay: 1 }), 3],
    ['sem ciclo', state({ cycle: [], cycleDay: 0 }), 0],
  ])('quanto vale amanhã: %s', (_name, value, points) => {
    expect(nextCheckinPoints(value)).toBe(points);
  });

  it('a linha de baixo vem em pedaços, para o valor de amanhã sair em lima', () => {
    expect(doneMeta(DONE)).toEqual({
      before: '5 dias seguidos · Amanhã vale ',
      points: '+6',
      after: '',
    });
    expect(doneMeta(state({ checkedInToday: true, streak: 1, cycleDay: 1 }))).toEqual({
      before: '1 dia seguido · Amanhã vale ',
      points: '+3',
      after: '',
    });
  });

  it('o rótulo e o anúncio dizem a sequência; o rótulo, também o valor de amanhã', () => {
    expect(checkinAnnouncement(DONE)).toBe('Check-in feito. 5 dias seguidos.');
    expect(doneLabel(DONE)).toBe('Check-in feito. 5 dias seguidos. Amanhã vale 6 pontos.');
    expect(doneLabel(state({ checkedInToday: true, streak: 1, cycleDay: 1 }))).toBe(
      'Check-in feito. 1 dia seguido. Amanhã vale 3 pontos.',
    );
  });

  it('com o dia seguinte valendo 0 (o ciclo zerado), só a sequência', () => {
    const zeroed = state({ checkedInToday: true, streak: 5, cycle: [0, 0, 0, 0, 0, 0, 0] });
    expect(doneMeta(zeroed)).toEqual({ text: '5 dias seguidos' });
    expect(doneLabel(zeroed)).toBe('Check-in feito. 5 dias seguidos.');
  });
});

describe('a recusa do toque', () => {
  const GENERIC = 'checkin.error';

  it.each<[string, unknown, boolean]>([
    ['a chave desligada (409 checkin_disabled)', disabled, true],
    ['a api de antes (404)', routeMissing, true],
    ['outro 409', new ApiError('validation', 'x', 409, 'idempotency_key_reused'), false],
    [
      'o checkin_disabled com outro status',
      new ApiError('validation', 'x', 400, 'checkin_disabled'),
      false,
    ],
    ['a rede', network, false],
    ['a conta suspensa', suspended, false],
    ['um erro que não é da API', new Error('x'), false],
  ])('o check-in saiu do ar? %s', (_name, error, expected) => {
    expect(isCheckinUnavailable(error)).toBe(expected);
  });

  it.each<[string, unknown, string | null, string]>([
    ['a chave desligada', disabled, null, 'checkin.unavailable'],
    ['a api de antes', routeMissing, null, 'checkin.unavailable'],
    ['a rede', network, null, GENERIC],
    ['o servidor fora do ar', server, null, GENERIC],
    ['um erro que não é da API', new Error('x'), null, GENERIC],
    ['a conta suspensa', suspended, 'suspended', 'suspension.short'],
    ['o ritmo', rateLimited, 'rateLimited', 'errors.rateLimited'],
  ])('a frase: %s', (_name, error, type, key) => {
    expect(checkinRefusal(error)).toEqual({ type, key });
  });
});
