import { addMonths, endOfDay, endOfWeek, set, startOfMonth } from 'date-fns';

import { fixtureNow, fixtureWallet, onFixtureSessionEnd } from '@/services/fixtures';

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
    target: { postId: 'p-clipe', artistId: 'netto-brito' },
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
        target: { artistId: 'netto-brito' },
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
        target: { artistId: 'netto-brito' },
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

function applyAdvance(item: Mission): Mission {
  const advance = advances.get(item.id);
  if (!advance) return item;
  const progress = { ...item.progress, current: advance.current };
  if (!advance.completedAt) return { ...item, progress };
  return { ...item, progress, status: 'completed', completedAt: advance.completedAt };
}

/** Temporada e missões com o que o fã já fez; objetos novos a cada chamada. */
export function buildMissionsFixture(now: Date): MissionsResponse {
  const completedHere = [...advances.values()].filter((advance) => advance.completedAt).length;
  return {
    season: buildSeason(now, completedHere),
    missions: buildBaseMissions(now).map(applyAdvance),
  };
}

/**
 * O servidor das missões nas fixtures. Outras fixtures contam aqui as ações do
 * fã que andam uma missão (o "Eu vou" da agenda); quando a ação completa a
 * missão, os pontos entram na carteira (`fixtureWallet`) e voltam na resposta
 * da ação, como a API faria. Fica em memória e volta ao início quando o app
 * reabre ou a sessão termina.
 */
export const missionsFixture = {
  /**
   * Uma ação do fã. Anda a primeira missão aberta desse tipo e devolve os
   * pontos que ela rendeu (zero se não concluiu, ou se não havia missão aberta).
   */
  record(action: MissionAction, now: Date = fixtureNow()): number {
    const open = buildMissionsFixture(now).missions.find(
      (item) => item.action === action && item.status === 'active',
    );
    if (!open) return 0;
    const current = Math.min(open.progress.current + 1, open.progress.target);
    const done = current >= open.progress.target;
    advances.set(open.id, { current, completedAt: done ? now.toISOString() : null });
    if (!done) return 0;
    fixtureWallet.earn(open.rewardPoints);
    return open.rewardPoints;
  },

  /** Volta ao início (fim da sessão e testes). */
  reset(): void {
    advances = new Map();
  },
};

onFixtureSessionEnd(() => missionsFixture.reset());
