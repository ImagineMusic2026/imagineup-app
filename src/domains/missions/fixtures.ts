import {
  addMonths,
  endOfDay,
  endOfWeek,
  set,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { earnFixturePoints, fixtureNow, onFixtureSessionEnd } from '@/services/fixtures';

import type { Mission, MissionAction, MissionsResponse, SeasonGoal } from './types';

/**
 * Missões de exemplo da 1g enquanto a API (M2) não existe: as do protótipo, sem
 * a de playlist (fora do contrato), que dá lugar a uma missão de curtir. Os
 * valores de ponto, os textos e as metas são exemplo; os reais vêm do painel.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// "Termina em 4 h" por meia hora, como no protótipo (a contagem arredonda para baixo).
const ENDS_IN_MS = 4 * HOUR_MS + 30 * MINUTE_MS;
// A temporada termina com a do ranking (12 dias).
const SEASON_ENDS_IN_MS = 12 * DAY_MS;
const SEASON_DONE = 12;
const SEASON_TARGET = 20;

/** Pontos da missão de presença em show, a primeira confirmação na agenda. */
export const RSVP_MISSION_POINTS = 15;

/**
 * Missão do dia de exemplo, a da home do protótipo (1b) e a destacada da 1g:
 * levar 5 pessoas ao clipe novo do Netto pelo link do post com o código do fã
 * (dentro do contrato: é o link de post do app com atribuição, não o YouTube).
 * 3 de 5, vale 20 e termina em 4 h e meia a partir de `now`.
 */
export function buildDailyMissionFixture(now: Date): Mission {
  return {
    id: 'm-clipe-netto',
    title: 'Leve 5 pessoas para o clipe novo do Netto',
    rewardPoints: 20,
    progress: { current: 3, target: 5 },
    endsAt: new Date(now.getTime() + ENDS_IN_MS).toISOString(),
    status: 'active',
    action: 'share',
    target: { postId: 'p-clipe', artistId: 'nettobrito' },
    period: 'daily',
    featured: true,
    pointsBreakdown: { perVisit: 2, perSignup: 10 },
    completedAt: null,
    unlockHint: null,
    event: null,
  } satisfies Mission;
}

/** "Concluída às 14:02": hoje nesse horário, ou meia hora atrás se ele ainda não chegou. */
function completedToday(now: Date): string {
  const at = set(now, { hours: 14, minutes: 2, seconds: 0, milliseconds: 0 });
  return (at <= now ? at : new Date(now.getTime() - 30 * MINUTE_MS)).toISOString();
}

/** Show sugerido na missão de presença: dia 21 do mês seguinte, às 22 h (o destaque da agenda). */
function nextShow(now: Date): string {
  return set(addMonths(startOfMonth(now), 1), {
    date: 21,
    hours: 22,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  }).toISOString();
}

type MissionBase = Omit<
  Mission,
  'endsAt' | 'featured' | 'pointsBreakdown' | 'completedAt' | 'unlockHint' | 'event' | 'target'
> &
  Partial<Pick<Mission, 'pointsBreakdown' | 'completedAt' | 'unlockHint' | 'event' | 'target'>>;

function mission(base: MissionBase, endsAt: Date): Mission {
  return {
    featured: false,
    pointsBreakdown: null,
    completedAt: null,
    unlockHint: null,
    event: null,
    target: null,
    ...base,
    endsAt: endsAt.toISOString(),
  };
}

/** A lista na ordem do painel, antes do que o fã fez nesta abertura do app. */
function buildBaseMissions(now: Date): Mission[] {
  const today = endOfDay(now);
  // Semana de segunda a domingo: "Esta semana" vale até domingo à noite.
  const week = endOfWeek(now, { weekStartsOn: 1 });

  return [
    buildDailyMissionFixture(now),
    mission(
      {
        id: 'm-curtir-nenho',
        title: 'Curta 5 posts do Nenho',
        rewardPoints: 10,
        progress: { current: 2, target: 5 },
        status: 'active',
        action: 'like',
        target: { artistId: 'nenho' },
        period: 'daily',
      },
      today,
    ),
    mission(
      {
        id: 'm-comentar-central',
        title: 'Comente em 3 posts da central',
        rewardPoints: 20,
        progress: { current: 3, target: 3 },
        status: 'completed',
        action: 'comment',
        target: { artistId: 'nettobrito' },
        period: 'daily',
        completedAt: completedToday(now),
      },
      today,
    ),
    mission(
      {
        id: 'm-relampago-show',
        title: 'Missão relâmpago do show',
        rewardPoints: 50,
        progress: { current: 0, target: 1 },
        status: 'locked',
        action: 'comment',
        target: { artistId: 'nettobrito' },
        period: 'daily',
        unlockHint: 'Abre quando o Netto subir no palco',
      },
      today,
    ),
    mission(
      {
        id: 'm-trazer-amigos',
        title: 'Traga 3 amigos novos pro app',
        rewardPoints: 30,
        progress: { current: 1, target: 3 },
        status: 'active',
        action: 'invite',
        period: 'weekly',
      },
      week,
    ),
    mission(
      {
        id: 'm-presenca-show',
        title: 'Confirme presença em um show',
        rewardPoints: RSVP_MISSION_POINTS,
        progress: { current: 0, target: 1 },
        status: 'active',
        action: 'rsvp',
        target: { eventId: 'sao-joao-irara' },
        period: 'weekly',
        event: { name: 'São João de Irará', startsAt: nextShow(now) },
      },
      week,
    ),
  ];
}

function buildSeason(now: Date, completedHere: number): SeasonGoal {
  return {
    id: 'temporada-sao-joao',
    title: 'Semana do arrocha',
    description: 'Complete 20 missões e garanta um lote de ingressos do São João.',
    completedCount: SEASON_DONE + completedHere,
    targetCount: SEASON_TARGET,
    endsAt: new Date(now.getTime() + SEASON_ENDS_IN_MS).toISOString(),
  };
}

interface Advance {
  current: number;
  /** ISO, quando a ação que faltava chegou. */
  completedAt: string | null;
}

// Estado de "servidor": o que o fã fez nesta abertura do app, por missão.
let advances = new Map<string, Advance>();
/**
 * Os alvos (post, show, central) que já contaram em cada missão no período,
 * como o `keys` do servidor (22.4): a mesma ação no mesmo alvo não conta duas
 * vezes. A chave é a missão e o começo do período.
 */
let counted = new Map<string, Set<string>>();

/**
 * Os alvos que o exemplo já conta: as duas curtidas do "2 de 5" da "Curta 5
 * posts do Nenho" são os posts `p-nenho-4` e `p-nenho-5` (já curtidos), e
 * descurtir e curtir de novo um deles não anda a missão.
 */
const INITIAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  'm-curtir-nenho': ['p-nenho-4', 'p-nenho-5'],
};

/** O fim do período (o dia, ou a semana de segunda a domingo), como o servidor manda na concluída. */
function periodEnd(period: Mission['period'], now: Date): Date {
  return period === 'weekly' ? endOfWeek(now, { weekStartsOn: 1 }) : endOfDay(now);
}

function applyAdvance(item: Mission, now: Date): Mission {
  const advance = advances.get(item.id);
  if (!advance) return item;
  const progress = { ...item.progress, current: advance.current };
  if (!advance.completedAt) return { ...item, progress };
  return {
    ...item,
    progress,
    status: 'completed',
    completedAt: advance.completedAt,
    // A concluída fica até o período virar (22.2), como no servidor.
    endsAt: periodEnd(item.period, now).toISOString(),
  };
}

/** Temporada e missões com o que o fã já fez; objetos novos a cada chamada. */
export function buildMissionsFixture(now: Date): MissionsResponse {
  const completedHere = [...advances.values()].filter((advance) => advance.completedAt).length;
  return {
    season: buildSeason(now, completedHere),
    missions: buildBaseMissions(now).map((item) => applyAdvance(item, now)),
  };
}

/** Onde a ação aconteceu: a central, o post e o show, como o tick do servidor. */
export interface MissionActionOn {
  artistId?: string;
  postId?: string;
  eventId?: string;
}

/**
 * A ação vale para a missão pelo alvo dela, como no servidor (22.1, decisão
 * 5): a de post só conta aquele post, a de show só aquele show, e a de uma
 * central ("Curta 5 posts do Nenho") só a ação naquela central. A missão sem
 * alvo serve a qualquer uma, e a ação sem central informada conta em qualquer
 * missão de central do tipo.
 */
function countsFor(item: Mission, on: MissionActionOn | undefined): boolean {
  const target = item.target;
  if (!target) return true;
  if (target.postId) return on?.postId === target.postId;
  if (target.eventId) return on?.eventId === target.eventId;
  const artistId = target.artistId;
  return !artistId || !on?.artistId || artistId === on.artistId;
}

/** O alvo que a ação conta na missão: o post, o show ou a central (null: conta sempre). */
function unitOf(action: MissionAction, on: MissionActionOn | undefined): string | null {
  if (action === 'like' || action === 'comment') return on?.postId ?? null;
  if (action === 'rsvp') return on?.eventId ?? null;
  if (action === 'join') return on?.artistId ?? null;
  return null;
}

/** O começo do período da missão: o dia ou a semana (segunda a domingo). */
function periodStart(item: Mission, now: Date): string {
  return (
    item.period === 'daily' ? startOfDay(now) : startOfWeek(now, { weekStartsOn: 1 })
  ).toISOString();
}

function countedIn(item: Mission, now: Date): Set<string> {
  const key = `${item.id}:${periodStart(item, now)}`;
  let set = counted.get(key);
  if (!set) {
    set = new Set(INITIAL_KEYS[item.id] ?? []);
    counted.set(key, set);
  }
  return set;
}

/**
 * O servidor das missões nas fixtures. Outras fixtures contam aqui as ações do
 * fã que andam uma missão (o "Eu vou" da agenda, curtir e comentar um post),
 * como o servidor do bloco 7 conta (22.12): a ação anda todas as missões
 * abertas que casam com ela, e o mesmo alvo conta uma vez por missão e
 * período. Quando a ação completa uma missão, os pontos entram na carteira
 * (`fixtureWallet`, por `earnFixturePoints`) e voltam na resposta da ação,
 * como a API faria; com a carteira na API, a missão conclui e a ação devolve
 * 0. Fica em memória e volta ao início quando o app reabre ou a sessão termina.
 */
export const missionsFixture = {
  /**
   * Uma ação do fã, com onde ela aconteceu (a central, o post, o show). Anda
   * as missões abertas desse tipo que valem para ela e devolve os pontos das
   * que concluiu (zero se nenhuma concluiu).
   */
  record(action: MissionAction, now: Date = fixtureNow(), on?: MissionActionOn): number {
    const open = buildMissionsFixture(now).missions.filter(
      (item) => item.action === action && item.status === 'active' && countsFor(item, on),
    );
    let points = 0;
    const unit = unitOf(action, on);
    for (const item of open) {
      if (unit !== null) {
        const seen = countedIn(item, now);
        if (seen.has(unit)) continue;
        seen.add(unit);
      }
      const current = Math.min(item.progress.current + 1, item.progress.target);
      const done = current >= item.progress.target;
      advances.set(item.id, { current, completedAt: done ? now.toISOString() : null });
      // Com a carteira na API, a missão de exemplo conclui sem crédito: a ação devolve 0.
      if (done) points += earnFixturePoints(item.rewardPoints);
    }
    return points;
  },

  /** Volta ao início (fim da sessão e testes). */
  reset(): void {
    advances = new Map();
    counted = new Map();
  },
};

onFixtureSessionEnd(() => missionsFixture.reset());
