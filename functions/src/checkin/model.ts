import type { CheckinState } from '../api/contract';
import { ConfigValidationError } from '../config-validation';
import { dayKey, nextDayStart, shiftDay } from '../day';

// Check-in diário com sequência (seção 40 de docs/arquitetura-api.md), puro:
// nada aqui lê ou grava o Firestore. A chave e o ciclo de pontos
// (config/points.checkin), o estado do fã (wallets/{uid}.checkin), a regra do
// dia e a montagem da resposta das rotas. O núcleo de pontos importa daqui
// (valores), como importa os modelos das missões e das conquistas: este
// arquivo só pode importar valores de day.ts e de config-validation.ts, e do
// núcleo de pontos, só tipos (o ciclo em tempo de execução, 22.2).

/** Os dias do ciclo de pontos: depois do último, o ciclo recomeça e a sequência segue contando. */
export const CHECKIN_CYCLE_DAYS = 7;
/**
 * O valor de um dia do ciclo na gravação do painel: de 1 a 999. Com quatro
 * dígitos ou mais, o valor é cortado na trilha do app no celular pequeno, e um
 * check-in diário nunca precisa de tanto. Não é o `VALUE_MAX` da régua, que
 * segue em 10.000. A leitura tolerante usa o mesmo teto.
 */
export const CHECKIN_VALUE_MIN = 1;
export const CHECKIN_VALUE_MAX = 999;

/**
 * config/points.checkin: a chave e os pontos de cada dia do ciclo. A chave
 * nasce desligada: sem ela, o servidor não paga, recusa o POST e não grava
 * nada de novo em carteira nenhuma.
 */
export type CheckinConfig = { enabled: boolean; cycle: number[] };

export const DEFAULT_CHECKIN_CONFIG: CheckinConfig = {
  enabled: false,
  cycle: [3, 3, 4, 4, 5, 6, 15],
};

/**
 * wallets/{uid}.checkin: a sequência no último check-in, a melhor de todas e
 * o dia de São Paulo dele. A sequência guardada envelhece (o dia perdido só
 * aparece no check-in seguinte): quem lê usa o `effectiveStreak`.
 */
export type CheckinRecord = { streak: number; best: number; lastDay: string | null };

export const EMPTY_CHECKIN_RECORD: CheckinRecord = { streak: 0, best: 0, lastDay: null };

export type CheckinErrorReason = 'checkin_disabled';

/**
 * Recusa do check-in: a chave desligada (`checkin_disabled`). A API traduz
 * para o 409 de mesmo nome (`toApiHttpError`), sem gravar nada.
 */
export class CheckinError extends Error {
  readonly reason: CheckinErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: CheckinErrorReason, details?: Record<string, unknown>) {
    super('O check-in diário não está disponível agora.');
    this.name = 'CheckinError';
    this.reason = reason;
    this.details = details;
  }
}

/** O log da leitura tolerante (o `ConfigLog` de points/config.ts cabe aqui). */
export type CheckinLog = {
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/**
 * Na leitura, o 0 passa (o seed usa o ciclo zerado); na gravação do painel,
 * não. O teto é o mesmo nas duas.
 */
const validReadValue = (value: unknown): value is number =>
  isInt(value) && value >= 0 && value <= CHECKIN_VALUE_MAX;

const validWriteValue = (value: unknown): value is number =>
  isInt(value) && value >= CHECKIN_VALUE_MIN && value <= CHECKIN_VALUE_MAX;

const CONFIG_KEYS: readonly string[] = ['enabled', 'cycle'];

// --- Leitura tolerante e gravação estrita da configuração --------------------------

/**
 * Leitura tolerante de config/points.checkin. Sem o bloco (o documento salvo
 * antes de o código o conhecer) ou com ele fora do formato: o padrão do
 * código, com a chave desligada. A chave só liga com `true`. O ciclo (7
 * inteiros de 0 a 999) vale inteiro ou volta inteiro ao padrão (erro no log),
 * como a régua de níveis: um valor acima de 999 derruba o ciclo salvo todo.
 * Chave desconhecida é ignorada, com aviso. O ciclo devolvido é sempre uma
 * cópia: quem lê nunca divide a lista com o padrão do código.
 */
export function parseCheckinConfig(value: unknown, log?: CheckinLog): CheckinConfig {
  const config: CheckinConfig = {
    enabled: DEFAULT_CHECKIN_CONFIG.enabled,
    cycle: [...DEFAULT_CHECKIN_CONFIG.cycle],
  };
  if (!isRecord(value)) return config;
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.includes(key)) {
      log?.warn('config/points.checkin com chave desconhecida.', { key });
    }
  }
  config.enabled = value.enabled === true;
  if (value.cycle !== undefined) {
    const { cycle } = value;
    if (
      Array.isArray(cycle) &&
      cycle.length === CHECKIN_CYCLE_DAYS &&
      cycle.every(validReadValue)
    ) {
      config.cycle = [...cycle];
    } else {
      log?.error('config/points.checkin.cycle inválido: valendo o ciclo padrão.');
    }
  }
  return config;
}

/**
 * Validação estrita do bloco no pedido do painel (`updatePointsConfig`): só
 * as chaves `enabled` e `cycle`, e pelo menos uma. A chave é booleana; o
 * ciclo são exatamente 7 inteiros de 1 a 999 (o 0 é recusado: quem desliga o
 * check-in é a chave). Recusa no primeiro campo errado, com o caminho dele.
 */
export function validateCheckinInput(value: unknown): Partial<CheckinConfig> {
  if (!isRecord(value)) throw new ConfigValidationError('checkin');
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.includes(key)) throw new ConfigValidationError('checkin');
  }
  const out: Partial<CheckinConfig> = {};
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new ConfigValidationError('checkin.enabled');
    out.enabled = value.enabled;
  }
  if (value.cycle !== undefined) {
    const { cycle } = value;
    if (!Array.isArray(cycle) || cycle.length !== CHECKIN_CYCLE_DAYS) {
      throw new ConfigValidationError('checkin.cycle');
    }
    const wrong = cycle.findIndex((item) => !validWriteValue(item));
    if (wrong >= 0) throw new ConfigValidationError(`checkin.cycle.${wrong}`);
    out.cycle = [...(cycle as number[])];
  }
  if (out.enabled === undefined && out.cycle === undefined) {
    throw new ConfigValidationError('checkin');
  }
  return out;
}

// --- O estado do fã e a regra do dia ---------------------------------------------------

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isCount = (value: unknown): value is number => isInt(value) && value >= 0;

/**
 * Leitura tolerante de wallets/{uid}.checkin: sem o campo ou com qualquer
 * coisa fora do formato, o estado vazio (uma cópia). No estado válido, a
 * sequência e a melhor são inteiros de 0 em diante, o dia é um `YYYY-MM-DD`
 * ou null, e a melhor nunca é menor que a sequência.
 */
export function parseCheckinRecord(value: unknown): CheckinRecord {
  const empty = (): CheckinRecord => ({ ...EMPTY_CHECKIN_RECORD });
  if (!isRecord(value)) return empty();
  const { streak, best, lastDay } = value;
  if (!isCount(streak) || !isCount(best)) return empty();
  if (lastDay !== null && (typeof lastDay !== 'string' || !DAY_PATTERN.test(lastDay))) {
    return empty();
  }
  return { streak, best: Math.max(best, streak), lastDay };
}

/**
 * A sequência que está viva em `today`: a guardada, quando o último check-in
 * foi hoje (ou num dia posterior, pelo relógio fora de ordem) ou ontem (o de
 * hoje ainda pode ser feito); depois de um dia perdido, 0. Os dias comparam
 * como texto.
 */
export function effectiveStreak(record: CheckinRecord, today: string): number {
  const { lastDay } = record;
  if (lastDay === null) return 0;
  return lastDay >= today || lastDay === shiftDay(today, -1) ? record.streak : 0;
}

/** O lugar da sequência no ciclo, de 1 ao tamanho dele (0 só com o ciclo vazio). */
function cycleDayOf(streak: number, length: number): number {
  if (length <= 0) return 0;
  return ((Math.max(streak, 1) - 1) % length) + 1;
}

const cyclePoints = (cycle: readonly number[], cycleDay: number): number =>
  cycle[cycleDay - 1] ?? 0;

export type CheckinPlan = {
  /** `checked`: o check-in de hoje entra agora; `already`: o de hoje (ou de um dia posterior) já está guardado. */
  status: 'checked' | 'already';
  /** O estado depois do check-in (o lido, sem mudar, no `already`). */
  next: CheckinRecord;
  /** O lugar da sequência no ciclo, de 1 ao tamanho dele. */
  cycleDay: number;
  /** Os pontos do dia pelo ciclo (0 no `already`; o 0 do ciclo zerado do seed passa). */
  points: number;
};

/**
 * O check-in do dia `today` (o `dayKey` do pedido) sobre o estado lido. O
 * último dia igual ou posterior a hoje: `already`, nada muda (o tempo nunca
 * anda para trás: o pedido de 23:59:59,950 que grava depois do de
 * 00:00:00,010 não desfaz o dia novo). O último dia foi ontem: a sequência
 * anda 1. Qualquer outra coisa (nunca fez, ou perdeu um dia): volta ao dia 1.
 * O lugar no ciclo é `((sequência - 1) % tamanho) + 1`, e ontem é sempre
 * `shiftDay(today, -1)`, nunca o instante menos 24 horas.
 */
export function planCheckin(
  record: CheckinRecord,
  today: string,
  cycle: readonly number[],
): CheckinPlan {
  if (record.lastDay !== null && record.lastDay >= today) {
    return {
      status: 'already',
      next: { ...record },
      cycleDay: cycleDayOf(record.streak, cycle.length),
      points: 0,
    };
  }
  const streak = record.lastDay === shiftDay(today, -1) ? record.streak + 1 : 1;
  const cycleDay = cycleDayOf(streak, cycle.length);
  return {
    status: 'checked',
    next: { streak, best: Math.max(record.best, streak), lastDay: today },
    cycleDay,
    points: cyclePoints(cycle, cycleDay),
  };
}

/**
 * O estado do check-in como as rotas respondem (`CheckinState`, seção 40).
 * Com a chave desligada, tudo zerado e o ciclo vazio, sem olhar o estado do
 * fã. Com ela ligada e o check-in de hoje feito, a sequência guardada e o
 * lugar dela no ciclo; ainda por fazer, a sequência viva (0 depois de um dia
 * perdido) e o lugar que o check-in de hoje vai ocupar. Nenhuma chave some da
 * resposta, e o aparelho nunca calcula o dia de São Paulo: o `resetsAt` é a
 * próxima meia-noite de lá.
 */
export function checkinView(
  record: CheckinRecord | null,
  config: CheckinConfig,
  now: number,
): CheckinState {
  const resetsAt = new Date(nextDayStart(now)).toISOString();
  if (!config.enabled) {
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
  const state = record ?? EMPTY_CHECKIN_RECORD;
  const checkedInToday = state.lastDay !== null && state.lastDay >= today;
  const streak = effectiveStreak(state, today);
  const cycleDay = cycleDayOf(checkedInToday ? streak : streak + 1, config.cycle.length);
  return {
    enabled: true,
    checkedInToday,
    streak,
    best: state.best,
    cycle: [...config.cycle],
    cycleDay,
    todayPoints: cyclePoints(config.cycle, cycleDay),
    resetsAt,
  };
}
