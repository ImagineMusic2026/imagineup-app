import { Timestamp } from 'firebase-admin/firestore';

import type { LeaderboardEntry, Season } from '../api/contract';
import { CentralError, isArtistId } from '../centrals/model';
import { gamePanelError } from '../missions/errors';
import {
  parseSeasonConfig,
  seasonConfigFields,
  seasonConfigRef,
  seasonDefDoc,
} from '../points/config';
import { expectedVersionOf, runConfigChange, type ConfigPanelDeps } from '../points/config-change';
import { resolveSeason, seasonClosing, seasonIdUsed, seasonInputOf } from '../points/panel';
import { requestFields } from '../staff/model';
import { directRead, readPanelActor } from '../staff/panel-actor';
import { panelError } from '../staff/panel-errors';
import { writeAudit, type CallerAuth } from '../staff/service';
import { runSeasonClose } from './jobs';
import {
  closeNowRefusal,
  decodeRankCursor,
  endSeasonRefusal,
  GLOBAL_SCOPE,
  nextSeasonRefusal,
  type RankCursor,
  type RankScope,
} from './model';
import { readLeaderboard, readSeason } from './service';

// As callables da temporada do bloco 8 (docs/arquitetura-api.md, 23.10), com
// a seção ranking: cadastrar a próxima (`scheduleNextSeason`), encerrar a de
// agora antes da hora (`endSeason`) e rodar na hora a virada que já venceu
// (`closeSeasonNow`, a saída da equipe se a função agendada parar). As duas
// primeiras no molde de 22.8 (`runConfigChange`), gravando o config/season
// inteiro; a terceira não grava a configuração por conta própria (quem grava
// é o fim da virada). As telas são do bloco 11 (imagineup-admin).

const quiet = { warn: () => undefined, error: () => undefined };

/** O tempo do `closeSeasonNow` (a função tem 120 s): o painel chama de novo enquanto vier `running`. */
export const CLOSE_NOW_BUDGET_MS = 90_000;

export type SeasonPanelDeps = ConfigPanelDeps & {
  /** Tempo da virada no `closeSeasonNow`; os testes diminuem. */
  closeBudgetMs?: number;
  /** Fãs por página da virada; os testes diminuem. */
  closePageSize?: number;
};

function seasonIdOf(input: Record<string, unknown>): string {
  const { seasonId } = input;
  if (typeof seasonId !== 'string' || seasonId === '') {
    throw gamePanelError('invalid-request', { field: 'seasonId' });
  }
  return seasonId;
}

/**
 * scheduleNextSeason: a próxima temporada (datas em ms) ou null, que tira a
 * próxima. Só com uma temporada atual (`no-season`); o id não pode ser o da
 * atual nem ter sido usado (`season-id-used`); o fim não pode ter passado
 * (`season-end-in-past`) e ela começa depois do fim da atual
 * (`season-overlap`). Vale também durante a virada: o fim dela lê a próxima
 * na própria transação. Auditoria `season.next.updated`.
 */
export async function scheduleNext(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const requested = seasonInputOf(input, 'next');
  const ref = seasonConfigRef(deps.db);
  return runConfigChange(
    deps,
    caller,
    'ranking',
    ref,
    expectedVersion,
    async ({ tx, snap, now }) => {
      const config = parseSeasonConfig(snap.data(), quiet);
      const previous = config.next;
      const next = requested ? resolveSeason(requested, previous) : null;
      if (JSON.stringify(seasonDefDoc(previous)) === JSON.stringify(seasonDefDoc(next))) {
        return { doc: null };
      }
      const checkId = next !== null && config.season !== null && next.id !== previous?.id;
      const idUsed = checkId
        ? await seasonIdUsed(tx, deps.db, next.id, [config.season?.id])
        : false;
      const refusal = nextSeasonRefusal(
        { current: config.season, next: previous, lastClosed: config.lastClosed },
        next,
        now,
        idUsed,
      );
      if (refusal) throw gamePanelError(refusal);
      return {
        doc: seasonConfigFields({ season: config.season, next, lastClosed: config.lastClosed }),
        audit: {
          action: 'season.next.updated',
          details: { seasonId: next?.id ?? null, previousSeasonId: previous?.id ?? null },
        },
      };
    },
  );
}

/**
 * endSeason: encerra agora a temporada em andamento, pelo id que a tela
 * mostrou (`season-not-active`), fora da virada (`season-closing`). O fim
 * vira o agora e o `endedEarly` guarda o fim combinado, quando e quem; a
 * virada fecha depois da folga, numa das rodadas seguintes. A próxima, se
 * houver, continua com o início dela. Auditoria `season.ended`.
 */
export async function endCurrent(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; version: number; endsAt: number }> {
  const input = requestFields(data);
  const expectedVersion = expectedVersionOf(input);
  const seasonId = seasonIdOf(input);
  const ref = seasonConfigRef(deps.db);
  return runConfigChange<{ endsAt: number }>(
    deps,
    caller,
    'ranking',
    ref,
    expectedVersion,
    async ({ tx, snap, now, actor }) => {
      const config = parseSeasonConfig(snap.data(), quiet);
      const refusal = endSeasonRefusal(
        { current: config.season, next: config.next, lastClosed: config.lastClosed },
        seasonId,
        now,
      );
      if (refusal) throw gamePanelError(refusal);
      const current = config.season!;
      if (await seasonClosing(tx, deps.db, current.id)) throw gamePanelError('season-closing');
      const ended = {
        ...current,
        endsAt: now,
        endedEarly: {
          plannedEndsAt: current.endsAt,
          at: now,
          by: { uid: actor.uid, name: actor.name },
        },
      };
      return {
        doc: seasonConfigFields({
          season: ended,
          next: config.next,
          lastClosed: config.lastClosed,
        }),
        audit: {
          action: 'season.ended',
          details: {
            seasonId,
            plannedEndsAt: new Date(current.endsAt).toISOString(),
            endedAt: new Date(now).toISOString(),
          },
        },
        result: { endsAt: now },
      };
    },
  );
}

/**
 * closeSeasonNow: roda na hora a virada que já venceu (`season-not-due` antes
 * do fim mais a folga; `no-season` sem temporada atual ou com outro id), pelo
 * mesmo `runSeasonClose` da função agendada, com 90 s. Responde `closed`
 * quando a virada terminou (com a próxima promovida) ou `running` quando o
 * tempo acabou: o painel chama de novo. Idempotente pelo trabalho, também
 * junto com uma rodada da função agendada. Auditoria `season.close.requested`
 * a cada chamada que rodou.
 */
export async function closeNow(
  deps: SeasonPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; status: 'running' | 'closed'; pages: number }> {
  const { db } = deps;
  const input = requestFields(data);
  const seasonId = seasonIdOf(input);
  const actor = await readPanelActor(directRead, db, caller, 'ranking', 'edit');
  const now = (deps.now ?? Date.now)();
  const config = parseSeasonConfig((await seasonConfigRef(db).get()).data(), quiet);
  const refusal = closeNowRefusal(
    { current: config.season, next: config.next, lastClosed: config.lastClosed },
    seasonId,
    now,
  );
  if (refusal) throw gamePanelError(refusal);
  const result = await runSeasonClose(db, {
    now,
    budgetMs: deps.closeBudgetMs ?? CLOSE_NOW_BUDGET_MS,
    ...(deps.closePageSize ? { pageSize: deps.closePageSize } : {}),
  });
  // `idle` aqui é a virada que outra rodada terminou entre a conferência e esta.
  const status = result.status === 'running' ? 'running' : 'closed';
  await db.runTransaction(async (tx) => {
    writeAudit(
      tx,
      db,
      {
        action: 'season.close.requested',
        actorUid: actor.uid,
        actorName: actor.name,
        targetEmail: '',
        targetUid: null,
        details: { seasonId, status, pages: result.pages },
      },
      Timestamp.fromMillis(now),
    );
  });
  return { ok: true, status, pages: result.pages };
}

/** O recorte do `getPanelRanking`: ausente ou null, o geral; fora do formato do @, a central não existe. */
function panelScopeOf(value: unknown): RankScope {
  if (value === undefined || value === null) return GLOBAL_SCOPE;
  if (typeof value !== 'string') throw panelError('invalid-request', { field: 'artistId' });
  if (!isArtistId(value)) throw panelError('artist-not-found');
  return { kind: 'artist', artistId: value };
}

/** O cursor opaco de 23.2: ausente ou null, a primeira página; fora do formato, `invalid-request`. */
function panelCursorOf(value: unknown): RankCursor | null {
  if (value === undefined || value === null) return null;
  const cursor = typeof value === 'string' ? decodeRankCursor(value) : null;
  if (!cursor) throw panelError('invalid-request', { field: 'cursor' });
  return cursor;
}

/**
 * getPanelRanking (bloco 11, 26.4): o ranking ao vivo para a seção ranking,
 * só de leitura, pelo mesmo `readLeaderboard` da rota do app, sem exigir a
 * central publicada (ela precisa existir: `artist-not-found`). O
 * `config/season` é lido sem cache, e o uid de quem chama nunca entra (o
 * `isMe` sai sempre falso: um membro da equipe que também é fã não se vê
 * marcado). Páginas de 20, com o cursor opaco do app. Sem auditoria: é
 * leitura do que o app já mostra. A seção ranking não lê carteiras nem perfis
 * pelas regras; esta callable é o caminho dela (decisão 7).
 */
export async function readPanelRanking(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ season: Season | null; items: LeaderboardEntry[]; nextCursor: string | null }> {
  const { db } = deps;
  await readPanelActor(directRead, db, caller, 'ranking', 'view');
  const input = requestFields(data);
  const scope = panelScopeOf(input.artistId);
  const cursor = panelCursorOf(input.cursor);
  const now = (deps.now ?? Date.now)();
  const config = parseSeasonConfig((await seasonConfigRef(db).get()).data(), quiet);
  try {
    const page = await readLeaderboard(db, '', config, now, scope, cursor, {
      requirePublished: false,
    });
    return { season: readSeason(config, now).season, ...page };
  } catch (error) {
    if (error instanceof CentralError) throw panelError('artist-not-found');
    throw error;
  }
}
