import { sourceOf } from '@/config/data-source';
// As recompensas pelo arquivo, fora do index: o index das missões puxaria telas.
import type { ActionRewards } from '@/domains/missions/types';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

import { checkinFixture } from './fixtures';
import type { CheckinResult, CheckinState, CheckinVariables } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Um inteiro de 0 para cima (pontos, dias). */
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** A resposta da chave desligada: nada do check-in aparece. */
function disabledState(resetsAt: unknown): CheckinState {
  return {
    enabled: false,
    checkedInToday: false,
    streak: 0,
    best: 0,
    cycle: [],
    cycleDay: 0,
    todayPoints: 0,
    resetsAt: typeof resetsAt === 'string' ? resetsAt : '',
  };
}

/**
 * O estado do check-in conferido campo a campo. O card só aparece com a
 * resposta do servidor novo e a chave ligada: `enabled` tem de ser `true`, o
 * `cycle` uma lista de pontos com pelo menos um valor, o `cycleDay` um lugar
 * dela e o `resetsAt` uma data. Qualquer outra coisa (a chave desligada, o
 * corpo de outra rota, um campo fora do formato) vira a resposta da chave
 * desligada, e nada aparece.
 */
export function toCheckinState(data: unknown): CheckinState {
  if (!isRecord(data)) return disabledState(null);
  const { enabled, checkedInToday, streak, best, cycle, cycleDay, todayPoints, resetsAt } = data;
  if (enabled !== true) return disabledState(resetsAt);
  if (!Array.isArray(cycle) || cycle.length === 0 || !cycle.every(isCount)) {
    return disabledState(resetsAt);
  }
  if (!isCount(cycleDay) || cycleDay < 1 || cycleDay > cycle.length) return disabledState(resetsAt);
  if (typeof resetsAt !== 'string' || Number.isNaN(Date.parse(resetsAt))) {
    return disabledState(null);
  }
  const days = isCount(streak) ? streak : 0;
  return {
    enabled: true,
    checkedInToday: checkedInToday === true,
    streak: days,
    best: isCount(best) ? Math.max(best, days) : days,
    cycle: [...cycle],
    cycleDay,
    todayPoints: isCount(todayPoints) ? todayPoints : (cycle[cycleDay - 1] ?? 0),
    resetsAt,
  };
}

/**
 * A resposta do toque: os pontos e o estado conferidos, e o que mais a ação
 * rendeu (22.2 da nota) só no formato esperado, porque o `describeRewards`
 * percorre as listas.
 */
export function toCheckinResult(data: unknown): CheckinResult {
  const body = isRecord(data) ? data : {};
  const { completedMissions, levelUp, unlockedAchievements, missionsChanged } =
    body as ActionRewards;
  return {
    pointsAwarded: isCount(body.pointsAwarded) ? body.pointsAwarded : 0,
    completedMissions: Array.isArray(completedMissions) ? completedMissions : undefined,
    levelUp: isRecord(levelUp) ? levelUp : null,
    unlockedAchievements: Array.isArray(unlockedAchievements) ? unlockedAchievements : undefined,
    missionsChanged: typeof missionsChanged === 'boolean' ? missionsChanged : undefined,
    checkin: toCheckinState(body.checkin),
  };
}

/**
 * O estado do check-in do fã. Com a chave desligada, o servidor responde
 * `enabled: false`; a `api` de antes do check-in responde 404, e a consulta
 * não pergunta de novo.
 */
export async function fetchCheckin(): Promise<CheckinState> {
  if (sourceOf('checkin') === 'fixtures') {
    await fixtureDelay();
    return checkinFixture.state();
  }
  const { data } = await api.get<unknown>('/me/checkin');
  return toCheckinState(data);
}

/**
 * O check-in de hoje, sem corpo: quem decide o dia, a sequência e os pontos é
 * o servidor. A chave de idempotência impede que uma repetição conte duas
 * vezes; o segundo toque no mesmo dia, com outra chave, responde sem pontos.
 */
export async function doCheckin({ idempotencyKey }: CheckinVariables): Promise<CheckinResult> {
  if (sourceOf('checkin') === 'fixtures') {
    await fixtureDelay();
    return checkinFixture.checkin(idempotencyKey);
  }
  const { data } = await api.post<unknown>('/me/checkin', null, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return toCheckinResult(data);
}
