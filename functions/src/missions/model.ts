import { createHash } from 'node:crypto';

import type { Mission, SeasonGoal } from '../api/contract';
import { isHandleFormat } from '../artists/model';
import { ConfigValidationError } from '../config-validation';
import { dayKey, nextDayStart, nextWeekStart, weekKey } from '../day';
import { isContentId } from '../page-cursor';
import { isVisibleLine } from '../visible-line';

// Missões do bloco 7, puro: nada aqui lê ou grava o Firestore. O catálogo
// (config/missions), o índice por tipo de ação, os períodos do dia e da semana
// de São Paulo, o progresso do fã (que mora na carteira) e a montagem da 1g.
// Do núcleo de pontos, só tipos: valor importado de points/model.ts fecharia
// um ciclo em tempo de execução (ele importa daqui). docs/arquitetura-api.md,
// seção 22.

export const MISSION_ACTIONS = ['like', 'comment', 'rsvp', 'join', 'share', 'invite'] as const;
export type MissionAction = (typeof MISSION_ACTIONS)[number];

export const MISSION_PERIODS = ['daily', 'weekly'] as const;
export type MissionPeriod = (typeof MISSION_PERIODS)[number];

/** No catálogo, só rascunho e no ar: a arquivada mora em missionArchive (22.1, decisão 2). */
export type MissionStatus = 'draft' | 'active';

/** Id da missão, gerado pelo servidor; é a chave do evento de pontos e nunca volta a ser usado. */
export const MISSION_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const MISSION_TITLE_MAX = 80;
/** A meta: de 1 a 50 unidades no período. */
export const MISSION_GOAL_MAX = 50;
/** A recompensa: de 1 a 10.000 pontos (o VALUE_MAX da régua). */
export const MISSION_REWARD_MAX = 10_000;
/** Missões no documento (rascunhos e no ar) e no ar ao mesmo tempo (22.3). */
export const MISSIONS_MAX = 60;
export const ACTIVE_MISSIONS_MAX = 30;
/** Janela de exibição: o `endsAt` vem até 366 dias depois do `startsAt`. */
export const MISSION_WINDOW_MAX_DAYS = 366;
/** Caracteres de cada resumo em `keys` (os 12 primeiros do sha256 em base64url). */
export const KEY_DIGEST_LENGTH = 12;

/** Meta da temporada (22.1, decisão 9). */
export const SEASON_GOAL_TITLE_MAX = 40;
export const SEASON_GOAL_TEXT_MAX = 140;
export const SEASON_GOAL_MISSIONS_MAX = 1_000;
export const SEASON_GOAL_POINTS_MAX = 1_000_000;
/** O mesmo formato do id da temporada (`SEASON_ID_PATTERN` de points/config.ts). */
const SEASON_ID_FORMAT = /^[a-z0-9-]{3,40}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * As quatro ações do próprio fã: o alvo da ação (o post, o show, a central)
 * conta uma vez por missão e período, pelo resumo em `keys`. Em `share` e
 * `invite`, a pessoa é única pelo marcador do convite, e nada é guardado.
 */
export const KEYED_ACTIONS: ReadonlySet<MissionAction> = new Set<MissionAction>([
  'like',
  'comment',
  'rsvp',
  'join',
]);

/** O alvo como fica no catálogo: as três chaves, null as que não valem. */
export type MissionTarget = {
  postId: string | null;
  /** A central; no alvo de post, a dele, gravada pelo servidor. */
  artistId: string | null;
  eventId: string | null;
};

export type TargetKind = 'none' | 'post' | 'artist' | 'event';

/** Alvos aceitos por tipo (22.1, decisão 4). O `join` exige a central (decisão 5). */
export const ACCEPTED_TARGETS: Readonly<Record<MissionAction, readonly TargetKind[]>> = {
  like: ['none', 'artist', 'post'],
  comment: ['none', 'artist', 'post'],
  rsvp: ['none', 'artist', 'event'],
  join: ['artist'],
  share: ['none', 'post', 'artist'],
  invite: ['none'],
};

export type MissionRecord = {
  id: string;
  title: string;
  action: MissionAction;
  target: MissionTarget | null;
  goal: number;
  period: MissionPeriod;
  rewardPoints: number;
  featured: boolean;
  startsAt: number;
  endsAt: number | null;
  status: MissionStatus;
  /** A primeira vez que ficou no ar (a trava `mission-locked`). */
  activatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type SeasonGoalMetric = 'missions' | 'points';

export type SeasonGoalConfig = {
  seasonId: string;
  title: string;
  description: string;
  /** O texto com a meta cumprida (o prêmio garantido); null usa o `description`. */
  reachedDescription: string | null;
  metric: SeasonGoalMetric;
  target: number;
};

/** config/missions lido. Sem documento, a versão 0: catálogo vazio e sem meta. */
export type MissionsConfig = {
  version: number;
  missions: MissionRecord[];
  seasonGoal: SeasonGoalConfig | null;
};

export const EMPTY_MISSIONS_CONFIG: MissionsConfig = { version: 0, missions: [], seasonGoal: null };

export type MissionsLog = { error: (message: string, data?: Record<string, unknown>) => void };

/**
 * Recusa do catálogo que não é de um campo: o alvo que o tipo não aceita
 * (`invalid-target`). O painel recebe como `details.reason`.
 */
export class MissionsError extends Error {
  readonly reason: 'invalid-target';

  constructor(reason: 'invalid-target', message = 'Esse alvo não vale para esse tipo de missão.') {
    super(message);
    this.name = 'MissionsError';
    this.reason = reason;
  }
}

// --- Leitura tolerante ------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/** ms de um Timestamp do Firestore (ou de algo com toMillis), ou de um número. */
export function millisOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const ms = (value.toMillis as () => unknown)();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

const validLine = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max && isVisibleLine(value);

/** O tipo do alvo; null quando a combinação não existe (post e show juntos, show e central). */
export function targetKind(target: MissionTarget | null): TargetKind | null {
  if (!target) return 'none';
  const { postId, artistId, eventId } = target;
  if (postId !== null) return eventId === null ? 'post' : null;
  if (eventId !== null) return artistId === null ? 'event' : null;
  return artistId !== null ? 'artist' : 'none';
}

/**
 * Alvo único: o alvo é a própria unidade (post em `like` e `comment`, show em
 * `rsvp`, central em `join`). A meta é 1, e a missão aberta de `like`, `rsvp`
 * e `join` some para quem já está no estado que ela pede.
 */
export function isSingleTarget(action: MissionAction, kind: TargetKind | null): boolean {
  return (
    ((action === 'like' || action === 'comment') && kind === 'post') ||
    (action === 'rsvp' && kind === 'event') ||
    (action === 'join' && kind === 'artist')
  );
}

function readTarget(value: unknown): MissionTarget | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const pick = (key: string, valid: (v: unknown) => boolean): string | null | undefined => {
    const raw = value[key];
    if (raw === undefined || raw === null) return null;
    return valid(raw) ? (raw as string) : undefined;
  };
  const postId = pick('postId', isContentId);
  const artistId = pick('artistId', isHandleFormat);
  const eventId = pick('eventId', isContentId);
  if (postId === undefined || artistId === undefined || eventId === undefined) return undefined;
  if (postId === null && artistId === null && eventId === null) return null;
  return { postId, artistId, eventId };
}

/** Uma missão do documento, conferida campo a campo; fora do formato, null. */
export function readMission(raw: unknown): MissionRecord | null {
  if (!isRecord(raw)) return null;
  const target = readTarget(raw.target);
  const startsAt = millisOf(raw.startsAt);
  const endsAt = raw.endsAt === null || raw.endsAt === undefined ? null : millisOf(raw.endsAt);
  const activatedAt =
    raw.activatedAt === null || raw.activatedAt === undefined ? null : millisOf(raw.activatedAt);
  if (
    typeof raw.id !== 'string' ||
    !MISSION_ID_PATTERN.test(raw.id) ||
    !validLine(raw.title, MISSION_TITLE_MAX) ||
    !(MISSION_ACTIONS as readonly unknown[]).includes(raw.action) ||
    !(MISSION_PERIODS as readonly unknown[]).includes(raw.period) ||
    (raw.status !== 'draft' && raw.status !== 'active') ||
    target === undefined ||
    !isInt(raw.goal) ||
    raw.goal < 1 ||
    raw.goal > MISSION_GOAL_MAX ||
    !isInt(raw.rewardPoints) ||
    raw.rewardPoints < 1 ||
    raw.rewardPoints > MISSION_REWARD_MAX ||
    typeof raw.featured !== 'boolean' ||
    startsAt === null ||
    (raw.endsAt !== null && raw.endsAt !== undefined && endsAt === null) ||
    (endsAt !== null && endsAt <= startsAt) ||
    (raw.activatedAt !== null && raw.activatedAt !== undefined && activatedAt === null)
  ) {
    return null;
  }
  const action = raw.action as MissionAction;
  const kind = targetKind(target);
  if (kind === null || !ACCEPTED_TARGETS[action].includes(kind)) return null;
  if (isSingleTarget(action, kind) && raw.goal !== 1) return null;
  return {
    id: raw.id,
    title: raw.title,
    action,
    target,
    goal: raw.goal,
    period: raw.period as MissionPeriod,
    rewardPoints: raw.rewardPoints,
    featured: raw.featured,
    startsAt,
    endsAt,
    status: raw.status,
    activatedAt,
    createdAt: millisOf(raw.createdAt) ?? 0,
    updatedAt: millisOf(raw.updatedAt) ?? 0,
  };
}

function readSeasonGoal(raw: unknown): SeasonGoalConfig | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return undefined;
  const max = raw.metric === 'points' ? SEASON_GOAL_POINTS_MAX : SEASON_GOAL_MISSIONS_MAX;
  if (
    typeof raw.seasonId !== 'string' ||
    !SEASON_ID_FORMAT.test(raw.seasonId) ||
    !validLine(raw.title, SEASON_GOAL_TITLE_MAX) ||
    !validLine(raw.description, SEASON_GOAL_TEXT_MAX) ||
    !(
      raw.reachedDescription === null ||
      raw.reachedDescription === undefined ||
      validLine(raw.reachedDescription, SEASON_GOAL_TEXT_MAX)
    ) ||
    (raw.metric !== 'missions' && raw.metric !== 'points') ||
    !isInt(raw.target) ||
    raw.target < 1 ||
    raw.target > max
  ) {
    return undefined;
  }
  return {
    seasonId: raw.seasonId,
    title: raw.title,
    description: raw.description,
    reachedDescription: (raw.reachedDescription as string | null | undefined) ?? null,
    metric: raw.metric,
    target: raw.target,
  };
}

/**
 * Leitura tolerante de config/missions (22.3): a missão fora do formato sai,
 * com erro no log, e as outras ficam (um `status` fora de `draft` e `active` é
 * fora do formato); id repetido fica só o primeiro; a meta inválida vira null;
 * documento fora do formato vale o catálogo vazio.
 */
export function parseMissionsConfig(data: unknown, log: MissionsLog): MissionsConfig {
  if (data === undefined || data === null) return { ...EMPTY_MISSIONS_CONFIG, missions: [] };
  if (!isRecord(data)) {
    log.error('config/missions fora do formato: catálogo vazio.');
    return { ...EMPTY_MISSIONS_CONFIG, missions: [] };
  }
  const version = isInt(data.version) && data.version >= 0 ? data.version : 0;
  if (version !== data.version) log.error('config/missions sem versão válida.');
  const missions: MissionRecord[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(data.missions)) {
    if (data.missions !== undefined) log.error('config/missions.missions fora do formato.');
  } else {
    for (const raw of data.missions) {
      const mission = readMission(raw);
      const id = isRecord(raw) ? raw.id : undefined;
      if (!mission) {
        log.error('config/missions: missão fora do formato, fora do catálogo.', { id });
      } else if (seen.has(mission.id)) {
        log.error('config/missions: id repetido, fica o primeiro.', { id: mission.id });
      } else {
        seen.add(mission.id);
        missions.push(mission);
      }
    }
  }
  const seasonGoal = readSeasonGoal(data.seasonGoal);
  if (seasonGoal === undefined) log.error('config/missions.seasonGoal inválida: sem meta.');
  return { version, missions, seasonGoal: seasonGoal ?? null };
}

// --- Gravação estrita (callables do painel) ----------------------------------------

/** A missão pedida pelo painel, conferida (sem id, status e datas do servidor). */
export type MissionInput = {
  title: string;
  action: MissionAction;
  target: MissionTarget | null;
  goal: number;
  period: MissionPeriod;
  rewardPoints: number;
  featured: boolean;
  startsAt: number;
  endsAt: number | null;
};

export const MISSION_FIELDS = [
  'title',
  'action',
  'target',
  'goal',
  'period',
  'rewardPoints',
  'featured',
  'startsAt',
  'endsAt',
] as const satisfies readonly (keyof MissionInput)[];

/** Os campos que a trava `mission-locked` segura depois do início (22.8). */
export const LOCKED_MISSION_FIELDS: readonly (keyof MissionInput)[] = [
  'action',
  'target',
  'goal',
  'period',
  'startsAt',
];

/**
 * O alvo pedido: null, ou um objeto com só uma das chaves (`postId`,
 * `eventId` ou `artistId`; com `postId`, o `artistId` é o do post, gravado
 * pelo servidor, e o do pedido é ignorado). Fora do formato: `invalid-request`
 * em `mission.target`; post com show, ou show com central, `invalid-target`.
 */
function parseTargetInput(value: unknown): MissionTarget | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new ConfigValidationError('mission.target');
  for (const key of Object.keys(value)) {
    if (!['postId', 'artistId', 'eventId'].includes(key)) {
      throw new ConfigValidationError(`mission.target.${key}`);
    }
  }
  const pick = (key: 'postId' | 'artistId' | 'eventId', valid: (v: unknown) => boolean) => {
    const raw = value[key];
    if (raw === undefined || raw === null) return null;
    if (!valid(raw)) throw new ConfigValidationError(`mission.target.${key}`);
    return raw as string;
  };
  const postId = pick('postId', isContentId);
  const artistId = pick('artistId', isHandleFormat);
  const eventId = pick('eventId', isContentId);
  if (postId !== null && eventId !== null) throw new MissionsError('invalid-target');
  if (eventId !== null && artistId !== null) throw new MissionsError('invalid-target');
  if (postId === null && artistId === null && eventId === null) return null;
  return { postId, artistId: postId !== null ? null : artistId, eventId };
}

function parseMissionField<K extends keyof MissionInput>(key: K, value: unknown): MissionInput[K] {
  const field = `mission.${key}`;
  const fail = (): never => {
    throw new ConfigValidationError(field);
  };
  switch (key) {
    case 'title':
      if (!validLine(value, MISSION_TITLE_MAX)) fail();
      break;
    case 'action':
      if (!(MISSION_ACTIONS as readonly unknown[]).includes(value)) fail();
      break;
    case 'target':
      return parseTargetInput(value) as MissionInput[K];
    case 'goal':
      if (!isInt(value) || value < 1 || value > MISSION_GOAL_MAX) fail();
      break;
    case 'period':
      if (!(MISSION_PERIODS as readonly unknown[]).includes(value)) fail();
      break;
    case 'rewardPoints':
      if (!isInt(value) || value < 1 || value > MISSION_REWARD_MAX) fail();
      break;
    case 'featured':
      if (typeof value !== 'boolean') fail();
      break;
    case 'startsAt':
      if (!isInt(value) || value < 0) fail();
      break;
    case 'endsAt':
      if (value !== null && (!isInt(value) || value < 0)) fail();
      break;
  }
  return value as MissionInput[K];
}

/**
 * As regras entre os campos, na missão já completa: o alvo que o tipo
 * aceita (`invalid-target`; o `join` sem central também), a meta 1 no alvo
 * único (`mission.goal`) e o `endsAt` depois do `startsAt`, até 366 dias.
 */
export function checkMissionRules(mission: MissionInput): void {
  const kind = targetKind(mission.target);
  if (kind === null || !ACCEPTED_TARGETS[mission.action].includes(kind)) {
    throw new MissionsError('invalid-target');
  }
  if (isSingleTarget(mission.action, kind) && mission.goal !== 1) {
    throw new ConfigValidationError('mission.goal');
  }
  if (
    mission.endsAt !== null &&
    (mission.endsAt <= mission.startsAt ||
      mission.endsAt - mission.startsAt > MISSION_WINDOW_MAX_DAYS * DAY_MS)
  ) {
    throw new ConfigValidationError('mission.endsAt');
  }
}

/** A missão nova do `createMission`: todos os campos, conferidos, e as regras entre eles. */
export function validateMissionInput(input: unknown): MissionInput {
  if (!isRecord(input)) throw new ConfigValidationError('mission');
  for (const key of Object.keys(input)) {
    if (!(MISSION_FIELDS as readonly string[]).includes(key)) {
      throw new ConfigValidationError(`mission.${key}`);
    }
  }
  const out = {} as Record<keyof MissionInput, unknown>;
  for (const key of MISSION_FIELDS) {
    if (!(key in input)) throw new ConfigValidationError(`mission.${key}`);
    out[key] = parseMissionField(key, input[key]);
  }
  const mission = out as MissionInput;
  checkMissionRules(mission);
  return mission;
}

/** As mudanças do `updateMission`: só os campos mandados, conferidos um a um. */
export function validateMissionChanges(input: unknown): Partial<MissionInput> {
  if (!isRecord(input)) throw new ConfigValidationError('changes');
  const out: Partial<Record<keyof MissionInput, unknown>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(MISSION_FIELDS as readonly string[]).includes(key)) {
      throw new ConfigValidationError(`mission.${key}`);
    }
    out[key as keyof MissionInput] = parseMissionField(key as keyof MissionInput, value);
  }
  return out as Partial<MissionInput>;
}

/** A meta da temporada pedida pelo painel (sem o `seasonId`, que vem de config/season). */
export type SeasonGoalInput = Omit<SeasonGoalConfig, 'seasonId'>;

/** Validação estrita da meta (`updateSeasonGoal`); null tira a meta. */
export function validateSeasonGoalInput(input: unknown): SeasonGoalInput | null {
  if (input === null) return null;
  if (!isRecord(input)) throw new ConfigValidationError('goal');
  const fields = ['title', 'description', 'reachedDescription', 'metric', 'target'];
  for (const key of Object.keys(input)) {
    if (!fields.includes(key)) throw new ConfigValidationError(`goal.${key}`);
  }
  if (!validLine(input.title, SEASON_GOAL_TITLE_MAX)) throw new ConfigValidationError('goal.title');
  if (!validLine(input.description, SEASON_GOAL_TEXT_MAX)) {
    throw new ConfigValidationError('goal.description');
  }
  const reached = input.reachedDescription ?? null;
  if (reached !== null && !validLine(reached, SEASON_GOAL_TEXT_MAX)) {
    throw new ConfigValidationError('goal.reachedDescription');
  }
  if (input.metric !== 'missions' && input.metric !== 'points') {
    throw new ConfigValidationError('goal.metric');
  }
  const max = input.metric === 'points' ? SEASON_GOAL_POINTS_MAX : SEASON_GOAL_MISSIONS_MAX;
  if (!isInt(input.target) || input.target < 1 || input.target > max) {
    throw new ConfigValidationError('goal.target');
  }
  return {
    title: input.title,
    description: input.description,
    reachedDescription: reached as string | null,
    metric: input.metric,
    target: input.target,
  };
}

/** O título sem acento, em minúsculas, com hífens, até 30 caracteres (o começo do id). */
export function missionSlug(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `missao${slug ? `-${slug}` : ''}`;
}

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** O id gerado: o slug mais um hífen e 4 caracteres sorteados (o `random` das dependências). */
export function draftMissionId(title: string, random: () => number): string {
  let suffix = '';
  for (let index = 0; index < 4; index += 1) {
    const at = Math.min(SUFFIX_ALPHABET.length - 1, Math.floor(random() * SUFFIX_ALPHABET.length));
    suffix += SUFFIX_ALPHABET[at];
  }
  return `${missionSlug(title)}-${suffix}`;
}

// --- Índice e períodos ---------------------------------------------------------------

/**
 * O índice por tipo de ação, montado a cada carga do cache: a ação consulta
 * o índice e nunca lê o catálogo (22.1, decisão 1). Só as missões no ar.
 */
export type MissionIndex = {
  version: number;
  byAction: ReadonlyMap<MissionAction, readonly MissionRecord[]>;
  /** Há missão `share` no ar com alvo de central: o link de post lê a central do post. */
  shareWithCentral: boolean;
};

export function missionIndex(config: Pick<MissionsConfig, 'version' | 'missions'>): MissionIndex {
  const byAction = new Map<MissionAction, MissionRecord[]>();
  let shareWithCentral = false;
  for (const mission of config.missions) {
    if (mission.status !== 'active') continue;
    const list = byAction.get(mission.action) ?? [];
    list.push(mission);
    byAction.set(mission.action, list);
    if (mission.action === 'share' && mission.target?.artistId && mission.target.postId === null) {
      shareWithCentral = true;
    }
  }
  return { version: config.version, byAction, shareWithCentral };
}

export const EMPTY_MISSION_INDEX: MissionIndex = missionIndex(EMPTY_MISSIONS_CONFIG);

/** A chave do período de `now`: o dia (`2026-10-05`) ou a semana ISO (`2026-W41`) de São Paulo. */
export function periodKeyOf(period: MissionPeriod, now: number): string {
  const day = dayKey(now);
  return period === 'daily' ? day : weekKey(day);
}

/** Quando o período de `now` acaba: o começo do dia seguinte ou da segunda-feira seguinte. */
export function periodEndOf(period: MissionPeriod, now: number): number {
  return period === 'daily' ? nextDayStart(now) : nextWeekStart(now);
}

/** O fim da missão aberta: o menor entre o `endsAt` e o fim do período (22.1, decisão 3). */
export function missionEnd(mission: Pick<MissionRecord, 'endsAt' | 'period'>, now: number): number {
  const end = periodEndOf(mission.period, now);
  return mission.endsAt === null ? end : Math.min(end, mission.endsAt);
}

/** No ar e na janela: `startsAt <= agora < fim`. */
export function isMissionOpen(mission: MissionRecord, now: number): boolean {
  return mission.status === 'active' && mission.startsAt <= now && now < missionEnd(mission, now);
}

// --- Ticks e progresso ----------------------------------------------------------------

/** Uma unidade de uma ação, contada a partir de uma gravação que o servidor já faz (22.4). */
export type MissionTick = {
  action: MissionAction;
  /** O post, o show, a central ou a chave da pessoa. */
  key: string;
  /** Onde a ação aconteceu, para o alvo da missão (decisão 5). */
  on: { postId?: string; eventId?: string; artistIds: readonly string[] };
};

/**
 * O alvo é filtro, e só a chave do alvo decide: o de post compara o
 * `postId`, o de show o `eventId`, o de central a lista de centrais do tick;
 * sem alvo, qualquer uma.
 */
export function tickMatches(mission: MissionRecord, tick: MissionTick): boolean {
  if (mission.action !== tick.action) return false;
  const target = mission.target;
  if (!target) return true;
  if (target.postId !== null) return tick.on.postId === target.postId;
  if (target.eventId !== null) return tick.on.eventId === target.eventId;
  if (target.artistId !== null) return tick.on.artistIds.includes(target.artistId);
  return true;
}

/** As missões no ar, na janela, do tipo de algum tick e com o alvo que casa, na ordem do catálogo. */
export function candidateMissions(
  index: MissionIndex,
  ticks: readonly MissionTick[],
  now: number,
): MissionRecord[] {
  if (ticks.length === 0) return [];
  const out: MissionRecord[] = [];
  const seen = new Set<string>();
  for (const action of new Set(ticks.map((tick) => tick.action))) {
    for (const mission of index.byAction.get(action) ?? []) {
      if (seen.has(mission.id) || !isMissionOpen(mission, now)) continue;
      if (ticks.some((tick) => tickMatches(mission, tick))) {
        seen.add(mission.id);
        out.push(mission);
      }
    }
  }
  return out;
}

/** O progresso de uma missão no período, na carteira (22.3). */
export type MissionItem = {
  current: number;
  /** Em like, comment, rsvp e join: o resumo de cada alvo que já contou. */
  keys: string[];
  completedAt: number | null;
  /** O que a conclusão pagou (0 enquanto aberta ou se saiu duplicate). */
  rewardPaid: number;
};

export type MissionPeriodState = { key: string; items: Record<string, MissionItem> };

/** `wallets/{uid}.missions`: só o período atual de cada tipo fica guardado. */
export type MissionsState = {
  daily: MissionPeriodState | null;
  weekly: MissionPeriodState | null;
};

export function emptyMissionsState(): MissionsState {
  return { daily: null, weekly: null };
}

function clonePeriod(state: MissionPeriodState | null): MissionPeriodState | null {
  if (!state) return null;
  const items: Record<string, MissionItem> = {};
  for (const [id, item] of Object.entries(state.items))
    items[id] = { ...item, keys: [...item.keys] };
  return { key: state.key, items };
}

export function cloneMissionsState(state: MissionsState): MissionsState {
  return { daily: clonePeriod(state.daily), weekly: clonePeriod(state.weekly) };
}

export type RolledMissions = {
  state: MissionsState;
  /** O período guardado é posterior ao do pedido: os ticks dele são descartados. */
  stale: Record<MissionPeriod, boolean>;
};

/**
 * A troca preguiçosa de período (22.4, passo 3): a chave guardada anterior à
 * do pedido vira um período vazio, com a chave do pedido, sem gravar por
 * isso. A chave posterior (o pedido de 23:59:59,950 gravando depois do de
 * 00:00:00,010) fica como está, e o pedido não anda aquele período. As chaves
 * comparam como texto.
 */
export function rollMissions(state: MissionsState, now: number): RolledMissions {
  const next = cloneMissionsState(state);
  const stale: Record<MissionPeriod, boolean> = { daily: false, weekly: false };
  for (const period of MISSION_PERIODS) {
    const key = periodKeyOf(period, now);
    const stored = next[period];
    if (!stored || stored.key < key) next[period] = { key, items: {} };
    else if (stored.key > key) stale[period] = true;
  }
  return { state: next, stale };
}

/** Os 12 primeiros caracteres do sha256 do id, em base64url: estável e curto (22.3). */
export function keyDigest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('base64url').slice(0, KEY_DIGEST_LENGTH);
}

/** Uma missão que fechou a meta agora, no período dela. */
export type MissionCompletion = { mission: MissionRecord; periodKey: string };

export type AppliedTicks = {
  state: MissionsState;
  completions: MissionCompletion[];
  /** Alguma unidade contou. */
  counted: boolean;
};

const emptyItem = (): MissionItem => ({ current: 0, keys: [], completedAt: null, rewardPaid: 0 });

/**
 * Os ticks, um por um, na ordem (22.4, passo 4). Para cada candidata do tick:
 * concluída no período, não anda; nas ações do fã, o alvo que já está em
 * `keys` não anda; senão, +1 (e o resumo do alvo em `keys`). Chegou na meta:
 * `completedAt` e a conclusão, que vira o lançamento da missão.
 */
export function applyMissionTicks(
  rolled: RolledMissions,
  candidates: readonly MissionRecord[],
  ticks: readonly MissionTick[],
  now: number,
): AppliedTicks {
  const state = cloneMissionsState(rolled.state);
  const completions: MissionCompletion[] = [];
  let counted = false;
  for (const tick of ticks) {
    const digest = KEYED_ACTIONS.has(tick.action) ? keyDigest(tick.key) : null;
    for (const mission of candidates) {
      if (!tickMatches(mission, tick) || rolled.stale[mission.period]) continue;
      const period = state[mission.period]!;
      const item = period.items[mission.id] ?? emptyItem();
      if (item.completedAt !== null) continue;
      if (digest !== null && item.keys.includes(digest)) continue;
      item.current += 1;
      if (digest !== null) item.keys.push(digest);
      if (item.current >= mission.goal) {
        item.completedAt = now;
        completions.push({ mission, periodKey: period.key });
      }
      period.items[mission.id] = item;
      counted = true;
    }
  }
  return { state, completions, counted };
}

/** O evento de pontos da conclusão: a missão e o período (`m-clipe-netto:2026-10-05`). */
export function missionEventId(missionId: string, periodKey: string): string {
  return `${missionId}:${periodKey}`;
}

/**
 * A central que a conclusão paga (22.1, decisão 7): a do alvo (a do post, ou a
 * central alvo) em curtir, comentar, "Eu vou" e entrar; null sem alvo, com
 * show alvo e sempre em `share` e `invite`.
 */
export function missionArtistId(mission: Pick<MissionRecord, 'action' | 'target'>): string | null {
  if (mission.action === 'share' || mission.action === 'invite') return null;
  if (!mission.target || mission.target.eventId !== null) return null;
  return mission.target.artistId;
}

// --- Leitura para a 1g ----------------------------------------------------------------

/** O progresso guardado da missão, só quando a chave é a do período de agora. */
export function itemNow(
  state: MissionsState,
  mission: Pick<MissionRecord, 'id' | 'period'>,
  now: number,
): MissionItem | null {
  const period = state[mission.period];
  if (!period || period.key !== periodKeyOf(mission.period, now)) return null;
  return period.items[mission.id] ?? null;
}

/** Uma missão que pode aparecer agora, antes de conferir o alvo. */
export type MissionCandidateView = { mission: MissionRecord; item: MissionItem | null };

/**
 * As missões no ar que podem aparecer agora, na ordem do catálogo (22.2,
 * passo 2): a aberta enquanto `agora < fim`, a concluída no período até o fim
 * do período (mesmo com o `endsAt` vencido).
 */
export function visibleCandidates(
  missions: readonly MissionRecord[],
  state: MissionsState,
  now: number,
): MissionCandidateView[] {
  const out: MissionCandidateView[] = [];
  for (const mission of missions) {
    if (mission.status !== 'active' || mission.startsAt > now) continue;
    const item = itemNow(state, mission, now);
    if (item?.completedAt !== null && item?.completedAt !== undefined) {
      out.push({ mission, item });
    } else if (now < missionEnd(mission, now)) {
      out.push({ mission, item });
    }
  }
  return out;
}

/** O que a montagem precisa saber de cada alvo, lido pelo service. */
export type TargetFacts = {
  /** Post no ar e de central no ar (a regra do `readVisiblePost`). */
  posts: ReadonlyMap<string, boolean>;
  /** Show no ar e não encerrado; com o título e a data, para o `event` da missão. */
  events: ReadonlyMap<string, { open: boolean; title: string; startsAt: number } | null>;
  /** Central no ar. */
  artists: ReadonlyMap<string, boolean>;
  /** Missões abertas de alvo único que o fã já fez (curtiu, vai, está na central). */
  done: ReadonlySet<string>;
};

/** Alvo único de `like`, `rsvp` ou `join`: a aberta some para quem já está no estado. */
export function hidesWhenDone(mission: MissionRecord): boolean {
  return mission.action !== 'comment' && isSingleTarget(mission.action, targetKind(mission.target));
}

function targetVisible(mission: MissionRecord, facts: TargetFacts): boolean {
  const target = mission.target;
  if (!target) return true;
  if (target.postId !== null) return facts.posts.get(target.postId) === true;
  if (target.eventId !== null) return facts.events.get(target.eventId)?.open === true;
  if (target.artistId !== null) return facts.artists.get(target.artistId) === true;
  return true;
}

function targetView(target: MissionTarget | null): Mission['target'] {
  if (!target) return null;
  const out: NonNullable<Mission['target']> = {};
  if (target.postId !== null) out.postId = target.postId;
  if (target.artistId !== null) out.artistId = target.artistId;
  if (target.eventId !== null) out.eventId = target.eventId;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A 1g (22.2, passos 3 a 5): sai a aberta com o alvo invisível e a aberta de
 * alvo único já feita; a concluída fica, com o alvo fora do ar. O destaque de
 * cada período é a primeira destacada visível, aberta ou concluída; as outras
 * saem com `featured: false`.
 */
export function missionsView(input: {
  candidates: readonly MissionCandidateView[];
  facts: TargetFacts;
  now: number;
  breakdown: { perVisit: number; perSignup: number };
}): Mission[] {
  const { facts, now } = input;
  const featuredTaken = new Set<MissionPeriod>();
  const out: Mission[] = [];
  for (const { mission, item } of input.candidates) {
    const completed = item?.completedAt !== null && item?.completedAt !== undefined;
    if (!completed) {
      if (!targetVisible(mission, facts)) continue;
      if (hidesWhenDone(mission) && facts.done.has(mission.id)) continue;
    }
    let featured = false;
    if (mission.featured && !featuredTaken.has(mission.period)) {
      featured = true;
      featuredTaken.add(mission.period);
    }
    const event =
      mission.action === 'rsvp' && mission.target?.eventId
        ? (facts.events.get(mission.target.eventId) ?? null)
        : null;
    const paid = completed && item!.rewardPaid > 0 ? item!.rewardPaid : mission.rewardPoints;
    out.push({
      id: mission.id,
      title: mission.title,
      rewardPoints: paid,
      progress: {
        current: Math.min(item?.current ?? 0, mission.goal),
        target: mission.goal,
      },
      // A concluída fica até o fim do período (decisão 3), e é esse fim que o
      // app recebe: passado dele, ela sai da tela sem esperar outra busca.
      endsAt: new Date(
        completed ? periodEndOf(mission.period, now) : missionEnd(mission, now),
      ).toISOString(),
      status: completed ? 'completed' : 'active',
      action: mission.action,
      target: targetView(mission.target),
      period: mission.period,
      featured,
      pointsBreakdown: mission.action === 'share' ? { ...input.breakdown } : null,
      completedAt: completed ? new Date(item!.completedAt!).toISOString() : null,
      unlockHint: null,
      event: event ? { name: event.title, startsAt: new Date(event.startsAt).toISOString() } : null,
    });
  }
  return out;
}

/** A missão do dia (1b): a destacada de "Hoje" da mesma montagem, ou null. */
export function dailyMissionOf(missions: readonly Mission[]): Mission | null {
  return missions.find((mission) => mission.period === 'daily' && mission.featured) ?? null;
}

/**
 * A meta da temporada da 1g (22.7): só com a temporada ativa de mesmo id.
 * `completedCount` são as missões concluídas na temporada ou os pontos dela;
 * cumprida (marcada ou com a conta no alvo), o texto é o do prêmio garantido.
 */
export function seasonGoalView(input: {
  goal: SeasonGoalConfig | null;
  season: { id: string; endsAt: number } | null;
  seasonMissions: number;
  seasonPoints: number;
  goalReachedSeasonId: string | null;
}): SeasonGoal | null {
  const { goal, season } = input;
  if (!goal || !season || goal.seasonId !== season.id) return null;
  const count = goal.metric === 'missions' ? input.seasonMissions : input.seasonPoints;
  const reached = input.goalReachedSeasonId === season.id || count >= goal.target;
  return {
    id: season.id,
    title: goal.title,
    description: reached ? (goal.reachedDescription ?? goal.description) : goal.description,
    completedCount: count,
    targetCount: goal.target,
    endsAt: new Date(season.endsAt).toISOString(),
    metric: goal.metric,
  };
}
