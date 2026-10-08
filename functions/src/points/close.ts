import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { safeCount, sumFanShards } from '../centrals/model';
import {
  centralPointsAggregate,
  fanShardsRef,
  sumCentralPoints,
  syncFanCount,
  type CentralPointsAggregate,
} from '../centrals/service';
import { nextDayStart } from '../day';
import { parseSeasonConfig, seasonConfigRef, type SeasonConfig } from './config';
import { dayKey, shiftDay, type SeasonInfo } from './model';
import { pruneZeros } from './stats';

// O fechamento do dia (bloco 11, docs/arquitetura-api.md, 26.3): a função
// agendada closeStatsDays soma os shards de cada dia passado
// (statsDaily/{dia}/statsShards/*) num documento statsDaily/{dia} com
// `closed: true`, que nunca muda depois (tx.create), e guarda no dia de ontem
// o retrato do estoque da noite (fãs, membros e "PTS DA CENTRAL" de cada
// central, fãs da temporada). O painel lê um documento por dia em vez de até
// 65. Só começa depois da carga dos cadastros antigos, que cria
// statsMeta/close (startStatsClose): fechado antes dela, um dia perderia os
// cadastros que a carga soma em dias passados.

/** O primeiro dia com perfil de fã: o createUserProfile foi publicado em 29/09/2026. */
export const STATS_FIRST_DAY = '2026-09-29';

/** Dias fechados no máximo por rodada; o resto fica para a próxima. */
export const CLOSE_MAX_DAYS = 31;

/**
 * Folga depois da meia-noite antes de fechar o dia: passa do maior tempo de
 * quem grava shard com o "agora" do começo da execução (o rankingTick, 540 s).
 * Função nova que grave shard com timeoutSeconds acima de 9 min sobe a folga.
 */
export const CLOSE_DAY_GRACE_MS = 10 * 60_000;

/** Chaves de `byOrigin.utmSource` e `byOrigin.utmCampaign` guardadas no dia fechado. */
export const ORIGIN_KEYS_MAX = 500;

/** Onde o resto das origens cortadas é somado. Nunca `__x__`, que o Firestore reserva. */
export const ORIGIN_OTHER = '_other';

export const STATS_SCHEMA_VERSION = 1;

/** O controle do fechamento: até onde ele chegou. */
export const STATS_CLOSE_DOC = 'statsMeta/close';

/** Folhas numéricas em qualquer profundidade, como os shards (seção 7). */
export type StatsTree = { [key: string]: number | StatsTree };

/** O retrato do estoque da noite, guardado no dia de ontem da rodada. */
export type StatsSnapshot = {
  /** Quando as contagens foram tiradas (ms). */
  at: number;
  /** `count()` de `users`. */
  fans: number;
  /** A temporada do dia (`seasonOfDay`) e os fãs com pontos nela, ou null sem temporada nele. */
  season: { id: string; rankedFans: number } | null;
  /** Os membros (a soma dos shards do fanCount) e o "PTS DA CENTRAL" de cada central, em qualquer status. */
  artists: Record<string, { members: number; totalPoints: number }>;
};

/**
 * Decide o retrato de cada dia da rodada: chamado dentro da transação de cada
 * dia, depois da soma, em ordem, e não lê nada. A transação repete quando
 * disputa o statsMeta/close com outra rodada, e a função é chamada de novo
 * para o mesmo dia: quem acumula estado (o seed) guarda o resultado por dia.
 */
export type SnapshotOf = (day: string, sum: StatsTree) => StatsSnapshot | null;

export type CloseLog = Pick<typeof logger, 'info' | 'warn' | 'error'>;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Campos do shard que não são contagem: o dia, o carimbo e a marca da carga. */
const TOP_LEVEL_SKIP = new Set(['day', 'updatedAt', 'backfill']);

/**
 * Só os mapas do Firestore (objetos simples): um Timestamp tem `_seconds`
 * numérico e não pode entrar na soma.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function addInto(target: StatsTree, source: Record<string, unknown>, top: boolean): void {
  for (const [key, value] of Object.entries(source)) {
    if (top && TOP_LEVEL_SKIP.has(key)) continue;
    const current = target[key];
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      // A mesma chave como número num shard e como mapa noutro não acontece; o primeiro tipo fica.
      if (current === undefined) target[key] = value;
      else if (typeof current === 'number') target[key] = current + value;
    } else if (isPlainObject(value)) {
      if (typeof current === 'number') continue;
      const child = current ?? {};
      addInto(child, value, false);
      target[key] = child;
    }
  }
}

/**
 * A soma dos shards de um dia: toda folha numérica, em qualquer profundidade,
 * menos `day`, `updatedAt` e `backfill` do topo (o `actives.day` entra). O
 * que falta num shard conta 0, e campo novo nos shards entra sem mudar código.
 * O painel tem a mesma função, com o mesmo teste.
 */
export function sumStatsDocs(docs: readonly unknown[]): StatsTree {
  const sum: StatsTree = {};
  for (const doc of docs) if (isPlainObject(doc)) addInto(sum, doc, true);
  return sum;
}

function weightOf(value: number | StatsTree): number {
  if (typeof value === 'number') return value;
  return Object.values(value).reduce<number>((total, child) => total + weightOf(child), 0);
}

function mergeInto(target: StatsTree, value: number | StatsTree, key: string): void {
  if (typeof value === 'number') {
    const current = target[key];
    target[key] = (typeof current === 'number' ? current : 0) + value;
    return;
  }
  const current = target[key];
  const child: StatsTree = typeof current === 'object' ? current : {};
  for (const [childKey, childValue] of Object.entries(value))
    mergeInto(child, childValue, childKey);
  target[key] = child;
}

function capMap(map: StatsTree, max: number): StatsTree {
  const named = Object.entries(map).filter(([key]) => key !== ORIGIN_OTHER);
  if (named.length <= max) return map;
  named.sort(([keyA, a], [keyB, b]) => weightOf(b) - weightOf(a) || (keyA < keyB ? -1 : 1));
  const out: StatsTree = Object.fromEntries(named.slice(0, max));
  const other: StatsTree = {};
  const previous = map[ORIGIN_OTHER];
  if (previous !== undefined) mergeInto(other, previous, ORIGIN_OTHER);
  for (const [, value] of named.slice(max)) mergeInto(other, value, ORIGIN_OTHER);
  out[ORIGIN_OTHER] = other[ORIGIN_OTHER]!;
  return out;
}

/**
 * Corta os recortes de `utm_source` e `utm_campaign` do dia em
 * `ORIGIN_KEYS_MAX` chaves: ficam as maiores (pelos cadastros; no empate, a
 * ordem das chaves) e o resto soma em `_other`, junto com um `_other` que já
 * existia. Quem cria o link escolhe o valor, e cada valor é uma chave nova.
 */
export function capOriginKeys(sum: StatsTree, max: number = ORIGIN_KEYS_MAX): StatsTree {
  const byOrigin = sum.byOrigin;
  if (typeof byOrigin !== 'object') return sum;
  const next: StatsTree = { ...byOrigin };
  for (const key of ['utmSource', 'utmCampaign']) {
    const map = byOrigin[key];
    if (typeof map === 'object') next[key] = capMap(map, max);
  }
  return { ...sum, byOrigin: next };
}

/**
 * Os dias a fechar numa rodada: do seguinte ao `lastClosedDay` até o último
 * dia D em que `now` passou do começo do dia seguinte a D mais a folga, em
 * ordem, no máximo `maxDays`. A folga não depende do horário do agendamento:
 * uma rodada forçada à 00:01 não fecha o dia de ontem.
 */
export function daysToClose(
  lastClosedDay: string,
  now: number,
  maxDays: number = CLOSE_MAX_DAYS,
  graceMs: number = CLOSE_DAY_GRACE_MS,
): string[] {
  // D fecha quando o dia de São Paulo de (now - folga) já é o seguinte a D.
  const lastClosable = shiftDay(dayKey(now - graceMs), -1);
  const days: string[] = [];
  for (let day = shiftDay(lastClosedDay, 1); day <= lastClosable; day = shiftDay(day, 1)) {
    if (days.length >= maxDays) break;
    days.push(day);
  }
  return days;
}

export function statsCloseRef(db: Firestore): DocumentReference {
  return db.doc(STATS_CLOSE_DOC);
}

/** O documento fechado de um dia (o pai dos shards, que só o fechamento cria). */
export function statsDayRef(db: Firestore, day: string): DocumentReference {
  return db.collection('statsDaily').doc(day);
}

/** O `lastClosedDay` gravado, ou null fora do formato. */
export function lastClosedOf(value: unknown): string | null {
  return typeof value === 'string' && DAY_PATTERN.test(value) ? value : null;
}

/** O instante em que começa o dia de São Paulo seguinte a `day`. */
const dayEnd = (day: string) => nextDayStart(Date.parse(`${day}T12:00:00Z`));

/**
 * A temporada do retrato de um dia (puro): entre a `season` e a `lastClosed`
 * de config/season, a última a começar entre as que valeram em algum momento
 * do dia de São Paulo (a que valia no fim dele, ou a encerrada antes da hora
 * no meio dele). O retrato de ontem é tirado depois da meia-noite, e a
 * temporada que terminou à meia-noite já pode ter saído da `season` (a
 * virada a põe em `lastClosed` e promove a próxima) ou continuar nela,
 * encerrada, esperando a virada.
 */
export function seasonOfDay(
  config: Pick<SeasonConfig, 'season' | 'lastClosed'>,
  day: string,
): SeasonInfo | null {
  const start = dayEnd(shiftDay(day, -1));
  const end = dayEnd(day);
  const during = [config.season, config.lastClosed].filter(
    (season): season is SeasonInfo =>
      season !== null && season.startsAt < end && season.endsAt > start,
  );
  return during.reduce<SeasonInfo | null>(
    (latest, season) => (latest && latest.startsAt >= season.startsAt ? latest : season),
    null,
  );
}

/** O retrato da noite e as centrais com a cópia do `fanCount` diferente da soma dos shards. */
export type SnapshotRead = { snapshot: StatsSnapshot; drift: string[] };

/**
 * O retrato do estoque, tirado uma vez por rodada, antes das transações, para
 * o dia de ontem: o `count()` de `users`; para cada central (qualquer status),
 * a soma dos 16 shards do `fanCount` (sem shard, a central é de antes do
 * bloco 4 e vale o `fanCount` gravado) e o "PTS DA CENTRAL" (a mesma soma do
 * GET /artists/:id); a temporada de ontem (`seasonOfDay`) com o `count()`
 * de quem tem pontos nela (a contagem A do ranking: a virada não zera a
 * carteira, e só quem já pontuou na temporada nova depois da meia-noite saiu
 * da conta). Devolve também as centrais em que a cópia do `fanCount` difere
 * da soma (a rede de segurança de 19.6).
 */
export async function readSnapshot(
  db: Firestore,
  now: number,
  aggregate: CentralPointsAggregate = centralPointsAggregate(db),
): Promise<SnapshotRead> {
  const [fans, artists, seasonDoc] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('artists').select('fanCount').get(),
    seasonConfigRef(db).get(),
  ]);
  const season = seasonOfDay(
    parseSeasonConfig(seasonDoc.data(), { warn: () => undefined, error: () => undefined }),
    shiftDay(dayKey(now), -1),
  );
  const [rankedFans, perArtist] = await Promise.all([
    season
      ? db
          .collection('wallets')
          .where('seasonId', '==', season.id)
          .where('seasonPoints', '>', 0)
          .count()
          .get()
          .then((snap) => snap.data().count)
      : Promise.resolve(0),
    Promise.all(
      artists.docs.map(async (artist) => {
        const [shards, totalPoints] = await Promise.all([
          fanShardsRef(db, artist.id).get(),
          sumCentralPoints(artist.id, aggregate),
        ]);
        const copied = safeCount(artist.get('fanCount'));
        const members = shards.empty
          ? copied
          : Math.max(0, sumFanShards(shards.docs.map((doc) => doc.get('count'))));
        return { id: artist.id, members, totalPoints, drift: !shards.empty && members !== copied };
      }),
    ),
  ]);
  return {
    snapshot: {
      at: now,
      fans: fans.data().count,
      season: season ? { id: season.id, rankedFans } : null,
      artists: Object.fromEntries(
        perArtist.map(({ id, members, totalPoints }) => [id, { members, totalPoints }]),
      ),
    },
    drift: perArtist.filter((item) => item.drift).map((item) => item.id),
  };
}

function snapshotDoc(snapshot: StatsSnapshot | null) {
  if (!snapshot) return null;
  return {
    at: Timestamp.fromMillis(snapshot.at),
    fans: snapshot.fans,
    season: snapshot.season,
    artists: snapshot.artists,
  };
}

export type StatsCloseOptions = {
  now: number;
  maxDays?: number;
  /** O retrato de cada dia; sem ele, o de produção (o `readSnapshot` só no dia de ontem). */
  snapshotOf?: SnapshotOf;
  log?: CloseLog;
  /** A soma do "PTS DA CENTRAL" (trocável nos testes). */
  aggregate?: CentralPointsAggregate;
};

export type StatsCloseResult = {
  /** `not-started` sem statsMeta/close; `idle` sem dia para fechar. */
  status: 'not-started' | 'idle' | 'closed';
  /** Os dias fechados nesta rodada, em ordem. */
  closed: string[];
  /** Os dias que outra rodada fechou no meio. */
  skipped: string[];
  /** As centrais com o `fanCount` acertado pela rede de segurança. */
  synced: string[];
  lastClosedDay: string | null;
};

/**
 * Uma rodada do fechamento (26.3): lê statsMeta/close (sem ele, erro no log e
 * nada fecha), escolhe os dias (`daysToClose`), tira o retrato quando ontem
 * está entre eles (só sem `snapshotOf`) e fecha cada dia numa transação:
 * relê o controle (outra rodada pode ter fechado o dia), lista os shards do
 * dia, soma, corta as origens, cria o statsDaily/{dia} (`create`: um dia
 * fechado nunca é regravado) e avança o `lastClosedDay`. Uma falha para a
 * rodada; os dias já fechados ficam, e a próxima começa no seguinte. Depois
 * dos dias, a central com a cópia do `fanCount` diferente da soma dos shards
 * é acertada pelo `syncFanCount`, fora das transações.
 */
export async function runStatsClose(
  db: Firestore,
  options: StatsCloseOptions,
): Promise<StatsCloseResult> {
  const { now, maxDays = CLOSE_MAX_DAYS, log = logger } = options;
  const meta = await statsCloseRef(db).get();
  if (!meta.exists) {
    log.error('closeStatsDays: statsMeta/close não existe; rode a carga dos cadastros');
    return { status: 'not-started', closed: [], skipped: [], synced: [], lastClosedDay: null };
  }
  const lastClosed = lastClosedOf(meta.get('lastClosedDay'));
  if (!lastClosed) {
    log.error('closeStatsDays: statsMeta/close sem lastClosedDay válido', {
      lastClosedDay: meta.get('lastClosedDay'),
    });
    return { status: 'not-started', closed: [], skipped: [], synced: [], lastClosedDay: null };
  }
  const days = daysToClose(lastClosed, now, maxDays);
  if (days.length === 0) {
    return { status: 'idle', closed: [], skipped: [], synced: [], lastClosedDay: lastClosed };
  }

  let drift: string[] = [];
  let snapshotOf: SnapshotOf = () => null;
  if (options.snapshotOf) {
    snapshotOf = options.snapshotOf;
  } else {
    const yesterday = shiftDay(dayKey(now), -1);
    if (days.includes(yesterday)) {
      const read = await readSnapshot(db, now, options.aggregate);
      drift = read.drift;
      snapshotOf = (day) => (day === yesterday ? read.snapshot : null);
    }
  }

  const closed: string[] = [];
  const skipped: string[] = [];
  let lastClosedDay: string = lastClosed;
  const at = Timestamp.fromMillis(now);
  for (const day of days) {
    const outcome = await db.runTransaction(async (tx) => {
      const control = await tx.get(statsCloseRef(db));
      const current = lastClosedOf(control.get('lastClosedDay'));
      if (!control.exists || !current || current >= day) return { closed: false, current };
      const shards = await tx.get(statsDayRef(db, day).collection('statsShards'));
      const sum = pruneZeros(capOriginKeys(sumStatsDocs(shards.docs.map((doc) => doc.data()))));
      const snapshot = snapshotOf(day, sum);
      tx.create(statsDayRef(db, day), {
        ...sum,
        day,
        closed: true,
        closedAt: at,
        shardCount: shards.size,
        schemaVersion: STATS_SCHEMA_VERSION,
        snapshot: snapshotDoc(snapshot),
      });
      tx.update(statsCloseRef(db), { lastClosedDay: day, updatedAt: at });
      return { closed: true, current: day };
    });
    if (outcome.closed) {
      closed.push(day);
      lastClosedDay = day;
    } else {
      skipped.push(day);
      if (outcome.current && outcome.current > lastClosedDay) lastClosedDay = outcome.current;
    }
  }

  const synced: string[] = [];
  for (const artistId of drift) {
    log.warn('closeStatsDays: fanCount diferente da soma dos shards; copiando de novo', {
      artistId,
    });
    try {
      await syncFanCount(db, artistId);
      synced.push(artistId);
    } catch (error) {
      log.error('closeStatsDays: o fanCount não foi acertado', {
        artistId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (closed.length > 0) log.info('closeStatsDays: dias fechados', { days: closed });
  return { status: 'closed', closed, skipped, synced, lastClosedDay };
}

export type StatsCloseStart = { created: boolean; lastClosedDay: string };

/**
 * Abre o fechamento: cria statsMeta/close com o `lastClosedDay` no dia antes
 * de `firstDay`, só se ele não existe (o primeiro a chegar vale). A carga dos
 * cadastros chama no fim, com o menor entre o primeiro dia que ela somou e
 * `STATS_FIRST_DAY`; o seed, com o primeiro dia dos números dele. Ninguém cria
 * o documento à mão.
 */
export async function startStatsClose(
  db: Firestore,
  firstDay: string,
  startedBy: 'backfill' | 'seed',
  now: number = Date.now(),
): Promise<StatsCloseStart> {
  if (!DAY_PATTERN.test(firstDay)) throw new RangeError(`Dia fora do formato: ${firstDay}`);
  return db.runTransaction(async (tx) => {
    const control = await tx.get(statsCloseRef(db));
    if (control.exists) {
      return { created: false, lastClosedDay: String(control.get('lastClosedDay')) };
    }
    const lastClosedDay = shiftDay(firstDay, -1);
    tx.create(statsCloseRef(db), {
      lastClosedDay,
      startedBy,
      updatedAt: Timestamp.fromMillis(now),
    });
    return { created: true, lastClosedDay };
  });
}

/** O `lastClosedDay` de agora, ou null sem o controle (o fechamento não começou). */
export async function readLastClosedDay(db: Firestore): Promise<string | null> {
  const control = await statsCloseRef(db).get();
  return control.exists ? lastClosedOf(control.get('lastClosedDay')) : null;
}
