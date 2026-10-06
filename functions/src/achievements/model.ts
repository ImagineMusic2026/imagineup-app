import type { Achievement, MyAchievements } from '../api/contract';
import { ConfigValidationError } from '../config-validation';
import { draftMissionId, millisOf } from '../missions/model';
import { isVisibleLine } from '../visible-line';

// Conquistas do bloco 7, puro: nada aqui lê ou grava o Firestore. O catálogo
// (config/achievements, com a lista provisória como padrão do código), as
// regras de desbloqueio (nível, primeira vez, ranking no bloco 8) e a montagem
// da 1e. Do núcleo de pontos, nada: o nível chega pronto (o número do degrau,
// calculado por quem chama). docs/arquitetura-api.md, 22.6.

/** As ações que a regra `first` conhece: as dos ticks, mais a primeira missão concluída. */
export const FIRST_ACTIONS = [
  'like',
  'comment',
  'rsvp',
  'join',
  'share',
  'invite',
  'mission',
] as const;
export type FirstAction = (typeof FIRST_ACTIONS)[number];

export type AchievementRule =
  | { type: 'level'; level: number }
  | { type: 'first'; action: FirstAction }
  | { type: 'rank'; top: number };

export type AchievementTone = 'action' | 'points' | 'events';
export type AchievementStatus = 'draft' | 'active' | 'archived';

export const ACHIEVEMENT_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const ACHIEVEMENT_TITLE_MAX = 40;
export const ACHIEVEMENT_ICON_PATTERN = /^[a-z0-9-]{1,30}$/;
/** Conquistas no documento, arquivadas inclusive (a arquivada fica na carteira de quem ganhou). */
export const ACHIEVEMENTS_MAX = 100;
/** Degraus da régua que uma conquista de nível pode pedir (o primeiro é o nível 1). */
export const ACHIEVEMENT_LEVEL_MIN = 2;
export const ACHIEVEMENT_LEVEL_MAX = 50;
/** Posição no ranking (bloco 8). */
export const ACHIEVEMENT_RANK_MAX = 1_000;
/** As peças da linha de conquistas da 1e (`ACHIEVEMENT_SLOTS` do app). */
export const ACHIEVEMENT_HIGHLIGHTS = 4;
/** Desbloqueadas entre os destaques: as 3 mais novas, e depois as bloqueadas. */
export const ACHIEVEMENT_UNLOCKED_HIGHLIGHTS = 3;

export type AchievementRecord = {
  id: string;
  title: string;
  icon: string;
  tone: AchievementTone;
  rule: AchievementRule;
  status: AchievementStatus;
  /** A primeira publicação: depois dela a regra não muda (`achievement-locked`). */
  activatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AchievementsConfig = { version: number; achievements: AchievementRecord[] };

type Seed = Pick<AchievementRecord, 'id' | 'title' | 'icon' | 'tone' | 'rule' | 'status'>;

/**
 * A lista provisória (22.6), até a cliente responder (UP-9): só regras que o
 * servidor sabe conferir hoje. Conta como publicada (cada `active` com
 * `activatedAt`), e o "Top 20" fica em rascunho até o ranking (bloco 8).
 */
const DEFAULT_LIST: readonly Seed[] = [
  {
    id: 'boca-a-boca',
    title: 'Boca a boca',
    icon: 'share',
    tone: 'action',
    rule: { type: 'first', action: 'share' },
    status: 'active',
  },
  {
    id: 'fa-de-show',
    title: 'Fã de show',
    icon: 'ticket',
    tone: 'events',
    rule: { type: 'first', action: 'rsvp' },
    status: 'active',
  },
  {
    id: 'missao-cumprida',
    title: 'Missão cumprida',
    icon: 'flame',
    tone: 'points',
    rule: { type: 'first', action: 'mission' },
    status: 'active',
  },
  {
    id: 'puxa-conversa',
    title: 'Puxa conversa',
    icon: 'comment',
    tone: 'action',
    rule: { type: 'first', action: 'comment' },
    status: 'active',
  },
  {
    id: 'pe-de-serra',
    title: 'Pé de serra',
    icon: 'star',
    tone: 'points',
    rule: { type: 'level', level: 3 },
    status: 'active',
  },
  {
    id: 'sanfona',
    title: 'Sanfona',
    icon: 'star',
    tone: 'points',
    rule: { type: 'level', level: 5 },
    status: 'active',
  },
  {
    id: 'purainha',
    title: 'Purainha',
    icon: 'star',
    tone: 'points',
    rule: { type: 'level', level: 7 },
    status: 'active',
  },
  {
    id: 'backstage',
    title: 'Backstage',
    icon: 'star',
    tone: 'points',
    rule: { type: 'level', level: 8 },
    status: 'active',
  },
  {
    id: 'lenda',
    title: 'Lenda',
    icon: 'star',
    tone: 'points',
    rule: { type: 'level', level: 10 },
    status: 'active',
  },
  {
    id: 'top-20',
    title: 'Top 20',
    icon: 'trophy',
    tone: 'points',
    rule: { type: 'rank', top: 20 },
    status: 'draft',
  },
];

/**
 * O catálogo com as datas de uma gravação: `activatedAt` igual a `at` nas
 * ativas (a lista padrão vale desde o deploy: sem a data, a trava deixaria
 * mudar a regra de uma conquista já ganha).
 */
export function defaultAchievements(at: number): AchievementRecord[] {
  return DEFAULT_LIST.map((seed) => ({
    ...seed,
    rule: { ...seed.rule } as AchievementRule,
    activatedAt: seed.status === 'active' ? at : null,
    createdAt: at,
    updatedAt: at,
  }));
}

/** O padrão do código (versão 0), valendo enquanto config/achievements não existe. */
export const DEFAULT_ACHIEVEMENTS_CONFIG: AchievementsConfig = {
  version: 0,
  achievements: defaultAchievements(0),
};

// --- Leitura tolerante ------------------------------------------------------------

export type AchievementsLog = { error: (message: string, data?: Record<string, unknown>) => void };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

const validTitle = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= ACHIEVEMENT_TITLE_MAX &&
  isVisibleLine(value);

const TONES: readonly unknown[] = ['action', 'points', 'events'];

/** A regra no formato (o degrau na régua de agora é conferido pela callable). */
function readRule(value: unknown): AchievementRule | null {
  if (!isRecord(value)) return null;
  if (value.type === 'level') {
    return isInt(value.level) &&
      value.level >= ACHIEVEMENT_LEVEL_MIN &&
      value.level <= ACHIEVEMENT_LEVEL_MAX &&
      Object.keys(value).length === 2
      ? { type: 'level', level: value.level }
      : null;
  }
  if (value.type === 'first') {
    return (FIRST_ACTIONS as readonly unknown[]).includes(value.action) &&
      Object.keys(value).length === 2
      ? { type: 'first', action: value.action as FirstAction }
      : null;
  }
  if (value.type === 'rank') {
    return isInt(value.top) &&
      value.top >= 1 &&
      value.top <= ACHIEVEMENT_RANK_MAX &&
      Object.keys(value).length === 2
      ? { type: 'rank', top: value.top }
      : null;
  }
  return null;
}

function readAchievement(raw: unknown): AchievementRecord | null {
  if (!isRecord(raw)) return null;
  const rule = readRule(raw.rule);
  const activatedAt =
    raw.activatedAt === null || raw.activatedAt === undefined ? null : millisOf(raw.activatedAt);
  if (
    typeof raw.id !== 'string' ||
    !ACHIEVEMENT_ID_PATTERN.test(raw.id) ||
    !validTitle(raw.title) ||
    typeof raw.icon !== 'string' ||
    !ACHIEVEMENT_ICON_PATTERN.test(raw.icon) ||
    !TONES.includes(raw.tone) ||
    !rule ||
    (raw.status !== 'draft' && raw.status !== 'active' && raw.status !== 'archived') ||
    (raw.activatedAt !== null && raw.activatedAt !== undefined && activatedAt === null)
  ) {
    return null;
  }
  return {
    id: raw.id,
    title: raw.title,
    icon: raw.icon,
    tone: raw.tone as AchievementTone,
    rule,
    status: raw.status,
    activatedAt,
    createdAt: millisOf(raw.createdAt) ?? 0,
    updatedAt: millisOf(raw.updatedAt) ?? 0,
  };
}

/**
 * Leitura tolerante de config/achievements: a conquista fora do formato sai,
 * com erro no log, e as outras ficam; id repetido fica só o primeiro;
 * documento fora do formato vale o padrão do código.
 */
export function parseAchievementsConfig(data: unknown, log: AchievementsLog): AchievementsConfig {
  const fallback = (): AchievementsConfig => ({
    version: 0,
    achievements: DEFAULT_ACHIEVEMENTS_CONFIG.achievements.map((item) => ({
      ...item,
      rule: { ...item.rule },
    })),
  });
  if (data === undefined || data === null) return fallback();
  if (!isRecord(data) || !Array.isArray(data.achievements)) {
    log.error('config/achievements fora do formato: valendo o padrão do código.');
    return fallback();
  }
  const version = isInt(data.version) && data.version >= 0 ? data.version : 0;
  if (version !== data.version) log.error('config/achievements sem versão válida.');
  const achievements: AchievementRecord[] = [];
  const seen = new Set<string>();
  for (const raw of data.achievements) {
    const achievement = readAchievement(raw);
    const id = isRecord(raw) ? raw.id : undefined;
    if (!achievement) {
      log.error('config/achievements: conquista fora do formato, fora do catálogo.', { id });
    } else if (seen.has(achievement.id)) {
      log.error('config/achievements: id repetido, fica o primeiro.', { id: achievement.id });
    } else {
      seen.add(achievement.id);
      achievements.push(achievement);
    }
  }
  return { version, achievements };
}

// --- Gravação estrita (callables do painel) ------------------------------------------

export type AchievementInput = Pick<AchievementRecord, 'title' | 'icon' | 'tone' | 'rule'>;

export const ACHIEVEMENT_FIELDS = ['title', 'icon', 'tone', 'rule'] as const;

function parseAchievementField<K extends keyof AchievementInput>(
  key: K,
  value: unknown,
): AchievementInput[K] {
  const fail = (): never => {
    throw new ConfigValidationError(`achievement.${key}`);
  };
  switch (key) {
    case 'title':
      if (!validTitle(value)) fail();
      return value as AchievementInput[K];
    case 'icon':
      if (typeof value !== 'string' || !ACHIEVEMENT_ICON_PATTERN.test(value)) fail();
      return value as AchievementInput[K];
    case 'tone':
      if (!TONES.includes(value)) fail();
      return value as AchievementInput[K];
    default: {
      const rule = readRule(value);
      if (!rule) {
        if (isRecord(value) && value.type === 'level') {
          throw new ConfigValidationError('achievement.rule.level');
        }
        fail();
      }
      return rule as AchievementInput[K];
    }
  }
}

/** A conquista nova do `createAchievement`: todos os campos, conferidos. */
export function validateAchievementInput(input: unknown): AchievementInput {
  if (!isRecord(input)) throw new ConfigValidationError('achievement');
  for (const key of Object.keys(input)) {
    if (!(ACHIEVEMENT_FIELDS as readonly string[]).includes(key)) {
      throw new ConfigValidationError(`achievement.${key}`);
    }
  }
  const out = {} as Record<keyof AchievementInput, unknown>;
  for (const key of ACHIEVEMENT_FIELDS) {
    if (!(key in input)) throw new ConfigValidationError(`achievement.${key}`);
    out[key] = parseAchievementField(key, input[key]);
  }
  return out as AchievementInput;
}

/** As mudanças do `updateAchievement`: só os campos mandados. */
export function validateAchievementChanges(input: unknown): Partial<AchievementInput> {
  if (!isRecord(input)) throw new ConfigValidationError('changes');
  const out: Partial<Record<keyof AchievementInput, unknown>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(ACHIEVEMENT_FIELDS as readonly string[]).includes(key)) {
      throw new ConfigValidationError(`achievement.${key}`);
    }
    out[key as keyof AchievementInput] = parseAchievementField(
      key as keyof AchievementInput,
      value,
    );
  }
  return out as Partial<AchievementInput>;
}

/** O id gerado, como o da missão: o título em slug, um hífen e 4 caracteres sorteados. */
export function draftAchievementId(title: string, random: () => number): string {
  return draftMissionId(title, random);
}

/** As regras iguais (a trava compara a regra inteira). */
export function sameRule(a: AchievementRule, b: AchievementRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** O maior degrau pedido por uma conquista de nível não arquivada (o `level-in-use`). */
export function levelsInUse(catalog: readonly AchievementRecord[]): AchievementRecord[] {
  return catalog.filter((item) => item.status !== 'archived' && item.rule.type === 'level');
}

// --- Desbloqueio ------------------------------------------------------------------

export type Unlocked = { id: string; title: string };

export type UnlockOutcome = {
  /** O mapa novo (id para ms), ou o lido quando nada nasceu. */
  owned: Record<string, number>;
  /** Todas as que nasceram agora (para o shard). */
  added: Unlocked[];
  /** As que nasceram com `now`, para o anúncio de quem chama (a de nível que já valia fica de fora). */
  announced: Unlocked[];
};

/**
 * As conquistas que a gravação destrava (22.6, `unlockAchievements`): cada
 * `active` que ainda não está em `owned` e cuja regra ficou verdadeira. A de
 * nível que o XP lido já alcançava (a régua mudou depois da última gravação)
 * entra com a data `readAt` (o `updatedAt` da carteira lida), a mesma que o
 * `GET /me/achievements` já mostrava, e fora do anúncio; o resto, com `now`.
 * Conquista não dá pontos e nunca é revogada.
 */
export function unlockAchievements(input: {
  catalog: readonly AchievementRecord[];
  owned: Readonly<Record<string, number>>;
  levelBefore: number;
  levelAfter: number;
  firsts: ReadonlySet<FirstAction>;
  now: number;
  readAt: number | null;
}): UnlockOutcome {
  const owned = { ...input.owned };
  const added: Unlocked[] = [];
  const announced: Unlocked[] = [];
  for (const item of input.catalog) {
    if (item.status !== 'active' || owned[item.id] !== undefined) continue;
    const { rule } = item;
    const entry = { id: item.id, title: item.title };
    if (rule.type === 'level') {
      if (input.levelBefore >= rule.level) {
        owned[item.id] = input.readAt ?? input.now;
        added.push(entry);
      } else if (input.levelAfter >= rule.level) {
        owned[item.id] = input.now;
        added.push(entry);
        announced.push(entry);
      }
    } else if (rule.type === 'first' && input.firsts.has(rule.action)) {
      owned[item.id] = input.now;
      added.push(entry);
      announced.push(entry);
    }
    // `rank`: só no bloco 8 (até lá nunca).
  }
  return { owned: added.length > 0 ? owned : { ...input.owned }, added, announced };
}

/**
 * As conquistas da 1e (`GET /me/achievements`, 22.2): o "X de N" das ativas,
 * com as de nível que o nível de agora já alcança (data do `updatedAt` da
 * carteira), e os destaques: até 3 desbloqueadas, da mais nova à mais velha
 * (empate pelo catálogo de trás para frente), e as bloqueadas, primeiro a de
 * nível com o menor degrau acima do nível atual, depois a ordem do catálogo,
 * até 4 peças.
 */
export function achievementsView(input: {
  catalog: readonly AchievementRecord[];
  owned: Readonly<Record<string, number>>;
  level: number;
  updatedAt: number | null;
}): MyAchievements {
  const active = input.catalog
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === 'active');
  const unlocked: { item: AchievementRecord; index: number; at: number }[] = [];
  const locked: { item: AchievementRecord; index: number }[] = [];
  for (const entry of active) {
    const at = input.owned[entry.item.id];
    if (at !== undefined) unlocked.push({ ...entry, at });
    else if (entry.item.rule.type === 'level' && input.level >= entry.item.rule.level) {
      unlocked.push({ ...entry, at: input.updatedAt ?? 0 });
    } else locked.push(entry);
  }
  unlocked.sort((a, b) => b.at - a.at || b.index - a.index);
  const nextLevel = locked
    .filter(({ item }) => item.rule.type === 'level')
    .sort(
      (a, b) =>
        (a.item.rule as { level: number }).level - (b.item.rule as { level: number }).level ||
        a.index - b.index,
    )[0];
  const lockedOrder = nextLevel
    ? [nextLevel, ...locked.filter((entry) => entry !== nextLevel)]
    : locked;
  const view = (item: AchievementRecord, at: number | null): Achievement => ({
    id: item.id,
    title: item.title,
    icon: item.icon,
    tone: item.tone,
    unlockedAt: at === null ? null : new Date(at).toISOString(),
  });
  const highlights = [
    ...unlocked.slice(0, ACHIEVEMENT_UNLOCKED_HIGHLIGHTS).map(({ item, at }) => view(item, at)),
    ...lockedOrder.map(({ item }) => view(item, null)),
  ].slice(0, ACHIEVEMENT_HIGHLIGHTS);
  return { unlockedCount: unlocked.length, totalCount: active.length, highlights };
}
