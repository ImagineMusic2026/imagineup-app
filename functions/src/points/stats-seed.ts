import { FieldPath, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { dayKey, nextDayStart, shiftDay, weekKey } from '../day';
import { SEED_MISSIONS } from '../missions/seed';
import { SEED_PAST_SEASONS } from '../ranking/seed';
import { SEED_REWARDS } from '../rewards/seed';
import {
  readLastClosedDay,
  runStatsClose,
  startStatsClose,
  statsDayRef,
  type CloseLog,
  type SnapshotOf,
  type StatsCloseResult,
  type StatsSnapshot,
  type StatsTree,
} from './close';
import { DEFAULT_POINTS_CONFIG } from './config';
import { EARN_SOURCES } from './model';
import { noonDaysAgo, SEED_SEASON } from './seed';
import { emptyArtistCount, emptyShardDelta, pruneZeros, type ShardDelta } from './stats';

// Os números de 60 dias do seed dos emuladores (bloco 11,
// docs/arquitetura-api.md, 26.13): um shard `seed` por dia, de 60 dias atrás
// até ontem, com fórmulas (mais movimento no fim de semana, crescimento ao
// longo dos 60 dias, as campanhas, os ativos coerentes com os únicos da semana
// e do mês, a retenção caindo semana a semana), e o retrato da noite montado
// para a frente a partir de uma base inventada, para as telas de números do
// painel terem o que mostrar. Nunca roda em produção: o script fixa o emulador.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias de números do seed, até ontem. */
export const SEED_STATS_DAYS = 60;

/** O id do shard do seed em cada dia (os reais são de 0 a 63, e a carga é `backfill`). */
export const SEED_STATS_SHARD = 'seed';

/** As centrais do seed com movimento, e o peso de cada uma (o Netto à frente do Nenho). */
export const SEED_STATS_CENTRALS: readonly (readonly [string, number])[] = [
  ['nettobrito', 40],
  ['nenho', 30],
  ['juninhomoraes', 15],
  ['rocksalles', 8],
  ['artista5', 5],
  ['artista6', 2],
];

/** Retenção da coorte na semana do cadastro (0) e nas 8 seguintes. */
export const SEED_RETENTION = [0.85, 0.46, 0.34, 0.28, 0.24, 0.21, 0.19, 0.17, 0.16] as const;

/** Como os novos da semana se espalham pelos dias, de segunda a domingo (a segunda junta mais). */
const WEEK_WEIGHTS = [100, 50, 38, 30, 25, 32, 30] as const;

/** Fãs de antes da janela ativos na primeira semana (cai 12% por semana). */
const LEGACY_WEEKLY = 160;

/** Ajustes da equipe de exemplo (poucos): um a cada 9 dias, nesta ordem. */
const SEED_ADJUSTMENTS = [500, -200, 1_000, 300, -150, 750, 400] as const;

/** As recompensas sem estoque do seed, na ordem em que os pedidos de exemplo as escolhem. */
const SHOP_ROTATION = ['ingressos', 'videochamada', 'camisa', 'telao'] as const;

/** O retrato de 60 dias atrás, inventado, de onde o seed soma os fluxos de cada dia. */
export const SEED_SNAPSHOT_BASE: {
  fans: number;
  artists: Record<string, { members: number; totalPoints: number }>;
} = {
  fans: 1_050,
  artists: {
    nettobrito: { members: 520, totalPoints: 182_000 },
    nenho: { members: 430, totalPoints: 151_000 },
    juninhomoraes: { members: 160, totalPoints: 41_000 },
    rocksalles: { members: 95, totalPoints: 22_500 },
    artista5: { members: 60, totalPoints: 12_800 },
    artista6: { members: 25, totalPoints: 4_900 },
    artista7: { members: 0, totalPoints: 0 },
    artista8: { members: 35, totalPoints: 9_300 },
  },
};

/** Divide `total` pelos pesos, em inteiros que somam `total` (arredondamento acumulado). */
export function splitTotal(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const out: number[] = [];
  let cumulative = 0;
  let given = 0;
  for (const weight of weights) {
    cumulative += weight;
    const upTo = sum === 0 ? 0 : Math.round((total * cumulative) / sum);
    out.push(upTo - given);
    given = upTo;
  }
  return out;
}

/** O dia da semana ISO do dia de calendário: 0 é segunda, 6 é domingo. */
export function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return (new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay() + 6) % 7;
}

/** A parte do dia de um total da semana, pelos pesos de segunda a domingo. */
function shareOfWeek(total: number, weekday: number): number {
  return splitTotal(total, WEEK_WEIGHTS)[weekday]!;
}

type SeedDay = {
  day: string;
  daysAgo: number;
  /** De 0 (60 dias atrás) a 1 (ontem): o crescimento. */
  t: number;
  weekday: number;
  weekend: boolean;
  week: string;
  monthDay: number;
};

/** Os 60 dias do seed, do mais antigo a ontem. */
export function seedStatsDays(now: number): { day: string; daysAgo: number }[] {
  const today = dayKey(now);
  return Array.from({ length: SEED_STATS_DAYS }, (_, index) => {
    const daysAgo = SEED_STATS_DAYS - index;
    return { day: shiftDay(today, -daysAgo), daysAgo };
  });
}

function seedDays(now: number): SeedDay[] {
  return seedStatsDays(now).map(({ day, daysAgo }) => {
    const weekday = weekdayOf(day);
    return {
      day,
      daysAgo,
      t: (SEED_STATS_DAYS - daysAgo) / (SEED_STATS_DAYS - 1),
      weekday,
      weekend: weekday >= 5,
      week: weekKey(day),
      monthDay: Number(day.slice(8, 10)),
    };
  });
}

/** Cadastros do dia: de 16 a 40, com 35% a mais no fim de semana. */
function signupsOf(info: SeedDay): number {
  return Math.round((16 + 24 * info.t) * (info.weekend ? 1.35 : 1));
}

/** A parte dos cadastros que veio de convite: de 28% a 40%. */
function invitedOf(info: SeedDay, signups: number): number {
  return Math.round(signups * (0.28 + 0.12 * info.t));
}

/** Os novos do dia que já agem no dia (a coorte da semana na semana dela). */
const firstWeekActives = (signups: number) => Math.round(signups * SEED_RETENTION[0]);

type Activity = {
  actives: { day: number; newInWeek: number; newInMonth: number };
  cohorts: Record<string, { active: number }>;
};

/**
 * Os ativos de cada dia: os únicos da semana são os novos (a coorte da semana)
 * mais cada coorte das 8 semanas anteriores pela retenção e os fãs de antes da
 * janela, espalhados pelos dias da semana; os ativos do dia são esses mais os
 * que voltam no resto da semana; os únicos do mês caem com o dia do mês. Nunca
 * acima dos ativos do dia.
 */
function activityOf(days: readonly SeedDay[], signups: ReadonlyMap<string, number>) {
  const weeks: string[] = [];
  const cohortSize = new Map<string, number>();
  for (const info of days) {
    if (!weeks.includes(info.week)) weeks.push(info.week);
    cohortSize.set(info.week, (cohortSize.get(info.week) ?? 0) + signups.get(info.day)!);
  }
  const out = new Map<string, Activity>();
  const earlierInWeek = new Map<string, number>();
  for (const info of days) {
    const weekIndex = weeks.indexOf(info.week);
    const own = firstWeekActives(signups.get(info.day)!);
    const cohorts: Record<string, { active: number }> = {};
    if (own > 0) cohorts[info.week] = { active: own };
    let newInWeek = own;
    for (let back = 1; back < SEED_RETENTION.length && back <= weekIndex; back += 1) {
      const cohort = weeks[weekIndex - back]!;
      const count = Math.round(cohortSize.get(cohort)! * SEED_RETENTION[back]!);
      const active = shareOfWeek(count, info.weekday);
      if (active > 0) cohorts[cohort] = { active };
      newInWeek += active;
    }
    newInWeek += shareOfWeek(Math.round(LEGACY_WEEKLY * 0.88 ** weekIndex), info.weekday);
    const earlier = earlierInWeek.get(info.week) ?? 0;
    const returning = Math.round(0.34 * earlier * (info.weekend ? 1.3 : 1));
    earlierInWeek.set(info.week, earlier + newInWeek);
    const day = newInWeek + returning;
    const newInMonth =
      info.monthDay === 1 ? day : Math.max(own, Math.round(day / (1 + 0.55 * (info.monthDay - 1))));
    out.set(info.day, { actives: { day, newInWeek, newInMonth }, cohorts });
  }
  return out;
}

function addSource(delta: ShardDelta, artistIds: readonly string[], source: string) {
  return (points: number, events: number, perArtist?: readonly number[]) => {
    if (events <= 0) return;
    const count = (delta.bySource[source] ??= { points: 0, events: 0 });
    count.points += points;
    count.events += events;
    if (!perArtist) return;
    const perPoint = points / events;
    artistIds.forEach((artistId, index) => {
      const n = perArtist[index]!;
      if (n <= 0) return;
      const artist = (delta.byArtist[artistId] ??= emptyArtistCount());
      const bySource = (artist.bySource[source] ??= { points: 0, events: 0 });
      bySource.points += n * perPoint;
      bySource.events += n;
    });
  };
}

type ShopEvent = {
  daysAgo: number;
  rewardId: string;
  kind: 'requested' | 'approved' | 'delivered' | 'refused';
  points: number;
};

/**
 * Os pedidos de exemplo da loja: um a cada 4 dias e mais um a cada 11, nas
 * recompensas sem estoque, em rodízio; cada quinto pedido é recusado no dia
 * seguinte (com os pontos de volta), os outros são aprovados no dia seguinte e
 * entregues três dias depois do pedido (os que ainda cabem até ontem).
 */
export function seedShopEvents(): ShopEvent[] {
  const events: ShopEvent[] = [];
  let index = 0;
  for (let daysAgo = SEED_STATS_DAYS; daysAgo >= 1; daysAgo -= 1) {
    const requests = (daysAgo % 4 === 1 ? 1 : 0) + (daysAgo % 11 === 3 ? 1 : 0);
    for (let n = 0; n < requests; n += 1) {
      const rewardId = SHOP_ROTATION[index % SHOP_ROTATION.length]!;
      const cost = SEED_REWARDS.find((reward) => reward.id === rewardId)!.cost;
      events.push({ daysAgo, rewardId, kind: 'requested', points: cost });
      if (index % 5 === 3) {
        if (daysAgo - 1 >= 1)
          events.push({ daysAgo: daysAgo - 1, rewardId, kind: 'refused', points: cost });
      } else {
        if (daysAgo - 1 >= 1)
          events.push({ daysAgo: daysAgo - 1, rewardId, kind: 'approved', points: 0 });
        if (daysAgo - 3 >= 1)
          events.push({ daysAgo: daysAgo - 3, rewardId, kind: 'delivered', points: 0 });
      }
      index += 1;
    }
  }
  return events;
}

const ENGAGEMENT_KEYS = [
  'likes',
  'unlikes',
  'comments',
  'rsvps',
  'rsvpsUndone',
  'reports',
] as const;
type EngagementKey = (typeof ENGAGEMENT_KEYS)[number];
type FlowKey = EngagementKey | 'joined' | 'left';

const REDEEM_TOTALS = {
  requested: 'redeemRequested',
  approved: 'redeemApproved',
  delivered: 'redeemDelivered',
  refused: 'redeemRefused',
} as const;

/**
 * O shard `seed` de cada um dos 60 dias (puro, do mais antigo a ontem), no
 * formato dos shards (seção 7, 20.7, 21.10, 25.3), sem zeros. Os valores dos
 * pontos são os do padrão do código; as missões, as do catálogo do seed.
 */
export function buildSeedStats(now: number): { day: string; daysAgo: number; tree: StatsTree }[] {
  const days = seedDays(now);
  const signups = new Map(days.map((info) => [info.day, signupsOf(info)]));
  const activity = activityOf(days, signups);
  const shop = seedShopEvents();
  const values = DEFAULT_POINTS_CONFIG.values;
  const artistIds = SEED_STATS_CENTRALS.map(([id]) => id);
  const weights = SEED_STATS_CENTRALS.map(([, weight]) => weight);
  let adjustmentIndex = 0;

  return days.map((info) => {
    const delta = emptyShardDelta();
    const total = signups.get(info.day)!;
    const invited = invitedOf(info, total);
    const { actives, cohorts } = activity.get(info.day)!;
    const a = actives.day;
    delta.actives = actives;
    delta.cohorts = cohorts;
    delta.signups = { total, invited };

    // Origem: cadastros por tipo de link, campanha e origem; visitas e links.
    const links = Math.round((5 + 9 * info.t) * (info.weekend ? 1.25 : 1));
    const visits = Math.round(invited * 2.4 + links * 0.4);
    delta.invites = { visits, links };
    const [post, artist, invite, agenda, code] = splitTotal(invited, [45, 25, 15, 10, 5]);
    const [visitPost, visitArtist, visitInvite, visitAgenda] = splitTotal(visits, [45, 25, 20, 10]);
    const [linkPost, linkArtist, linkInvite, linkAgenda] = splitTotal(links, [40, 25, 25, 10]);
    delta.byOrigin.kind = {
      post: { signups: post!, visits: visitPost!, links: linkPost! },
      artist: { signups: artist!, visits: visitArtist!, links: linkArtist! },
      invite: { signups: invite!, visits: visitInvite!, links: linkInvite! },
      agenda: { signups: agenda!, visits: visitAgenda!, links: linkAgenda! },
      code: { signups: code!, visits: 0, links: 0 },
    };
    const [instagram, whatsapp, noSource] = splitTotal(invited, [55, 30, 15]);
    delta.byOrigin.utmSource = {
      instagram: { signups: instagram! },
      whatsapp: { signups: whatsapp! },
      _none: { signups: noSource! },
    };
    const campaign = info.daysAgo <= 30 ? 'sao-joao' : 'lancamento-clipe';
    delta.byOrigin.utmCampaign = {
      [campaign]: { signups: post! },
      _none: { signups: invited - post! },
    };

    // Engajamento, no total e por central; entradas e saídas das centrais.
    const likes = Math.round(a * 1.7);
    const rsvps = Math.round(a * 0.05);
    const comments = Math.round(a * 0.32);
    const engagement: Record<EngagementKey, number> = {
      likes,
      unlikes: Math.round(likes * 0.06),
      comments,
      rsvps,
      rsvpsUndone: Math.round(rsvps * 0.12),
      reports: (info.daysAgo % 4 === 2 ? 1 : 0) + Math.round(comments * 0.004),
    };
    const joined = Math.round(total * 1.5 + a * 0.06);
    const left = Math.round(joined * 0.07);
    const flows: Record<FlowKey, number> = { ...engagement, joined, left };
    const perArtist = {} as Record<FlowKey, number[]>;
    for (const key of Object.keys(flows) as FlowKey[]) {
      perArtist[key] = splitTotal(flows[key], weights);
      delta.totals[key] = flows[key];
    }
    delta.totals.blocks = info.daysAgo % 9 === 5 ? 1 : 0;
    artistIds.forEach((artistId, index) => {
      const count = (delta.byArtist[artistId] ??= emptyArtistCount());
      for (const key of Object.keys(flows) as FlowKey[]) count[key] = perArtist[key][index]!;
    });

    // Pontos ganhos, pelas origens com valor e pelas missões do catálogo.
    addSource(delta, artistIds, 'comment')(
      comments * values.comment,
      values.comment > 0 ? comments : 0,
      perArtist.comments,
    );
    addSource(delta, artistIds, 'like')(
      likes * values.like,
      values.like > 0 ? likes : 0,
      perArtist.likes,
    );
    addSource(delta, artistIds, 'rsvp')(
      rsvps * values.rsvp,
      values.rsvp > 0 ? rsvps : 0,
      perArtist.rsvps,
    );
    addSource(delta, artistIds, 'central_join')(
      joined * values.central_join,
      values.central_join > 0 ? joined : 0,
      perArtist.joined,
    );
    addSource(
      delta,
      artistIds,
      'invite_visit',
    )(visits * values.invite_visit, values.invite_visit > 0 ? visits : 0);
    addSource(
      delta,
      artistIds,
      'invite_signup',
    )(invited * values.invite_signup, values.invite_signup > 0 ? invited : 0);
    const completions: Record<string, number> = {
      'm-clipe-netto': Math.round(a * 0.03),
      'm-curtir-nenho': Math.round(a * 0.05),
      'm-comentar-central': Math.round(a * 0.025),
      'm-trazer-amigos': Math.round(invited * 0.08),
      'm-presenca-show': Math.round(rsvps * 0.4),
    };
    for (const mission of SEED_MISSIONS) {
      const completed = completions[mission.id] ?? 0;
      if (completed <= 0) continue;
      delta.byMission[mission.id] = { completed };
      const missionArtist = mission.target?.artistId ?? null;
      addSource(delta, artistIds, 'mission')(
        completed * mission.rewardPoints,
        completed,
        missionArtist ? artistIds.map((id) => (id === missionArtist ? completed : 0)) : undefined,
      );
    }
    for (const source of EARN_SOURCES) {
      const count = delta.bySource[source];
      if (!count) continue;
      delta.totals.earned += count.points;
      delta.totals.earnedEvents += count.events;
    }
    for (const artistId of artistIds) {
      const artist = delta.byArtist[artistId];
      if (!artist) continue;
      for (const count of Object.values(artist.bySource)) {
        artist.earned += count.points;
        artist.earnedEvents += count.events;
      }
    }

    // Conquistas desbloqueadas.
    const own = firstWeekActives(total);
    const unlocked: Record<string, number> = {
      'missao-cumprida': Math.round(own * 0.22),
      'puxa-conversa': Math.round(own * 0.18),
      'boca-a-boca': Math.round(invited * 0.12),
      'fa-de-show': Math.round(own * 0.05),
      'pe-de-serra': Math.round(a * 0.015),
      sanfona: info.daysAgo % 3 === 0 ? 1 : 0,
    };
    for (const [id, value] of Object.entries(unlocked)) {
      if (value > 0) delta.byAchievement[id] = { unlocked: value };
    }

    // Ajustes da equipe (poucos), só no total de ajustes e por origem.
    if (info.daysAgo % 9 === 4) {
      const points = SEED_ADJUSTMENTS[adjustmentIndex % SEED_ADJUSTMENTS.length]!;
      adjustmentIndex += 1;
      delta.totals.adjusted += points;
      delta.totals.adjustedEvents += 1;
      delta.bySource.adjustment = { points, events: 1 };
    }

    // A loja: os pedidos, os pontos gastos e devolvidos e as transições.
    for (const event of shop.filter((item) => item.daysAgo === info.daysAgo)) {
      delta.totals[REDEEM_TOTALS[event.kind]] += 1;
      const reward = (delta.byReward[event.rewardId] ??= {
        requested: 0,
        spent: 0,
        approved: 0,
        delivered: 0,
        refused: 0,
        canceled: 0,
        refunded: 0,
      });
      reward[event.kind] += 1;
      if (event.kind === 'requested') {
        reward.spent += event.points;
        delta.totals.spent += event.points;
        delta.totals.spentEvents += 1;
        addSource(delta, artistIds, 'redeem')(event.points, 1);
      } else if (event.kind === 'refused') {
        reward.refunded += event.points;
        delta.totals.refunded += event.points;
        delta.totals.refundedEvents += 1;
        addSource(delta, artistIds, 'redeem_refund')(event.points, 1);
      }
    }

    return {
      day: info.day,
      daysAgo: info.daysAgo,
      tree: pruneZeros(delta as unknown as StatsTree),
    };
  });
}

/**
 * Grava o shard `seed` de cada dia dos 60 (com `set`: o mesmo dia e o mesmo
 * "agora" dão o mesmo conteúdo), só nos dias depois do `lastClosedDay`: o dia
 * fechado nunca recebe gravação (26.22). Devolve quantos dias gravou.
 */
export async function seedPanelStats(db: Firestore, now: number = Date.now()): Promise<number> {
  const lastClosed = await readLastClosedDay(db);
  let written = 0;
  for (const { day, daysAgo, tree } of buildSeedStats(now)) {
    if (lastClosed !== null && day <= lastClosed) continue;
    await statsDayRef(db, day)
      .collection('statsShards')
      .doc(SEED_STATS_SHARD)
      .set({ day, ...tree, updatedAt: Timestamp.fromMillis(noonDaysAgo(now, daysAgo)) });
    written += 1;
  }
  return written;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const isTree = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** O estoque de onde o retrato do seed anda: os fãs e cada central. */
export type SeedSnapshotState = {
  fans: number;
  artists: Record<string, { members: number; totalPoints: number }>;
};

/** O estado guardado no retrato de um dia fechado (o ponto de partida da rodada seguinte). */
export function snapshotState(snapshot: unknown): SeedSnapshotState | null {
  if (!isTree(snapshot) || typeof snapshot.fans !== 'number' || !isTree(snapshot.artists)) {
    return null;
  }
  const artists: SeedSnapshotState['artists'] = {};
  for (const [id, value] of Object.entries(snapshot.artists)) {
    if (!isTree(value)) continue;
    artists[id] = { members: num(value.members), totalPoints: num(value.totalPoints) };
  }
  return { fans: snapshot.fans, artists };
}

/** A temporada em andamento no instante `at` e os fãs com pontos nela, pelas datas do seed. */
function seedSeasonAt(now: number, at: number, fans: number): StatsSnapshot['season'] {
  const seasons = [
    {
      id: SEED_SEASON.id,
      startsAt: now - SEED_SEASON.startedDaysAgo * DAY_MS,
      endsAt: now + SEED_SEASON.endsInDays * DAY_MS,
    },
    ...SEED_PAST_SEASONS.map((season) => ({
      id: season.id,
      startsAt: noonDaysAgo(now, season.startedDaysAgo),
      endsAt: noonDaysAgo(now, season.endedDaysAgo),
    })),
  ];
  const season = seasons.find((item) => at >= item.startsAt && at < item.endsAt);
  if (!season) return null;
  const progress = (at - season.startsAt) / (season.endsAt - season.startsAt);
  return { id: season.id, rankedFans: Math.round(fans * (0.1 + 0.25 * progress)) };
}

/**
 * O retrato do seed (26.13), montado para a frente: parte da base inventada
 * (ou do retrato do último dia fechado) e soma os fluxos de cada dia que o
 * fechamento entrega, na ordem: os fãs pelos `signups.total`, os membros pelas
 * entradas menos as saídas (nunca abaixo de 0) e o "PTS DA CENTRAL" pelo
 * `earned` da central. A transação do dia pode repetir e chamar de novo o
 * mesmo dia: o retrato fica guardado por dia, e o estado anda uma vez só.
 */
export function seedSnapshotOf(now: number, start: SeedSnapshotState | null = null): SnapshotOf {
  const base = start ?? SEED_SNAPSHOT_BASE;
  const state: SeedSnapshotState = {
    fans: base.fans,
    artists: Object.fromEntries(
      Object.entries(base.artists).map(([id, value]) => [id, { ...value }]),
    ),
  };
  const byDay = new Map<string, StatsSnapshot>();
  return (day, sum) => {
    const done = byDay.get(day);
    if (done) return done;
    const signups = isTree(sum.signups) ? sum.signups : {};
    state.fans += num(signups.total);
    const flows = isTree(sum.byArtist) ? sum.byArtist : {};
    for (const id of new Set([...Object.keys(state.artists), ...Object.keys(flows)])) {
      const flow = isTree(flows[id]) ? (flows[id] as Record<string, unknown>) : {};
      const current = state.artists[id] ?? { members: 0, totalPoints: 0 };
      state.artists[id] = {
        members: Math.max(0, current.members + num(flow.joined) - num(flow.left)),
        totalPoints: Math.max(0, current.totalPoints + num(flow.earned)),
      };
    }
    // A hora do fechamento de produção: 00:20 do dia seguinte (nunca depois do "agora").
    const noon = Date.parse(`${day}T15:00:00.000Z`);
    const at = Math.min(now, nextDayStart(noon) + 20 * 60_000);
    const snapshot: StatsSnapshot = {
      at,
      fans: state.fans,
      season: seedSeasonAt(now, at, state.fans),
      artists: Object.fromEntries(
        Object.entries(state.artists).map(([id, value]) => [id, { ...value }]),
      ),
    };
    byDay.set(day, snapshot);
    return snapshot;
  };
}

/**
 * Abre o fechamento no primeiro dia dos números do seed (60 dias atrás; só se
 * ele ainda não começou) e fecha até ontem numa rodada só (até 90 dias), com o
 * retrato do seed partindo do último dia fechado. O "hoje" fica aberto.
 */
export async function seedPanelClose(
  db: Firestore,
  now: number = Date.now(),
  log?: CloseLog,
): Promise<StatsCloseResult> {
  await startStatsClose(db, shiftDay(dayKey(now), -SEED_STATS_DAYS), 'seed', now);
  const lastClosed = await readLastClosedDay(db);
  const previous = lastClosed ? await statsDayRef(db, lastClosed).get() : null;
  const start = previous?.exists ? snapshotState(previous.get('snapshot')) : null;
  return runStatsClose(db, {
    now,
    maxDays: 90,
    snapshotOf: seedSnapshotOf(now, start),
    ...(log ? { log } : {}),
  });
}

/** Os números de um período fechado que a conferência do painel compara. */
export type ClosedTotals = {
  from: string;
  to: string;
  closedDays: number;
  /** O `snapshot.fans` do último dia fechado com retrato. */
  fans: number | null;
  signups: number;
  invited: number;
  earned: number;
  adjustmentPoints: number;
  adjustmentEvents: number;
  /** A média de `actives.day` nos dias fechados, arredondada. */
  activesAverage: number;
  likes: number;
  comments: number;
  rsvps: number;
  reports: number;
  joined: number;
  redeemRequested: number;
  redeemSpent: number;
  refunded: number;
  redeemDelivered: number;
};

/** Os totais de uma lista de dias fechados (puro), como a Visão geral soma. */
export function closedTotals(
  from: string,
  to: string,
  docs: readonly DocumentData[],
): ClosedTotals {
  const closed = docs
    .filter((doc) => doc.closed === true && typeof doc.day === 'string')
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  const pick = (doc: DocumentData, ...path: string[]) => {
    let value: unknown = doc;
    for (const key of path) value = isTree(value) ? value[key] : undefined;
    return num(value);
  };
  const sum = (...path: string[]) => closed.reduce((acc, doc) => acc + pick(doc, ...path), 0);
  const withSnapshot = closed.filter((doc) => isTree(doc.snapshot));
  const last = withSnapshot.at(-1);
  return {
    from,
    to,
    closedDays: closed.length,
    fans: last ? pick(last, 'snapshot', 'fans') : null,
    signups: sum('signups', 'total'),
    invited: sum('signups', 'invited'),
    earned: sum('totals', 'earned'),
    adjustmentPoints: sum('bySource', 'adjustment', 'points'),
    adjustmentEvents: sum('bySource', 'adjustment', 'events'),
    activesAverage: closed.length === 0 ? 0 : Math.round(sum('actives', 'day') / closed.length),
    likes: sum('totals', 'likes'),
    comments: sum('totals', 'comments'),
    rsvps: sum('totals', 'rsvps'),
    reports: sum('totals', 'reports'),
    joined: sum('totals', 'joined'),
    redeemRequested: sum('totals', 'redeemRequested'),
    redeemSpent: sum('bySource', 'redeem', 'points'),
    refunded: sum('totals', 'refunded'),
    redeemDelivered: sum('totals', 'redeemDelivered'),
  };
}

/**
 * Os totais dos últimos `size` dias fechados até ontem, pela mesma consulta
 * do painel (`documentId()` entre dois dias): o seed imprime os de 7 e 30 dias,
 * e a conferência no navegador compara os cartões com eles.
 */
export async function readClosedTotals(
  db: Firestore,
  now: number,
  size: number,
): Promise<ClosedTotals> {
  const today = dayKey(now);
  const from = shiftDay(today, -size);
  const to = shiftDay(today, -1);
  const page = await db
    .collection('statsDaily')
    .where(FieldPath.documentId(), '>=', from)
    .where(FieldPath.documentId(), '<=', to)
    .get();
  return closedTotals(
    from,
    to,
    page.docs.map((doc) => doc.data()),
  );
}
