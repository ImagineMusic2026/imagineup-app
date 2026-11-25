import { describe, expect, it } from 'vitest';

import { DEFAULT_ACHIEVEMENTS_CONFIG, type AchievementRecord } from '../achievements/model';
import {
  keyDigest,
  missionIndex,
  type MissionRecord,
  type MissionTick,
  type SeasonGoalConfig,
} from '../missions/model';
import { buildLoadedConfig, DEFAULT_POINTS_CONFIG } from './config';
import {
  activityMarks,
  assertValidEntry,
  computeAwards,
  EARN_SOURCES,
  emptyCentral,
  emptyWallet,
  levelForXp,
  PointsError,
  seasonsPlayed,
  trimDays,
  VALUE_SOURCES,
  weekEarned,
  type ActivityMarks,
  type AwardEntry,
  type CentralState,
  type ComputeInput,
  type FanInput,
  type GameConfig,
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
  topTarget: 10,
  endedEarly: null,
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

// Os testes de dayKey, weekKey, shiftDay e nextDayStart moraram aqui até o
// bloco 7; agora estão em src/day.test.ts, com o nextWeekStart.
describe('marcas de atividade nos dias de São Paulo', () => {
  it('perto da meia-noite, o mesmo instante dá o dia, a semana e o mês de São Paulo', () => {
    const marks = activityMarks(
      { lastDay: null, lastWeek: null, lastMonth: null },
      Date.parse('2026-10-01T02:30:00.000Z'),
      null,
    );
    expect(marks).toMatchObject({ day: '2026-09-30', week: '2026-W40', month: '2026-09' });
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

  it.each([
    // Antes da virada: as fechadas e a de agora, com ponto.
    [
      'antes da virada',
      { pastSeasons: 2, seasonPoints: 4_120, seasonId: 'sj', closedSeasonId: 'carnaval' },
      3,
    ],
    [
      'sem ponto na de agora',
      { pastSeasons: 2, seasonPoints: 0, seasonId: 'sj', closedSeasonId: 'carnaval' },
      2,
    ],
    // Depois da virada e antes da primeira ação na nova: a virada já contou a guardada.
    [
      'depois da virada',
      { pastSeasons: 3, seasonPoints: 4_120, seasonId: 'sj', closedSeasonId: 'sj' },
      3,
    ],
    // A primeira ação na nova trocou a carteira (sem somar), e ainda sem ponto nela.
    [
      'depois da troca',
      { pastSeasons: 3, seasonPoints: 0, seasonId: 'nova', closedSeasonId: 'sj' },
      3,
    ],
    [
      'pontuando na nova',
      { pastSeasons: 3, seasonPoints: 10, seasonId: 'nova', closedSeasonId: 'sj' },
      4,
    ],
    [
      'fã que nunca passou por virada',
      { pastSeasons: 0, seasonPoints: 5, seasonId: 'sj', closedSeasonId: null },
      1,
    ],
  ] as const)('temporadas jogadas: %s', (_name, wallet, expected) => {
    expect(seasonsPlayed(wallet)).toBe(expected);
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
          member: false,
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
        entries: [
          {
            kind: 'earn',
            source: 'mission',
            eventId: 'm:2026-W41',
            points: 20,
            title: 'Traga 3 amigos novos pro app',
          },
        ],
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
    // A troca preguiçosa não soma temporada: quem conta é a virada (bloco 8, 23.7).
    expect(out.fans[0]!.wallet!.state).toMatchObject({
      seasonId: SEASON.id,
      seasonPoints: 2,
      pastSeasons: 0,
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

  it('com o título da recompensa, o extrato guarda o subjectTitle (bloco 10)', () => {
    const out = compute([
      fan({
        wallet: rich(),
        entries: [
          {
            kind: 'spend',
            source: 'redeem',
            eventId: 'UP-4KD9TM',
            points: 600,
            subject: { type: 'reward', id: 'ingressos' },
            title: 'Par de ingressos',
          },
        ],
      }),
    ]);
    expect(out.fans[0]!.ledger[0]).toMatchObject({
      id: 'redeem:UP-4KD9TM',
      data: {
        kind: 'spend',
        points: -600,
        subject: { type: 'reward', id: 'ingressos' },
        subjectTitle: 'Par de ingressos',
      },
    });
  });

  it('título do resgate fora do formato é erro de programação', () => {
    for (const title of ['', ' Par', 'x'.repeat(81), 'Par\nde ingressos']) {
      expect(() =>
        compute([
          fan({
            wallet: rich(),
            entries: [{ kind: 'spend', source: 'redeem', eventId: 'r1', points: 1, title }],
          }),
        ]),
      ).toThrow(PointsError);
    }
  });
});

// --- Bloco 10: a devolução do resgate recusado (25.1, decisão 7) ------------------------

describe('devolução do resgate (refund)', () => {
  const STAFF = { type: 'staff', uid: 'equipe', name: 'Equipe' } as const;
  const refund = (extra: Partial<Extract<AwardEntry, { kind: 'refund' }>> = {}): AwardEntry => ({
    kind: 'refund',
    source: 'redeem_refund',
    eventId: 'UP-9FJT6V',
    points: 8_500,
    subject: { type: 'reward', id: 'videochamada' },
    title: 'Videochamada',
    ...extra,
  });
  const spent = () =>
    wallet({
      balance: 3_980,
      xp: 12_480,
      seasonId: SEASON.id,
      seasonPoints: 4_120,
      seasonPointsAt: NOW - DAY_MS,
      earnedTotal: 12_480,
      spentTotal: 8_500,
      days: { '2026-10-05': { earned: 10, count: { comment: 5 } } },
    });

  it('sobe o saldo e desce o spentTotal, sem mexer em XP, temporada, central e dias', () => {
    const out = compute([fan({ wallet: spent(), entries: [refund()] })], { actor: STAFF });
    expect(out.results).toEqual([
      { uid: 'fa', entryId: 'redeem_refund:UP-9FJT6V', status: 'applied', points: 8_500 },
    ]);
    expect(out.pointsAwarded).toBe(0);
    const state = out.fans[0]!.wallet!.state;
    expect(state).toMatchObject({
      balance: 12_480,
      xp: 12_480,
      seasonPoints: 4_120,
      seasonPointsAt: NOW - DAY_MS,
      earnedTotal: 12_480,
      spentTotal: 0,
    });
    expect(state.days).toEqual({ '2026-10-05': { earned: 10, count: { comment: 5 } } });
    expect(out.fans[0]!.centrals).toEqual([]);
    expect(out.fans[0]!.ledger[0]).toMatchObject({
      id: 'redeem_refund:UP-9FJT6V',
      data: {
        kind: 'refund',
        source: 'redeem_refund',
        points: 8_500,
        xpDelta: 0,
        seasonDelta: 0,
        artistId: null,
        subjectTitle: 'Videochamada',
        balanceAfter: 12_480,
        actor: STAFF,
      },
    });
    expect(out.shard).toMatchObject({
      totals: { refunded: 8_500, refundedEvents: 1, spent: 0, earned: 0, adjusted: 0 },
      bySource: { redeem_refund: { points: 8_500, events: 1 } },
      byArtist: {},
    });
  });

  it('o spentTotal nunca fica negativo', () => {
    const out = compute(
      [fan({ wallet: wallet({ balance: 0, spentTotal: 100 }), entries: [refund()] })],
      { actor: STAFF },
    );
    expect(out.fans[0]!.wallet!.state).toMatchObject({ balance: 8_500, spentTotal: 0 });
  });

  it('a mesma devolução de novo sai duplicate, sem gravar', () => {
    const out = compute(
      [
        fan({
          wallet: spent(),
          entries: [refund()],
          existingLedger: new Set(['redeem_refund:UP-9FJT6V']),
        }),
      ],
      { actor: STAFF },
    );
    expect(out.results[0]).toMatchObject({ status: 'duplicate', points: 0 });
    expect(out.fans[0]!.wallet).toBeNull();
    expect(out.shard).toBeNull();
  });

  it('o fã sem perfil (conta sendo excluída) sai skipped', () => {
    const out = compute([fan({ hasProfile: false, wallet: spent(), entries: [refund()] })], {
      actor: STAFF,
    });
    expect(out.results[0]).toMatchObject({ status: 'skipped', points: 0 });
    expect(out.fans).toEqual([]);
  });

  it('fora do formato é erro de programação', () => {
    const bad: AwardEntry[] = [
      refund({ points: 0 }),
      refund({ points: 1.5 }),
      refund({ source: 'redeem' as 'redeem_refund' }),
      refund({ title: '' }),
      refund({ eventId: 'com espaço' }),
    ];
    for (const entry of bad) {
      expect(() => compute([fan({ wallet: spent(), entries: [entry] })], { actor: STAFF })).toThrow(
        PointsError,
      );
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

  it('o prêmio do fã-clube (seção 34, decisão 45): só o saldo, com o id fanclub_prize:<grantId> e a nota', () => {
    const out = compute(
      [
        fan({
          wallet: wallet({ balance: 10, xp: 30 }),
          entries: [
            {
              kind: 'adjust',
              source: 'fanclub_prize',
              eventId: 'concessao-0001',
              balance: 200,
              note: 'Divulgou o show.',
            },
          ],
        }),
      ],
      { actor: { type: 'staff', uid: 'uidEquipe', name: 'Editora' } },
    );
    expect(out.fans[0]!.wallet!.state).toMatchObject({ balance: 210, xp: 30, earnedTotal: 0 });
    expect(out.fans[0]!.ledger[0]).toMatchObject({
      id: 'fanclub_prize:concessao-0001',
      data: {
        kind: 'adjust',
        source: 'fanclub_prize',
        points: 200,
        xpDelta: 0,
        seasonDelta: 0,
        note: 'Divulgou o show.',
      },
    });
    // No total de ajustes e na origem nova, como o ajuste (points/stats.ts).
    expect(out.shard).toMatchObject({
      totals: { adjusted: 200, adjustedEvents: 1 },
      bySource: { fanclub_prize: { points: 200, events: 1 } },
    });
  });

  it('o prêmio do fã-clube só com o saldo positivo; a mesma origem num ganho é recusada', () => {
    const invalid = [
      { kind: 'adjust', source: 'fanclub_prize', eventId: 'g', balance: -5 },
      { kind: 'adjust', source: 'fanclub_prize', eventId: 'g', xp: 5 },
      { kind: 'adjust', source: 'fanclub_prize', eventId: 'g', balance: 5, season: 5 },
      {
        kind: 'adjust',
        source: 'fanclub_prize',
        eventId: 'g',
        balance: 5,
        central: { artistId: 'nenho', total: 5 },
      },
      { kind: 'earn', source: 'fanclub_prize', eventId: 'g' },
    ] as unknown as AwardEntry[];
    for (const entry of invalid) {
      expect(() => assertValidEntry(entry), JSON.stringify(entry)).toThrow(
        expect.objectContaining({ reason: 'invalid_entry' }),
      );
    }
    expect(() =>
      assertValidEntry({ kind: 'adjust', source: 'fanclub_prize', eventId: 'g', balance: 5 }),
    ).not.toThrow();
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
          {
            kind: 'earn',
            source: 'mission',
            eventId: 'm1',
            points: 20,
            artistId: 'nenho',
            title: 'Curta 5 posts do Nenho',
          },
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
        // Do engajamento (bloco 6): nada aqui, e o pruneZeros não grava os zerados.
        likes: 0,
        unlikes: 0,
        comments: 0,
        rsvps: 0,
        rsvpsUndone: 0,
        reports: 0,
        blocks: 0,
        // Da loja (bloco 10): nada aqui, e o pruneZeros não grava os zerados.
        refunded: 0,
        refundedEvents: 0,
        redeemRequested: 0,
        redeemApproved: 0,
        redeemDelivered: 0,
        redeemRefused: 0,
        redeemCanceled: 0,
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
          likes: 0,
          unlikes: 0,
          comments: 0,
          rsvps: 0,
          rsvpsUndone: 0,
          reports: 0,
          bySource: { comment: { points: 2, events: 1 }, mission: { points: 20, events: 1 } },
        },
      },
      actives: { day: 1, newInWeek: 1, newInMonth: 1 },
      cohorts: {},
      // Do convite (bloco 5): nada aqui, e o pruneZeros não grava os zerados.
      signups: { total: 0, invited: 0 },
      invites: { visits: 0, links: 0 },
      byOrigin: { kind: {}, utmSource: {}, utmCampaign: {} },
      // Das missões e conquistas (bloco 7): o lançamento direto não conta como
      // conclusão de missão (só a conclusão pelo progresso), e sem o jogo nada desbloqueia.
      byMission: {},
      byAchievement: {},
      byReward: {},
    });
  });
});

// --- Bloco 7: missões, meta da temporada, conquistas e nível (22.4) -----------------

describe('missões, meta e conquistas no cálculo', () => {
  const MISSION_BASE = {
    goal: 5,
    period: 'daily' as const,
    featured: false,
    startsAt: NOW - DAY_MS,
    endsAt: null,
    status: 'active' as const,
    activatedAt: NOW - DAY_MS,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
  };
  const CURTIR: MissionRecord = {
    ...MISSION_BASE,
    id: 'm-curtir-nenho',
    title: 'Curta 5 posts do Nenho',
    action: 'like',
    target: { postId: null, artistId: 'nenho', eventId: null },
    rewardPoints: 10,
  };
  const AMIGOS: MissionRecord = {
    ...MISSION_BASE,
    id: 'm-trazer-amigos',
    title: 'Traga 3 amigos novos pro app',
    action: 'invite',
    target: null,
    goal: 3,
    period: 'weekly',
    rewardPoints: 30,
  };
  const goal = (metric: 'missions' | 'points', target: number): SeasonGoalConfig => ({
    seasonId: SEASON.id,
    title: 'Semana do arrocha',
    description: 'Complete 20 missões.',
    reachedDescription: null,
    metric,
    target,
  });
  const game = (extra: Partial<GameConfig> = {}): GameConfig => ({
    missions: missionIndex({ version: 1, missions: [CURTIR, AMIGOS] }),
    achievements: DEFAULT_ACHIEVEMENTS_CONFIG.achievements,
    seasonGoal: null,
    ...extra,
  });
  const like = (postId: string): MissionTick => ({
    action: 'like',
    key: postId,
    on: { postId, artistIds: ['nenho'] },
  });
  const likeEntry = (postId: string): AwardEntry => ({
    kind: 'earn',
    source: 'like',
    eventId: postId,
    artistId: 'nenho',
  });
  const likeOne: PointsConfig = {
    ...DEFAULT_POINTS_CONFIG,
    values: { ...DEFAULT_POINTS_CONFIG.values, like: 1 },
  };
  /** A carteira com a "Curta 5 posts do Nenho" em `current` de 5 hoje. */
  const withProgress = (current: number, extra: Partial<WalletState> = {}): WalletState =>
    wallet({
      seasonId: SEASON.id,
      missions: {
        daily: {
          key: '2026-10-05',
          items: {
            'm-curtir-nenho': {
              current,
              keys: Array.from({ length: current }, (_, i) => keyDigest(`old${i}`)),
              completedAt: null,
              rewardPaid: 0,
            },
          },
        },
        weekly: null,
      },
      ...extra,
    });

  it('a curtida que fecha a meta paga a missão depois da curtida, no mesmo pointsAwarded', () => {
    const out = compute(
      [fan({ wallet: withProgress(4), entries: [likeEntry('p5')], ticks: [like('p5')] })],
      { game: game(), config: likeOne },
    );
    expect(out.results.map((result) => [result.entryId, result.status, result.points])).toEqual([
      ['like:p5', 'applied', 1],
      ['mission:m-curtir-nenho:2026-10-05', 'applied', 10],
    ]);
    expect(out.pointsAwarded).toBe(11);
    const plan = out.fans[0]!;
    expect(plan.ledger[1]!.data).toMatchObject({
      source: 'mission',
      eventId: 'm-curtir-nenho:2026-10-05',
      artistId: 'nenho',
      subject: { type: 'mission', id: 'm-curtir-nenho' },
      subjectTitle: 'Curta 5 posts do Nenho',
      points: 10,
    });
    expect(plan.ledger[0]!.data.subjectTitle).toBeNull();
    const item = plan.wallet!.state.missions.daily!.items['m-curtir-nenho']!;
    expect(item).toMatchObject({ current: 5, completedAt: NOW, rewardPaid: 10 });
    expect(plan.wallet!.state.seasonMissions).toBe(1);
    expect(out.rewards).toEqual({
      completedMissions: [
        {
          id: 'm-curtir-nenho',
          title: 'Curta 5 posts do Nenho',
          rewardPoints: 10,
          completedAt: new Date(NOW).toISOString(),
        },
      ],
      levelUp: null,
      unlockedAchievements: [{ id: 'missao-cumprida', title: 'Missão cumprida' }],
      missionsChanged: true,
    });
    expect(out.shard!.byMission).toEqual({ 'm-curtir-nenho': { completed: 1 } });
    expect(out.shard!.byAchievement).toEqual({ 'missao-cumprida': { unlocked: 1 } });
  });

  it('só o progresso mudou: a carteira é gravada, sem lançamento', () => {
    const out = compute(
      [fan({ wallet: withProgress(1), entries: [likeEntry('p2')], ticks: [like('p2')] })],
      { game: game({ achievements: [] }) },
    );
    expect(out.results[0]!.status).toBe('zero');
    expect(out.fans[0]!.ledger).toEqual([]);
    expect(out.fans[0]!.wallet!.state.missions.daily!.items['m-curtir-nenho']!.current).toBe(2);
    expect(out.rewards.missionsChanged).toBe(true);
  });

  it('o mesmo post no período não conta de novo: nada mudou, nada gravado', () => {
    const state = withProgress(1);
    state.missions.daily!.items['m-curtir-nenho']!.keys = [keyDigest('p1')];
    const out = compute([fan({ wallet: state, ticks: [like('p1')] })], {
      game: game({ achievements: [] }),
    });
    expect(out.fans[0]!.wallet).toBeNull();
    expect(out.rewards.missionsChanged).toBe(false);
  });

  it('a conclusão que já está no extrato sai duplicate: completedAt fica e rewardPaid 0', () => {
    const out = compute(
      [
        fan({
          wallet: withProgress(4),
          ticks: [like('p5')],
          existingLedger: new Set(['mission:m-curtir-nenho:2026-10-05']),
        }),
      ],
      { game: game({ achievements: [] }) },
    );
    expect(out.results[0]!.status).toBe('duplicate');
    expect(out.fans[0]!.wallet!.state.missions.daily!.items['m-curtir-nenho']).toMatchObject({
      completedAt: NOW,
      rewardPaid: 0,
    });
    expect(out.rewards.completedMissions).toEqual([]);
    expect(out.pointsAwarded).toBe(0);
  });

  it('seasonMissions sobe só com temporada ativa e zera na troca de temporada', () => {
    const outside = compute([fan({ wallet: withProgress(4), ticks: [like('p5')] })], {
      game: game({ achievements: [] }),
      season: null,
    });
    expect(outside.fans[0]!.wallet!.state.seasonMissions).toBe(0);
    const switched = compute(
      [
        fan({
          wallet: withProgress(0, { seasonId: 'carnaval', seasonMissions: 9 }),
          ticks: [like('p1')],
        }),
      ],
      { game: game({ achievements: [] }) },
    );
    expect(switched.fans[0]!.wallet!.state).toMatchObject({
      seasonId: SEASON.id,
      seasonMissions: 0,
    });
  });

  it.each([
    ['missões', 'missions', 1, withProgress(4, { seasonMissions: 0 })],
    ['pontos', 'points', 4_100, withProgress(4, { seasonPoints: 4_090 })],
  ] as const)(
    'meta por %s marcada ao chegar no alvo, uma vez só',
    (_name, metric, target, state) => {
      const config = metric === 'points' ? likeOne : DEFAULT_POINTS_CONFIG;
      const g = game({ achievements: [], seasonGoal: goal(metric, target) });
      const out = compute(
        [
          fan({
            wallet: state,
            entries: metric === 'points' ? [likeEntry('p5')] : [],
            ticks: [like('p5')],
          }),
        ],
        { game: g, config },
      );
      expect(out.fans[0]!.wallet!.state.goalReached).toEqual({ seasonId: SEASON.id, at: NOW });
      const again = compute(
        [fan({ wallet: { ...out.fans[0]!.wallet!.state, seasonPoints: 0, seasonMissions: 0 } })],
        { game: g, now: NOW + 1 },
      );
      // A marca fica com a conta caindo, e nada novo é gravado.
      expect(again.fans[0]!.wallet).toBeNull();
    },
  );

  it('a meta marca na primeira gravação depois de a equipe baixar o alvo', () => {
    const out = compute(
      [fan({ wallet: withProgress(0, { seasonMissions: 12 }), ticks: [like('p1')] })],
      { game: game({ achievements: [], seasonGoal: goal('missions', 12) }) },
    );
    expect(out.fans[0]!.wallet!.state.goalReached).toEqual({ seasonId: SEASON.id, at: NOW });
  });

  it('meta por pontos: os pontos da temporada que mudam, sem unidade contada, mudam as missões de quem chama', () => {
    // Um comentário (2, o padrão) num post fora de qualquer missão.
    const byPoints = game({ achievements: [], seasonGoal: goal('points', 5_000) });
    const points = compute([fan({ wallet: withProgress(0), entries: [comment('c1', 'nenho')] })], {
      game: byPoints,
    });
    expect(points.pointsAwarded).toBe(2);
    expect(points.rewards.missionsChanged).toBe(true);

    // Por missões, o mesmo comentário não muda o anel.
    const byMissions = game({ achievements: [], seasonGoal: goal('missions', 20) });
    const missions = compute(
      [fan({ wallet: withProgress(0), entries: [comment('c1', 'nenho')] })],
      {
        game: byMissions,
      },
    );
    expect(missions.rewards.missionsChanged).toBe(false);

    // Sem pontos (curtir vale 0), nada muda nem na meta por pontos.
    const zero = compute([fan({ wallet: withProgress(0), entries: [likeEntry('p9')] })], {
      game: byPoints,
    });
    expect(zero.rewards.missionsChanged).toBe(false);

    // A meta de outra temporada não conta.
    const stale = compute([fan({ wallet: withProgress(0), entries: [comment('c1', 'nenho')] })], {
      game: game({
        achievements: [],
        seasonGoal: { ...goal('points', 5_000), seasonId: 'carnaval' },
      }),
    });
    expect(stale.rewards.missionsChanged).toBe(false);
  });

  it('a meta cumprida agora muda as missões de quem chama, mesmo sem unidade contada', () => {
    // O post já contou no período: o tick não anda nada, mas a gravação marca a
    // meta que a equipe baixou para 12.
    const state = withProgress(1, { seasonMissions: 12 });
    state.missions.daily!.items['m-curtir-nenho']!.keys = [keyDigest('p1')];
    const out = compute([fan({ wallet: state, ticks: [like('p1')] })], {
      game: game({ achievements: [], seasonGoal: goal('missions', 12) }),
    });
    expect(out.fans[0]!.wallet!.state.missions.daily!.items['m-curtir-nenho']!.current).toBe(1);
    expect(out.rewards.missionsChanged).toBe(true);
    expect(out.fans[0]!.wallet!.state.goalReached).toEqual({ seasonId: SEASON.id, at: NOW });
  });

  it('outro fã sem perfil: os ticks são ignorados', () => {
    const out = compute(
      [
        fan(),
        fan({
          uid: 'quem-convidou',
          hasProfile: false,
          ticks: [{ action: 'invite', key: 'e1', on: { artistIds: [] } }],
        }),
      ],
      { game: game() },
    );
    expect(out.fans.map((item) => item.uid)).toEqual(['fa']);
  });

  it('o tick do período velho é descartado (o pedido de 23:59 gravando depois do de 0:00)', () => {
    const future = wallet({
      missions: {
        daily: {
          key: '2026-10-06',
          items: {
            'm-curtir-nenho': { current: 1, keys: [], completedAt: null, rewardPaid: 0 },
          },
        },
        weekly: null,
      },
    });
    const out = compute([fan({ wallet: future, ticks: [like('p1')] })], {
      game: game({ achievements: [] }),
    });
    expect(out.fans[0]!.wallet).toBeNull();
  });

  it('subida de nível pela régua do pedido, duas de uma vez mandam o nível final', () => {
    const out = compute(
      [
        fan({
          wallet: wallet({ xp: 500 }),
          entries: [{ kind: 'adjust', source: 'seed', eventId: 'base', xp: 1_100 }],
        }),
      ],
      { game: game() },
    );
    expect(out.rewards.levelUp).toEqual({ number: 3, name: 'Pé de serra', minXp: 1_500 });
    expect(out.rewards.unlockedAchievements).toEqual([{ id: 'pe-de-serra', title: 'Pé de serra' }]);
    expect(out.fans[0]!.wallet!.state.achievements).toEqual({ 'pe-de-serra': NOW });
  });

  it('a de nível que o XP lido já alcançava entra com o updatedAt lido, sem anúncio', () => {
    const readAt = NOW - 3 * DAY_MS;
    const out = compute([fan({ wallet: wallet({ xp: 1_600, updatedAt: readAt }) })], {
      game: game(),
    });
    expect(out.fans[0]!.wallet!.state.achievements).toEqual({ 'pe-de-serra': readAt });
    expect(out.rewards.unlockedAchievements).toEqual([]);
    expect(out.rewards.levelUp).toBeNull();
  });

  it('a primeira presença dá "Fã de show" mesmo com o "Eu vou" valendo 0', () => {
    const out = compute(
      [
        fan({
          entries: [{ kind: 'earn', source: 'rsvp', eventId: 's1' }],
          ticks: [{ action: 'rsvp', key: 's1', on: { eventId: 's1', artistIds: [] } }],
        }),
      ],
      { game: game() },
    );
    expect(out.results[0]!.status).toBe('zero');
    expect(out.rewards.unlockedAchievements).toEqual([{ id: 'fa-de-show', title: 'Fã de show' }]);
    expect(out.fans[0]!.wallet!.create).toBe(true);
  });

  it('sem o jogo (NO_GAME), nada anda nem desbloqueia', () => {
    const out = compute([fan({ wallet: withProgress(4), ticks: [like('p5')] })]);
    expect(out.fans[0]!.wallet).toBeNull();
    expect(out.rewards).toEqual({
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
  });

  it('o lançamento de missão leva o título; as outras origens, não', () => {
    expect(() =>
      compute([fan({ entries: [{ kind: 'earn', source: 'mission', eventId: 'm', points: 5 }] })]),
    ).toThrow(PointsError);
    expect(() =>
      compute([fan({ entries: [{ ...comment('c1'), title: 'x' }] as AwardEntry[] })]),
    ).toThrow(/título/);
  });
});

// --- Bloco 11: o contador negativo e o fã suspenso que não chama (26.5) ---------------

describe('ajuste da equipe e suspensão (bloco 11)', () => {
  const adjust = (extra: Partial<Extract<AwardEntry, { kind: 'adjust' }>>): AwardEntry => ({
    kind: 'adjust',
    source: 'adjustment',
    eventId: 'ajuste-0001',
    ...extra,
  });
  const counterOf = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return (error as PointsError).details?.counter;
    }
    return undefined;
  };

  it('o contador negativo diz qual, na ordem do painel', () => {
    const base = fan({
      wallet: wallet({ balance: 10, xp: 10, seasonId: SEASON.id, seasonPoints: 5 }),
    });
    expect(counterOf(() => compute([{ ...base, entries: [adjust({ balance: -11 })] }]))).toBe(
      'balance',
    );
    expect(counterOf(() => compute([{ ...base, entries: [adjust({ xp: -11 })] }]))).toBe('xp');
    expect(counterOf(() => compute([{ ...base, entries: [adjust({ season: -6 })] }]))).toBe(
      'season',
    );
    expect(
      counterOf(() =>
        compute([{ ...base, entries: [adjust({ central: { artistId: 'nenho', season: -1 } })] }]),
      ),
    ).toBe('centralSeason');
    expect(
      counterOf(() =>
        compute([{ ...base, entries: [adjust({ central: { artistId: 'nenho', total: -1 } })] }]),
      ),
    ).toBe('centralTotal');
    // Dois negativos: o primeiro na ordem (saldo antes da central).
    expect(
      counterOf(() =>
        compute([
          {
            ...base,
            entries: [adjust({ balance: -11, central: { artistId: 'nenho', total: -1 } })],
          },
        ]),
      ),
    ).toBe('balance');
  });

  const AMIGO: MissionRecord = {
    id: 'm-um-amigo',
    title: 'Traga 1 amigo',
    action: 'invite',
    target: null,
    goal: 1,
    period: 'weekly',
    featured: false,
    startsAt: NOW - DAY_MS,
    endsAt: null,
    status: 'active',
    activatedAt: NOW - DAY_MS,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
    rewardPoints: 30,
  };
  const GAME: GameConfig = {
    missions: missionIndex({ version: 1, missions: [AMIGO] }),
    achievements: [],
    seasonGoal: null,
  };
  const owner = (suspended: boolean): FanInput =>
    fan({
      uid: 'dono',
      suspended,
      wallet: wallet({ balance: 100, spentTotal: 500 }),
      entries: [
        { kind: 'earn', source: 'invite_visit', eventId: 'chave-1' },
        { kind: 'earn', source: 'invite_signup', eventId: 'chave-1' },
        { kind: 'refund', source: 'redeem_refund', eventId: 'UP-AAAA11', points: 300 },
      ],
      ticks: [{ action: 'invite', key: 'chave-1', on: { artistIds: [] } }],
    });

  it('o suspenso que não chama não ganha (convite e missão), e a devolução entra', () => {
    const out = compute([fan({ uid: 'quem-chama' }), owner(true)], { game: GAME });
    const results = out.results.filter((result) => result.uid === 'dono');
    expect(results.map((result) => [result.entryId, result.status, result.points])).toEqual([
      ['invite_visit:chave-1', 'skipped', 0],
      ['invite_signup:chave-1', 'skipped', 0],
      ['redeem_refund:UP-AAAA11', 'applied', 300],
    ]);
    const plan = out.fans.find((item) => item.uid === 'dono')!;
    expect(plan.wallet!.state).toMatchObject({ balance: 400, spentTotal: 200, earnedTotal: 0 });
    expect(plan.wallet!.state.missions.weekly).toBeNull();
    expect(plan.ledger.map((entry) => entry.id)).toEqual(['redeem_refund:UP-AAAA11']);
  });

  it('sem a suspensão, o mesmo plano paga o convite e conclui a missão', () => {
    const out = compute([fan({ uid: 'quem-chama' }), owner(false)], { game: GAME });
    const plan = out.fans.find((item) => item.uid === 'dono')!;
    expect(plan.ledger.map((entry) => entry.id)).toEqual([
      'invite_visit:chave-1',
      'invite_signup:chave-1',
      'redeem_refund:UP-AAAA11',
      expect.stringMatching(/^mission:m-um-amigo:/),
    ]);
  });
});

// --- Check-in diário com sequência (seção 40) -----------------------------------------

describe('check-in diário no cálculo (seção 40)', () => {
  const TODAY = '2026-10-05';
  const YESTERDAY = '2026-10-04';
  const ON: PointsConfig = {
    ...DEFAULT_POINTS_CONFIG,
    checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] },
  };
  const streak = (days: number, lastDay: string | null, best = days) => ({
    streak: days,
    best,
    lastDay,
  });
  /** O fã que pede o check-in de hoje. */
  const checkin = (extra: Partial<FanInput> = {}): FanInput => fan({ checkin: true, ...extra });
  const milestone = (days: number): AchievementRecord => ({
    id: `sequencia-${days}`,
    title: `${days} dias seguidos`,
    icon: 'flame',
    tone: 'action',
    rule: { type: 'streak', days },
    status: 'active',
    activatedAt: NOW - DAY_MS,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
  });
  const CATALOG = [...DEFAULT_ACHIEVEMENTS_CONFIG.achievements, milestone(7), milestone(30)];
  const game = (extra: Partial<GameConfig> = {}): GameConfig => ({
    missions: missionIndex({ version: 1, missions: [] }),
    achievements: CATALOG,
    seasonGoal: null,
    ...extra,
  });

  it('a origem existe só para ganhar, sem valor na configuração: quem dá os pontos é o ciclo', () => {
    expect(EARN_SOURCES).toContain('checkin');
    expect(VALUE_SOURCES).not.toContain('checkin');
    expect(DEFAULT_POINTS_CONFIG.values).not.toHaveProperty('checkin');
    expect(DEFAULT_POINTS_CONFIG.dailyLimits.checkin).toBeNull();
    expect(DEFAULT_POINTS_CONFIG.checkin).toEqual({
      enabled: false,
      cycle: [3, 3, 4, 4, 5, 6, 15],
    });
  });

  it('a carteira vazia nasce com a sequência vazia, uma cópia por carteira', () => {
    expect(emptyWallet().checkin).toEqual({ streak: 0, best: 0, lastDay: null });
    expect(emptyWallet().checkin).not.toBe(emptyWallet().checkin);
  });

  it('o primeiro check-in paga o dia 1 do ciclo e entra no saldo, no XP, na temporada e no dia', () => {
    const out = compute([checkin()], { config: ON });
    expect(out.results).toEqual([
      { uid: 'fa', entryId: 'checkin:2026-10-05', status: 'applied', points: 3 },
    ]);
    expect(out.pointsAwarded).toBe(3);
    expect(out.checkin).toEqual({
      status: 'checked',
      record: streak(1, TODAY),
      cycleDay: 1,
      points: 3,
    });
    const plan = out.fans[0]!;
    expect(plan.wallet).toMatchObject({
      create: true,
      state: {
        balance: 3,
        xp: 3,
        earnedTotal: 3,
        seasonId: SEASON.id,
        seasonPoints: 3,
        seasonPointsAt: NOW,
        days: { '2026-10-05': { earned: 3, count: { checkin: 1 } } },
        checkin: streak(1, TODAY),
      },
    });
    // Sem central, sem assunto e sem título.
    expect(plan.centrals).toEqual([]);
    expect(plan.ledger).toHaveLength(1);
    expect(plan.ledger[0]).toMatchObject({
      id: 'checkin:2026-10-05',
      data: {
        kind: 'earn',
        source: 'checkin',
        eventId: '2026-10-05',
        points: 3,
        xpDelta: 3,
        seasonDelta: 3,
        artistId: null,
        centralSeasonDelta: 0,
        centralTotalDelta: 0,
        seasonId: SEASON.id,
        subject: null,
        subjectTitle: null,
        balanceAfter: 3,
        xpAfter: 3,
        seasonPointsAfter: 3,
        day: '2026-10-05',
        createdAt: NOW,
      },
    });
    expect(out.shard!.totals).toMatchObject({ earned: 3, earnedEvents: 1 });
    expect(out.shard!.bySource).toEqual({ checkin: { points: 3, events: 1 } });
    expect(out.shard!.byArtist).toEqual({});
  });

  it.each([
    [1, 2, 2, 3],
    [4, 5, 5, 5],
    [6, 7, 7, 15],
    [7, 8, 1, 3],
    [13, 14, 7, 15],
    [14, 15, 1, 3],
  ])(
    'fez ontem o dia %i: hoje é o dia %i, no lugar %i do ciclo, e paga %i',
    (stored, next, cycleDay, points) => {
      const out = compute(
        [checkin({ wallet: wallet({ balance: 100, checkin: streak(stored, YESTERDAY) }) })],
        { config: ON },
      );
      expect(out.checkin).toEqual({
        status: 'checked',
        record: streak(next, TODAY),
        cycleDay,
        points,
      });
      expect(out.pointsAwarded).toBe(points);
      expect(out.fans[0]!.wallet!.state).toMatchObject({
        balance: 100 + points,
        checkin: streak(next, TODAY),
      });
    },
  );

  it('perdeu um dia: volta ao dia 1; os pontos de antes e a melhor sequência ficam', () => {
    const read = wallet({ balance: 100, xp: 100, checkin: streak(4, '2026-10-03', 9) });
    const out = compute([checkin({ wallet: read })], { config: ON });
    expect(out.checkin).toEqual({
      status: 'checked',
      record: streak(1, TODAY, 9),
      cycleDay: 1,
      points: 3,
    });
    expect(out.fans[0]!.wallet!.state).toMatchObject({
      balance: 103,
      xp: 103,
      checkin: streak(1, TODAY, 9),
    });
    // A carteira lida (o retrato do pedido) não muda: o cálculo trabalha numa cópia.
    expect(read.checkin).toEqual(streak(4, '2026-10-03', 9));
    expect(out.fans[0]!.wallet!.state.checkin).not.toBe(read.checkin);
  });

  it('o segundo pedido do mesmo dia não paga nem grava nada', () => {
    const out = compute(
      [
        checkin({
          wallet: wallet({ balance: 105, checkin: streak(5, TODAY) }),
          existingLedger: new Set(['checkin:2026-10-05']),
          activity: noActivity,
        }),
      ],
      { config: ON },
    );
    expect(out.results).toEqual([]);
    expect(out.pointsAwarded).toBe(0);
    expect(out.fans[0]).toEqual({ uid: 'fa', wallet: null, ledger: [], centrals: [] });
    expect(out.shard).toBeNull();
    expect(out.checkin).toEqual({
      status: 'already',
      record: streak(5, TODAY),
      cycleDay: 5,
      points: 0,
    });
  });

  it('o dia guardado posterior ao do pedido não anda para trás (o tempo só anda para a frente)', () => {
    const out = compute(
      [checkin({ wallet: wallet({ checkin: streak(5, '2026-10-06') }), activity: noActivity })],
      { config: ON },
    );
    expect(out.fans[0]!.wallet).toBeNull();
    expect(out.results).toEqual([]);
    expect(out.checkin).toMatchObject({ status: 'already', record: streak(5, '2026-10-06') });
  });

  it('meia-noite em São Paulo: 02:59:59,999Z ainda é o dia anterior, e 03:00:00,000Z já é o seguinte', () => {
    const read = wallet({ checkin: streak(3, TODAY) });
    const before = compute([checkin({ wallet: read, activity: noActivity })], {
      config: ON,
      now: Date.parse('2026-10-06T02:59:59.999Z'),
    });
    expect(before.checkin).toMatchObject({ status: 'already', record: streak(3, TODAY) });
    expect(before.fans[0]!.wallet).toBeNull();

    const after = compute([checkin({ wallet: read })], {
      config: ON,
      now: Date.parse('2026-10-06T03:00:00.000Z'),
    });
    expect(after.results).toEqual([
      { uid: 'fa', entryId: 'checkin:2026-10-06', status: 'applied', points: 4 },
    ]);
    expect(after.checkin).toEqual({
      status: 'checked',
      record: streak(4, '2026-10-06'),
      cycleDay: 4,
      points: 4,
    });
  });

  it('dois pedidos fora de ordem na virada: o de 00:00:00,010 grava, e o de 23:59:59,950 depois dele não muda nada', () => {
    // O pedido carimbado depois da meia-noite grava primeiro...
    const first = compute([checkin({ wallet: wallet({ checkin: streak(4, TODAY) }) })], {
      config: ON,
      now: Date.parse('2026-10-06T03:00:00.010Z'),
    });
    expect(first.checkin).toMatchObject({ status: 'checked', record: streak(5, '2026-10-06') });
    const stored = first.fans[0]!.wallet!.state;
    // ...e o carimbado antes dela chega depois, com a carteira já no dia novo.
    const late = compute(
      [
        checkin({
          wallet: stored,
          existingLedger: new Set(['checkin:2026-10-05']),
          activity: noActivity,
        }),
      ],
      { config: ON, now: Date.parse('2026-10-06T02:59:59.950Z') },
    );
    expect(late.day).toBe('2026-10-05');
    expect(late.results).toEqual([]);
    expect(late.pointsAwarded).toBe(0);
    expect(late.fans[0]!.wallet).toBeNull();
    expect(late.checkin).toEqual({
      status: 'already',
      record: streak(5, '2026-10-06'),
      cycleDay: 5,
      points: 0,
    });
  });

  it('o dia que vale 0 não lança nada, mas a sequência é guardada (o ciclo zerado do seed)', () => {
    const zero: PointsConfig = { ...ON, checkin: { enabled: true, cycle: [0, 0, 0, 0, 0, 0, 0] } };
    const read = wallet({
      balance: 50,
      xp: 80,
      earnedTotal: 80,
      seasonId: SEASON.id,
      seasonPoints: 20,
      days: { '2026-10-04': { earned: 7, count: { comment: 1 } } },
      checkin: streak(2, YESTERDAY),
    });
    const out = compute([checkin({ wallet: read })], { config: zero });
    expect(out.results).toEqual([]);
    expect(out.pointsAwarded).toBe(0);
    expect(out.shard).toBeNull();
    const plan = out.fans[0]!;
    expect(plan.ledger).toEqual([]);
    expect(plan.wallet).toEqual({
      create: false,
      state: { ...read, checkin: streak(3, TODAY) },
    });
    expect(out.checkin).toEqual({
      status: 'checked',
      record: streak(3, TODAY),
      cycleDay: 3,
      points: 0,
    });
  });

  it('o lançamento do dia que já está no extrato sai duplicate, e a sequência anda mesmo assim: a trava é o lastDay', () => {
    const out = compute(
      [
        checkin({
          wallet: wallet({ balance: 40, checkin: streak(4, YESTERDAY) }),
          existingLedger: new Set(['checkin:2026-10-05']),
        }),
      ],
      { config: ON },
    );
    expect(out.results).toEqual([
      { uid: 'fa', entryId: 'checkin:2026-10-05', status: 'duplicate', points: 0 },
    ]);
    expect(out.pointsAwarded).toBe(0);
    expect(out.fans[0]!.ledger).toEqual([]);
    expect(out.fans[0]!.wallet!.state).toMatchObject({ balance: 40, checkin: streak(5, TODAY) });
    expect(out.checkin).toEqual({
      status: 'checked',
      record: streak(5, TODAY),
      cycleDay: 5,
      points: 0,
    });
  });

  it('fora da janela da temporada, o check-in entra só no saldo e no XP', () => {
    const out = compute([checkin()], { config: ON, season: { ...SEASON, endsAt: NOW } });
    expect(out.fans[0]!.wallet!.state).toMatchObject({
      balance: 3,
      xp: 3,
      seasonPoints: 0,
      seasonId: null,
    });
    expect(out.fans[0]!.ledger[0]!.data).toMatchObject({ seasonDelta: 0, seasonId: null });
  });

  it('não anda missão nem dispara conquista de primeira vez', () => {
    const mission: MissionRecord = {
      id: 'm-curtir',
      title: 'Curta 1 post',
      action: 'like',
      target: null,
      goal: 1,
      period: 'daily',
      rewardPoints: 10,
      featured: false,
      startsAt: NOW - DAY_MS,
      endsAt: null,
      status: 'active',
      activatedAt: NOW - DAY_MS,
      createdAt: NOW - DAY_MS,
      updatedAt: NOW - DAY_MS,
    };
    const out = compute([checkin()], {
      config: ON,
      game: game({ missions: missionIndex({ version: 1, missions: [mission] }) }),
    });
    expect(out.pointsAwarded).toBe(3);
    expect(out.rewards).toEqual({
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
    expect(out.fans[0]!.wallet!.state.missions).toEqual({ daily: null, weekly: null });
    expect(out.fans[0]!.wallet!.state.achievements).toEqual({});
  });

  it('com a meta da temporada por pontos, o check-in avisa que as missões mudaram e pode bater a meta', () => {
    const goal = (target: number): SeasonGoalConfig => ({
      seasonId: SEASON.id,
      title: 'Semana do arrocha',
      description: 'Some pontos na temporada.',
      reachedDescription: null,
      metric: 'points',
      target,
    });
    const far = compute([checkin()], { config: ON, game: game({ seasonGoal: goal(1_000) }) });
    expect(far.rewards.missionsChanged).toBe(true);
    expect(far.fans[0]!.wallet!.state.goalReached).toBeNull();
    const reached = compute([checkin()], { config: ON, game: game({ seasonGoal: goal(3) }) });
    expect(reached.fans[0]!.wallet!.state.goalReached).toEqual({ seasonId: SEASON.id, at: NOW });
  });

  it('o check-in que cruza o degrau sobe o nível e destrava a conquista de nível', () => {
    const out = compute([checkin({ wallet: wallet({ xp: 1_498, balance: 10 }) })], {
      config: ON,
      game: game(),
    });
    expect(out.rewards.levelUp).toEqual({ number: 3, name: 'Pé de serra', minXp: 1_500 });
    expect(out.rewards.unlockedAchievements).toEqual([{ id: 'pe-de-serra', title: 'Pé de serra' }]);
  });

  it.each([
    [5, []],
    [6, [{ id: 'sequencia-7', title: '7 dias seguidos' }]],
    [29, [{ id: 'sequencia-30', title: '30 dias seguidos' }]],
  ])(
    'com %i dias até ontem, o check-in de hoje anuncia %j na mesma resposta',
    (stored, unlocked) => {
      const owned: Record<string, number> = stored >= 7 ? { 'sequencia-7': NOW - 20 * DAY_MS } : {};
      const out = compute(
        [checkin({ wallet: wallet({ checkin: streak(stored, YESTERDAY), achievements: owned }) })],
        { config: ON, game: game() },
      );
      expect(out.rewards.unlockedAchievements).toEqual(unlocked);
      expect(out.fans[0]!.wallet!.state.achievements).toEqual({
        ...owned,
        ...Object.fromEntries(unlocked.map((item) => [item.id, NOW])),
      });
      expect(out.shard!.byAchievement).toEqual(
        Object.fromEntries(unlocked.map((item) => [item.id, { unlocked: 1 }])),
      );
    },
  );

  // A conquista de sequência só destrava no cálculo em que o passo do check-in
  // rodou para o fã: assim ela sai sempre na resposta do `POST /me/checkin`. A
  // carteira dos casos abaixo já tinha a sequência quando a conquista foi
  // publicada (a de agora até se perdeu: vale a melhor, que só cresce).
  const LATE = streak(1, '2026-09-01', 40);

  it.each<[string, Partial<FanInput>, string[]]>([
    ['num comentário', { entries: [comment('c1')] }, []],
    [
      'no primeiro comentário, que dá só a conquista dele',
      {
        entries: [comment('c1')],
        ticks: [{ action: 'comment', key: 'c1', on: { postId: 'p1', artistIds: [] } }],
      },
      ['puxa-conversa'],
    ],
    [
      'numa gravação sem lançamento, só com a atividade do dia',
      { activity: { ...noActivity, newDay: true } },
      [],
    ],
  ])('a conquista de sequência não sai fora do check-in: %s', (_, extra, ids) => {
    const out = compute([fan({ wallet: wallet({ checkin: LATE }), ...extra })], {
      config: ON,
      game: game(),
    });
    expect(out.rewards.unlockedAchievements.map((item) => item.id)).toEqual(ids);
    // A carteira é gravada (pelo comentário ou pela atividade), sem conquista de sequência.
    const stored = out.fans[0]!.wallet!.state;
    expect(Object.keys(stored.achievements)).toEqual(ids);
    expect(Object.keys(out.shard!.byAchievement)).toEqual(ids);
    // A outra gravação não mexe na sequência guardada.
    expect(stored.checkin).toEqual(LATE);
    expect(out.checkin).toBeUndefined();
  });

  it('a conquista publicada depois chega no check-in seguinte de quem já tinha a melhor sequência, com o anúncio', () => {
    const out = compute([checkin({ wallet: wallet({ checkin: LATE }) })], {
      config: ON,
      game: game(),
    });
    // O dia perdido voltou a sequência ao dia 1: quem destrava é a melhor.
    expect(out.checkin).toEqual({
      status: 'checked',
      record: streak(1, TODAY, 40),
      cycleDay: 1,
      points: 3,
    });
    expect(out.rewards.unlockedAchievements).toEqual([
      { id: 'sequencia-7', title: '7 dias seguidos' },
      { id: 'sequencia-30', title: '30 dias seguidos' },
    ]);
    expect(out.fans[0]!.wallet!.state.achievements).toEqual({
      'sequencia-7': NOW,
      'sequencia-30': NOW,
    });
    expect(out.shard!.byAchievement).toEqual({
      'sequencia-7': { unlocked: 1 },
      'sequencia-30': { unlocked: 1 },
    });
  });

  it('também no segundo toque do dia: o check-in já feito destrava e anuncia a conquista publicada depois dele, sem pagar', () => {
    const out = compute(
      [
        checkin({
          wallet: wallet({ balance: 105, checkin: streak(8, TODAY) }),
          existingLedger: new Set(['checkin:2026-10-05']),
          activity: noActivity,
        }),
      ],
      { config: ON, game: game() },
    );
    expect(out.checkin).toEqual({
      status: 'already',
      record: streak(8, TODAY),
      cycleDay: 1,
      points: 0,
    });
    expect(out.results).toEqual([]);
    expect(out.pointsAwarded).toBe(0);
    expect(out.rewards.unlockedAchievements).toEqual([
      { id: 'sequencia-7', title: '7 dias seguidos' },
    ]);
    // A carteira é gravada só pela conquista: o saldo e a sequência ficam, sem lançamento.
    const plan = out.fans[0]!;
    expect(plan.ledger).toEqual([]);
    expect(plan.wallet).toMatchObject({
      create: false,
      state: {
        balance: 105,
        checkin: streak(8, TODAY),
        achievements: { 'sequencia-7': NOW },
      },
    });
    expect(out.shard!.byAchievement).toEqual({ 'sequencia-7': { unlocked: 1 } });
    // Quem já tem a conquista não a recebe de novo no toque seguinte.
    const again = compute(
      [
        checkin({
          wallet: plan.wallet!.state,
          existingLedger: new Set(['checkin:2026-10-05']),
          activity: noActivity,
        }),
      ],
      { config: ON, game: game() },
    );
    expect(again.rewards.unlockedAchievements).toEqual([]);
    expect(again.fans[0]!.wallet).toBeNull();
  });

  it('o check-in de um fã não destrava a conquista de sequência de outro fã do mesmo cálculo', () => {
    const out = compute(
      [
        checkin({ uid: 'quem-chama' }),
        fan({ uid: 'outro', wallet: wallet({ checkin: LATE }), entries: [comment('c1')] }),
      ],
      { config: ON, game: game() },
    );
    expect(out.checkin).toMatchObject({ status: 'checked', record: streak(1, TODAY) });
    expect(out.rewards.unlockedAchievements).toEqual([]);
    // O comentário do outro fã entra, e a carteira dele fica sem a conquista.
    const other = out.fans.find((item) => item.uid === 'outro')!;
    expect(other.ledger.map((entry) => entry.id)).toEqual(['comment:c1']);
    expect(other.wallet!.state.achievements).toEqual({});
    expect(other.wallet!.state.checkin).toEqual(LATE);
    expect(out.shard!.byAchievement).toEqual({});
  });

  it('sem o jogo (o caminho fora da API que não passa nada), a sequência anda e nada destrava', () => {
    const out = compute([checkin({ wallet: wallet({ checkin: streak(6, YESTERDAY) }) })], {
      config: ON,
    });
    expect(out.checkin).toMatchObject({ status: 'checked', record: streak(7, TODAY) });
    expect(out.rewards.unlockedAchievements).toEqual([]);
    expect(out.fans[0]!.wallet!.state.achievements).toEqual({});
  });

  describe('com a chave desligada, nada acontece', () => {
    // O padrão do código: `checkin.enabled` false.
    const OFF = DEFAULT_POINTS_CONFIG;

    it('o pedido de check-in é ignorado inteiro: nem carteira, nem extrato, nem shard, nem resultado', () => {
      // Com o jogo sem o filtro da carga e a melhor sequência acima dos marcos: a
      // chave desligada também segura o desbloqueio, e não só o filtro.
      const read = wallet({ balance: 10, checkin: streak(40, YESTERDAY) });
      const out = compute([checkin({ wallet: read, activity: noActivity })], {
        config: OFF,
        game: game(),
      });
      expect(out.results).toEqual([]);
      expect(out.pointsAwarded).toBe(0);
      expect(out.fans[0]).toEqual({ uid: 'fa', wallet: null, ledger: [], centrals: [] });
      expect(out.shard).toBeNull();
      expect('checkin' in out).toBe(false);
      expect(read.checkin).toEqual(streak(40, YESTERDAY));
    });

    it('o fã novo que pede o check-in não ganha carteira', () => {
      const out = compute([checkin({ activity: noActivity })], { config: OFF, game: game() });
      expect(out.fans[0]!.wallet).toBeNull();
      expect(out.rewards.unlockedAchievements).toEqual([]);
    });

    it('junto de outra ação, só a ação entra: a sequência fica vazia e o campo não nasce', () => {
      const out = compute([checkin({ entries: [comment('c1')] })], { config: OFF });
      expect(out.results).toEqual([
        { uid: 'fa', entryId: 'comment:c1', status: 'applied', points: 2 },
      ]);
      expect(out.fans[0]!.ledger.map((entry) => entry.id)).toEqual(['comment:c1']);
      expect(out.fans[0]!.wallet!.state.checkin).toEqual({ streak: 0, best: 0, lastDay: null });
      expect(out.fans[0]!.wallet!.state.days['2026-10-05']!.count).toEqual({ comment: 1 });
      expect('checkin' in out).toBe(false);
    });

    it('as conquistas de sequência saem do jogo da carga: nem o check-in pedido por quem tem a melhor sequência guardada destrava', () => {
      const achievements = { version: 3, achievements: CATALOG };
      const read = wallet({ checkin: streak(40, YESTERDAY) });
      const loaded = (config: PointsConfig) =>
        buildLoadedConfig({ points: config, achievements }).game;
      const play = (config: PointsConfig) =>
        compute([checkin({ wallet: read, entries: [comment('c1')] })], {
          config,
          game: loaded(config),
        });
      expect(loaded(OFF).achievements.some((item) => item.rule.type === 'streak')).toBe(false);
      const off = play(OFF);
      expect(off.results[0]).toMatchObject({ status: 'applied' });
      expect(off.rewards.unlockedAchievements).toEqual([]);
      expect(off.fans[0]!.wallet!.state.achievements).toEqual({});
      // A mesma carga com a chave ligada destrava as duas, no check-in.
      expect(play(ON).rewards.unlockedAchievements.map((item) => item.id)).toEqual([
        'sequencia-7',
        'sequencia-30',
      ]);
    });
  });

  it('o check-in é de quem pede: o de outro fã anda sem entrar no resultado nem nos pontos de quem chama', () => {
    const out = compute(
      [fan({ uid: 'quem-chama' }), checkin({ uid: 'outro', wallet: wallet({ balance: 1 }) })],
      { config: ON },
    );
    expect(out.pointsAwarded).toBe(0);
    expect(out.checkin).toBeUndefined();
    const other = out.fans.find((item) => item.uid === 'outro')!;
    expect(other.wallet!.state).toMatchObject({ balance: 4, checkin: streak(1, TODAY) });
  });

  it('o suspenso que não chama e o fã sem perfil não fazem check-in (26.6)', () => {
    const out = compute(
      [
        fan({ uid: 'quem-chama' }),
        // A melhor sequência acima dos marcos e o jogo com eles: a suspensão também
        // segura o desbloqueio.
        checkin({
          uid: 'suspenso',
          suspended: true,
          wallet: wallet({ checkin: streak(40, YESTERDAY) }),
        }),
        checkin({ uid: 'excluido', hasProfile: false }),
      ],
      { config: ON, game: game() },
    );
    expect(out.results).toEqual([]);
    expect(out.fans.map((item) => [item.uid, item.wallet])).toEqual([
      ['quem-chama', null],
      ['suspenso', null],
    ]);
    expect(out.shard).toBeNull();
  });

  it('a rota não manda o lançamento do check-in: só o núcleo monta (o pedido é `checkin: true`)', () => {
    const entry: AwardEntry = { kind: 'earn', source: 'checkin', eventId: '2026-10-05' };
    expect(() => assertValidEntry(entry)).toThrow(PointsError);
    expect(() => assertValidEntry(entry)).toThrow(/check-in/);
    expect(() => assertValidEntry({ ...entry, points: 15 })).toThrow(/check-in/);
    expect(() => compute([fan({ entries: [entry] })], { config: ON })).toThrow(/check-in/);
    // Pontos explícitos continuam só da missão.
    expect(() =>
      assertValidEntry({ kind: 'earn', source: 'comment', eventId: 'c', points: 5 }),
    ).toThrow(/missão/);
  });
});
