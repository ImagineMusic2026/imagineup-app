import { describe, expect, it, vi } from 'vitest';

import { ConfigValidationError } from '../config-validation';
import { dayKey, shiftDay } from '../day';
import {
  CHECKIN_CYCLE_DAYS,
  CHECKIN_VALUE_MAX,
  CHECKIN_VALUE_MIN,
  CheckinError,
  checkinView,
  DEFAULT_CHECKIN_CONFIG,
  effectiveStreak,
  EMPTY_CHECKIN_RECORD,
  parseCheckinConfig,
  parseCheckinRecord,
  planCheckin,
  validateCheckinInput,
  type CheckinConfig,
  type CheckinRecord,
} from './model';

// Terça-feira, 10 de novembro de 2026, meio-dia em São Paulo.
const NOW = Date.parse('2026-11-10T15:00:00.000Z');
const TODAY = '2026-11-10';
const YESTERDAY = '2026-11-09';
const CYCLE = DEFAULT_CHECKIN_CONFIG.cycle;
const ON: CheckinConfig = { enabled: true, cycle: [...CYCLE] };

const record = (streak: number, lastDay: string | null, best = streak): CheckinRecord => ({
  streak,
  best,
  lastDay,
});

function spyLog() {
  return { warn: vi.fn(), error: vi.fn() };
}

/** O campo da recusa estrita. */
function fieldOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigValidationError) return error.field;
    throw error;
  }
  return undefined;
}

describe('o padrão do código', () => {
  it('a chave nasce desligada, com o ciclo de 7 dias 3, 3, 4, 4, 5, 6 e 15', () => {
    expect(DEFAULT_CHECKIN_CONFIG).toEqual({ enabled: false, cycle: [3, 3, 4, 4, 5, 6, 15] });
    expect(DEFAULT_CHECKIN_CONFIG.cycle).toHaveLength(CHECKIN_CYCLE_DAYS);
    expect([CHECKIN_VALUE_MIN, CHECKIN_VALUE_MAX]).toEqual([1, 999]);
    expect(EMPTY_CHECKIN_RECORD).toEqual({ streak: 0, best: 0, lastDay: null });
  });

  it('a recusa do check-in desligado leva o motivo e a mensagem do 409', () => {
    const error = new CheckinError('checkin_disabled');
    expect(error).toMatchObject({
      name: 'CheckinError',
      reason: 'checkin_disabled',
      message: 'O check-in diário não está disponível agora.',
      details: undefined,
    });
  });
});

describe('leitura tolerante da configuração (config/points.checkin)', () => {
  it('sem o bloco vale o padrão, em silêncio, e cada leitura devolve uma cópia', () => {
    const log = spyLog();
    const first = parseCheckinConfig(undefined, log);
    expect(first).toEqual(DEFAULT_CHECKIN_CONFIG);
    expect(first).not.toBe(DEFAULT_CHECKIN_CONFIG);
    expect(first.cycle).not.toBe(DEFAULT_CHECKIN_CONFIG.cycle);
    // Mexer no que foi lido não mexe no padrão do código nem na leitura seguinte.
    first.cycle[0] = 999;
    first.enabled = true;
    expect(parseCheckinConfig(undefined)).toEqual({
      enabled: false,
      cycle: [3, 3, 4, 4, 5, 6, 15],
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([[null], ['ligado'], [7], [true], [[1, 2, 3]]])(
    'o bloco fora do formato (%j) vale o padrão, com a chave desligada',
    (value) => {
      const log = spyLog();
      expect(parseCheckinConfig(value, log)).toEqual(DEFAULT_CHECKIN_CONFIG);
      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    [true, true],
    [false, false],
    ['true', false],
    [1, false],
    [null, false],
    [undefined, false],
  ])('a chave %j liga? %s (só o true liga)', (enabled, expected) => {
    expect(parseCheckinConfig({ enabled }).enabled).toBe(expected);
  });

  it('o ciclo salvo vale inteiro, numa cópia; o 0 passa na leitura (o seed usa o ciclo zerado)', () => {
    const saved = { enabled: true, cycle: [1, 2, 3, 4, 5, 6, 999] };
    const config = parseCheckinConfig(saved, spyLog());
    expect(config).toEqual(saved);
    expect(config.cycle).not.toBe(saved.cycle);
    const log = spyLog();
    expect(parseCheckinConfig({ cycle: [0, 0, 0, 0, 0, 0, 0] }, log)).toEqual({
      enabled: false,
      cycle: [0, 0, 0, 0, 0, 0, 0],
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([
    ['6 valores', [3, 3, 4, 4, 5, 6]],
    ['8 valores', [3, 3, 4, 4, 5, 6, 15, 20]],
    ['um negativo', [3, 3, 4, -1, 5, 6, 15]],
    ['acima do teto de 999', [3, 3, 4, 4, 5, 6, 1_000]],
    ['no teto da régua, que não é o do check-in', [3, 3, 4, 4, 5, 6, 10_000]],
    ['um quebrado', [3, 3, 4, 4.5, 5, 6, 15]],
    ['um texto', [3, '3', 4, 4, 5, 6, 15]],
    ['um null', [3, 3, null, 4, 5, 6, 15]],
    ['não é lista', '3,3,4,4,5,6,15'],
    ['null', null],
  ])(
    'ciclo inválido (%s) volta inteiro ao padrão, com erro no log, e a chave lida fica',
    (_, cycle) => {
      const log = spyLog();
      expect(parseCheckinConfig({ enabled: true, cycle }, log)).toEqual({
        enabled: true,
        cycle: [3, 3, 4, 4, 5, 6, 15],
      });
      expect(log.error).toHaveBeenCalledOnce();
      expect(log.warn).not.toHaveBeenCalled();
    },
  );

  it('chave desconhecida é ignorada, com aviso', () => {
    const log = spyLog();
    const config = parseCheckinConfig(
      { enabled: true, bonus: 50, cycle: [1, 1, 1, 1, 1, 1, 1] },
      log,
    );
    expect(config).toEqual({ enabled: true, cycle: [1, 1, 1, 1, 1, 1, 1] });
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), { key: 'bonus' });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('sem o log, a leitura tolerante não lança', () => {
    expect(parseCheckinConfig({ cycle: 'x', outro: 1 })).toEqual(DEFAULT_CHECKIN_CONFIG);
  });
});

describe('gravação estrita do painel (validateCheckinInput)', () => {
  it('aceita só a chave, só o ciclo ou os dois, e devolve só o que veio (o ciclo, numa cópia)', () => {
    expect(validateCheckinInput({ enabled: true })).toEqual({ enabled: true });
    expect(validateCheckinInput({ enabled: false })).toEqual({ enabled: false });
    const cycle = [1, 2, 3, 4, 5, 6, 999];
    const onlyCycle = validateCheckinInput({ cycle });
    expect(onlyCycle).toEqual({ cycle });
    expect(onlyCycle.cycle).not.toBe(cycle);
    expect('enabled' in onlyCycle).toBe(false);
    expect(validateCheckinInput({ enabled: true, cycle })).toEqual({ enabled: true, cycle });
  });

  it.each([
    [null, 'checkin'],
    ['ligado', 'checkin'],
    [[true], 'checkin'],
    [{}, 'checkin'],
    [{ bonus: 50 }, 'checkin'],
    [{ enabled: true, bonus: 50 }, 'checkin'],
    [{ enabled: 'sim' }, 'checkin.enabled'],
    [{ enabled: 1 }, 'checkin.enabled'],
    [{ enabled: null }, 'checkin.enabled'],
    [{ cycle: '3,3,4,4,5,6,15' }, 'checkin.cycle'],
    [{ cycle: [3, 3, 4, 4, 5, 6] }, 'checkin.cycle'],
    [{ cycle: [3, 3, 4, 4, 5, 6, 15, 20] }, 'checkin.cycle'],
    [{ cycle: [] }, 'checkin.cycle'],
    // O 0 é recusado na gravação: quem desliga o check-in é a chave.
    [{ cycle: [0, 3, 4, 4, 5, 6, 15] }, 'checkin.cycle.0'],
    [{ cycle: [3, '3', 4, 4, 5, 6, 15] }, 'checkin.cycle.1'],
    [{ cycle: [3, 3, 4, 4.5, 5, 6, 15] }, 'checkin.cycle.3'],
    [{ cycle: [3, 3, 4, 4, -5, 6, 15] }, 'checkin.cycle.4'],
    // O teto é 999: quatro dígitos não cabem na trilha do app.
    [{ cycle: [3, 3, 4, 4, 5, 6, 1_000] }, 'checkin.cycle.6'],
    [{ cycle: [10_000, 3, 4, 4, 5, 6, 15] }, 'checkin.cycle.0'],
    // O primeiro errado é o que volta.
    [{ cycle: [3, 0, 4, 4, 5, 6, 0] }, 'checkin.cycle.1'],
    // A chave errada vem antes do ciclo errado.
    [{ enabled: 'sim', cycle: [0] }, 'checkin.enabled'],
  ])('recusa %j em %s', (input, field) => {
    expect(fieldOf(() => validateCheckinInput(input))).toBe(field);
  });
});

describe('leitura tolerante do estado do fã (wallets/{uid}.checkin)', () => {
  it.each([[undefined], [null], ['4'], [4], [[4, 4, YESTERDAY]], [{}]])(
    'sem o campo ou fora do formato (%j): o estado vazio, numa cópia',
    (value) => {
      const parsed = parseCheckinRecord(value);
      expect(parsed).toEqual({ streak: 0, best: 0, lastDay: null });
      expect(parsed).not.toBe(EMPTY_CHECKIN_RECORD);
    },
  );

  it('o estado gravado volta como está, sem as chaves a mais', () => {
    expect(parseCheckinRecord({ streak: 4, best: 9, lastDay: YESTERDAY, outro: true })).toEqual({
      streak: 4,
      best: 9,
      lastDay: YESTERDAY,
    });
  });

  it('a melhor sequência nunca fica menor que a de agora', () => {
    expect(parseCheckinRecord({ streak: 5, best: 2, lastDay: TODAY })).toEqual({
      streak: 5,
      best: 5,
      lastDay: TODAY,
    });
  });

  it.each([
    ['sequência negativa', { streak: -1, best: 3, lastDay: TODAY }],
    ['sequência quebrada', { streak: 2.5, best: 3, lastDay: TODAY }],
    ['sequência em texto', { streak: '4', best: 4, lastDay: TODAY }],
    ['sem a melhor', { streak: 4, lastDay: TODAY }],
    ['melhor negativa', { streak: 4, best: -4, lastDay: TODAY }],
    ['dia em outro formato', { streak: 4, best: 4, lastDay: '10/11/2026' }],
    ['dia em número', { streak: 4, best: 4, lastDay: 20261110 }],
    ['sem o dia', { streak: 4, best: 4 }],
  ])('%s: o estado vazio', (_, value) => {
    expect(parseCheckinRecord(value)).toEqual(EMPTY_CHECKIN_RECORD);
  });

  it.each([
    [{ streak: 0, best: 0, lastDay: null }],
    [{ streak: 0, best: 4, lastDay: TODAY }],
    [{ streak: 0, best: 30, lastDay: null }],
  ])('os zeros e o dia null são valores do formato: %j volta como está', (value) => {
    expect(parseCheckinRecord(value)).toEqual(value);
  });
});

describe('a sequência que está viva (effectiveStreak)', () => {
  it.each([
    ['nunca fez', record(0, null), TODAY, 0],
    ['fez hoje', record(5, TODAY), TODAY, 5],
    ['fez ontem: o de hoje ainda pode ser feito', record(4, YESTERDAY), TODAY, 4],
    ['perdeu um dia', record(4, '2026-11-08'), TODAY, 0],
    ['parou há um mês', record(40, '2026-10-10'), TODAY, 0],
    ['o último dia é posterior (o relógio fora de ordem)', record(5, '2026-11-11'), TODAY, 5],
    ['ontem na virada do mês', record(3, '2026-10-31'), '2026-11-01', 3],
    ['ontem na virada do ano', record(3, '2026-12-31'), '2027-01-01', 3],
    ['ontem no fim de fevereiro', record(3, '2026-02-28'), '2026-03-01', 3],
    // 2028 é bissexto: 29 de fevereiro existe, e é a véspera de 1º de março.
    ['hoje é 29 de fevereiro: ontem foi o dia 28', record(3, '2028-02-28'), '2028-02-29', 3],
    ['ontem foi 29 de fevereiro', record(3, '2028-02-29'), '2028-03-01', 3],
    [
      'em ano bissexto, 28 de fevereiro é anteontem de 1º de março',
      record(3, '2028-02-28'),
      '2028-03-01',
      0,
    ],
    // 2100 não é bissexto (divide por 100 e não por 400): fevereiro acaba no dia 28.
    ['ontem no fim de fevereiro de 2100', record(3, '2100-02-28'), '2100-03-01', 3],
    ['anteontem na virada do mês', record(3, '2026-10-30'), '2026-11-01', 0],
  ])('%s', (_, state, today, expected) => {
    expect(effectiveStreak(state, today)).toBe(expected);
  });
});

describe('o check-in do dia (planCheckin)', () => {
  it.each([
    ['o primeiro da vida', record(0, null), 'checked', record(1, TODAY), 1, 3],
    ['fez ontem: a sequência anda', record(4, YESTERDAY), 'checked', record(5, TODAY), 5, 5],
    [
      'perdeu um dia: volta ao dia 1',
      record(4, '2026-11-08'),
      'checked',
      record(1, TODAY, 4),
      1,
      3,
    ],
    ['já fez hoje: nada muda', record(5, TODAY), 'already', record(5, TODAY), 5, 0],
    [
      'o último dia é posterior: nada muda',
      record(5, '2026-11-11'),
      'already',
      record(5, '2026-11-11'),
      5,
      0,
    ],
    [
      'do dia 6 para o 7: o maior valor do ciclo',
      record(6, YESTERDAY),
      'checked',
      record(7, TODAY),
      7,
      15,
    ],
    [
      'do dia 7 para o 8: o ciclo recomeça e a sequência segue',
      record(7, YESTERDAY),
      'checked',
      record(8, TODAY),
      1,
      3,
    ],
    [
      'do dia 13 para o 14: de novo o 7º do ciclo',
      record(13, YESTERDAY),
      'checked',
      record(14, TODAY),
      7,
      15,
    ],
    [
      'do dia 14 para o 15: o ciclo recomeça outra vez',
      record(14, YESTERDAY),
      'checked',
      record(15, TODAY),
      1,
      3,
    ],
    [
      'a melhor fica quando a sequência recomeçou',
      record(2, YESTERDAY, 30),
      'checked',
      record(3, TODAY, 30),
      3,
      4,
    ],
    [
      'a melhor cresce com a sequência',
      record(30, YESTERDAY, 30),
      'checked',
      record(31, TODAY),
      3,
      4,
    ],
    [
      'já fez hoje no dia 14: o lugar é o da sequência guardada',
      record(14, TODAY),
      'already',
      record(14, TODAY),
      7,
      0,
    ],
    // O servidor nunca grava o dia com a sequência 0; se vier assim, o lugar no ciclo não vira 0.
    [
      'a sequência 0 com o dia de ontem entra no dia 1',
      record(0, YESTERDAY),
      'checked',
      record(1, TODAY),
      1,
      3,
    ],
    [
      'a sequência 0 com o dia de hoje não muda, no lugar 1',
      record(0, TODAY),
      'already',
      record(0, TODAY),
      1,
      0,
    ],
  ] as const)('%s', (_, state, status, next, cycleDay, points) => {
    expect(planCheckin(state, TODAY, CYCLE)).toEqual({ status, next, cycleDay, points });
  });

  it('ontem é o dia de calendário anterior, também na virada do mês e do ano', () => {
    expect(planCheckin(record(9, '2026-10-31'), '2026-11-01', CYCLE).next.streak).toBe(10);
    expect(planCheckin(record(9, '2026-12-31'), '2027-01-01', CYCLE).next.streak).toBe(10);
    expect(planCheckin(record(9, '2026-10-30'), '2026-11-01', CYCLE).next.streak).toBe(1);
  });

  it.each([
    // 2028 é bissexto: o dia 29 entra na sequência e é a véspera de 1º de março.
    ['o check-in de 29 de fevereiro segue o do dia 28', record(9, '2028-02-28'), '2028-02-29', 10],
    ['o de 1º de março segue o de 29 de fevereiro', record(10, '2028-02-29'), '2028-03-01', 11],
    ['quem pulou o dia 29 volta ao dia 1', record(9, '2028-02-28'), '2028-03-01', 1],
    // 2100 não é bissexto: de 28 de fevereiro para 1º de março é um dia só.
    ['em 2100, o de 1º de março segue o do dia 28', record(9, '2100-02-28'), '2100-03-01', 10],
  ])('o fim de fevereiro: %s', (_, state, today, streak) => {
    const plan = planCheckin(state, today, CYCLE);
    expect(plan.status).toBe('checked');
    expect(plan.next).toEqual(record(streak, today, Math.max(state.best, streak)));
  });

  it('o ciclo zerado (o do seed) dá 0 ponto e o check-in vale: a sequência anda', () => {
    const zero = [0, 0, 0, 0, 0, 0, 0];
    expect(planCheckin(record(3, YESTERDAY), TODAY, zero)).toEqual({
      status: 'checked',
      next: record(4, TODAY),
      cycleDay: 4,
      points: 0,
    });
  });

  it('não muda o estado lido, nem no check-in que já estava feito', () => {
    const pending = record(4, YESTERDAY);
    planCheckin(pending, TODAY, CYCLE);
    expect(pending).toEqual(record(4, YESTERDAY));
    const done = record(5, TODAY);
    const plan = planCheckin(done, TODAY, CYCLE);
    expect(plan.next).toEqual(done);
    expect(plan.next).not.toBe(done);
  });

  it('15 dias seguidos: o ciclo dá duas voltas e paga 83 pontos, sem bônus de marco', () => {
    let state = record(0, null);
    const days: number[] = [];
    let total = 0;
    for (let index = 0; index < 15; index += 1) {
      const plan = planCheckin(state, shiftDay('2026-11-01', index), CYCLE);
      expect(plan.status).toBe('checked');
      days.push(plan.cycleDay);
      total += plan.points;
      state = plan.next;
    }
    expect(days).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1]);
    expect(total).toBe(40 + 40 + 3);
    expect(state).toEqual({ streak: 15, best: 15, lastDay: '2026-11-15' });
  });
});

describe('o estado que as rotas respondem (checkinView)', () => {
  const RESETS_AT = '2026-11-11T03:00:00.000Z';
  const OFF_STATE = {
    enabled: false,
    checkedInToday: false,
    streak: 0,
    best: 0,
    cycle: [],
    cycleDay: 0,
    todayPoints: 0,
    resetsAt: RESETS_AT,
  };

  it('o relógio do teste: meio-dia de 10/11/2026 em São Paulo', () => {
    expect(dayKey(NOW)).toBe(TODAY);
    expect(shiftDay(TODAY, -1)).toBe(YESTERDAY);
  });

  it.each([
    ['sem estado', null],
    ['com uma sequência guardada', record(12, TODAY, 40)],
  ])('chave desligada, %s: tudo zerado, o ciclo vazio e só o resetsAt', (_, state) => {
    expect(checkinView(state, { enabled: false, cycle: [...CYCLE] }, NOW)).toEqual(OFF_STATE);
  });

  it.each([
    ['nunca fez (sem estado)', null, false, 0, 0, 1, 3],
    ['nunca fez (estado vazio)', record(0, null), false, 0, 0, 1, 3],
    ['por fazer: fez ontem o 4º dia', record(4, YESTERDAY), false, 4, 4, 5, 5],
    ['feito hoje: o 5º dia', record(5, TODAY), true, 5, 5, 5, 5],
    [
      'perdeu um dia: a sequência some e a melhor fica',
      record(4, '2026-11-08', 9),
      false,
      0,
      9,
      1,
      3,
    ],
    ['por fazer o 7º dia', record(6, YESTERDAY), false, 6, 6, 7, 15],
    ['feito hoje o 7º dia', record(7, TODAY), true, 7, 7, 7, 15],
    ['por fazer o 8º: o ciclo recomeça', record(7, YESTERDAY), false, 7, 7, 1, 3],
    ['feito hoje o 8º', record(8, TODAY), true, 8, 8, 1, 3],
    ['o último dia é posterior: conta como feito', record(5, '2026-11-11'), true, 5, 5, 5, 5],
    [
      'a sequência 0 com o dia de hoje: feito, no lugar 1 do ciclo',
      record(0, TODAY),
      true,
      0,
      0,
      1,
      3,
    ],
  ] as const)(
    'chave ligada, %s',
    (_, state, checkedInToday, streak, best, cycleDay, todayPoints) => {
      expect(checkinView(state, ON, NOW)).toEqual({
        enabled: true,
        checkedInToday,
        streak,
        best,
        cycle: [3, 3, 4, 4, 5, 6, 15],
        cycleDay,
        todayPoints,
        resetsAt: RESETS_AT,
      });
    },
  );

  it('o valor de hoje é o do ciclo de agora (o painel mudou o ciclo depois do check-in)', () => {
    const view = checkinView(
      record(5, TODAY),
      { enabled: true, cycle: [1, 1, 1, 1, 9, 1, 1] },
      NOW,
    );
    expect(view).toMatchObject({ cycleDay: 5, todayPoints: 9, cycle: [1, 1, 1, 1, 9, 1, 1] });
  });

  it('meia-noite em São Paulo (03:00Z): o feito de ontem vira por fazer e o prazo anda um dia', () => {
    const state = record(5, TODAY);
    const before = checkinView(state, ON, Date.parse('2026-11-11T02:59:59.999Z'));
    expect(before).toMatchObject({
      checkedInToday: true,
      streak: 5,
      cycleDay: 5,
      resetsAt: '2026-11-11T03:00:00.000Z',
    });
    const after = checkinView(state, ON, Date.parse('2026-11-11T03:00:00.000Z'));
    expect(after).toMatchObject({
      checkedInToday: false,
      streak: 5,
      cycleDay: 6,
      todayPoints: 6,
      resetsAt: '2026-11-12T03:00:00.000Z',
    });
    // Um dia inteiro sem check-in: na meia-noite seguinte a sequência some.
    const lost = checkinView(state, ON, Date.parse('2026-11-12T03:00:00.000Z'));
    expect(lost).toMatchObject({ checkedInToday: false, streak: 0, best: 5, cycleDay: 1 });
  });

  it('nenhuma chave some nem vem undefined, e o corpo é JSON puro (a chave de idempotência guarda)', () => {
    const keys = [
      'best',
      'checkedInToday',
      'cycle',
      'cycleDay',
      'enabled',
      'resetsAt',
      'streak',
      'todayPoints',
    ];
    for (const config of [ON, DEFAULT_CHECKIN_CONFIG]) {
      for (const state of [null, record(0, null), record(4, YESTERDAY), record(5, TODAY)]) {
        const view = checkinView(state, config, NOW);
        expect(Object.keys(view).sort()).toEqual(keys);
        expect(Object.values(view).every((value) => value !== undefined)).toBe(true);
        expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      }
    }
  });

  it('o ciclo da resposta é uma cópia: mexer nela não mexe na configuração', () => {
    const config: CheckinConfig = { enabled: true, cycle: [...CYCLE] };
    const view = checkinView(null, config, NOW);
    view.cycle[0] = 999;
    expect(config.cycle).toEqual([3, 3, 4, 4, 5, 6, 15]);
  });
});
