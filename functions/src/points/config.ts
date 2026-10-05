import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { isVisibleLine } from '../visible-line';
import {
  EARN_SOURCES,
  VALUE_SOURCES,
  type EarnSource,
  type Level,
  type PointsConfig,
  type SeasonInfo,
  type ValueSource,
} from './model';

// Valores, limites diários e régua (config/points) e a temporada
// (config/season). Versionados, com padrão no código para quando o documento
// não existe. Contrato em docs/arquitetura-api.md, seção 9.

/**
 * Padrão do código (versão 0). A régua é a FIXTURE_LEVELS do app; os valores
 * repetem os das fixtures. Os de verdade vêm da cliente (UP-9) e mudam pelo
 * painel, sem código.
 */
export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  version: 0,
  values: { like: 0, comment: 2, rsvp: 0, central_join: 10, invite_visit: 2, invite_signup: 10 },
  dailyLimits: {
    like: 50,
    comment: 20,
    rsvp: 10,
    central_join: 10,
    mission: null,
    invite_visit: 50,
    invite_signup: 20,
  },
  levels: [
    { number: 1, name: 'Primeiro passo', minXp: 0 },
    { number: 2, name: 'Na roda', minXp: 600 },
    { number: 3, name: 'Pé de serra', minXp: 1_500 },
    { number: 4, name: 'Arrastapé', minXp: 2_800 },
    { number: 5, name: 'Sanfona', minXp: 4_200 },
    { number: 6, name: 'Fogueira', minXp: 5_600 },
    { number: 7, name: 'Purainha', minXp: 7_000 },
    { number: 8, name: 'Xodó', minXp: 15_000 },
    { number: 9, name: 'Coração do palco', minXp: 25_000 },
    { number: 10, name: 'Lenda', minXp: 40_000 },
  ],
};

export const VALUE_MAX = 10_000;
export const LIMIT_MAX = 1_000;
export const LEVELS_MIN = 2;
export const LEVELS_MAX = 50;
export const LABEL_MAX = 40;
export const SEASON_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const SEASON_MAX_DAYS = 366;

export type SeasonConfig = { version: number; season: SeasonInfo | null };

export const DEFAULT_SEASON_CONFIG: SeasonConfig = { version: 0, season: null };

export type ConfigLog = {
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

const defaultLog: ConfigLog = { warn: logger.warn, error: logger.error };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

const validValue = (value: unknown): value is number =>
  isInt(value) && value >= 0 && value <= VALUE_MAX;

const validLimit = (value: unknown): value is number | null =>
  value === null || (isInt(value) && value >= 1 && value <= LIMIT_MAX);

const validLabel = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= LABEL_MAX &&
  isVisibleLine(value);

/** Régua válida: de 2 a 50 degraus, números de 1 a n, minXp de 0 sempre subindo, nomes de 1 a 40. */
export function validLevels(value: unknown): value is Level[] {
  if (!Array.isArray(value) || value.length < LEVELS_MIN || value.length > LEVELS_MAX) return false;
  return value.every((level: unknown, index) => {
    if (!isRecord(level)) return false;
    const previous = index === 0 ? null : (value[index - 1] as { minXp?: unknown });
    return (
      level.number === index + 1 &&
      validLabel(level.name) &&
      isInt(level.minXp) &&
      (index === 0 ? level.minXp === 0 : isInt(previous?.minXp) && level.minXp > previous.minXp)
    );
  });
}

const versionOf = (value: unknown): number | null => (isInt(value) && value >= 0 ? value : null);

/**
 * Leitura tolerante de config/points: parte do padrão e sobrepõe, campo a
 * campo, o que veio no documento. Origem desconhecida é ignorada (aviso);
 * valor inválido volta ao padrão só nele, e régua inválida volta inteira
 * (erro no log). Origem nova no código entra com o padrão dela e não derruba
 * os valores que a equipe ajustou nas outras.
 */
export function parsePointsConfig(data: unknown, log: ConfigLog = defaultLog): PointsConfig {
  const config: PointsConfig = {
    version: DEFAULT_POINTS_CONFIG.version,
    values: { ...DEFAULT_POINTS_CONFIG.values },
    dailyLimits: { ...DEFAULT_POINTS_CONFIG.dailyLimits },
    levels: DEFAULT_POINTS_CONFIG.levels.map((level) => ({ ...level })),
  };
  if (data === undefined || data === null) return config;
  if (!isRecord(data)) {
    log.error('config/points fora do formato: valendo o padrão do código.');
    return config;
  }

  const version = versionOf(data.version);
  if (version === null) log.error('config/points sem versão válida.', { version: data.version });
  config.version = version ?? 0;

  if (data.values !== undefined) {
    if (!isRecord(data.values)) log.error('config/points.values fora do formato.');
    else {
      for (const [source, value] of Object.entries(data.values)) {
        if (!(VALUE_SOURCES as readonly string[]).includes(source)) {
          log.warn('config/points.values com origem desconhecida.', { source });
        } else if (!validValue(value)) {
          log.error('config/points.values inválido: valendo o padrão.', { source, value });
        } else {
          config.values[source as ValueSource] = value;
        }
      }
    }
  }

  if (data.dailyLimits !== undefined) {
    if (!isRecord(data.dailyLimits)) log.error('config/points.dailyLimits fora do formato.');
    else {
      for (const [source, limit] of Object.entries(data.dailyLimits)) {
        if (!(EARN_SOURCES as readonly string[]).includes(source)) {
          log.warn('config/points.dailyLimits com origem desconhecida.', { source });
        } else if (!validLimit(limit)) {
          log.error('config/points.dailyLimits inválido: valendo o padrão.', { source, limit });
        } else {
          config.dailyLimits[source as EarnSource] = limit;
        }
      }
    }
  }

  if (data.levels !== undefined) {
    if (validLevels(data.levels)) {
      config.levels = data.levels.map(({ number, name, minXp }) => ({ number, name, minXp }));
    } else {
      log.error('config/points.levels inválido: valendo a régua padrão.');
    }
  }
  return config;
}

/** ms de um Timestamp do Firestore (ou de algo com toMillis). */
function millisOf(value: unknown): number | null {
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const ms = (value.toMillis as () => unknown)();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Temporada válida: id, nome, início antes do fim (no máximo 366 dias) e título opcional. */
export function validSeason(season: {
  id: unknown;
  name: unknown;
  startsAt: number | null;
  endsAt: number | null;
  leaderTitle: unknown;
}): boolean {
  return (
    typeof season.id === 'string' &&
    SEASON_ID_PATTERN.test(season.id) &&
    validLabel(season.name) &&
    season.startsAt !== null &&
    season.endsAt !== null &&
    season.startsAt < season.endsAt &&
    season.endsAt - season.startsAt <= SEASON_MAX_DAYS * 24 * 60 * 60 * 1000 &&
    (season.leaderTitle === null || validLabel(season.leaderTitle))
  );
}

/** Leitura de config/season. Temporada inválida vira null (sem temporada), com erro no log. */
export function parseSeasonConfig(data: unknown, log: ConfigLog = defaultLog): SeasonConfig {
  if (data === undefined || data === null) return { ...DEFAULT_SEASON_CONFIG };
  if (!isRecord(data)) {
    log.error('config/season fora do formato: sem temporada.');
    return { ...DEFAULT_SEASON_CONFIG };
  }
  const version = versionOf(data.version) ?? 0;
  if (data.season === null || data.season === undefined) return { version, season: null };
  const raw = isRecord(data.season) ? data.season : {};
  const season = {
    id: raw.id,
    name: raw.name,
    startsAt: millisOf(raw.startsAt),
    endsAt: millisOf(raw.endsAt),
    leaderTitle: raw.leaderTitle ?? null,
  };
  if (!validSeason(season)) {
    log.error('config/season.season inválida: sem temporada.', { id: raw.id });
    return { version, season: null };
  }
  return {
    version,
    season: {
      id: season.id as string,
      name: season.name as string,
      startsAt: season.startsAt!,
      endsAt: season.endsAt!,
      leaderTitle: season.leaderTitle as string | null,
    },
  };
}

/** Campo errado na gravação estrita, com o caminho dele (`values.like`, `levels.3.minXp`). */
export class ConfigValidationError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`Configuração inválida em ${field}.`);
    this.name = 'ConfigValidationError';
    this.field = field;
  }
}

export type PointsConfigInput = {
  values?: Partial<Record<ValueSource, number>>;
  dailyLimits?: Partial<Record<EarnSource, number | null>>;
  levels?: Level[];
};

/**
 * Validação estrita do pedido de mudança (callable do painel, bloco
 * seguinte): recusa o pedido inteiro no primeiro campo errado, com as mesmas
 * regras da leitura.
 */
export function validatePointsConfigInput(input: unknown): PointsConfigInput {
  if (!isRecord(input)) throw new ConfigValidationError('');
  const out: PointsConfigInput = {};
  for (const key of Object.keys(input)) {
    if (!['values', 'dailyLimits', 'levels'].includes(key)) throw new ConfigValidationError(key);
  }
  if (input.values !== undefined) {
    if (!isRecord(input.values)) throw new ConfigValidationError('values');
    const values: Partial<Record<ValueSource, number>> = {};
    for (const [source, value] of Object.entries(input.values)) {
      if (!(VALUE_SOURCES as readonly string[]).includes(source) || !validValue(value)) {
        throw new ConfigValidationError(`values.${source}`);
      }
      values[source as ValueSource] = value;
    }
    out.values = values;
  }
  if (input.dailyLimits !== undefined) {
    if (!isRecord(input.dailyLimits)) throw new ConfigValidationError('dailyLimits');
    const limits: Partial<Record<EarnSource, number | null>> = {};
    for (const [source, limit] of Object.entries(input.dailyLimits)) {
      if (!(EARN_SOURCES as readonly string[]).includes(source) || !validLimit(limit)) {
        throw new ConfigValidationError(`dailyLimits.${source}`);
      }
      limits[source as EarnSource] = limit;
    }
    out.dailyLimits = limits;
  }
  if (input.levels !== undefined) {
    if (!validLevels(input.levels)) throw new ConfigValidationError('levels');
    out.levels = input.levels.map(({ number, name, minXp }) => ({ number, name, minXp }));
  }
  return out;
}

export type SeasonInput = {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  leaderTitle: string | null;
};

/** Validação estrita da temporada pedida pelo painel (bloco 8). Datas em ms. */
export function validateSeasonInput(input: unknown): SeasonInput {
  if (!isRecord(input)) throw new ConfigValidationError('season');
  const season = {
    id: input.id,
    name: input.name,
    startsAt: isInt(input.startsAt) ? input.startsAt : null,
    endsAt: isInt(input.endsAt) ? input.endsAt : null,
    leaderTitle: input.leaderTitle ?? null,
  };
  if (typeof season.id !== 'string' || !SEASON_ID_PATTERN.test(season.id)) {
    throw new ConfigValidationError('season.id');
  }
  if (!validLabel(season.name)) throw new ConfigValidationError('season.name');
  if (season.leaderTitle !== null && !validLabel(season.leaderTitle)) {
    throw new ConfigValidationError('season.leaderTitle');
  }
  if (!validSeason(season)) throw new ConfigValidationError('season.endsAt');
  return season as SeasonInput;
}

export type LoadedConfig = { points: PointsConfig; season: SeasonConfig };

/** Valores, limites, régua e temporada, com cache. A temporada do lançamento vem da transação. */
export interface ConfigSource {
  get(): Promise<LoadedConfig>;
}

export const CONFIG_TTL_MS = 60_000;

export function pointsConfigRef(db: Firestore) {
  return db.collection('config').doc('points');
}

export function seasonConfigRef(db: Firestore) {
  return db.collection('config').doc('season');
}

export function loadedConfig(
  points: DocumentSnapshot | undefined,
  season: DocumentSnapshot | undefined,
  log?: ConfigLog,
): LoadedConfig {
  return {
    points: parsePointsConfig(points?.data(), log),
    season: parseSeasonConfig(season?.data(), log),
  };
}

/**
 * Lê config/points e config/season juntos (`getAll`) e guarda em memória por
 * instância. Mudança feita no painel vale em até 60 s. Leitura que falha não
 * fica no cache: a próxima tenta de novo.
 */
export function createConfigSource(
  db: Firestore,
  options: { ttlMs?: number; now?: () => number; log?: ConfigLog } = {},
): ConfigSource {
  const ttlMs = options.ttlMs ?? CONFIG_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { at: number; value: Promise<LoadedConfig> } | null = null;
  return {
    get() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      const value = db
        .getAll(pointsConfigRef(db), seasonConfigRef(db))
        .then(([points, season]) => loadedConfig(points, season, options.log));
      const entry = { at: now(), value };
      cached = entry;
      value.catch(() => {
        if (cached === entry) cached = null;
      });
      return value;
    },
  };
}

/** Fonte fixa (testes e seed): sempre a mesma configuração, sem ler nada. */
export function staticConfigSource(config: Partial<LoadedConfig> = {}): ConfigSource {
  const value: LoadedConfig = {
    points: config.points ?? parsePointsConfig(undefined),
    season: config.season ?? { ...DEFAULT_SEASON_CONFIG },
  };
  return { get: () => Promise.resolve(value) };
}
