import { describe, expect, it } from 'vitest';

import { monthKey, shiftDay, weekKey } from '../day';
import { sumStatsDocs, type StatsSnapshot, type StatsTree } from './close';
import {
  buildSeedStats,
  closedTotals,
  SEED_RETENTION,
  SEED_SNAPSHOT_BASE,
  SEED_STATS_CENTRALS,
  SEED_STATS_DAYS,
  seedShopEvents,
  seedSnapshotOf,
  seedStatsDays,
  snapshotState,
  splitTotal,
  weekdayOf,
} from './stats-seed';

// Os números de 60 dias do seed dos emuladores (26.13): as relações que as
// telas do painel precisam (o retrato nunca negativo, o Netto à frente do
// Nenho em entradas nos 30 dias contando as reais do ranking, os únicos da
// semana e do mês coerentes, a retenção caindo) e as somas de 7, 30 e 60 dias
// presas, com o relógio fixo.

const T0 = Date.parse('2026-10-07T18:00:00.000Z');
const days = buildSeedStats(T0);
const today = '2026-10-07';

type Tree = { [key: string]: number | Tree };
const at = (tree: StatsTree, ...path: string[]): number => {
  let value: number | Tree | undefined = tree as Tree;
  for (const key of path) value = typeof value === 'object' ? value[key] : undefined;
  return typeof value === 'number' ? value : 0;
};
const lastDays = (n: number) => sumStatsDocs(days.slice(-n).map((item) => item.tree));

/** Todas as folhas numéricas de uma árvore. */
function leaves(tree: StatsTree, path = ''): [string, number][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'number' ? [[`${path}${key}`, value]] : leaves(value, `${path}${key}.`),
  ) as [string, number][];
}

/** As entradas reais do seed do ranking, 8 dias atrás (23.15). */
const RANKING_JOINS: Record<string, number> = { nenho: 49, nettobrito: 30, juninhomoraes: 7 };

describe('splitTotal e weekdayOf', () => {
  it('divide em inteiros que somam o total, na proporção dos pesos', () => {
    expect(splitTotal(10, [40, 30, 15, 8, 5, 2])).toEqual([4, 3, 2, 0, 1, 0]);
    expect(splitTotal(0, [1, 2])).toEqual([0, 0]);
    for (const total of [1, 7, 99, 553]) {
      const parts = splitTotal(total, [45, 25, 15, 10, 5]);
      expect(parts.reduce((acc, part) => acc + part, 0)).toBe(total);
      expect(parts.every((part) => part >= 0)).toBe(true);
    }
  });

  it('segunda é 0 e domingo é 6', () => {
    expect(weekdayOf('2026-10-05')).toBe(0);
    expect(weekdayOf('2026-10-07')).toBe(2);
    expect(weekdayOf('2026-10-11')).toBe(6);
  });
});

describe('os 60 dias do seed', () => {
  it('vão de 60 dias atrás até ontem, um shard por dia, sem número negativo nem zero guardado', () => {
    expect(seedStatsDays(T0)).toHaveLength(SEED_STATS_DAYS);
    expect(days.map((item) => item.day)).toEqual(
      Array.from({ length: SEED_STATS_DAYS }, (_, index) => shiftDay(today, index - 60)),
    );
    for (const { tree } of days) {
      for (const [path, value] of leaves(tree)) {
        expect(Number.isInteger(value), path).toBe(true);
        if (!path.startsWith('totals.adjusted') && !path.startsWith('bySource.adjustment')) {
          expect(value, path).toBeGreaterThan(0);
        }
      }
    }
  });

  it('cresce ao longo dos 60 dias e tem mais movimento no fim de semana', () => {
    const signups = (from: number, to: number) =>
      days.slice(from, to).reduce((acc, item) => acc + at(item.tree, 'signups', 'total'), 0);
    expect(signups(53, 60)).toBeGreaterThan(signups(0, 7) * 1.6);
    for (const [index, item] of days.entries()) {
      if (weekdayOf(item.day) !== 5 || index < 1) continue;
      // O sábado passa da sexta, nos cadastros, nas curtidas e nos ativos.
      for (const path of [
        ['signups', 'total'],
        ['totals', 'likes'],
        ['actives', 'day'],
      ]) {
        expect(at(item.tree, ...path)).toBeGreaterThan(at(days[index - 1]!.tree, ...path));
      }
    }
  });

  it('as partes fecham com os totais: convite, origens, centrais, pontos e loja', () => {
    for (const { tree } of days) {
      const invited = at(tree, 'signups', 'invited');
      expect(invited).toBeLessThanOrEqual(at(tree, 'signups', 'total'));
      const kinds = ['post', 'artist', 'invite', 'agenda', 'code'];
      expect(
        kinds.reduce((acc, kind) => acc + at(tree, 'byOrigin', 'kind', kind, 'signups'), 0),
      ).toBe(invited);
      for (const field of ['utmSource', 'utmCampaign']) {
        const map = (tree.byOrigin as StatsTree)[field] as StatsTree;
        expect(Object.keys(map).reduce((acc, key) => acc + at(map, key, 'signups'), 0)).toBe(
          invited,
        );
      }
      expect(
        kinds.reduce((acc, kind) => acc + at(tree, 'byOrigin', 'kind', kind, 'visits'), 0),
      ).toBe(at(tree, 'invites', 'visits'));
      for (const flow of ['likes', 'comments', 'rsvps', 'joined', 'left', 'earned']) {
        const perArtist = SEED_STATS_CENTRALS.reduce(
          (acc, [id]) => acc + at(tree, 'byArtist', id, flow),
          0,
        );
        if (flow === 'earned') expect(perArtist).toBeLessThanOrEqual(at(tree, 'totals', 'earned'));
        else expect(perArtist).toBe(at(tree, 'totals', flow));
      }
      const earned = [
        'like',
        'comment',
        'rsvp',
        'central_join',
        'mission',
        'invite_visit',
        'invite_signup',
      ]
        .map((source) => at(tree, 'bySource', source, 'points'))
        .reduce((acc, points) => acc + points, 0);
      expect(earned).toBe(at(tree, 'totals', 'earned'));
      expect(at(tree, 'bySource', 'adjustment', 'points')).toBe(at(tree, 'totals', 'adjusted'));
      expect(at(tree, 'bySource', 'redeem', 'points')).toBe(at(tree, 'totals', 'spent'));
      expect(at(tree, 'bySource', 'redeem_refund', 'points')).toBe(at(tree, 'totals', 'refunded'));
      expect(at(tree, 'bySource', 'seed', 'points')).toBe(0);
    }
  });

  it('ativos: os novos da semana e do mês nunca passam dos ativos do dia; os únicos cabem nos fãs', () => {
    let fans = SEED_SNAPSHOT_BASE.fans;
    const weekly = new Map<string, number>();
    const monthly = new Map<string, number>();
    for (const { day, tree } of days) {
      fans += at(tree, 'signups', 'total');
      const day_ = at(tree, 'actives', 'day');
      expect(at(tree, 'actives', 'newInWeek')).toBeLessThanOrEqual(day_);
      expect(at(tree, 'actives', 'newInMonth')).toBeLessThanOrEqual(day_);
      weekly.set(weekKey(day), (weekly.get(weekKey(day)) ?? 0) + at(tree, 'actives', 'newInWeek'));
      monthly.set(
        monthKey(day),
        (monthly.get(monthKey(day)) ?? 0) + at(tree, 'actives', 'newInMonth'),
      );
      expect(weekly.get(weekKey(day))!).toBeLessThan(fans);
      expect(monthly.get(monthKey(day))!).toBeLessThan(fans);
    }
    // O mês inteiro (setembro) tem mais únicos que qualquer semana dentro dele.
    const september = monthly.get('2026-09')!;
    for (const week of ['2026-W37', '2026-W38', '2026-W39']) {
      expect(september).toBeGreaterThan(weekly.get(week)!);
    }
  });

  it('a retenção de cada coorte cai semana a semana e nunca passa de 100%', () => {
    const signupsByWeek = new Map<string, number>();
    const activeBy = new Map<string, number>();
    for (const { day, tree } of days) {
      const week = weekKey(day);
      signupsByWeek.set(week, (signupsByWeek.get(week) ?? 0) + at(tree, 'signups', 'total'));
      const cohorts = (tree.cohorts ?? {}) as StatsTree;
      for (const cohort of Object.keys(cohorts)) {
        const key = `${cohort}|${week}`;
        activeBy.set(key, (activeBy.get(key) ?? 0) + at(cohorts, cohort, 'active'));
      }
    }
    const weeks = [...signupsByWeek.keys()];
    // As coortes inteiras na janela (sem a primeira, parcial, e as duas últimas, curtas).
    for (const cohort of weeks.slice(1, -2)) {
      const rates = weeks
        .slice(weeks.indexOf(cohort), weeks.length - 1)
        .map((week) => (activeBy.get(`${cohort}|${week}`) ?? 0) / signupsByWeek.get(cohort)!);
      expect(rates[0]).toBeCloseTo(SEED_RETENTION[0], 1);
      for (let index = 1; index < rates.length; index += 1) {
        expect(rates[index]!).toBeLessThan(rates[index - 1]!);
        expect(rates[index]!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a loja: só recompensas sem estoque, cada pedido decidido uma vez, recusa com os pontos de volta', () => {
    const events = seedShopEvents();
    const requested = events.filter((event) => event.kind === 'requested');
    expect(requested.length).toBeGreaterThan(15);
    expect(new Set(requested.map((event) => event.rewardId))).toEqual(
      new Set(['ingressos', 'videochamada', 'camisa', 'telao']),
    );
    for (const event of events.filter((item) => item.kind === 'refused')) {
      expect(event.points).toBeGreaterThan(0);
    }
    expect(events.every((event) => event.daysAgo >= 1 && event.daysAgo <= SEED_STATS_DAYS)).toBe(
      true,
    );
  });
});

describe('as somas presas (26.13)', () => {
  const headline = (n: number) => {
    const sum = lastDays(n);
    return {
      signups: at(sum, 'signups', 'total'),
      invited: at(sum, 'signups', 'invited'),
      visits: at(sum, 'invites', 'visits'),
      links: at(sum, 'invites', 'links'),
      earned: at(sum, 'totals', 'earned'),
      earnedEvents: at(sum, 'totals', 'earnedEvents'),
      spent: at(sum, 'totals', 'spent'),
      refunded: at(sum, 'totals', 'refunded'),
      adjusted: at(sum, 'totals', 'adjusted'),
      adjustedEvents: at(sum, 'totals', 'adjustedEvents'),
      likes: at(sum, 'totals', 'likes'),
      unlikes: at(sum, 'totals', 'unlikes'),
      comments: at(sum, 'totals', 'comments'),
      rsvps: at(sum, 'totals', 'rsvps'),
      rsvpsUndone: at(sum, 'totals', 'rsvpsUndone'),
      reports: at(sum, 'totals', 'reports'),
      blocks: at(sum, 'totals', 'blocks'),
      joined: at(sum, 'totals', 'joined'),
      left: at(sum, 'totals', 'left'),
      redeemRequested: at(sum, 'totals', 'redeemRequested'),
      redeemApproved: at(sum, 'totals', 'redeemApproved'),
      redeemDelivered: at(sum, 'totals', 'redeemDelivered'),
      redeemRefused: at(sum, 'totals', 'redeemRefused'),
      activesDay: at(sum, 'actives', 'day'),
      newInWeek: at(sum, 'actives', 'newInWeek'),
      newInMonth: at(sum, 'actives', 'newInMonth'),
      bySource: Object.fromEntries(
        Object.keys(sum.bySource as StatsTree).map((source) => [
          source,
          at(sum, 'bySource', source, 'points'),
        ]),
      ),
      joinedByArtist: Object.fromEntries(
        SEED_STATS_CENTRALS.map(([id]) => [id, at(sum, 'byArtist', id, 'joined')]),
      ),
    };
  };

  it('7 dias', () => {
    expect(headline(7)).toEqual({
      signups: 299,
      invited: 118,
      visits: 323,
      links: 101,
      earned: 12_074,
      earnedEvents: 1_782,
      spent: 41_000,
      refunded: 15_000,
      adjusted: 400,
      adjustedEvents: 1,
      likes: 2_965,
      unlikes: 178,
      comments: 559,
      rsvps: 89,
      rsvpsUndone: 9,
      reports: 2,
      blocks: 1,
      joined: 553,
      left: 39,
      redeemRequested: 3,
      redeemApproved: 1,
      redeemDelivered: 1,
      redeemRefused: 1,
      activesDay: 1_744,
      newInWeek: 758,
      newInMonth: 811,
      bySource: {
        comment: 1_118,
        central_join: 5_530,
        invite_visit: 646,
        invite_signup: 1_180,
        mission: 3_600,
        redeem: 41_000,
        adjustment: 400,
        redeem_refund: 15_000,
      },
      joinedByArtist: {
        nettobrito: 221,
        nenho: 166,
        juninhomoraes: 83,
        rocksalles: 44,
        artista5: 30,
        artista6: 9,
      },
    });
  });

  it('30 dias', () => {
    expect(headline(30)).toEqual({
      signups: 1_121,
      invited: 418,
      visits: 1_154,
      links: 378,
      earned: 44_005,
      earnedEvents: 6_446,
      spent: 140_000,
      refunded: 23_500,
      adjusted: 1_000,
      adjustedEvents: 3,
      likes: 10_600,
      unlikes: 636,
      comments: 1_996,
      rsvps: 315,
      rsvpsUndone: 37,
      reports: 8,
      blocks: 3,
      joined: 2_059,
      left: 145,
      redeemRequested: 11,
      redeemApproved: 8,
      redeemDelivered: 8,
      redeemRefused: 2,
      activesDay: 6_235,
      newInWeek: 2_825,
      newInMonth: 1_519,
      bySource: {
        comment: 3_992,
        central_join: 20_590,
        invite_visit: 2_308,
        invite_signup: 4_180,
        mission: 12_935,
        redeem: 140_000,
        adjustment: 1_000,
        redeem_refund: 23_500,
      },
      joinedByArtist: {
        nettobrito: 822,
        nenho: 621,
        juninhomoraes: 307,
        rocksalles: 165,
        artista5: 106,
        artista6: 38,
      },
    });
  });

  it('60 dias', () => {
    expect(headline(60)).toEqual({
      signups: 1_855,
      invited: 646,
      visits: 1_792,
      links: 614,
      earned: 70_134,
      earnedEvents: 10_204,
      spent: 253_500,
      refunded: 49_500,
      adjusted: 2_600,
      adjustedEvents: 7,
      likes: 16_570,
      unlikes: 997,
      comments: 3_120,
      rsvps: 490,
      rsvpsUndone: 57,
      reports: 15,
      blocks: 7,
      joined: 3_370,
      left: 234,
      redeemRequested: 21,
      redeemApproved: 16,
      redeemDelivered: 15,
      redeemRefused: 4,
      activesDay: 9_746,
      newInWeek: 4_373,
      newInMonth: 2_421,
      bySource: {
        comment: 6_240,
        central_join: 33_700,
        invite_visit: 3_584,
        invite_signup: 6_460,
        mission: 20_150,
        adjustment: 2_600,
        redeem: 253_500,
        redeem_refund: 49_500,
      },
      joinedByArtist: {
        nettobrito: 1_345,
        nenho: 1_019,
        juninhomoraes: 502,
        rocksalles: 271,
        artista5: 165,
        artista6: 68,
      },
    });
  });

  it('o Netto passa o Nenho em entradas nos 30 dias, mesmo com as 49 e as 30 reais; o Juninho fica atrás dos dois', () => {
    const sum = lastDays(30);
    const joins = (id: string) => at(sum, 'byArtist', id, 'joined') + (RANKING_JOINS[id] ?? 0);
    expect(joins('nettobrito')).toBeGreaterThan(joins('nenho'));
    expect(joins('juninhomoraes')).toBeLessThan(joins('nenho'));
  });

  it('os "Ajustes da equipe" são poucos e ficam fora dos pontos distribuídos', () => {
    const sum = lastDays(60);
    expect(at(sum, 'bySource', 'adjustment', 'events')).toBe(7);
    expect(at(sum, 'totals', 'earned')).toBe(70_134);
  });
});

describe('seedSnapshotOf', () => {
  const real = (day: string): StatsTree =>
    day === shiftDay(today, -8)
      ? {
          byArtist: Object.fromEntries(
            Object.entries(RANKING_JOINS).map(([id, joined]) => [id, { joined }]),
          ),
        }
      : {};

  it('anda para a frente a partir da base, sem nenhum número negativo, com a temporada do dia', () => {
    const snapshotOf = seedSnapshotOf(T0);
    const snapshots: StatsSnapshot[] = [];
    for (const { day, tree } of days) {
      const sum = sumStatsDocs([tree, real(day)]);
      snapshots.push(snapshotOf(day, sum)!);
    }
    for (const snapshot of snapshots) {
      expect(snapshot.fans).toBeGreaterThan(0);
      for (const value of Object.values(snapshot.artists)) {
        expect(value.members).toBeGreaterThanOrEqual(0);
        expect(value.totalPoints).toBeGreaterThanOrEqual(0);
      }
      if (snapshot.season) expect(snapshot.season.rankedFans).toBeLessThanOrEqual(snapshot.fans);
    }
    const last = snapshots.at(-1)!;
    expect(last.fans).toBe(SEED_SNAPSHOT_BASE.fans + at(lastDays(60), 'signups', 'total'));
    expect(last.artists.nenho!.members).toBe(
      SEED_SNAPSHOT_BASE.artists.nenho!.members +
        at(lastDays(60), 'byArtist', 'nenho', 'joined') -
        at(lastDays(60), 'byArtist', 'nenho', 'left') +
        49,
    );
    expect(last.artists.artista7).toEqual({ members: 0, totalPoints: 0 });
    // Hoje (São João em andamento), 40 a 18 dias atrás (nenhuma), 60 dias atrás (Carnaval).
    expect(last.season?.id).toBe('temporada-sao-joao');
    expect(snapshots[60 - 30]!.season).toBeNull();
    expect(snapshots[0]!.season?.id).toBe('temporada-carnaval');
    // A hora do fechamento: 00:20 do dia seguinte.
    expect(new Date(snapshots[0]!.at).toISOString()).toBe('2026-08-09T03:20:00.000Z');
  });

  it('a transação que repete recebe o mesmo retrato, e o estado anda uma vez só', () => {
    const snapshotOf = seedSnapshotOf(T0);
    const first = snapshotOf(days[0]!.day, days[0]!.tree);
    expect(snapshotOf(days[0]!.day, days[0]!.tree)).toBe(first);
    const second = snapshotOf(days[1]!.day, days[1]!.tree)!;
    expect(second.fans).toBe(first!.fans + at(days[1]!.tree, 'signups', 'total'));
  });

  it('parte do retrato do último dia fechado, quando ele existe', () => {
    const start = snapshotState({
      at: 0,
      fans: 2_000,
      season: null,
      artists: { nenho: { members: 10, totalPoints: 5 }, torto: 'x' },
    });
    expect(start).toEqual({ fans: 2_000, artists: { nenho: { members: 10, totalPoints: 5 } } });
    expect(snapshotState(null)).toBeNull();
    expect(snapshotState({ fans: 'x' })).toBeNull();
    const next = seedSnapshotOf(T0, start)(days.at(-1)!.day, days.at(-1)!.tree)!;
    expect(next.fans).toBe(2_000 + at(days.at(-1)!.tree, 'signups', 'total'));
    expect(next.artists.nenho!.members).toBe(
      10 +
        at(days.at(-1)!.tree, 'byArtist', 'nenho', 'joined') -
        at(days.at(-1)!.tree, 'byArtist', 'nenho', 'left'),
    );
  });
});

describe('closedTotals', () => {
  it('soma só os dias fechados, com a média dos ativos e os fãs do último retrato', () => {
    const totals = closedTotals('2026-10-01', '2026-10-03', [
      {
        day: '2026-10-02',
        closed: true,
        signups: { total: 5, invited: 2 },
        totals: { earned: 10, likes: 3, redeemRequested: 1, refunded: 4 },
        bySource: { adjustment: { points: -20, events: 1 }, redeem: { points: 6_000, events: 1 } },
        actives: { day: 9 },
        snapshot: { fans: 300 },
      },
      {
        day: '2026-10-01',
        closed: true,
        signups: { total: 1 },
        actives: { day: 4 },
        snapshot: { fans: 290 },
      },
      { day: '2026-10-03', closed: false, signups: { total: 100 } },
    ]);
    expect(totals).toMatchObject({
      closedDays: 2,
      fans: 300,
      signups: 6,
      invited: 2,
      earned: 10,
      adjustmentPoints: -20,
      adjustmentEvents: 1,
      activesAverage: 7,
      likes: 3,
      redeemRequested: 1,
      redeemSpent: 6_000,
      refunded: 4,
    });
    expect(closedTotals('a', 'b', []).fans).toBeNull();
  });
});
