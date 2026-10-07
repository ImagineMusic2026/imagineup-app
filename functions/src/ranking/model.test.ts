import { describe, expect, it } from 'vitest';

import {
  ACHIEVEMENT_RANK_MAX,
  defaultAchievements,
  validateAchievementInput,
} from '../achievements/model';
import type { ClosedSeason } from '../points/config';
import type { SeasonInfo } from '../points/model';
import {
  CLOSE_GRACE_MS,
  closeDue,
  closeNowRefusal,
  decodeRankCursor,
  encodeRankCursor,
  endSeasonRefusal,
  nextSeasonRefusal,
  promoteNext,
  RANKING_JOB_PAGE,
  rankChange,
  rankTarget,
  rankUnlocks,
  seasonView,
  shownPoints,
  shownSeason,
  snapshotDue,
  targetRead,
  updateSeasonRefusal,
  type ShownSeason,
} from './model';

const DAY_MS = 24 * 60 * 60 * 1000;
// Quarta-feira, 7 de outubro de 2026, 15:00 de São Paulo (semana 2026-W41).
const NOW = Date.parse('2026-10-07T18:00:00.000Z');

const SJ: SeasonInfo = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: NOW - 18 * DAY_MS,
  endsAt: NOW + 12 * DAY_MS,
  leaderTitle: null,
  topTarget: 10,
  endedEarly: null,
};
const VERAO: SeasonInfo = {
  ...SJ,
  id: 'temporada-verao',
  name: 'Verão',
  startsAt: NOW + 20 * DAY_MS,
  endsAt: NOW + 50 * DAY_MS,
};
const CARNAVAL: ClosedSeason = {
  ...SJ,
  id: 'temporada-carnaval',
  name: 'Carnaval',
  startsAt: NOW - 70 * DAY_MS,
  endsAt: NOW - 40 * DAY_MS,
  closedAt: NOW - 40 * DAY_MS + 120_000,
};

const live = (season: SeasonInfo, status: 'active' | 'ended' = 'active'): ShownSeason => ({
  season,
  source: 'live',
  status,
});

describe('temporada mostrada (decisão 4 de 23.1)', () => {
  it.each([
    [
      'em andamento',
      { season: SJ, lastClosed: CARNAVAL },
      NOW,
      'temporada-sao-joao',
      'live',
      'active',
    ],
    [
      'encerrada esperando a virada, lida ao vivo',
      { season: { ...SJ, endsAt: NOW - 1 }, lastClosed: CARNAVAL },
      NOW,
      'temporada-sao-joao',
      'live',
      'ended',
    ],
    [
      'agendada, com a última fechada: a fechada, do arquivo',
      { season: VERAO, lastClosed: CARNAVAL },
      NOW,
      'temporada-carnaval',
      'archive',
      'ended',
    ],
    [
      'a agendada que já começou',
      { season: VERAO, lastClosed: CARNAVAL },
      VERAO.startsAt,
      'temporada-verao',
      'live',
      'active',
    ],
    [
      'só a última fechada',
      { season: null, lastClosed: CARNAVAL },
      NOW,
      'temporada-carnaval',
      'archive',
      'ended',
    ],
  ] as const)('%s', (_name, config, now, id, source, status) => {
    expect(shownSeason(config, now)).toMatchObject({ season: { id }, source, status });
  });

  it('agendada sem a última fechada, ou nada: nenhuma', () => {
    expect(shownSeason({ season: VERAO, lastClosed: null }, NOW)).toBeNull();
    expect(shownSeason({ season: null, lastClosed: null }, NOW)).toBeNull();
    expect(seasonView(null)).toBeNull();
  });

  it('a temporada do app, com as datas em ISO', () => {
    expect(seasonView(live(SJ))).toEqual({
      id: 'temporada-sao-joao',
      name: 'São João',
      startsAt: new Date(SJ.startsAt).toISOString(),
      endsAt: new Date(SJ.endsAt).toISOString(),
      status: 'active',
      leaderTitle: null,
    });
  });

  it('os pontos de um documento só contam na temporada mostrada', () => {
    expect(shownPoints({ seasonId: SJ.id, seasonPoints: 4_120 }, live(SJ))).toBe(4_120);
    expect(shownPoints({ seasonId: 'carnaval', seasonPoints: 4_120 }, live(SJ))).toBe(0);
    expect(shownPoints({ seasonId: SJ.id, seasonPoints: 4_120 }, null)).toBe(0);
  });
});

describe('cursor do ranking', () => {
  it('ida e volta, com o instante nulo inclusive', () => {
    const cursor = { points: 4_120, atMs: NOW, uid: 'Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd', position: 20 };
    expect(decodeRankCursor(encodeRankCursor(cursor))).toEqual(cursor);
    const nullAt = { ...cursor, atMs: null };
    expect(decodeRankCursor(encodeRankCursor(nullAt))).toEqual(nullAt);
  });

  it.each([
    ['pontos 0', [0, NOW, 'uid1', 1]],
    ['pontos fracionários', [1.5, NOW, 'uid1', 1]],
    ['instante acima do maior Timestamp', [10, 253_402_300_800_000, 'uid1', 1]],
    ['instante negativo', [10, -1, 'uid1', 1]],
    ['uid fora do formato', [10, NOW, 'uid/outro', 1]],
    ['posição 0', [10, NOW, 'uid1', 0]],
    ['posição fracionária', [10, NOW, 'uid1', 2.5]],
    ['faltando campo', [10, NOW, 'uid1']],
  ])('recusa %s', (_name, value) => {
    const text = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    expect(decodeRankCursor(text)).toBeNull();
  });

  it('recusa texto que não decodifica', () => {
    expect(decodeRankCursor('!!!')).toBeNull();
    expect(decodeRankCursor(Buffer.from('não é json').toString('base64url'))).toBeNull();
  });
});

describe('a seta da semana (23.5)', () => {
  const week = (w: string, position: number, seasonId = SJ.id) => ({ seasonId, week: w, position });

  it.each([
    ['retrato desta semana', week('2026-W41', 14), 12, 2],
    [
      'retrato da semana anterior (segunda antes da rodada, retrato que falhou)',
      week('2026-W40', 7),
      12,
      -5,
    ],
    ['retrato de duas semanas atrás não vale', week('2026-W39', 14), 12, 0],
    ['retrato de outra temporada não vale', week('2026-W41', 14, 'carnaval'), 12, 0],
    ['sem retrato', null, 12, 0],
  ] as const)('%s', (_name, rankWeek, position, change) => {
    expect(rankChange(rankWeek, position, live(SJ), NOW)).toBe(change);
  });

  it('temporada encerrada não tem seta', () => {
    expect(rankChange(week('2026-W41', 14), 12, live(SJ, 'ended'), NOW)).toBe(0);
    expect(rankChange(week('2026-W41', 14), 12, null, NOW)).toBe(0);
  });
});

describe('a meta do card "Você" (decisão 11)', () => {
  it.each([
    ['sem posição', null, 0, 10, false, null, null],
    ['no 1º lugar', 1, 9_140, 10, false, 7_902, null],
    ['encerrada', 12, 4_120, 10, true, 4_959, null],
    [
      'fora do top: a 10ª tem 4.959, faltam 840',
      12,
      4_120,
      10,
      false,
      4_959,
      { kind: 'top', position: 10, pointsLeft: 840 },
    ],
    [
      'dentro do top: o de cima mais 1',
      6,
      5_930,
      10,
      false,
      6_201,
      { kind: 'position', position: 5, pointsLeft: 272 },
    ],
    [
      'o 2º mira o 1º',
      2,
      7_902,
      10,
      false,
      9_140,
      { kind: 'position', position: 1, pointsLeft: 1_239 },
    ],
    [
      'top da temporada: 5',
      6,
      5_930,
      5,
      false,
      6_201,
      { kind: 'top', position: 5, pointsLeft: 272 },
    ],
    [
      'empate com o de cima: falta 1',
      7,
      5_000,
      10,
      false,
      5_000,
      { kind: 'position', position: 6, pointsLeft: 1 },
    ],
    [
      'nunca abaixo de 1',
      7,
      5_000,
      10,
      false,
      4_000,
      { kind: 'position', position: 6, pointsLeft: 1 },
    ],
    ['sem a linha lida', 7, 5_000, 10, false, null, null],
  ] as const)('%s', (_name, position, points, topTarget, ended, rowPoints, target) => {
    expect(rankTarget({ position, points, topTarget, ended, rowPoints })).toEqual(target);
  });

  it('que linha ler: a N-ésima fora do top, a de cima dentro, nenhuma no 1º', () => {
    expect(targetRead(11, 10, false)).toBe('top');
    expect(targetRead(10, 10, false)).toBe('above');
    expect(targetRead(2, 10, false)).toBe('above');
    expect(targetRead(1, 10, false)).toBeNull();
    expect(targetRead(12, 10, true)).toBeNull();
  });
});

describe('conquistas de posição (23.9)', () => {
  const catalog = defaultAchievements(NOW);

  it('alcança o Top 20 no 20º e não no 21º; quem já tem não ganha de novo', () => {
    expect(rankUnlocks(catalog, 20, {}).map((item) => item.id)).toEqual(['top-20']);
    expect(rankUnlocks(catalog, 21, {})).toEqual([]);
    expect(rankUnlocks(catalog, 1, { 'top-20': NOW })).toEqual([]);
  });

  it('a arquivada e a de outra regra não entram', () => {
    const archived = catalog.map((item) =>
      item.id === 'top-20' ? { ...item, status: 'archived' as const } : item,
    );
    expect(rankUnlocks(archived, 1, {})).toEqual([]);
  });

  it('o top de uma conquista cabe na primeira página do retrato, lida numa consulta só (23.5)', () => {
    expect(ACHIEVEMENT_RANK_MAX).toBeLessThanOrEqual(RANKING_JOB_PAGE);
    const input = { title: 'Top 200', icon: 'trophy', tone: 'points' };
    expect(
      validateAchievementInput({ ...input, rule: { type: 'rank', top: RANKING_JOB_PAGE } }).rule,
    ).toEqual({ type: 'rank', top: RANKING_JOB_PAGE });
    expect(() =>
      validateAchievementInput({ ...input, rule: { type: 'rank', top: RANKING_JOB_PAGE + 1 } }),
    ).toThrow();
  });
});

describe('virada e retrato: quando vencem', () => {
  it('a virada vence com o fim mais a folga', () => {
    expect(closeDue(null, NOW)).toBe(false);
    expect(closeDue({ ...SJ, endsAt: NOW }, NOW)).toBe(false);
    expect(closeDue({ ...SJ, endsAt: NOW - CLOSE_GRACE_MS + 1 }, NOW)).toBe(false);
    expect(closeDue({ ...SJ, endsAt: NOW - CLOSE_GRACE_MS }, NOW)).toBe(true);
  });

  it('o retrato vence na temporada ativa começada antes desta segunda e sem o trabalho feito', () => {
    const monday = Date.parse('2026-10-05T03:00:00.000Z');
    expect(snapshotDue(SJ, monday, false)).toBe(true);
    expect(snapshotDue(SJ, NOW, false)).toBe(true);
    expect(snapshotDue(SJ, NOW, true)).toBe(false);
    // Começou nesta semana: na primeira não há com o que comparar.
    expect(snapshotDue({ ...SJ, startsAt: monday }, NOW, false)).toBe(false);
    expect(snapshotDue({ ...SJ, startsAt: monday - 1 }, NOW, false)).toBe(true);
    // Encerrada, ou nenhuma.
    expect(snapshotDue({ ...SJ, endsAt: NOW - 1 }, NOW, false)).toBe(false);
    expect(snapshotDue(null, NOW, false)).toBe(false);
  });

  it('a próxima vencida enquanto esperava não é promovida; a começada é', () => {
    expect(promoteNext({ ...VERAO, endsAt: NOW }, NOW)).toEqual({
      season: null,
      expiredId: 'temporada-verao',
    });
    expect(promoteNext({ ...VERAO, startsAt: NOW - DAY_MS }, NOW).season?.id).toBe(
      'temporada-verao',
    );
    expect(promoteNext(null, NOW)).toEqual({ season: null, expiredId: null });
  });
});

describe('regras das callables da temporada (23.10)', () => {
  const state = (extra: Partial<Parameters<typeof updateSeasonRefusal>[0]> = {}) => ({
    current: SJ,
    next: null,
    lastClosed: CARNAVAL,
    ...extra,
  });

  describe('updateSeason', () => {
    it.each([
      ['a começada não sai', state(), null, 'season-started'],
      ['a começada não troca de id', state(), { ...SJ, id: 'outra' }, 'season-id-locked'],
      [
        'a começada não muda o início',
        state(),
        { ...SJ, startsAt: SJ.startsAt + 1 },
        'season-started',
      ],
      ['o fim no passado é o endSeason', state(), { ...SJ, endsAt: NOW - 1 }, 'season-end-in-past'],
      [
        'o fim depois do início da próxima',
        state({ next: VERAO }),
        { ...SJ, endsAt: VERAO.startsAt + 1 },
        'season-overlap',
      ],
      [
        'nome, fim e título mudam',
        state({ next: VERAO }),
        { ...SJ, name: 'Junina', endsAt: VERAO.startsAt },
        null,
      ],
      [
        'na encerrada, o fim não muda',
        state({ current: { ...SJ, endsAt: NOW - DAY_MS } }),
        { ...SJ, endsAt: NOW + DAY_MS },
        'season-ended',
      ],
      [
        'na encerrada, nome e título mudam',
        state({ current: { ...SJ, endsAt: NOW - DAY_MS } }),
        { ...SJ, endsAt: NOW - DAY_MS, name: 'Junina', leaderTitle: 'Rainha', topTarget: 5 },
        null,
      ],
      ['livre: sai sem próxima', state({ current: VERAO }), null, null],
      ['livre: não sai com a próxima', state({ current: null, next: VERAO }), null, 'has-next'],
      [
        'livre: o início antes do fim da última fechada',
        state({ current: null }),
        { ...VERAO, startsAt: CARNAVAL.endsAt - 1 },
        'season-overlap',
      ],
      [
        'livre: o fim no passado',
        state({ current: null }),
        { ...VERAO, startsAt: NOW - 3 * DAY_MS, endsAt: NOW - DAY_MS },
        'season-end-in-past',
      ],
      [
        'livre: nasce começando agora',
        state({ current: null }),
        { ...VERAO, startsAt: NOW - DAY_MS },
        null,
      ],
      [
        'livre: a agendada troca de id',
        state({ current: VERAO }),
        { ...VERAO, id: 'temporada-ferias' },
        null,
      ],
    ] as const)('%s', (_name, current, input, reason) => {
      expect(updateSeasonRefusal(current, input, NOW)).toBe(reason);
    });

    it('o id usado (conferido por quem chama) só vale para id novo numa atual livre', () => {
      expect(updateSeasonRefusal(state({ current: null }), VERAO, NOW, true)).toBe(
        'season-id-used',
      );
      expect(updateSeasonRefusal(state({ current: VERAO }), VERAO, NOW, true)).toBeNull();
    });
  });

  describe('scheduleNextSeason', () => {
    it.each([
      ['sem temporada atual', state({ current: null }), VERAO, false, 'no-season'],
      ['o id da atual', state(), { ...VERAO, id: SJ.id }, false, 'season-id-used'],
      ['id usado numa versão ou fechado', state(), VERAO, true, 'season-id-used'],
      [
        'vencida',
        state(),
        { ...VERAO, startsAt: NOW - 3 * DAY_MS, endsAt: NOW - DAY_MS },
        false,
        'season-end-in-past',
      ],
      [
        'antes do fim da atual',
        state(),
        { ...VERAO, startsAt: SJ.endsAt - 1 },
        false,
        'season-overlap',
      ],
      ['emendada no fim da atual', state(), { ...VERAO, startsAt: SJ.endsAt }, false, null],
      ['tirar a próxima vale sempre', state({ current: null }), null, false, null],
    ] as const)('%s', (_name, current, input, idUsed, reason) => {
      expect(nextSeasonRefusal(current, input, NOW, idUsed)).toBe(reason);
    });
  });

  it('endSeason: só a em andamento, pelo id da tela', () => {
    expect(endSeasonRefusal(state(), SJ.id, NOW)).toBeNull();
    expect(endSeasonRefusal(state(), 'outra', NOW)).toBe('season-not-active');
    expect(endSeasonRefusal(state({ current: null }), SJ.id, NOW)).toBe('season-not-active');
    expect(endSeasonRefusal(state({ current: VERAO }), VERAO.id, NOW)).toBe('season-not-active');
    expect(endSeasonRefusal(state({ current: { ...SJ, endsAt: NOW } }), SJ.id, NOW)).toBe(
      'season-not-active',
    );
  });

  it('closeSeasonNow: só a que venceu, com a folga', () => {
    expect(closeNowRefusal(state({ current: null }), SJ.id, NOW)).toBe('no-season');
    expect(closeNowRefusal(state(), 'outra', NOW)).toBe('no-season');
    expect(closeNowRefusal(state(), SJ.id, NOW)).toBe('season-not-due');
    const ended = state({ current: { ...SJ, endsAt: NOW - CLOSE_GRACE_MS } });
    expect(closeNowRefusal(ended, SJ.id, NOW)).toBeNull();
  });
});
