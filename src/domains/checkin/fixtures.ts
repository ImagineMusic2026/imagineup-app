import { ApiError } from '@/services/api/errors';
import { earnFixturePoints, fixtureNow, onFixtureSessionEnd } from '@/services/fixtures';

import { CHECKIN_DISABLED } from './describe-checkin';
import type { CheckinResult, CheckinState } from './types';

/**
 * A chave do check-in nas fixtures (as builds sem API: o Expo Go sem o `.env`
 * e o Jest). Nasce desligada, como a do servidor
 * (`config/points.checkin.enabled`, que só o dono liga): a fixture espelha a
 * produção, e a build sem API, que é como o app é mostrado hoje num iPhone
 * (o Expo Go sem o `.env`), não mostra o check-in antes de o dono acertar a
 * função com a cliente. Desligada, o estado responde `enabled: false` e o
 * toque é recusado com o 409, como no servidor, e nada aparece. Para mostrar
 * o check-in de exemplo numa demonstração sem API (a sequência do seed dos
 * emuladores, 4 dias até ontem), troque para `true`; os testes que contam com
 * o exemplo ligam por `checkinFixture.setEnabled(true)`.
 */
export const CHECKIN_FIXTURE_ENABLED = false;

/** O ciclo padrão do servidor (`DEFAULT_CHECKIN_CONFIG`), o mesmo do seed dos emuladores. */
export const CHECKIN_FIXTURE_CYCLE: readonly number[] = [3, 3, 4, 4, 5, 6, 15];

/** A sequência da Camila no seed dos emuladores: 4 dias, o último ontem. */
export const CHECKIN_FIXTURE_STREAK = 4;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** São Paulo, sem horário de verão desde 2019: o dia do check-in é o de lá, como o `dayKey` do servidor. */
const SAO_PAULO_OFFSET_MS = -3 * HOUR_MS;

/** O dia de São Paulo de um instante, `AAAA-MM-DD`. */
function dayKey(ms: number): string {
  return new Date(ms + SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

/** `day` andando `delta` dias no calendário. */
function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** O instante da próxima meia-noite de São Paulo. */
function nextDayStart(ms: number): number {
  return Date.parse(`${shiftDay(dayKey(ms), 1)}T00:00:00.000Z`) - SAO_PAULO_OFFSET_MS;
}

/** O que o servidor guarda na carteira do fã (`wallets/{uid}.checkin`). */
interface CheckinRecord {
  streak: number;
  best: number;
  lastDay: string | null;
}

// `null` até o primeiro check-in da sessão: o exemplo é o do seed, relativo
// ao relógio das fixtures (a sequência de 4 dias que terminou ontem).
let record: CheckinRecord | null = null;
// Chave de idempotência já vista e o que ela devolveu, como o servidor faria.
let answers = new Map<string, CheckinResult>();
let enabled = CHECKIN_FIXTURE_ENABLED;

function recordOn(today: string): CheckinRecord {
  return (
    record ?? {
      streak: CHECKIN_FIXTURE_STREAK,
      best: CHECKIN_FIXTURE_STREAK,
      lastDay: shiftDay(today, -1),
    }
  );
}

/** O lugar de uma sequência no ciclo, de 1 ao tamanho dele. */
function cycleDayOf(streak: number): number {
  return ((streak - 1) % CHECKIN_FIXTURE_CYCLE.length) + 1;
}

/** O estado como o `checkinView` do servidor monta, com a chave ligada ou desligada. */
function view(current: CheckinRecord, now: number): CheckinState {
  const resetsAt = new Date(nextDayStart(now)).toISOString();
  if (!enabled) {
    return {
      enabled: false,
      checkedInToday: false,
      streak: 0,
      best: 0,
      cycle: [],
      cycleDay: 0,
      todayPoints: 0,
      resetsAt,
    };
  }
  const today = dayKey(now);
  const checkedInToday = current.lastDay !== null && current.lastDay >= today;
  // A sequência vale com o check-in de hoje ou com o de ontem; com um dia pulado, volta a 0.
  const alive = checkedInToday || current.lastDay === shiftDay(today, -1);
  const streak = alive ? current.streak : 0;
  const cycleDay = cycleDayOf(checkedInToday ? streak : streak + 1);
  return {
    enabled: true,
    checkedInToday,
    streak,
    best: Math.max(current.best, streak),
    cycle: [...CHECKIN_FIXTURE_CYCLE],
    cycleDay,
    todayPoints: CHECKIN_FIXTURE_CYCLE[cycleDay - 1] ?? 0,
    resetsAt,
  };
}

const copyOf = (result: CheckinResult): CheckinResult => ({
  ...result,
  checkin: { ...result.checkin, cycle: [...result.checkin.cycle] },
});

/**
 * O "servidor" do check-in diário enquanto o domínio lê das fixtures, com as
 * regras do de verdade: um check-in por dia de São Paulo, a sequência que
 * anda com o de ontem e recomeça do 1 com um dia pulado, e os pontos do dia
 * do ciclo, que recomeça depois do último. Fica em memória e volta ao início
 * quando o app reabre ou a sessão termina.
 */
export const checkinFixture = {
  /** `GET /me/checkin`. */
  state(): CheckinState {
    const now = fixtureNow().getTime();
    return view(recordOn(dayKey(now)), now);
  },

  /**
   * `POST /me/checkin`. A mesma chave de novo devolve a resposta da primeira
   * vez; outra chave no mesmo dia responde sem pontos, com o mesmo estado.
   * Com a carteira na API, o check-in de exemplo não rende ponto
   * (`earnFixturePoints`): o ponto existe num lugar só.
   */
  checkin(idempotencyKey: string): CheckinResult {
    const previous = answers.get(idempotencyKey);
    if (previous) return copyOf(previous);
    if (!enabled) {
      throw new ApiError(
        'validation',
        'O check-in diário não está disponível agora.',
        409,
        CHECKIN_DISABLED,
      );
    }

    const now = fixtureNow().getTime();
    const today = dayKey(now);
    const current = recordOn(today);
    let pointsAwarded = 0;
    if (current.lastDay === null || current.lastDay < today) {
      const streak = current.lastDay === shiftDay(today, -1) ? current.streak + 1 : 1;
      pointsAwarded = earnFixturePoints(CHECKIN_FIXTURE_CYCLE[cycleDayOf(streak) - 1] ?? 0);
      record = { streak, best: Math.max(current.best, streak), lastDay: today };
    }
    const result: CheckinResult = {
      pointsAwarded,
      // O check-in não anda missão; nível e conquistas as fixtures não modelam.
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
      checkin: view(recordOn(today), now),
    };
    answers.set(idempotencyKey, result);
    return copyOf(result);
  },

  /** Liga e desliga a chave de exemplo (testes); o `reset` volta ao `CHECKIN_FIXTURE_ENABLED`. */
  setEnabled(value: boolean): void {
    enabled = value;
  },

  /** Volta ao início (fim da sessão e testes). */
  reset(): void {
    record = null;
    answers = new Map();
    enabled = CHECKIN_FIXTURE_ENABLED;
  },
};

onFixtureSessionEnd(() => checkinFixture.reset());
