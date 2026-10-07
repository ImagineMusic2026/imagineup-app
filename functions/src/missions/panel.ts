import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';

import { eventRef } from '../agenda/store';
import { artistRef } from '../centrals/service';
import {
  CONFIG_TTL_MS,
  missionsConfigRef,
  parseSeasonConfig,
  seasonConfigRef,
} from '../points/config';
import {
  expectedVersionOf,
  runConfigChange,
  tsOrNull,
  type ConfigChange,
  type ConfigPanelDeps,
} from '../points/config-change';
import { postRef } from '../posts/store';
import { requestFields } from '../staff/model';
import type { CallerAuth } from '../staff/service';
import { gamePanelError } from './errors';
import {
  ACTIVE_MISSIONS_MAX,
  checkMissionRules,
  draftMissionId,
  LOCKED_MISSION_FIELDS,
  MISSION_FIELDS,
  MISSION_ID_PATTERN,
  MISSIONS_MAX,
  parseMissionsConfig,
  readMission,
  validateMissionChanges,
  validateMissionInput,
  validateSeasonGoalInput,
  type MissionInput,
  type MissionRecord,
  type MissionsConfig,
  type MissionTarget,
  type SeasonGoalConfig,
} from './model';

// As callables das missões e da meta da temporada (bloco 7,
// docs/arquitetura-api.md, 22.8), com a seção missions (admin, ou editor com
// ela): criar, editar, publicar, arquivar e trazer de volta, reordenar e a
// meta. O catálogo é config/missions, versionado; a arquivada vai para
// missionArchive/{id}, na mesma transação. As telas são do bloco 11.

/** O arquivo das missões: a arquivada, fora do catálogo, com o mesmo id. */
export function missionArchiveRef(db: Firestore, missionId: string) {
  return db.collection('missionArchive').doc(missionId);
}

const silentLog = { error: () => undefined };

/** Uma missão como fica no documento (datas em Timestamp). */
export function missionDoc(mission: MissionRecord): DocumentData {
  return {
    id: mission.id,
    title: mission.title,
    action: mission.action,
    target: mission.target ? { ...mission.target } : null,
    goal: mission.goal,
    period: mission.period,
    rewardPoints: mission.rewardPoints,
    featured: mission.featured,
    startsAt: tsOrNull(mission.startsAt),
    endsAt: tsOrNull(mission.endsAt),
    status: mission.status,
    activatedAt: tsOrNull(mission.activatedAt),
    createdAt: tsOrNull(mission.createdAt),
    updatedAt: tsOrNull(mission.updatedAt),
  };
}

function goalDoc(goal: SeasonGoalConfig | null): DocumentData | null {
  return goal ? { ...goal } : null;
}

/** O documento inteiro do catálogo (sem `version`, `updatedAt` e `updatedBy`). */
export function catalogDoc(missions: readonly MissionRecord[], goal: SeasonGoalConfig | null) {
  return { missions: missions.map(missionDoc), seasonGoal: goalDoc(goal) };
}

function catalogOf(snap: { data(): DocumentData | undefined }): MissionsConfig {
  return parseMissionsConfig(snap.data(), silentLog);
}

/**
 * O alvo confere na transação, em qualquer status: o post (e o servidor grava
 * a central dele em `artistId`), o show ou a central. Não existe:
 * `target-not-found`.
 */
async function resolveTarget(
  tx: Transaction,
  db: Firestore,
  target: MissionTarget | null,
): Promise<MissionTarget | null> {
  if (!target) return null;
  if (target.postId) {
    const post = await tx.get(postRef(db, target.postId));
    const artistId = post.exists ? post.get('artistId') : null;
    if (!post.exists || typeof artistId !== 'string') throw gamePanelError('target-not-found');
    return { postId: target.postId, artistId, eventId: null };
  }
  if (target.eventId) {
    if (!(await tx.get(eventRef(db, target.eventId))).exists) {
      throw gamePanelError('target-not-found');
    }
    return { ...target };
  }
  if (target.artistId && !(await tx.get(artistRef(db, target.artistId))).exists) {
    throw gamePanelError('target-not-found');
  }
  return { ...target };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function missionIdOf(input: Record<string, unknown>): string {
  const { missionId } = input;
  if (typeof missionId !== 'string' || !MISSION_ID_PATTERN.test(missionId)) {
    throw gamePanelError('mission-not-found');
  }
  return missionId;
}

const activeCount = (missions: readonly MissionRecord[]) =>
  missions.filter((mission) => mission.status === 'active').length;

/**
 * createMission: nasce `draft`, com o id gerado pelo servidor (o título em
 * slug mais 4 caracteres sorteados), conferido no catálogo e no arquivo
 * (tomado, sorteia de novo). Catálogo cheio: `too-many-missions`.
 */
export async function addMission(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number; missionId: string }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const random = deps.random ?? Math.random;
  const ref = missionsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const mission = validateMissionInput(input.mission);
    const catalog = catalogOf(ctx.snap);
    if (catalog.missions.length >= MISSIONS_MAX) throw gamePanelError('too-many-missions');
    const target = await resolveTarget(ctx.tx, deps.db, mission.target);
    let id = '';
    for (let attempt = 0; attempt < 5 && !id; attempt += 1) {
      const drawn = draftMissionId(mission.title, random);
      if (catalog.missions.some((item) => item.id === drawn)) continue;
      if ((await ctx.tx.get(missionArchiveRef(deps.db, drawn))).exists) continue;
      id = drawn;
    }
    if (!id) throw new Error('Nenhum id de missão livre entre os sorteados.');
    const record: MissionRecord = {
      ...mission,
      target,
      id,
      status: 'draft',
      activatedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    return {
      doc: catalogDoc([...catalog.missions, record], catalog.seasonGoal),
      audit: { action: 'mission.created', details: { missionId: id, title: record.title } },
      result: { missionId: id },
    };
  });
}

/**
 * updateMission: só o que está no catálogo (arquivada: `mission-not-found`).
 * Missão que já foi publicada e cujo início passou, ou chega dentro do cache
 * do catálogo (`CONFIG_TTL_MS`, 60 s), não muda tipo, alvo, meta, período nem
 * início (`mission-locked`); título, recompensa, destaque e fim mudam sempre.
 * As regras entre os campos valem na missão inteira.
 */
export async function editMission(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const missionId = missionIdOf(input);
  const ref = missionsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const changes = validateMissionChanges(input.changes);
    const catalog = catalogOf(ctx.snap);
    const index = catalog.missions.findIndex((item) => item.id === missionId);
    if (index < 0) throw gamePanelError('mission-not-found');
    const current = catalog.missions[index]!;
    const merged: MissionInput = {
      ...(Object.fromEntries(MISSION_FIELDS.map((key) => [key, current[key]])) as MissionInput),
      ...changes,
    };
    if ('target' in changes && !same(changes.target, current.target)) {
      merged.target = await resolveTarget(ctx.tx, deps.db, merged.target);
    } else {
      merged.target = current.target;
    }
    const changed = MISSION_FIELDS.filter((key) => !same(merged[key], current[key]));
    if (changed.length === 0) return { doc: null };
    // A api lê o catálogo pelo cache de 60 s: uma instância com o catálogo de
    // antes da mudança ainda conta a missão pelas regras velhas logo depois do
    // início. Com o período trocado nessa janela, uma instância pagaria
    // `mission:<id>:<dia>` e outra `mission:<id>:<semana>` (22.8).
    const started = current.activatedAt !== null && current.startsAt <= ctx.now + CONFIG_TTL_MS;
    if (started && changed.some((key) => LOCKED_MISSION_FIELDS.includes(key))) {
      throw gamePanelError('mission-locked');
    }
    checkMissionRules(merged);
    const missions = [...catalog.missions];
    missions[index] = { ...current, ...merged, updatedAt: ctx.now };
    return {
      doc: catalogDoc(missions, catalog.seasonGoal),
      audit: { action: 'mission.updated', details: { missionId, fields: changed } },
    };
  });
}

/**
 * setMissionStatus: `active` publica (grava `activatedAt` na primeira vez;
 * a 31ª no ar é `too-many-active`) ou, com um id que só está no arquivo, traz
 * a missão de volta para o fim do catálogo, já no ar, com o mesmo id e o
 * `activatedAt` de antes (catálogo cheio: `too-many-missions`); `archived`
 * tira do catálogo e grava em missionArchive/{id}, na mesma transação.
 */
export async function changeMissionStatus(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const missionId = missionIdOf(input);
  const { status } = input;
  if (status !== 'active' && status !== 'archived') throw gamePanelError('invalid-status');
  const ref = missionsConfigRef(deps.db);
  const archiveRef = missionArchiveRef(deps.db, missionId);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const catalog = catalogOf(ctx.snap);
    const index = catalog.missions.findIndex((item) => item.id === missionId);
    const archived = await ctx.tx.get(archiveRef);

    if (status === 'archived') {
      if (index < 0) {
        if (archived.exists) return { doc: null };
        throw gamePanelError('mission-not-found');
      }
      const mission = catalog.missions[index]!;
      return {
        doc: catalogDoc(
          catalog.missions.filter((item) => item.id !== missionId),
          catalog.seasonGoal,
        ),
        writes: (tx) =>
          tx.set(archiveRef, {
            ...missionDoc(mission),
            status: 'archived',
            archivedAt: tsOrNull(ctx.now),
            archivedBy: { uid: ctx.actor.uid, name: ctx.actor.name },
          }),
        audit: { action: 'mission.archived', details: { missionId } },
      } satisfies ConfigChange<object>;
    }

    if (index >= 0) {
      const mission = catalog.missions[index]!;
      if (mission.status === 'active') return { doc: null };
      if (activeCount(catalog.missions) >= ACTIVE_MISSIONS_MAX) {
        throw gamePanelError('too-many-active');
      }
      const missions = [...catalog.missions];
      missions[index] = {
        ...mission,
        status: 'active',
        activatedAt: mission.activatedAt ?? ctx.now,
        updatedAt: ctx.now,
      };
      return {
        doc: catalogDoc(missions, catalog.seasonGoal),
        audit: { action: 'mission.published', details: { missionId } },
      };
    }

    if (!archived.exists) throw gamePanelError('mission-not-found');
    const restored = readMission({ ...archived.data(), status: 'active' });
    if (!restored) throw gamePanelError('mission-not-found');
    if (catalog.missions.length >= MISSIONS_MAX) throw gamePanelError('too-many-missions');
    if (activeCount(catalog.missions) >= ACTIVE_MISSIONS_MAX) {
      throw gamePanelError('too-many-active');
    }
    const record: MissionRecord = {
      ...restored,
      activatedAt: restored.activatedAt ?? ctx.now,
      updatedAt: ctx.now,
    };
    return {
      doc: catalogDoc([...catalog.missions, record], catalog.seasonGoal),
      writes: (tx) => tx.delete(archiveRef),
      audit: { action: 'mission.published', details: { missionId, restored: true } },
    };
  });
}

/** reorderMissions: a lista inteira do catálogo, sem faltar nem sobrar, na ordem nova. */
export async function reorderMissionList(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const ids = input.missionIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw gamePanelError('invalid-request', { field: 'missionIds' });
  }
  const ref = missionsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, ({ snap }) => {
    const catalog = catalogOf(snap);
    const current = catalog.missions.map((item) => item.id);
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      !current.every((id) => ids.includes(id))
    ) {
      throw gamePanelError('invalid-request', { field: 'missionIds' });
    }
    if (same(ids, current)) return { doc: null };
    const byId = new Map(catalog.missions.map((item) => [item.id, item]));
    return {
      doc: catalogDoc(
        (ids as string[]).map((id) => byId.get(id)!),
        catalog.seasonGoal,
      ),
      audit: { action: 'mission.reordered', details: { missionIds: ids } },
    };
  });
}

/**
 * updateSeasonGoal: a meta da temporada de config/season, lida na transação
 * (sem temporada, `no-season`), presa ao id dela; null tira a meta.
 */
export async function changeSeasonGoal(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  if (!('goal' in input)) throw gamePanelError('invalid-request', { field: 'goal' });
  const ref = missionsConfigRef(deps.db);
  return runConfigChange(deps, caller, 'missions', ref, expectedVersion, async (ctx) => {
    const goal = validateSeasonGoalInput(input.goal);
    const catalog = catalogOf(ctx.snap);
    const season = parseSeasonConfig((await ctx.tx.get(seasonConfigRef(deps.db))).data(), {
      warn: () => undefined,
      error: () => undefined,
    }).season;
    if (!season) throw gamePanelError('no-season');
    const next: SeasonGoalConfig | null = goal ? { seasonId: season.id, ...goal } : null;
    if (same(goalDoc(next), goalDoc(catalog.seasonGoal))) return { doc: null };
    return {
      doc: catalogDoc(catalog.missions, next),
      audit: {
        action: 'season.goal.updated',
        details: {
          seasonId: season.id,
          metric: next?.metric ?? null,
          target: next?.target ?? null,
        },
      },
    };
  });
}
