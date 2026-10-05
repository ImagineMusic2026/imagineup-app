import { describe, expect, it } from 'vitest';

import { DEFAULT_POINTS_CONFIG } from './config';
import {
  activityMarks,
  computeAwards,
  dayKey,
  emptyCentral,
  emptyWallet,
  levelForXp,
  monthKey,
  nextDayStart,
  PointsError,
  seasonsPlayed,
  shiftDay,
  trimDays,
  weekEarned,
  weekKey,
  type ActivityMarks,
  type AwardEntry,
  type CentralState,
  type ComputeInput,
  type FanInput,
  type PointsConfig,
  type SeasonInfo,
  type WalletState,
} from './model';

const DAY_MS = 24 * 60 * 60 * 1000;
// Segunda-feira, meio-dia em São Paulo.
const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const SEASON: SeasonInfo = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: NOW - 18 * DAY_MS,
  endsAt: NOW + 12 * DAY_MS,
  leaderTitle: null,
};
const FAN = { type: 'fan', uid: 'fa', name: null } as const;

function wallet(extra: Partial<WalletState> = {}): WalletState {
  return { ...emptyWallet(), exists: true, ...extra };
}

function fan(extra: Partial<FanInput> = {}): FanInput {
  return {
    uid: 'fa',
    hasProfile: true,
    wallet: emptyWallet(),
    entries: [],
    existingLedger: new Set(),
    centrals: new Map(),
    activity: null,
    ...extra,
  };
}

function compute(
  fans: FanInput[],
  extra: Partial<Omit<ComputeInput, 'fans'>> = {},
): ReturnType<typeof computeAwards> {
  return computeAwards({
    now: NOW,
    config: DEFAULT_POINTS_CONFIG,
    season: SEASON,
    actor: FAN,
    callerUid: fans[0]?.uid ?? null,
    fans,
    ...extra,
  });
}

const comment = (id: string, artistId?: string): AwardEntry => ({
  kind: 'earn',
  source: 'comment',
  eventId: id,
  ...(artistId ? { artistId } : {}),
});

const noActivity: ActivityMarks = {
  day: '2026-10-05',
  week: '2026-W41',
  month: '2026-10',
  newDay: false,
  newWeek: false,
  newMonth: false,
  cohort: null,
};

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

  it('perto da meia-noite, o mesmo instante dá o dia, a semana e o mês de São Paulo', () => {
    const marks = activityMarks(
      { lastDay: null, lastWeek: null, lastMonth: null },
      Date.parse('2026-10-01T02:30:00.000Z'),
      null,
    );
    expect(marks).toMatchObject({ day: '2026-09-30', week: '2026-W40', month: '2026-09' });
  });

  it.each([
    ['2026-10-05T15:00:00.000Z', '2026-10-06T03:00:00.000Z'],
    ['2026-10-06T02:59:59.999Z', '2026-10-06T03:00:00.000Z'],
    ['2026-10-06T03:00:00.000Z', '2026-10-07T03:00:00.000Z'],
    ['2026-12-31T23:00:00.000Z', '2027-01-01T03:00:00.000Z'],
  ])('o dia de São Paulo seguinte a %s começa em %s', (iso, next) => {
    expect(new Date(nextDayStart(Date.parse(iso))).toISOString()).toBe(next);
  });
});

describe('nível pela régua', () => {
  it.each([
    [0, 1, 2],
    [599, 1, 2],
    [600, 2, 3],
    [12_480, 7, 8],
    [40_000, 10, null],
  ])('%i de XP é o nível %i (próximo %s)', (xp, level, next) => {
    const result = levelForXp(xp, DEFAULT_POINTS_CONFIG.levels);
    expect(result.level.number).toBe(level);
    expect(result.nextLevel?.number ?? null).toBe(next);
  });

  it('12.480 é Purainha, e o Xodó vem aos 15.000', () => {
    expect(levelForXp(12_480, DEFAULT_POINTS_CONFIG.levels)).toEqual({
      level: { number: 7, name: 'Purainha', minXp: 7_000 },
      nextLevel: { number: 8, name: 'Xodó', minXp: 15_000 },
    });
  });
});

describe('semana e temporadas', () => {
  it('soma hoje e os 6 dias anteriores, sem o 7º dia para trás nem o dia seguinte', () => {
    const days = {
      '2026-09-28': { earned: 1_000, count: {} },
      '2026-09-29': { earned: 200, count: {} },
      '2026-10-03': { earned: 240, count: {} },
      '2026-10-05': { earned: 400, count: {} },
      '2026-10-06': { earned: 7, count: {} },
    };
    expect(weekEarned(days, NOW)).toBe(840);
  });

  it('temporadas jogadas: as passadas e a dos pontos guardados, se tem ponto', () => {
    expect(seasonsPlayed({ pastSeasons: 2, seasonPoints: 4_120 })).toBe(3);
    expect(seasonsPlayed({ pastSeasons: 2, seasonPoints: 0 })).toBe(2);
  });

  it('o corte dos dias tira só os anteriores a hoje menos 6; o dia seguinte fica', () => {
    const days = {
      '2026-09-28': { earned: 1, count: {} },
      '2026-09-29': { earned: 2, count: {} },
      '2026-10-06': { earned: 3, count: {} },
    };
    expect(Object.keys(trimDays(days, '2026-10-05')).sort()).toEqual(['2026-09-29', '2026-10-06']);
  });
});

describe('ganho', () => {
  it('comentar soma no saldo, no XP, na temporada, na central e no dia', () => {
    const out = compute([fan({ entries: [comment('c1', 'nettobrito')] })]);
    expect(out.results).toEqual([
      { uid: 'fa', entryId: 'comment:c1', status: 'applied', points: 2 },
    ]);
    expect(out.pointsAwarded).toBe(2);
    const plan = out.fans[0]!;
    expect(plan.wallet).toMatchObject({
      create: true,
      state: {
        balance: 2,
        xp: 2,
        earnedTotal: 2,
        seasonId: SEASON.id,
        seasonPoints: 2,
        seasonPointsAt: NOW,
        days: { '2026-10-05': { earned: 2, count: { comment: 1 } } },
      },
    });
    expect(plan.centrals).toEqual([
      {
        create: true,
        state: {
          exists: true,
          artistId: 'nettobrito',
          seasonId: SEASON.id,
          seasonPoints: 2,
          seasonPointsAt: NOW,
          totalPoints: 2,
        },
      },
    ]);
    expect(plan.ledger[0]).toMatchObject({
      id: 'comment:c1',
      data: {
        kind: 'earn',
        source: 'comment',
        points: 2,
        xpDelta: 2,
        seasonDelta: 2,
        centralSeasonDelta: 2,
        centralTotalDelta: 2,
        seasonId: SEASON.id,
        balanceAfter: 2,
        xpAfter: 2,
        seasonPointsAfter: 2,
        configVersion: 0,
        day: '2026-10-05',
        createdAt: NOW,
      },
    });
  });

  it('o mesmo evento não paga duas vezes, nem no mesmo pedido', () => {
    const repeated = compute([fan({ entries: [comment('c1'), comment('c1')] })]);
    expect(repeated.results.map((r) => r.status)).toEqual(['applied', 'duplicate']);
    const paid = compute([
      fan({ entries: [comment('c1')], existingLedger: new Set(['comment:c1']) }),
    ]);
    expect(paid.results[0]!.status).toBe('duplicate');
    expect(paid.fans[0]!.wallet).toBeNull();
  });

  it('valor zero e valor ausente na configuração rendem zero, sem gravar', () => {
    const like = compute([fan({ entries: [{ kind: 'earn', source: 'like', eventId: 'p1' }] })]);
    expect(like.results[0]!.status).toBe('zero');
    const broken = {
      ...DEFAULT_POINTS_CONFIG,
      values: {} as PointsConfig['values'],
    };
    const missing = compute([fan({ entries: [comment('c1')] })], { config: broken });
    expect(missing.results[0]!.status).toBe('zero');
    expect(missing.fans[0]!.wallet).toBeNull();
    expect(missing.shard).toBeNull();
  });

  it('missão leva os pontos dela e não tem limite por padrão', () => {
    const out = compute([
      fan({
        entries: [{ kind: 'earn', source: 'mission', eventId: 'm:2026-W41', points: 20 }],
        wallet: wallet({ days: { '2026-10-05': { earned: 0, count: { mission: 900 } } } }),
      }),
    ]);
    expect(out.results[0]).toMatchObject({ status: 'applied', points: 20 });
  });

  it('o limite do dia corta, e o dia seguinte paga de novo', () => {
    const full = wallet({ days: { '2026-10-05': { earned: 40, count: { comment: 20 } } } });
    const capped = compute([fan({ wallet: full, entries: [comment('c21')] })]);
    expect(capped.results[0]!.status).toBe('capped');
    expect(capped.fans[0]!.wallet).toBeNull();

    // Às 03:00 UTC do dia 6 já é o dia 6 em São Paulo.
    const tomorrow = compute([fan({ wallet: full, entries: [comment('c21')] })], {
      now: Date.parse('2026-10-06T03:00:00.000Z'),
    });
    expect(tomorrow.results[0]!.status).toBe('applied');
    expect(tomorrow.fans[0]!.wallet!.state.days['2026-10-06']).toEqual({
      earned: 2,
      count: { comment: 1 },
    });
  });

  it('fora da janela da temporada, o ponto entra no saldo e no total da central, não na temporada', () => {
    const out = compute([fan({ entries: [comment('c1', 'nenho')] })], {
      season: { ...SEASON, endsAt: NOW },
    });
    const state = out.fans[0]!.wallet!.state;
    expect(state).toMatchObject({ balance: 2, xp: 2, seasonPoints: 0, seasonId: null });
    expect(out.fans[0]!.centrals[0]!.state).toMatchObject({ seasonPoints: 0, totalPoints: 2 });
    expect(out.fans[0]!.ledger[0]!.data).toMatchObject({
      seasonDelta: 0,
      centralSeasonDelta: 0,
      centralTotalDelta: 2,
      seasonId: null,
    });
  });

  it('a temporada nova zera os pontos da anterior e conta uma temporada passada', () => {
    const old = wallet({ seasonId: 'carnaval', seasonPoints: 500, seasonPointsAt: NOW - DAY_MS });
    const central: CentralState = {
      ...emptyCentral('nenho'),
      exists: true,
      seasonId: 'carnaval',
      seasonPoints: 300,
      seasonPointsAt: NOW - DAY_MS,
      totalPoints: 300,
    };
    const out = compute([
      fan({
        wallet: old,
        entries: [comment('c1', 'nenho')],
        centrals: new Map([['nenho', central]]),
      }),
    ]);
    expect(out.fans[0]!.wallet!.state).toMatchObject({
      seasonId: SEASON.id,
      seasonPoints: 2,
      pastSeasons: 1,
    });
    expect(out.fans[0]!.centrals[0]).toMatchObject({
      create: false,
      state: { seasonId: SEASON.id, seasonPoints: 2, totalPoints: 302 },
    });
  });

  it('carteira na temporada sem pontos troca sem contar temporada passada', () => {
    const empty = wallet({ seasonId: 'carnaval', seasonPoints: 0 });
    const out = compute([fan({ wallet: empty, entries: [comment('c1')] })]);
    expect(out.fans[0]!.wallet!.state.pastSeasons).toBe(0);
  });

  it('outro fã sem perfil sai skipped, sem gravar; quem chama recebe', () => {
    const out = compute([
      fan({ uid: 'convidado', entries: [comment('c1')] }),
      fan({ uid: 'excluido', hasProfile: false, entries: [comment('c2')] }),
    ]);
    expect(out.results.map((r) => [r.uid, r.status])).toEqual([
      ['convidado', 'applied'],
      ['excluido', 'skipped'],
    ]);
    expect(out.fans.map((f) => f.uid)).toEqual(['convidado']);
  });

  it('o pointsAwarded soma só os ganhos aplicados de quem chama', () => {
    const out = compute(
      [
        fan({ uid: 'convidado', entries: [comment('c1'), comment('c2')] }),
        fan({ uid: 'quem-convidou', entries: [comment('c3')] }),
      ],
      { callerUid: 'convidado' },
    );
    expect(out.pointsAwarded).toBe(4);
  });

  it('o mesmo fã duas vezes no cálculo é erro de programação (o planAwards junta antes)', () => {
    expect(() =>
      compute([fan({ entries: [comment('c1')] }), fan({ entries: [comment('c2')] })]),
    ).toThrow(/repetido/);
  });

  it('entrada fora do formato é erro de programação', () => {
    expect(() => compute([fan({ entries: [comment('com espaço')] })])).toThrow(PointsError);
    expect(() =>
      compute([
        fan({
          entries: [{ kind: 'earn', source: 'comment', eventId: 'c', artistId: 'Netto Brito' }],
        }),
      ]),
    ).toThrow(/artistId/);
    expect(() =>
      compute([fan({ entries: [{ kind: 'earn', source: 'mission', eventId: 'm' }] })]),
    ).toThrow(/missão/);
    expect(() =>
      compute([fan({ entries: [{ kind: 'earn', source: 'comment', eventId: 'c', points: 5 }] })]),
    ).toThrow(/missão/);
  });
});

describe('resgate', () => {
  const rich = () => wallet({ balance: 1_000, xp: 5_000, seasonId: SEASON.id, seasonPoints: 300 });

  it('desconta só o saldo', () => {
    const out = compute([
      fan({
        wallet: rich(),
        entries: [{ kind: 'spend', source: 'redeem', eventId: 'r1', points: 300 }],
      }),
    ]);
    expect(out.results[0]).toMatchObject({ status: 'applied', points: -300 });
    expect(out.pointsAwarded).toBe(0);
    expect(out.fans[0]!.wallet!.state).toMatchObject({
      balance: 700,
      xp: 5_000,
      seasonPoints: 300,
      spentTotal: 300,
      earnedTotal: 0,
    });
    expect(out.shard).toMatchObject({
      totals: { spent: 300, spentEvents: 1 },
      bySource: { redeem: { points: 300, events: 1 } },
    });
  });

  it('sem saldo recusa tudo, com o saldo e o custo', () => {
    const run = () =>
      compute([
        fan({
          wallet: rich(),
          entries: [{ kind: 'spend', source: 'redeem', eventId: 'r1', points: 1_200 }],
        }),
      ]);
    expect(run).toThrow(PointsError);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({
        reason: 'insufficient_points',
        details: { balance: 1_000, cost: 1_200 },
      });
    }
  });
});

describe('ajuste', () => {
  it('soma cada contador pedido, sem limite do dia e sem contar no dia', () => {
    const out = compute(
      [
        fan({
          entries: [
            { kind: 'adjust', source: 'seed', eventId: 'base', balance: 100, xp: 200, season: 50 },
          ],
        }),
      ],
      { actor: { type: 'system', uid: null, name: null } },
    );
    expect(out.fans[0]!.wallet!.state).toMatchObject({
      balance: 100,
      xp: 200,
      seasonPoints: 50,
      seasonPointsAt: NOW,
      earnedTotal: 0,
      days: {},
    });
    expect(out.shard).toMatchObject({
      totals: { adjusted: 100, adjustedEvents: 1 },
      bySource: { seed: { points: 100, events: 1 } },
      byArtist: {},
    });
  });

  it('que deixaria um contador negativo recusa', () => {
    expect(() =>
      compute([fan({ entries: [{ kind: 'adjust', source: 'adjustment', eventId: 'a', xp: -1 }] })]),
    ).toThrow(expect.objectContaining({ reason: 'negative_counter' }));
  });

  it('de central: a temporada pede temporada ativa; o total de sempre, não', () => {
    const season = (total?: number) =>
      ({
        kind: 'adjust',
        source: 'adjustment',
        eventId: 'a',
        central: { artistId: 'nenho', season: 10, ...(total ? { total } : {}) },
      }) as AwardEntry;
    expect(() => compute([fan({ entries: [season()] })], { season: null })).toThrow(
      expect.objectContaining({ reason: 'season_required' }),
    );

    const totalOnly = compute(
      [
        fan({
          entries: [
            {
              kind: 'adjust',
              source: 'adjustment',
              eventId: 'a',
              central: { artistId: 'nenho', total: 40 },
            },
          ],
        }),
      ],
      { season: null },
    );
    expect(totalOnly.fans[0]!.centrals[0]!.state).toMatchObject({
      totalPoints: 40,
      seasonPoints: 0,
      seasonPointsAt: null,
    });

    const both = compute([fan({ entries: [season(40)] })]);
    expect(both.fans[0]!.centrals[0]!.state).toMatchObject({
      seasonPoints: 10,
      seasonPointsAt: NOW,
      totalPoints: 40,
    });
    expect(both.fans[0]!.ledger[0]!.data).toMatchObject({
      points: 0,
      artistId: 'nenho',
      centralSeasonDelta: 10,
      centralTotalDelta: 40,
    });
    // Ajuste nunca conta por artista nos agregados.
    expect(both.shard?.byArtist).toEqual({});
  });
});

describe('atividade e o que é gravado', () => {
  it('nada aplicado e sem marca nova: nada gravado, nem carteira, nem central, nem shard', () => {
    const out = compute([
      fan({
        wallet: wallet({ balance: 10 }),
        entries: [{ kind: 'earn', source: 'like', eventId: 'p1', artistId: 'nenho' }],
        activity: noActivity,
      }),
    ]);
    expect(out.fans[0]).toEqual({ uid: 'fa', wallet: null, ledger: [], centrals: [] });
    expect(out.shard).toBeNull();
  });

  it('primeira ação do dia, da semana e do mês marca o fã ativo e a coorte do cadastro', () => {
    const marks = activityMarks(
      { lastDay: '2026-09-30', lastWeek: '2026-W40', lastMonth: '2026-09' },
      NOW,
      Date.parse('2026-09-29T12:00:00.000Z'),
    );
    expect(marks).toEqual({
      day: '2026-10-05',
      week: '2026-W41',
      month: '2026-10',
      newDay: true,
      newWeek: true,
      newMonth: true,
      cohort: '2026-W40',
    });
    const out = compute([fan({ wallet: wallet(), activity: marks })]);
    expect(out.fans[0]!.wallet).toMatchObject({
      create: false,
      state: { activity: { lastDay: '2026-10-05', lastWeek: '2026-W41', lastMonth: '2026-10' } },
    });
    expect(out.shard).toEqual(
      expect.objectContaining({
        actives: { day: 1, newInWeek: 1, newInMonth: 1 },
        cohorts: { '2026-W40': { active: 1 } },
      }),
    );
  });

  it('segunda ação do dia não marca de novo', () => {
    const marks = activityMarks(
      { lastDay: '2026-10-05', lastWeek: '2026-W41', lastMonth: '2026-10' },
      NOW,
      null,
    );
    expect([marks.newDay, marks.newWeek, marks.newMonth]).toEqual([false, false, false]);
    expect(compute([fan({ wallet: wallet(), activity: marks })]).fans[0]!.wallet).toBeNull();
  });

  it('dia novo na mesma semana conta só o dia', () => {
    const marks = activityMarks(
      { lastDay: '2026-10-05', lastWeek: '2026-W41', lastMonth: '2026-10' },
      NOW + DAY_MS,
      null,
    );
    expect([marks.newDay, marks.newWeek, marks.newMonth]).toEqual([true, false, false]);
  });

  it('ajuste e seed não marcam atividade', () => {
    const marks = activityMarks({ lastDay: null, lastWeek: null, lastMonth: null }, NOW, null);
    const out = compute([fan({ activity: marks })], {
      actor: { type: 'staff', uid: 'admin', name: 'Admin' },
    });
    expect(out.fans[0]!.wallet).toBeNull();
    expect(out.shard).toBeNull();
  });

  it('pontos por origem e por artista no shard; atividade junto com o ponto', () => {
    const marks = activityMarks({ lastDay: null, lastWeek: null, lastMonth: null }, NOW, null);
    const out = compute([
      fan({
        activity: marks,
        entries: [
          comment('c1', 'nenho'),
          { kind: 'earn', source: 'mission', eventId: 'm1', points: 20, artistId: 'nenho' },
          comment('c2'),
        ],
      }),
    ]);
    expect(out.shard).toEqual({
      totals: {
        earned: 24,
        earnedEvents: 3,
        spent: 0,
        spentEvents: 0,
        adjusted: 0,
        adjustedEvents: 0,
        joined: 0,
        left: 0,
      },
      bySource: { comment: { points: 4, events: 2 }, mission: { points: 20, events: 1 } },
      byArtist: {
        nenho: {
          earned: 22,
          earnedEvents: 2,
          spent: 0,
          spentEvents: 0,
          joined: 0,
          left: 0,
          bySource: { comment: { points: 2, events: 1 }, mission: { points: 20, events: 1 } },
        },
      },
      actives: { day: 1, newInWeek: 1, newInMonth: 1 },
      cohorts: {},
      // Do convite (bloco 5): nada aqui, e o pruneZeros não grava os zerados.
      signups: { total: 0, invited: 0 },
      invites: { visits: 0, links: 0 },
      byOrigin: { kind: {}, utmSource: {}, utmCampaign: {} },
    });
  });
});
