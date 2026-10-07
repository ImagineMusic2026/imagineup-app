import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import {
  DEFAULT_ACHIEVEMENTS_CONFIG,
  parseAchievementsConfig,
  type AchievementsConfig,
} from '../achievements/model';
import { CENTRAL_ENTRIES_PER_DAY } from '../centrals/model';
import { ConfigValidationError } from '../config-validation';
import { PHOTO_CHANGES_PER_DAY } from '../fan-profile/model';
import { INVITE_LINKS_PER_DAY, INVITE_VISITS_SENT_PER_DAY } from '../invites/model';
import {
  EMPTY_MISSIONS_CONFIG,
  missionIndex,
  parseMissionsConfig,
  type MissionsConfig,
} from '../missions/model';
import {
  BLOCKS_PER_DAY,
  COMMENTS_PER_DAY,
  LIKES_PER_DAY,
  REDEEMS_PER_DAY,
  REPORTS_PER_DAY,
  RSVPS_PER_DAY,
} from '../moderation/model';
import { isVisibleLine } from '../visible-line';
import {
  EARN_SOURCES,
  VALUE_SOURCES,
  type DailyActionKey,
  type EarnSource,
  type EndedEarly,
  type GameConfig,
  type Level,
  type PointsConfig,
  type SeasonInfo,
  type ValueSource,
} from './model';

// Valores, limites diários, tetos do dia e régua (config/points), a temporada
// (config/season) e, desde o bloco 7, o catálogo de missões com a meta da
// temporada (config/missions) e o de conquistas (config/achievements).
// Versionados, com padrão no código para quando o documento não existe.
// Contrato em docs/arquitetura-api.md, seções 9 e 22.

export { ConfigValidationError };

/** As chaves dos tetos do dia, na ordem da nota (22.3). */
export const ACTION_CAP_KEYS = [
  'central_entry',
  'invite_visit_sent',
  'invite_link',
  'like_set',
  'comment_sent',
  'rsvp_set',
  'comment_report',
  'fan_block',
  'photo_set',
  'reward_redeem',
] as const satisfies readonly DailyActionKey[];

/**
 * Os tetos do dia (blocos 4, 5, 6, desde o bloco 9 as trocas de foto e desde o
 * bloco 10 os resgates da loja) como padrão do código (22.1, decisão 13; 24.1,
 * decisão 11; 25.1, decisão 15).
 */
export const DEFAULT_ACTION_CAPS: Record<DailyActionKey, number> = {
  central_entry: CENTRAL_ENTRIES_PER_DAY,
  invite_visit_sent: INVITE_VISITS_SENT_PER_DAY,
  invite_link: INVITE_LINKS_PER_DAY,
  like_set: LIKES_PER_DAY,
  comment_sent: COMMENTS_PER_DAY,
  rsvp_set: RSVPS_PER_DAY,
  comment_report: REPORTS_PER_DAY,
  fan_block: BLOCKS_PER_DAY,
  photo_set: PHOTO_CHANGES_PER_DAY,
  reward_redeem: REDEEMS_PER_DAY,
};

/** Teto do dia: de 1 a 10.000. */
export const ACTION_CAP_MAX = 10_000;

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
  actionCaps: { ...DEFAULT_ACTION_CAPS },
};

export const VALUE_MAX = 10_000;
export const LIMIT_MAX = 1_000;
export const LEVELS_MIN = 2;
export const LEVELS_MAX = 50;
export const LABEL_MAX = 40;
export const SEASON_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const SEASON_MAX_DAYS = 366;

/** O "top N" do card "Você" sem o campo na temporada (bloco 8, decisão 11 de 23.1). */
export const TOP_TARGET_DEFAULT = 10;
/** Fora do top, o `/me/rank` lê as N primeiras linhas a cada busca: até 50. */
export const TOP_TARGET_MAX = 50;

/** A última temporada fechada pela virada (bloco 8), com o instante do fechamento. */
export type ClosedSeason = SeasonInfo & { closedAt: number };

/**
 * config/season (seção 4 e, no bloco 8, 23.3): a temporada atual (em
 * andamento, encerrada esperando a virada ou agendada, depois de uma virada
 * que promoveu a próxima), a próxima, cadastrada pelo painel, e a última
 * fechada pela virada. O lançamento usa só a `season` (seção 8).
 */
export type SeasonConfig = {
  version: number;
  season: SeasonInfo | null;
  next: SeasonInfo | null;
  lastClosed: ClosedSeason | null;
};

export const DEFAULT_SEASON_CONFIG: SeasonConfig = {
  version: 0,
  season: null,
  next: null,
  lastClosed: null,
};

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

const validCap = (value: unknown): value is number =>
  isInt(value) && value >= 1 && value <= ACTION_CAP_MAX;

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
    actionCaps: { ...DEFAULT_POINTS_CONFIG.actionCaps },
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
        } else if (source === 'mission') {
          // Sempre sem limite: uma conclusão `capped` não pagaria mais no período (22.1, decisão 7).
          if (limit !== null) log.error('config/points.dailyLimits.mission precisa ser null.');
        } else if (!validLimit(limit)) {
          log.error('config/points.dailyLimits inválido: valendo o padrão.', { source, limit });
        } else {
          config.dailyLimits[source as EarnSource] = limit;
        }
      }
    }
  }

  if (data.actionCaps !== undefined) {
    if (!isRecord(data.actionCaps)) log.error('config/points.actionCaps fora do formato.');
    else {
      for (const [key, cap] of Object.entries(data.actionCaps)) {
        if (!(ACTION_CAP_KEYS as readonly string[]).includes(key)) {
          log.warn('config/points.actionCaps com teto desconhecido.', { key });
        } else if (!validCap(cap)) {
          log.error('config/points.actionCaps inválido: valendo o padrão.', { key, cap });
        } else {
          config.actionCaps[key as DailyActionKey] = cap;
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

const validTopTarget = (value: unknown): value is number =>
  isInt(value) && value >= 1 && value <= TOP_TARGET_MAX;

/** `endedEarly` lido; fora do formato vale null. */
function parseEndedEarly(value: unknown): EndedEarly | null {
  if (!isRecord(value)) return null;
  const plannedEndsAt = millisOf(value.plannedEndsAt);
  const at = millisOf(value.at);
  const by = isRecord(value.by) ? value.by : null;
  if (plannedEndsAt === null || at === null || !by) return null;
  if (typeof by.uid !== 'string' || typeof by.name !== 'string') return null;
  return { plannedEndsAt, at, by: { uid: by.uid, name: by.name } };
}

/**
 * Uma temporada de config/season (`season`, `next` ou `lastClosed`), ou null
 * quando está fora do formato. `topTarget` ausente ou inválido vale 10, e
 * `endedEarly` inválido vale null, sem derrubar a temporada (bloco 8, 23.3).
 */
function parseSeasonDef(raw: Record<string, unknown>): SeasonInfo | null {
  const season = {
    id: raw.id,
    name: raw.name,
    startsAt: millisOf(raw.startsAt),
    endsAt: millisOf(raw.endsAt),
    leaderTitle: raw.leaderTitle ?? null,
  };
  if (!validSeason(season)) return null;
  return {
    id: season.id as string,
    name: season.name as string,
    startsAt: season.startsAt!,
    endsAt: season.endsAt!,
    leaderTitle: season.leaderTitle as string | null,
    topTarget: validTopTarget(raw.topTarget) ? raw.topTarget : TOP_TARGET_DEFAULT,
    endedEarly: parseEndedEarly(raw.endedEarly),
  };
}

/**
 * Leitura de config/season. Temporada inválida vira null (sem temporada), com
 * erro no log; a próxima e a última fechada fora do formato também viram null,
 * sem derrubar a atual (bloco 8, 23.3).
 */
export function parseSeasonConfig(data: unknown, log: ConfigLog = defaultLog): SeasonConfig {
  if (data === undefined || data === null) return { ...DEFAULT_SEASON_CONFIG };
  if (!isRecord(data)) {
    log.error('config/season fora do formato: sem temporada.');
    return { ...DEFAULT_SEASON_CONFIG };
  }
  const version = versionOf(data.version) ?? 0;
  const config: SeasonConfig = { version, season: null, next: null, lastClosed: null };
  if (data.season !== null && data.season !== undefined) {
    const raw = isRecord(data.season) ? data.season : {};
    config.season = parseSeasonDef(raw);
    if (!config.season) log.error('config/season.season inválida: sem temporada.', { id: raw.id });
  }
  if (data.next !== null && data.next !== undefined) {
    const raw = isRecord(data.next) ? data.next : {};
    config.next = parseSeasonDef(raw);
    if (!config.next) log.error('config/season.next inválida: sem próxima.', { id: raw.id });
  }
  if (data.lastClosed !== null && data.lastClosed !== undefined) {
    const raw = isRecord(data.lastClosed) ? data.lastClosed : {};
    const season = parseSeasonDef(raw);
    const closedAt = millisOf(raw.closedAt);
    config.lastClosed = season && closedAt !== null ? { ...season, closedAt } : null;
    if (!config.lastClosed) {
      log.error('config/season.lastClosed inválida: sem a última fechada.', { id: raw.id });
    }
  }
  return config;
}

/** Uma temporada como fica em config/season (datas em Timestamp). */
export function seasonDefDoc(season: SeasonInfo | null): DocumentData | null {
  if (!season) return null;
  return {
    id: season.id,
    name: season.name,
    startsAt: Timestamp.fromMillis(season.startsAt),
    endsAt: Timestamp.fromMillis(season.endsAt),
    leaderTitle: season.leaderTitle,
    topTarget: season.topTarget,
    endedEarly: season.endedEarly
      ? {
          plannedEndsAt: Timestamp.fromMillis(season.endedEarly.plannedEndsAt),
          at: Timestamp.fromMillis(season.endedEarly.at),
          by: { ...season.endedEarly.by },
        }
      : null,
  };
}

/**
 * Os três campos de config/season, sempre juntos: as callables e a virada
 * gravam o documento inteiro (`tx.set` sem merge), e um campo esquecido
 * apagaria a próxima ou a última fechada (23.3).
 */
export function seasonConfigFields(config: Omit<SeasonConfig, 'version'>): DocumentData {
  const lastClosed = seasonDefDoc(config.lastClosed);
  return {
    season: seasonDefDoc(config.season),
    next: seasonDefDoc(config.next),
    lastClosed:
      lastClosed && config.lastClosed
        ? { ...lastClosed, closedAt: Timestamp.fromMillis(config.lastClosed.closedAt) }
        : null,
  };
}

/**
 * Grava config/season inteiro com a versão dada e a cópia em `versions/{n}`,
 * como o `runConfigChange` das callables: a virada (sem quem fez, `updatedBy:
 * null`) e o seed das temporadas passadas usam (bloco 8, 23.6).
 */
export function writeSeasonConfig(
  tx: Transaction,
  db: Firestore,
  config: SeasonConfig,
  options: { now: number; updatedBy: { uid: string; name: string } | null },
): void {
  const ref = seasonConfigRef(db);
  const doc = {
    ...seasonConfigFields(config),
    version: config.version,
    updatedAt: Timestamp.fromMillis(options.now),
    updatedBy: options.updatedBy,
  };
  tx.set(ref, doc);
  tx.set(ref.collection('versions').doc(String(config.version)), doc);
}

export type PointsConfigInput = {
  values?: Partial<Record<ValueSource, number>>;
  dailyLimits?: Partial<Record<EarnSource, number | null>>;
  levels?: Level[];
  actionCaps?: Partial<Record<DailyActionKey, number>>;
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
    if (!['values', 'dailyLimits', 'levels', 'actionCaps'].includes(key)) {
      throw new ConfigValidationError(key);
    }
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
      // A missão só aceita null (22.1, decisão 7); as outras, de 1 a 1.000 ou null.
      const valid = source === 'mission' ? limit === null : validLimit(limit);
      if (!(EARN_SOURCES as readonly string[]).includes(source) || !valid) {
        throw new ConfigValidationError(`dailyLimits.${source}`);
      }
      limits[source as EarnSource] = limit as number | null;
    }
    out.dailyLimits = limits;
  }
  if (input.actionCaps !== undefined) {
    if (!isRecord(input.actionCaps)) throw new ConfigValidationError('actionCaps');
    const caps: Partial<Record<DailyActionKey, number>> = {};
    for (const [key, cap] of Object.entries(input.actionCaps)) {
      if (!(ACTION_CAP_KEYS as readonly string[]).includes(key) || !validCap(cap)) {
        throw new ConfigValidationError(`actionCaps.${key}`);
      }
      caps[key as DailyActionKey] = cap;
    }
    out.actionCaps = caps;
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
  /** Opcional no pedido: sem ele, o da temporada de agora (mesmo id) ou 10 (bloco 8). */
  topTarget?: number;
};

/**
 * Validação estrita da temporada pedida pelo painel (`updateSeason` e, no
 * bloco 8, `scheduleNextSeason`, com o campo `next`). Datas em ms; o
 * `topTarget` opcional, inteiro de 1 a 50.
 */
export function validateSeasonInput(input: unknown, field = 'season'): SeasonInput {
  if (!isRecord(input)) throw new ConfigValidationError(field);
  const season = {
    id: input.id,
    name: input.name,
    startsAt: isInt(input.startsAt) ? input.startsAt : null,
    endsAt: isInt(input.endsAt) ? input.endsAt : null,
    leaderTitle: input.leaderTitle ?? null,
  };
  if (typeof season.id !== 'string' || !SEASON_ID_PATTERN.test(season.id)) {
    throw new ConfigValidationError(`${field}.id`);
  }
  if (!validLabel(season.name)) throw new ConfigValidationError(`${field}.name`);
  if (season.leaderTitle !== null && !validLabel(season.leaderTitle)) {
    throw new ConfigValidationError(`${field}.leaderTitle`);
  }
  if (input.topTarget !== undefined && !validTopTarget(input.topTarget)) {
    throw new ConfigValidationError(`${field}.topTarget`);
  }
  if (!validSeason(season)) throw new ConfigValidationError(`${field}.endsAt`);
  return {
    ...(season as Omit<SeasonInput, 'topTarget'>),
    ...(input.topTarget !== undefined ? { topTarget: input.topTarget as number } : {}),
  };
}

/**
 * A configuração de uma carga do cache: valores, limites e régua, a
 * temporada, o catálogo de missões (com a meta da temporada), o de conquistas
 * e o jogo montado deles (o índice das missões por tipo de ação, 22.1,
 * decisão 1).
 */
export type LoadedConfig = {
  points: PointsConfig;
  season: SeasonConfig;
  missions: MissionsConfig;
  achievements: AchievementsConfig;
  game: GameConfig;
};

/** Valores, limites, régua, temporada e o jogo, com cache. A temporada do lançamento vem da transação. */
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

export function missionsConfigRef(db: Firestore) {
  return db.collection('config').doc('missions');
}

export function achievementsConfigRef(db: Firestore) {
  return db.collection('config').doc('achievements');
}

/** O jogo de uma carga: o índice das missões no ar, o catálogo de conquistas e a meta. */
export function gameOf(missions: MissionsConfig, achievements: AchievementsConfig): GameConfig {
  return {
    missions: missionIndex(missions),
    achievements: achievements.achievements,
    seasonGoal: missions.seasonGoal,
  };
}

/** A carga com o que veio de cada documento (o que falta vale o padrão do código). */
export function buildLoadedConfig(parts: Partial<Omit<LoadedConfig, 'game'>> = {}): LoadedConfig {
  const missions = parts.missions ?? { ...EMPTY_MISSIONS_CONFIG, missions: [] };
  const achievements = parts.achievements ?? DEFAULT_ACHIEVEMENTS_CONFIG;
  return {
    points: parts.points ?? parsePointsConfig(undefined),
    season: parts.season ?? { ...DEFAULT_SEASON_CONFIG },
    missions,
    achievements,
    game: gameOf(missions, achievements),
  };
}

export function loadedConfig(
  points: DocumentSnapshot | undefined,
  season: DocumentSnapshot | undefined,
  log: ConfigLog = defaultLog,
  missions?: DocumentSnapshot,
  achievements?: DocumentSnapshot,
): LoadedConfig {
  return buildLoadedConfig({
    points: parsePointsConfig(points?.data(), log),
    season: parseSeasonConfig(season?.data(), log),
    missions: parseMissionsConfig(missions?.data(), log),
    achievements: parseAchievementsConfig(achievements?.data(), log),
  });
}

/**
 * Lê config/points, config/season, config/missions e config/achievements
 * juntos (`getAll`) e guarda em memória por instância. Mudança feita no
 * painel vale em até 60 s (também o catálogo de missões, 22.17). Leitura que
 * falha não fica no cache: a próxima tenta de novo.
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
        .getAll(
          pointsConfigRef(db),
          seasonConfigRef(db),
          missionsConfigRef(db),
          achievementsConfigRef(db),
        )
        .then(([points, season, missions, achievements]) =>
          loadedConfig(points, season, options.log, missions, achievements),
        );
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
export function staticConfigSource(config: Partial<Omit<LoadedConfig, 'game'>> = {}): ConfigSource {
  const value = buildLoadedConfig(config);
  return { get: () => Promise.resolve(value) };
}
