import type {
  DocumentData,
  DocumentSnapshot,
  Transaction,
  Firestore,
} from 'firebase-admin/firestore';

import { gamePanelError } from '../missions/errors';
import { achievementsConfigRef, parsePointsConfig, pointsConfigRef } from '../points/config';
import {
  expectedVersionOf,
  runConfigChange,
  tsOrNull,
  type ConfigPanelDeps,
} from '../points/config-change';
import { requestFields } from '../staff/model';
import type { CallerAuth } from '../staff/service';
import { achievementPanelError } from './errors';
import {
  ACHIEVEMENT_FIELDS,
  ACHIEVEMENT_ID_PATTERN,
  ACHIEVEMENTS_MAX,
  defaultAchievements,
  draftAchievementId,
  parseAchievementsConfig,
  sameRule,
  validateAchievementChanges,
  validateAchievementInput,
  type AchievementRecord,
  type AchievementRule,
} from './model';

// As callables das conquistas (bloco 7, docs/arquitetura-api.md, 22.8), com
// a seção missions (admin, ou editor com ela): criar, editar, publicar,
// arquivar e reordenar o catálogo de config/achievements. Sem o documento, a
// primeira mudança parte da lista provisória do código, com `activatedAt` nas
// ativas. As telas são do bloco 11.

/** Uma conquista como fica no documento (datas em Timestamp); a carga da versão 1 também usa. */
export function achievementDoc(item: AchievementRecord): DocumentData {
  return {
    id: item.id,
    title: item.title,
    icon: item.icon,
    tone: item.tone,
    rule: { ...item.rule },
    status: item.status,
    activatedAt: tsOrNull(item.activatedAt),
    createdAt: tsOrNull(item.createdAt),
    updatedAt: tsOrNull(item.updatedAt),
  };
}

/**
 * O catálogo de agora: o do documento ou, sem ele, a lista provisória com as
 * datas desta gravação (a lista padrão vale desde o deploy: sem a data, a
 * trava deixaria mudar a regra de uma conquista já ganha).
 */
function catalogOf(snap: DocumentSnapshot, now: number): AchievementRecord[] {
  if (!snap.exists) return defaultAchievements(now);
  return parseAchievementsConfig(snap.data(), { error: () => undefined }).achievements;
}

/**
 * A regra de nível precisa de um degrau da régua de agora, lida de
 * config/points na transação (e não do cache).
 */
async function checkLevel(tx: Transaction, db: Firestore, rule: AchievementRule): Promise<void> {
  if (rule.type !== 'level') return;
  const { levels } = parsePointsConfig((await tx.get(pointsConfigRef(db))).data(), {
    warn: () => undefined,
    error: () => undefined,
  });
  if (rule.level > levels.length) {
    throw gamePanelError('invalid-request', { field: 'achievement.rule.level' });
  }
}

function idOf(input: Record<string, unknown>): string {
  const { achievementId } = input;
  if (typeof achievementId !== 'string' || !ACHIEVEMENT_ID_PATTERN.test(achievementId)) {
    throw achievementPanelError('achievement-not-found');
  }
  return achievementId;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** createAchievement: nasce `draft`, com o id gerado como o da missão; até 100 no catálogo. */
export async function addAchievement(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number; achievementId: string }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const random = deps.random ?? Math.random;
  const ref = achievementsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const achievement = validateAchievementInput(input.achievement);
    const catalog = catalogOf(ctx.snap, ctx.now);
    if (catalog.length >= ACHIEVEMENTS_MAX) throw achievementPanelError('too-many-achievements');
    await checkLevel(ctx.tx, deps.db, achievement.rule);
    let id = '';
    for (let attempt = 0; attempt < 5 && !id; attempt += 1) {
      const drawn = draftAchievementId(achievement.title, random);
      if (!catalog.some((item) => item.id === drawn)) id = drawn;
    }
    if (!id) throw new Error('Nenhum id de conquista livre entre os sorteados.');
    const record: AchievementRecord = {
      ...achievement,
      id,
      status: 'draft',
      activatedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    return {
      doc: { achievements: [...catalog, record].map(achievementDoc) },
      audit: { action: 'achievement.created', details: { achievementId: id, title: record.title } },
      result: { achievementId: id },
    };
  });
}

/**
 * updateAchievement: título, ícone e tom mudam sempre; a regra não muda
 * depois da primeira publicação (`achievement-locked`, também numa conquista
 * da lista padrão).
 */
export async function editAchievement(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const achievementId = idOf(input);
  const ref = achievementsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const changes = validateAchievementChanges(input.changes);
    const catalog = catalogOf(ctx.snap, ctx.now);
    const index = catalog.findIndex((item) => item.id === achievementId);
    if (index < 0) throw achievementPanelError('achievement-not-found');
    const current = catalog[index]!;
    const merged = { ...current, ...changes };
    const changed = ACHIEVEMENT_FIELDS.filter((key) => !same(merged[key], current[key]));
    if (changed.length === 0) return { doc: null };
    if (!sameRule(merged.rule, current.rule)) {
      if (current.activatedAt !== null) throw achievementPanelError('achievement-locked');
      await checkLevel(ctx.tx, deps.db, merged.rule);
    }
    const next = [...catalog];
    next[index] = { ...merged, updatedAt: ctx.now };
    return {
      doc: { achievements: next.map(achievementDoc) },
      audit: { action: 'achievement.updated', details: { achievementId, fields: changed } },
    };
  });
}

/**
 * setAchievementStatus: `active` publica (grava `activatedAt` na primeira
 * vez; a de nível confere o degrau na régua de agora; a `rank` vale desde o
 * bloco 8, no retrato semanal e na virada); `archived` arquiva (a arquivada
 * sai do "de N" e fica na carteira de quem ganhou).
 */
export async function changeAchievementStatus(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const achievementId = idOf(input);
  const { status } = input;
  if (status !== 'active' && status !== 'archived') {
    throw achievementPanelError('invalid-status');
  }
  const ref = achievementsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const catalog = catalogOf(ctx.snap, ctx.now);
    const index = catalog.findIndex((item) => item.id === achievementId);
    if (index < 0) throw achievementPanelError('achievement-not-found');
    const current = catalog[index]!;
    if (current.status === status) return { doc: null };
    if (status === 'active') await checkLevel(ctx.tx, deps.db, current.rule);
    const next = [...catalog];
    next[index] = {
      ...current,
      status,
      activatedAt: status === 'active' ? (current.activatedAt ?? ctx.now) : current.activatedAt,
      updatedAt: ctx.now,
    };
    return {
      doc: { achievements: next.map(achievementDoc) },
      audit: {
        action: status === 'active' ? 'achievement.published' : 'achievement.archived',
        details: { achievementId },
      },
    };
  });
}

/** reorderAchievements: a lista inteira do catálogo, sem faltar nem sobrar, na ordem nova. */
export async function reorderAchievementList(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const ids = input.achievementIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw gamePanelError('invalid-request', { field: 'achievementIds' });
  }
  const ref = achievementsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, ({ snap, now }) => {
    const catalog = catalogOf(snap, now);
    const current = catalog.map((item) => item.id);
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      !current.every((id) => ids.includes(id))
    ) {
      throw gamePanelError('invalid-request', { field: 'achievementIds' });
    }
    if (same(ids, current)) return { doc: null };
    const byId = new Map(catalog.map((item) => [item.id, item]));
    return {
      doc: { achievements: (ids as string[]).map((id) => achievementDoc(byId.get(id)!)) },
      audit: { action: 'achievement.reordered', details: { achievementIds: ids } },
    };
  });
}
