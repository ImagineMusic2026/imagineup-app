import { describe, expect, it } from 'vitest';

import { DEFAULT_ACHIEVEMENTS_CONFIG } from '../achievements/model';
import {
  keyDigest,
  missionIndex,
  type MissionRecord,
  type MissionTick,
  type SeasonGoalConfig,
} from '../missions/model';
import { DEFAULT_POINTS_CONFIG } from './config';
import {
  activityMarks,
  computeAwards,
  emptyCentral,
  emptyWallet,
  levelForXp,
  PointsError,
  seasonsPlayed,
  trimDays,
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
