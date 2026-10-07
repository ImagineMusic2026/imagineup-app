import { Timestamp } from 'firebase-admin/firestore';

import { levelsInUse, parseAchievementsConfig } from '../achievements/model';
import { gamePanelError } from '../missions/errors';
import { requestFields } from '../staff/model';
import type { CallerAuth } from '../staff/service';
import {
  achievementsConfigRef,
  parsePointsConfig,
  parseSeasonConfig,
  pointsConfigRef,
  seasonConfigRef,
  validatePointsConfigInput,
  validateSeasonInput,
  type SeasonInput,
} from './config';
import { expectedVersionOf, runConfigChange, type ConfigPanelDeps } from './config-change';
import type { PointsConfig, SeasonInfo } from './model';

// As callables da régua e da temporada (bloco 7, docs/arquitetura-api.md,
// 22.8): `updatePointsConfig` (valores, limites, tetos do dia e níveis), com a
// seção missions, e `updateSeason`, antecipado do bloco 8, com a seção
// ranking. As telas são do bloco 11 (imagineup-admin).

const POINTS_FIELDS = ['values', 'dailyLimits', 'levels', 'actionCaps'] as const;

/** Sem o `expectedVersion`: o resto do pedido é a mudança, conferida inteira. */
function withoutVersion(input: Record<string, unknown>): Record<string, unknown> {
  const { expectedVersion: _version, ...rest } = input;
  return rest;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * updatePointsConfig: os campos mandados sobrepõem os de agora (ausente não
 * muda); `dailyLimits.mission` só aceita null (22.1, decisão 7). Régua com
 * menos degraus do que uma conquista de nível não arquivada pede é recusada
 * (`level-in-use`, com `details.achievementIds`), lendo config/achievements na
 * transação (sem o documento, vale a lista padrão). Auditoria
 * `points.config.updated`, com os campos mudados.
 */
export async function changePointsConfig(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const changes = (() => {
    try {
      return validatePointsConfigInput(withoutVersion(input));
    } catch (error) {
      const field = (error as { field?: string }).field;
      throw gamePanelError('invalid-request', { field: field ?? '' });
    }
  })();
  return runConfigChange(
    deps,
    caller,
    'missions',
    pointsConfigRef(deps.db),
    expectedVersion,
    async ({ tx, snap }) => {
      const current = parsePointsConfig(snap.data());
      const next: Omit<PointsConfig, 'version'> = {
        values: { ...current.values, ...changes.values },
        dailyLimits: { ...current.dailyLimits, ...changes.dailyLimits, mission: null },
        levels: changes.levels ?? current.levels,
        actionCaps: { ...current.actionCaps, ...changes.actionCaps },
      };
      const changed = POINTS_FIELDS.filter((field) => !same(current[field], next[field]));
      if (changed.length === 0) return { doc: null };
      if (changes.levels) {
        const catalog = parseAchievementsConfig(
          (await tx.get(achievementsConfigRef(deps.db))).data(),
          { error: () => undefined },
        ).achievements;
        const blocked = levelsInUse(catalog).filter(
          (item) => item.rule.type === 'level' && item.rule.level > next.levels.length,
        );
        if (blocked.length > 0) {
          throw gamePanelError('level-in-use', { achievementIds: blocked.map((item) => item.id) });
        }
      }
      return {
        doc: { ...next },
        audit: { action: 'points.config.updated', details: { fields: changed } },
      };
    },
  );
}

function seasonDoc(season: SeasonInput | SeasonInfo | null) {
  if (!season) return null;
  return {
    id: season.id,
    name: season.name,
    startsAt: Timestamp.fromMillis(season.startsAt),
    endsAt: Timestamp.fromMillis(season.endsAt),
    leaderTitle: season.leaderTitle,
  };
}

/**
 * updateSeason (seção 8 e 22.8): a temporada nova (datas em ms) ou null, que
 * encerra sem outra. O id de uma temporada que já começou não muda
 * (`season-id-locked`: nome, fim e título continuam editáveis; para trocar de
 * temporada, encerre e crie a outra), e o id novo não pode ter aparecido numa
 * versão antiga (`season-id-used`). A meta da temporada antiga some sozinha
 * (22.1, decisão 9). Auditoria `season.updated`.
 */
export async function changeSeason(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  if (!('season' in input)) throw gamePanelError('invalid-request', { field: 'season' });
  let season: SeasonInput | null = null;
  if (input.season !== null) {
    try {
      season = validateSeasonInput(input.season);
    } catch (error) {
      throw gamePanelError('invalid-request', {
        field: (error as { field?: string }).field ?? 'season',
      });
    }
  }
  const ref = seasonConfigRef(deps.db);
  return runConfigChange(
    deps,
    caller,
    'ranking',
    ref,
    expectedVersion,
    async ({ tx, snap, now }) => {
      const current = parseSeasonConfig(snap.data(), {
        warn: () => undefined,
        error: () => undefined,
      }).season;
      if (same(seasonDoc(current), seasonDoc(season))) return { doc: null };
      if (season && current && season.id !== current.id) {
        if (current.startsAt <= now) throw gamePanelError('season-id-locked');
      }
      if (season && season.id !== current?.id) {
        const used = await tx.get(
          ref.collection('versions').where('season.id', '==', season.id).limit(1),
        );
        if (!used.empty) throw gamePanelError('season-id-used');
      }
      return {
        doc: { season: seasonDoc(season) },
        audit: {
          action: 'season.updated',
          details: { seasonId: season?.id ?? null, previousSeasonId: current?.id ?? null },
        },
      };
    },
  );
}
