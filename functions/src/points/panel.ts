import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { levelsInUse, parseAchievementsConfig } from '../achievements/model';
import { gamePanelError } from '../missions/errors';
import { closeJobId, hasStarted, updateSeasonRefusal } from '../ranking/model';
import { requestFields } from '../staff/model';
import type { CallerAuth } from '../staff/service';
import {
  achievementsConfigRef,
  parsePointsConfig,
  parseSeasonConfig,
  pointsConfigRef,
  seasonConfigFields,
  seasonConfigRef,
  seasonDefDoc,
  TOP_TARGET_DEFAULT,
  validatePointsConfigInput,
  validateSeasonInput,
  type SeasonInput,
} from './config';
import { expectedVersionOf, runConfigChange, type ConfigPanelDeps } from './config-change';
import type { PointsConfig, SeasonInfo } from './model';

// As callables da régua e da temporada (bloco 7, docs/arquitetura-api.md,
// 22.8): `updatePointsConfig` (valores, limites, tetos do dia e níveis), com a
// seção missions, e `updateSeason`, antecipado do bloco 8, com a seção
// ranking, mais estrito no bloco 8 (23.10). As telas são do bloco 11
// (imagineup-admin).

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

const quiet = { warn: () => undefined, error: () => undefined };

/**
 * A temporada pedida pelo painel com o que ele não manda: o `topTarget` da
 * temporada de agora (mesmo id) ou 10, e o `endedEarly` dela (bloco 8, 23.3).
 */
export function resolveSeason(input: SeasonInput, keep: SeasonInfo | null): SeasonInfo {
  const same = keep && keep.id === input.id ? keep : null;
  return {
    id: input.id,
    name: input.name,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    leaderTitle: input.leaderTitle,
    topTarget: input.topTarget ?? same?.topTarget ?? TOP_TARGET_DEFAULT,
    endedEarly: same?.endedEarly ?? null,
  };
}

/** A temporada pedida (`field` no corpo), conferida, ou null; fora do formato, `invalid-request`. */
export function seasonInputOf(input: Record<string, unknown>, field: string): SeasonInput | null {
  if (!(field in input)) throw gamePanelError('invalid-request', { field });
  if (input[field] === null) return null;
  try {
    return validateSeasonInput(input[field], field);
  } catch (error) {
    throw gamePanelError('invalid-request', {
      field: (error as { field?: string }).field ?? field,
    });
  }
}

/** A virada da temporada `seasonId` está em andamento (o trabalho existe e não terminou)? */
export async function seasonClosing(
  tx: Transaction,
  db: Firestore,
  seasonId: string,
): Promise<boolean> {
  const job = await tx.get(db.collection('rankingJobs').doc(closeJobId(seasonId)));
  return job.exists && job.get('status') !== 'done';
}

/**
 * O id já foi usado (23.10): o da próxima ou o da atual (`taken`), um que
 * apareceu como `season.id` numa versão antiga ou que tem `seasons/{id}` (uma
 * temporada fechada). As carteiras guardam o id dos pontos: voltar a um id
 * usado zeraria de novo quem já trocou de temporada.
 */
export async function seasonIdUsed(
  tx: Transaction,
  db: Firestore,
  id: string,
  taken: readonly (string | undefined)[],
): Promise<boolean> {
  if (taken.includes(id)) return true;
  const [versions, archive] = await Promise.all([
    tx.get(seasonConfigRef(db).collection('versions').where('season.id', '==', id).limit(1)),
    tx.get(db.collection('seasons').doc(id)),
  ]);
  return !versions.empty || archive.exists;
}

/**
 * updateSeason (seção 8, 22.8 e, no bloco 8, 23.10): mexe só na `season` de
 * config/season (a próxima e a última fechada ficam). Recusas, nesta ordem:
 * a virada em andamento (`season-closing`); na temporada começada, sair ou
 * mudar o início (`season-started`), trocar o id (`season-id-locked`), mudar
 * o fim da encerrada (`season-ended`), o fim no passado (`season-end-in-past`,
 * para encerrar há o `endSeason`) e o fim depois do início da próxima
 * (`season-overlap`); sem temporada ou com a atual ainda sem começar, ela é
 * livre, mas não sai com a próxima cadastrada (`has-next`), o id novo não pode
 * ter sido usado (`season-id-used`), o fim não pode ter passado e as datas não
 * cruzam a última fechada nem a próxima. A meta da temporada antiga some
 * sozinha (22.1, decisão 9). Auditoria `season.updated`.
 */
export async function changeSeason(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const requested = seasonInputOf(input, 'season');
  const ref = seasonConfigRef(deps.db);
  return runConfigChange(
    deps,
    caller,
    'ranking',
    ref,
    expectedVersion,
    async ({ tx, snap, now }) => {
      const config = parseSeasonConfig(snap.data(), quiet);
      const current = config.season;
      const season = requested ? resolveSeason(requested, current) : null;
      if (same(seasonDefDoc(current), seasonDefDoc(season))) return { doc: null };
      if (current && (await seasonClosing(tx, deps.db, current.id))) {
        throw gamePanelError('season-closing');
      }
      const checkId = season !== null && season.id !== current?.id && !hasStarted(current, now);
      const idUsed = checkId
        ? await seasonIdUsed(tx, deps.db, season.id, [config.next?.id])
        : false;
      const refusal = updateSeasonRefusal(
        { current, next: config.next, lastClosed: config.lastClosed },
        season,
        now,
        idUsed,
      );
      if (refusal) throw gamePanelError(refusal);
      return {
        doc: seasonConfigFields({ season, next: config.next, lastClosed: config.lastClosed }),
        audit: {
          action: 'season.updated',
          details: { seasonId: season?.id ?? null, previousSeasonId: current?.id ?? null },
        },
      };
    },
  );
}
