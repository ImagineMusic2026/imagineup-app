import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { parseAchievementsConfig, type AchievementRecord } from '../achievements/model';
import { dayKey, weekKey } from '../day';
import {
  achievementsConfigRef,
  parseSeasonConfig,
  seasonConfigRef,
  seasonDefDoc,
  writeSeasonConfig,
  type SeasonConfig,
} from '../points/config';
import { activeSeason, type SeasonInfo } from '../points/model';
import {
  addAchievementToShard,
  emptyShardDelta,
  isEmptyShardDelta,
  pickShard,
  shardRef,
  shardWrite,
  type ShardDelta,
} from '../points/stats';
import { writeAudit } from '../staff/service';
import {
  CLOSE_LATE_MS,
  closeDue,
  closeJobId,
  promoteNext,
  RANKING_JOB_PAGE,
  rankUnlocks,
  scopeKey,
  scopeOf,
  snapshotDue,
  snapshotJobId,
  type RankScope,
} from './model';
import { keyValues, rankingQuery, rankRowOf, type RankRow } from './queries';
import { profileView, seasonArchiveRef, standingsRef } from './service';

// A virada de temporada e o retrato semanal (bloco 8, 23.5 e 23.6), pela
// função agendada `rankingTick` (e a virada também pela callable
// `closeSeasonNow`). Os dois andam em páginas de 200 fãs pela lista do
// ranking, e cada página entra numa transação que confere e avança o
// andamento guardado em `rankingJobs/{id}`: retomar depois de falha, de prazo
// estourado ou de duas rodadas ao mesmo tempo nunca grava a mesma página duas
// vezes. O emulador não roda função agendada: os testes e o seed chamam o
// handler, com relógio fixo.

/** Código gRPC de documento que sumiu (o `update` de uma carteira apagada no meio). */
const NOT_FOUND = 5;

/** Quedas seguidas na mesma página antes de a rodada desistir (a próxima continua). */
const PAGE_FAILURES_MAX = 3;

type Log = Pick<typeof logger, 'info' | 'warn' | 'error'>;

const quiet = { warn: () => undefined, error: () => undefined };

/** O andamento de uma virada ou de um retrato (23.3). */
export type RankingJob = {
  kind: 'close' | 'snapshot';
  seasonId: string;
  week: string | null;
  status: 'running' | 'done';
  scopes: string[];
  scopeIndex: number;
  cursor: { points: number; atMs: number | null; uid: string } | null;
  position: number;
  counts: Record<string, number>;
};

export function rankingJobRef(db: Firestore, jobId: string): DocumentReference {
  return db.collection('rankingJobs').doc(jobId);
}

function parseJob(data: DocumentData | undefined): RankingJob | null {
  if (!data) return null;
  const cursor = data.cursor as RankingJob['cursor'] | null | undefined;
  return {
    kind: data.kind === 'snapshot' ? 'snapshot' : 'close',
    seasonId: String(data.seasonId),
    week: typeof data.week === 'string' ? data.week : null,
    status: data.status === 'done' ? 'done' : 'running',
    scopes: Array.isArray(data.scopes) ? (data.scopes as string[]) : [],
    scopeIndex: typeof data.scopeIndex === 'number' ? data.scopeIndex : 0,
    cursor: cursor && typeof cursor.uid === 'string' ? cursor : null,
    position: typeof data.position === 'number' ? data.position : 0,
    counts:
      typeof data.counts === 'object' && data.counts !== null
        ? (data.counts as Record<string, number>)
        : {},
  };
}

/** A rodada leu o mesmo andamento que a transação relê? Senão, outra passou na frente. */
function sameProgress(a: RankingJob, b: RankingJob): boolean {
  return (
    a.status === b.status &&
    a.scopeIndex === b.scopeIndex &&
    a.position === b.position &&
    JSON.stringify(a.cursor) === JSON.stringify(b.cursor)
  );
}

/** Um documento da página sumiu entre a consulta e a transação: a página é lida de novo. */
class PageChanged extends Error {
  constructor() {
    super('Um documento da página sumiu.');
    this.name = 'PageChanged';
  }
}

/** Os recortes de um trabalho: o geral e uma central por documento de `artists` (qualquer status). */
async function jobScopes(db: Firestore): Promise<string[]> {
  const artists = await db.collection('artists').select().get();
  return [
    'global',
    ...artists.docs.map((doc) => scopeKey({ kind: 'artist', artistId: doc.id })).sort(),
  ];
}

function newJob(
  kind: RankingJob['kind'],
  seasonId: string,
  week: string | null,
  scopes: string[],
  now: number,
): DocumentData {
  const at = Timestamp.fromMillis(now);
  return {
    kind,
    seasonId,
    week,
    status: 'running',
    scopes,
    scopeIndex: 0,
    cursor: null,
    position: 0,
    counts: {},
    startedAt: at,
    updatedAt: at,
    finishedAt: null,
  };
}

/** O catálogo de conquistas, lido sem cache no começo da rodada (as `rank` ativas). */
async function rankCatalog(db: Firestore): Promise<AchievementRecord[]> {
  const snap = await achievementsConfigRef(db).get();
  return parseAchievementsConfig(snap.data(), quiet).achievements.filter(
    (item) => item.status === 'active' && item.rule.type === 'rank',
  );
}

/** O tempo da rodada: ela para entre páginas quando acaba (a seguinte continua do cursor). */
type Budget = { left: () => boolean };

function budgetOf(budgetMs: number, clock: () => number): Budget {
  const deadline = clock() + budgetMs;
  return { left: () => clock() < deadline };
}

/**
 * Onde a rodada parou: sem trabalho, trabalho já feito, recortes todos feitos
 * (falta o fim) ou no meio (o tempo acabou, ou outra rodada passou na frente).
 */
type JobPagesState = 'missing' | 'done' | 'scopes-done' | 'partial';

/** O que cada trabalho grava numa página, dentro da transação dela. */
type PageWriter = {
  /** Lido fora da transação, antes dela (os perfis da virada). */
  prepare?: (rows: RankRow[], scope: RankScope) => Promise<unknown>;
  write: (
    tx: Transaction,
    page: { scope: RankScope; rows: RankRow[]; first: number; extra: unknown },
  ) => Promise<void>;
};

/**
 * Anda o trabalho página a página (pelo menos uma por rodada), até acabar os
 * recortes ou o tempo. Cada página: a consulta do recorte em andamento fora
 * da transação, e depois uma transação que relê o trabalho, confere que ele
 * não está feito e que o andamento é o que a rodada leu, grava a página e o
 * cursor novo. Página com menos linhas que o tamanho fecha o recorte. Um
 * documento que sumiu no meio (exclusão de conta) faz a página ser lida de
 * novo; três quedas seguidas encerram a rodada com erro no log.
 */
async function runJobPages(
  db: Firestore,
  jobRef: DocumentReference,
  seasonId: string,
  options: {
    budget: Budget;
    pageSize: number;
    now: number;
    log: Log;
    onPage?: JobOptions['onPage'];
  },
  writer: PageWriter,
): Promise<{ pages: number; state: JobPagesState }> {
  let pages = 0;
  let failures = 0;
  for (;;) {
    const job = parseJob((await jobRef.get()).data());
    if (!job) return { pages, state: 'missing' };
    if (job.status === 'done') return { pages, state: 'done' };
    if (job.scopeIndex >= job.scopes.length) return { pages, state: 'scopes-done' };
    if (pages > 0 && !options.budget.left()) return { pages, state: 'partial' };

    const key = job.scopes[job.scopeIndex]!;
    const scope = scopeOf(key);
    let query = rankingQuery(db, seasonId, scope);
    if (job.cursor) query = query.startAfter(...keyValues(db, scope, job.cursor));
    const snap = await query.limit(options.pageSize).get();
    const rows = snap.docs.map(rankRowOf);
    const extra = await writer.prepare?.(rows, scope);
    await options.onPage?.(
      rows.map((row) => row.uid),
      scope,
    );
    try {
      const moved = await db.runTransaction(async (tx) => {
        const current = parseJob((await tx.get(jobRef)).data());
        if (!current || current.status === 'done' || !sameProgress(current, job)) return true;
        await writer.write(tx, { scope, rows, first: job.position + 1, extra });
        const position = job.position + rows.length;
        const last = rows.at(-1);
        const at = Timestamp.fromMillis(options.now);
        if (rows.length < options.pageSize) {
          tx.update(jobRef, {
            scopeIndex: job.scopeIndex + 1,
            cursor: null,
            position: 0,
            counts: { ...current.counts, [key]: position },
            updatedAt: at,
          });
        } else {
          tx.update(jobRef, {
            cursor: { points: last!.points, atMs: last!.atMs, uid: last!.uid },
            position,
            updatedAt: at,
          });
        }
        return false;
      });
      if (moved) return { pages, state: 'partial' };
      pages += 1;
      failures = 0;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== NOT_FOUND && !(error instanceof PageChanged)) throw error;
      failures += 1;
      if (failures >= PAGE_FAILURES_MAX) {
        options.log.error('rankingTick: a página mudou três vezes seguidas', {
          job: jobRef.id,
          scope: key,
          position: job.position,
        });
        return { pages, state: 'partial' };
      }
    }
  }
}

/** Soma as conquistas de posição de uma página no shard do dia delas (uma gravação por página). */
function writeAchievementShard(tx: Transaction, db: Firestore, delta: ShardDelta, at: number) {
  if (isEmptyShardDelta(delta)) return;
  const day = dayKey(at);
  tx.set(shardRef(db, day, pickShard(Math.random)), shardWrite(delta, day, at), { merge: true });
}

/**
 * As conquistas de posição de uma linha do geral (23.9): os campos para o
 * `tx.update` da carteira (só o campo de cada conquista, sem apagar as
 * outras) e a soma no shard.
 */
function rankAchievementFields(
  catalog: readonly AchievementRecord[],
  row: RankRow,
  position: number,
  at: number,
  delta: ShardDelta,
): Record<string, Timestamp> {
  const fields: Record<string, Timestamp> = {};
  for (const item of rankUnlocks(catalog, position, row.achievements)) {
    fields[`achievements.${item.id}`] = Timestamp.fromMillis(at);
    addAchievementToShard(delta, item.id);
  }
  return fields;
}

// --- Virada ----------------------------------------------------------------------------------

export type CloseResult = {
  /** `idle`: nada venceu; `running`: o tempo acabou no meio; `closed`: fechou e promoveu. */
  status: 'idle' | 'running' | 'closed';
  seasonId: string | null;
  pages: number;
};

export type JobOptions = {
  /** O "agora" da rodada, em ms (fixo nos testes e no seed). */
  now: number;
  /** O tempo da rodada; a seguinte continua do cursor. */
  budgetMs: number;
  /** Fãs por página (os testes diminuem). */
  pageSize?: number;
  /** O relógio do tempo da rodada (de verdade, mesmo com o `now` fixo). */
  clock?: () => number;
  log?: Log;
  /**
   * Chamado entre a consulta de cada página e a transação dela, com os uids da
   * página: os testes excluem uma conta ali, como a exclusão no meio da rodada.
   */
  onPage?: (uids: string[], scope: RankScope) => Promise<void>;
};

/**
 * A virada da temporada (23.6): fecha a `season` cujo `endsAt` mais a folga
 * passou, arquiva o resultado (as `standings` do geral e de cada central, só
 * membros), soma 1 nas temporadas de quem pontuou no geral, dá as conquistas
 * de posição com a data do fim e, no fim, numa transação, promove a próxima.
 */
export async function runSeasonClose(db: Firestore, options: JobOptions): Promise<CloseResult> {
  const { now } = options;
  const log = options.log ?? logger;
  const config = parseSeasonConfig((await seasonConfigRef(db).get()).data(), quiet);
  const season = config.season;
  if (!closeDue(season, now)) return { status: 'idle', seasonId: null, pages: 0 };

  const jobRef = rankingJobRef(db, closeJobId(season.id));
  if (!(await jobRef.get()).exists) {
    const scopes = await jobScopes(db);
    const finishedSnapshots = await startClose(db, jobRef, season, scopes, now);
    if (finishedSnapshots.length > 0) {
      log.warn('rankingTick: retrato encerrado pela virada', {
        seasonId: season.id,
        jobs: finishedSnapshots,
      });
    }
  }

  const catalog = await rankCatalog(db);
  const archive = standingsRef(db, season.id);
  const { pages, state } = await runJobPages(
    db,
    jobRef,
    season.id,
    {
      budget: budgetOf(options.budgetMs, options.clock ?? Date.now),
      pageSize: options.pageSize ?? RANKING_JOB_PAGE,
      now,
      log,
      onPage: options.onPage,
    },
    {
      prepare: async (rows) => {
        const uids = [...new Set(rows.map((row) => row.uid))];
        if (uids.length === 0) return new Map();
        const snaps = await db.getAll(...uids.map((uid) => db.collection('users').doc(uid)));
        return new Map(uids.map((uid, index) => [uid, profileView(snaps[index])]));
      },
      write: async (tx, { scope, rows, first, extra }) => {
        const profiles = extra as Map<string, ReturnType<typeof profileView>>;
        if (scope.kind === 'artist' && rows.length > 0) {
          // Trava os `centralPoints` da página: a exclusão de conta espera, ou a
          // transação vê o documento apagado e a página é lida de novo, sem
          // ele (sem isso, a linha voltaria órfã depois da exclusão, 23.13).
          const snaps = await tx.getAll(...rows.map((row) => row.ref));
          if (snaps.some((snap) => !snap.exists)) throw new PageChanged();
        }
        const delta = emptyShardDelta();
        rows.forEach((row, index) => {
          const position = first + index;
          const profile = profiles.get(row.uid) ?? profileView(undefined);
          const ref = archive.doc(row.uid);
          if (scope.kind === 'global') {
            tx.set(ref, {
              uid: row.uid,
              seasonId: season.id,
              ...profile,
              position,
              points: row.points,
              pointsAt: row.atMs === null ? null : Timestamp.fromMillis(row.atMs),
              centrals: {},
            });
            tx.update(row.ref, {
              'stats.pastSeasons': FieldValue.increment(1),
              'stats.closedSeasonId': season.id,
              ...rankAchievementFields(catalog, row, position, season.endsAt, delta),
            });
          } else {
            // O mapa aninhado com merge junta só as folhas que vieram: o geral
            // e as outras centrais ficam (nunca a chave 'centrals.<id>' num set).
            tx.set(
              ref,
              {
                uid: row.uid,
                seasonId: season.id,
                ...profile,
                centrals: { [scope.artistId]: { position, points: row.points } },
              },
              { merge: true },
            );
          }
        });
        writeAchievementShard(tx, db, delta, season.endsAt);
      },
    },
  );
  if (state === 'missing') return { status: 'idle', seasonId: null, pages };
  if (state === 'done') return { status: 'closed', seasonId: season.id, pages };
  if (state === 'partial') return { status: 'running', seasonId: season.id, pages };
  const closed = await finishClose(db, jobRef, season.id, now, log);
  return { status: closed ? 'closed' : 'running', seasonId: season.id, pages };
}

/**
 * Começo da virada, numa transação: relê a temporada (a mesma, ainda vencida)
 * e o trabalho; sem ele, cria o trabalho e `seasons/{S}` (`closing`), e
 * encerra o retrato de S que ficou no meio. Devolve os retratos encerrados.
 */
async function startClose(
  db: Firestore,
  jobRef: DocumentReference,
  season: SeasonInfo,
  scopes: string[],
  now: number,
): Promise<string[]> {
  return db.runTransaction(async (tx) => {
    const config = parseSeasonConfig((await tx.get(seasonConfigRef(db))).data(), quiet);
    if (config.season?.id !== season.id || !closeDue(config.season, now)) return [];
    if ((await tx.get(jobRef)).exists) return [];
    const running = await tx.get(
      db
        .collection('rankingJobs')
        .where('seasonId', '==', season.id)
        .where('kind', '==', 'snapshot')
        .where('status', '==', 'running'),
    );
    const at = Timestamp.fromMillis(now);
    tx.create(jobRef, newJob('close', season.id, null, scopes, now));
    tx.set(seasonArchiveRef(db, season.id), {
      ...seasonDefDoc(config.season),
      status: 'closing',
      closingAt: at,
      closedAt: null,
      rankedFans: 0,
      centrals: {},
      schemaVersion: 1,
    });
    for (const doc of running.docs) {
      tx.update(doc.ref, { status: 'done', cursor: null, finishedAt: at, updatedAt: at });
    }
    return running.docs.map((doc) => doc.id);
  });
}

/**
 * Fim da virada, numa transação (23.6, passo 4): o arquivo `closed`, com as
 * contagens; `config/season` com a última fechada, a próxima promovida (se não
 * venceu enquanto esperava) e a versão nova; a auditoria `season.closed`; e o
 * trabalho feito. Se a configuração não tiver mais S, nada é promovido, o
 * trabalho fica sem `done` e o erro vai para o log (o alarme, a cada rodada).
 */
async function finishClose(
  db: Firestore,
  jobRef: DocumentReference,
  seasonId: string,
  now: number,
  log: Log,
): Promise<boolean> {
  const outcome = await db.runTransaction(async (tx) => {
    const job = parseJob((await tx.get(jobRef)).data());
    if (!job || job.status === 'done') return { closed: false, moved: false, expiredId: null };
    if (job.scopeIndex < job.scopes.length) return { closed: false, moved: false, expiredId: null };
    const config = parseSeasonConfig((await tx.get(seasonConfigRef(db))).data(), quiet);
    if (!config.season || config.season.id !== seasonId) {
      return { closed: false, moved: true, expiredId: null };
    }
    const at = Timestamp.fromMillis(now);
    const rankedFans = job.counts.global ?? 0;
    const centrals: Record<string, { rankedFans: number }> = {};
    for (const [key, count] of Object.entries(job.counts)) {
      const scope = scopeOf(key);
      if (scope.kind === 'artist' && count > 0) centrals[scope.artistId] = { rankedFans: count };
    }
    tx.update(seasonArchiveRef(db, seasonId), {
      status: 'closed',
      closedAt: at,
      rankedFans,
      centrals,
    });
    const promoted = promoteNext(config.next, now);
    const next: SeasonConfig = {
      version: config.version + 1,
      season: promoted.season,
      next: null,
      lastClosed: { ...config.season, closedAt: now },
    };
    writeSeasonConfig(tx, db, next, { now, updatedBy: null });
    writeAudit(
      tx,
      db,
      {
        action: 'season.closed',
        actorUid: null,
        actorName: 'Virada automática',
        targetEmail: '',
        targetUid: null,
        details: {
          seasonId,
          rankedFans,
          nextSeasonId: promoted.season?.id ?? null,
          expiredNextSeasonId: promoted.expiredId,
          fromVersion: config.version,
          toVersion: next.version,
        },
      },
      at,
    );
    tx.update(jobRef, { status: 'done', cursor: null, finishedAt: at, updatedAt: at });
    return { closed: true, moved: false, expiredId: promoted.expiredId };
  });
  if (outcome.moved) {
    log.error('rankingTick: a virada terminou e a configuração não tem mais a temporada', {
      seasonId,
    });
  }
  if (outcome.expiredId) {
    log.error('rankingTick: a próxima temporada venceu antes da virada e não foi promovida', {
      seasonId,
      expiredNextSeasonId: outcome.expiredId,
    });
  }
  return outcome.closed;
}

// --- Retrato semanal -----------------------------------------------------------------------------

export type SnapshotResult = {
  /** `idle`: nada venceu; `running`: o tempo acabou no meio; `done`: terminou agora. */
  status: 'idle' | 'running' | 'done';
  week: string | null;
  pages: number;
};

/**
 * O retrato da semana (23.5): na temporada ativa, começada antes desta
 * segunda-feira, grava em cada carteira e em cada `centralPoints` do ranking a
 * posição de agora (`rankWeek`, só esse campo) e, no geral, as conquistas de
 * posição com a data da rodada.
 */
export async function runRankSnapshot(db: Firestore, options: JobOptions): Promise<SnapshotResult> {
  const { now } = options;
  const log = options.log ?? logger;
  const config = parseSeasonConfig((await seasonConfigRef(db).get()).data(), quiet);
  const season = activeSeason(config.season, now);
  if (!season) return { status: 'idle', week: null, pages: 0 };
  const week = weekKey(dayKey(now));
  const jobRef = rankingJobRef(db, snapshotJobId(season.id, week));
  const existing = parseJob((await jobRef.get()).data());
  if (!snapshotDue(season, now, existing?.status === 'done')) {
    return { status: 'idle', week, pages: 0 };
  }
  if (!existing) {
    const scopes = await jobScopes(db);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(jobRef)).exists) return;
      tx.create(jobRef, newJob('snapshot', season.id, week, scopes, now));
    });
  }

  const catalog = await rankCatalog(db);
  const { pages, state } = await runJobPages(
    db,
    jobRef,
    season.id,
    {
      budget: budgetOf(options.budgetMs, options.clock ?? Date.now),
      pageSize: options.pageSize ?? RANKING_JOB_PAGE,
      now,
      log,
      onPage: options.onPage,
    },
    {
      write: async (tx, { scope, rows, first }) => {
        const delta = emptyShardDelta();
        rows.forEach((row, index) => {
          const position = first + index;
          tx.update(row.ref, {
            rankWeek: { seasonId: season.id, week, position },
            ...(scope.kind === 'global'
              ? rankAchievementFields(catalog, row, position, now, delta)
              : {}),
          });
        });
        writeAchievementShard(tx, db, delta, now);
      },
    },
  );
  if (state === 'missing') return { status: 'idle', week, pages };
  if (state === 'done') return { status: 'done', week, pages };
  if (state === 'partial') return { status: 'running', week, pages };
  const finished = await db.runTransaction(async (tx) => {
    const job = parseJob((await tx.get(jobRef)).data());
    if (!job || job.status === 'done' || job.scopeIndex < job.scopes.length) return false;
    const at = Timestamp.fromMillis(now);
    tx.update(jobRef, { status: 'done', cursor: null, finishedAt: at, updatedAt: at });
    return true;
  });
  return { status: finished ? 'done' : 'running', week, pages };
}

// --- A rodada da função agendada -------------------------------------------------------------------

/**
 * Uma rodada do `rankingTick` (23.6): a virada e, com tempo sobrando, o
 * retrato. Registra uma linha, e o erro da virada atrasada (encerrada há mais
 * de 30 min e o trabalho sem `done`) ou sem a temporada na configuração.
 */
export async function runRankingTick(deps: {
  db: Firestore;
  now: () => number;
  budgetMs: number;
  clock?: () => number;
  log?: Log;
}): Promise<{ close: CloseResult; snapshot: SnapshotResult }> {
  const { db } = deps;
  const log = deps.log ?? logger;
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const close = await runSeasonClose(db, {
    now: deps.now(),
    budgetMs: deps.budgetMs,
    clock,
    log,
  });
  const left = deps.budgetMs - (clock() - started);
  const snapshot: SnapshotResult =
    close.status !== 'running' && left > 0
      ? await runRankSnapshot(db, { now: deps.now(), budgetMs: left, clock, log })
      : { status: 'idle', week: null, pages: 0 };

  const config = parseSeasonConfig((await seasonConfigRef(db).get()).data(), quiet);
  const now = deps.now();
  if (config.season && now - config.season.endsAt > CLOSE_LATE_MS) {
    const job = parseJob((await rankingJobRef(db, closeJobId(config.season.id)).get()).data());
    if (job?.status !== 'done') {
      log.error('rankingTick: virada atrasada', {
        seasonId: config.season.id,
        endsAt: new Date(config.season.endsAt).toISOString(),
        job: job ? { scopeIndex: job.scopeIndex, position: job.position } : null,
      });
    }
  }
  const orphans = await db
    .collection('rankingJobs')
    .where('kind', '==', 'close')
    .where('status', '==', 'running')
    .limit(5)
    .get();
  for (const doc of orphans.docs) {
    if (doc.get('seasonId') !== config.season?.id) {
      log.error('rankingTick: virada sem a temporada na configuração', {
        job: doc.id,
        seasonId: doc.get('seasonId'),
      });
    }
  }
  log.info('rankingTick', {
    closed: close.status === 'closed' ? close.seasonId : null,
    close: close.status,
    snapshot: snapshot.status,
    pages: close.pages + snapshot.pages,
    ms: clock() - started,
  });
  return { close, snapshot };
}
