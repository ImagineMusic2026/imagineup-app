import { FieldValue, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import {
  FAN_CLUB_COPY_CONCURRENCY,
  FAN_CLUB_COPY_MAX,
  FOLLOWERS_RECENT_MS,
  fanClubMonthOf,
  fanClubRecord,
  isFeatureExpired,
  monthTurn,
  staleEngagementDays,
  sumFanClubShards,
  type FanClubCopyCounts,
} from './model';
import { FEATURE_OFF, fanClubRef, fanClubShardsOf, fanClubsOf, followersQuery } from './store';

// A cópia da noite do fã-clube (docs/arquitetura-api.md, seção 34, decisões
// 28, 35 e 37; a etapa 4 de 34.14): os números de cada fã-clube ativo ou
// pausado copiados para o `counts` (a ordem das listas do painel e do card da
// 1d), os retratos do mês (`monthStart` e `lastMonth`) e o Destaque vencido
// desligado. É um passo próprio do handler do `closeStatsDays`, num `finally`
// depois do `runStatsClose` e com o `try/catch` dele (`runFanClubCopyStep`): o
// fechamento volta antes quando não há dia a fechar e lança quando um dia
// falha (34.19). Sem função nova (decisão 55). Desde a Fase 2 (seção 37,
// 37.11; a etapa 4 de 37.13), o corte dos dias da taxa de engajamento com
// mais de 35 dias nos shards que a cópia já lê.

type Log = Pick<typeof logger, 'info' | 'error'>;

const count = async (query: Query): Promise<number> => (await query.count().get()).data().count;

/** Os dias velhos de um shard que a cópia apaga (37.11): o id do shard e os dias. */
export type StaleShardDays = { shard: string; days: string[] };

/** O que a cópia lê de um fã-clube: os números e os dias velhos de cada shard. */
export type FanClubCopyRead = { counts: FanClubCopyCounts; staleDays: StaleShardDays[] };

/**
 * Os números de um fã-clube, fora de transação: os 16 shards (uma consulta,
 * `sumFanClubShards`), os `count()` no grupo `fanClubFollows` pelo
 * `followersQuery` (todos, os de `followedAt` nos últimos 30 dias, as contas
 * novas, o @ automático e os trazidos pelo gestor, cada um com o índice de
 * grupo de 34.6) e o `count()` no grupo `centrals` com o `fanClubId` (os
 * trazidos que ficaram, pela isenção do campo no grupo). Umas 22 leituras.
 * Sem o índice (só em produção), a contagem lança, e o fã-clube não é copiado:
 * um 0 gravado apagaria o número de verdade. Desde a Fase 2 (37.11), dos
 * mesmos shards, os dias da taxa com mais de 35 dias (`staleEngagementDays`),
 * só dos shards que têm algum.
 */
export async function readFanClubCounts(
  db: Firestore,
  clubId: string,
  now: number,
): Promise<FanClubCopyRead> {
  const followers = () => followersQuery(db, clubId);
  const [shards, all, recent, newAccounts, automaticUsername, byOwnerCode, retained] =
    await Promise.all([
      fanClubShardsOf(db, clubId).get(),
      count(followers()),
      count(followersQuery(db, clubId, Timestamp.fromMillis(now - FOLLOWERS_RECENT_MS))),
      count(followers().where('newAccount', '==', true)),
      count(followers().where('chosenUsername', '==', false)),
      count(followers().where('byOwnerCode', '==', true)),
      count(db.collectionGroup('centrals').where('fanClubId', '==', clubId)),
    ]);
  const days = shards.docs.map((doc) => doc.data());
  const sums = sumFanClubShards(days);
  return {
    counts: {
      followers: all,
      followers30d: recent,
      newAccounts,
      automaticUsername,
      byOwnerCode,
      joins: sums.joins,
      retained,
      signups: sums.signups,
      visits: sums.visits,
      links: sums.links,
    },
    staleDays: shards.docs.flatMap((doc, index) => {
      const stale = staleEngagementDays(days[index]!, now);
      return stale.length > 0 ? [{ shard: doc.id, days: stale }] : [];
    }),
  };
}

export type FanClubCopyOne = {
  copied: boolean;
  unfeatured: boolean;
  monthClosed: boolean;
  /** Os dias velhos da taxa apagados dos shards (37.11). */
  daysCut: number;
};

export type ReadFanClubCounts = typeof readFanClubCounts;

/**
 * A cópia de um fã-clube: os números lidos fora de transação
 * (`readFanClubCounts`) e uma transação curta que relê o fã-clube e grava,
 * numa gravação só, o `counts` com o `at` da cópia; na primeira cópia do mês,
 * o `lastMonth` e o `monthStart` novo (`monthTurn`, pelo `monthStart` relido:
 * a cópia repetida no mesmo mês não fecha o mês de novo); e, com o prazo do
 * Destaque vencido no `featuredUntil` relido, o destaque desligado (um
 * Destaque dado depois da leitura não é desfeito). Desde a Fase 2 (37.11), na
 * mesma transação, o corte dos dias da taxa com mais de 35 dias: um `update`
 * com o `FieldValue.delete()` de cada dia velho, só nos shards que têm algum
 * (o `set` com `merge` da ação junta os mapas, e sem o corte os dias velhos
 * nunca sairiam); o dia que a ação soma depois da leitura é outro campo, e o
 * corte não o toca. O fã-clube que sumiu não grava nada.
 */
export async function copyFanClubCount(
  db: Firestore,
  clubId: string,
  now: number,
  readCounts: ReadFanClubCounts = readFanClubCounts,
): Promise<FanClubCopyOne> {
  const { counts, staleDays } = await readCounts(db, clubId, now);
  const at = Timestamp.fromMillis(now);
  return db.runTransaction(async (tx): Promise<FanClubCopyOne> => {
    const snap = await tx.get(fanClubRef(db, clubId));
    if (!snap.exists) {
      return { copied: false, unfeatured: false, monthClosed: false, daysCut: 0 };
    }
    const data = snap.data() ?? {};
    const turn = monthTurn(fanClubMonthOf(data.monthStart), counts, now);
    const unfeatured = isFeatureExpired(fanClubRecord(snap.id, data), now);
    tx.update(snap.ref, {
      counts: { ...counts, at },
      ...(turn ? { monthStart: turn.monthStart } : {}),
      ...(turn?.lastMonth ? { lastMonth: turn.lastMonth } : {}),
      ...(unfeatured ? { ...FEATURE_OFF, updatedAt: at } : {}),
    });
    let daysCut = 0;
    for (const { shard, days } of staleDays) {
      tx.update(
        fanClubShardsOf(db, clubId).doc(shard),
        Object.fromEntries(days.map((day) => [`days.${day}`, FieldValue.delete()])),
      );
      daysCut += days.length;
    }
    return { copied: true, unfeatured, monthClosed: turn?.lastMonth != null, daysCut };
  });
}

export type FanClubCopyResult = {
  /** Os fã-clubes lidos para a cópia desta noite (até 500). */
  selected: number;
  copied: number;
  /** As cópias que falharam, cada uma no log. */
  failed: number;
  /** Os que ficaram para a noite seguinte, pelo prazo. */
  deferred: number;
  /** Os destaques vencidos desligados. */
  unfeatured: number;
  /** Os meses fechados (o `lastMonth` gravado). */
  monthsClosed: number;
  /** Os dias velhos da taxa apagados dos shards, somados (37.11). */
  daysCut: number;
};

export type FanClubCopyOptions = {
  /** O instante da cópia: o `counts.at`, os 30 dias e o mês de São Paulo. */
  now: number;
  /** Depois dele, nenhum fã-clube novo começa (o prazo do handler). */
  deadline: number;
  /** O relógio do prazo; os testes fixam. */
  clock?: () => number;
  log?: Log;
  /** Os testes diminuem. */
  max?: number;
  concurrency?: number;
  /** Os testes trocam (a falha de um fã-clube). */
  readCounts?: ReadFanClubCounts;
};

/**
 * A cópia da noite (34.5): até 500 fã-clubes `active` ou `paused` pelo
 * `counts.at` crescente (o `null` da aprovação primeiro; o índice `status`,
 * `counts.at`), copiados 10 de cada vez (`copyFanClubCount`). Depois do prazo,
 * nenhum começa: o que sobrou fica para a noite seguinte, que começa pelos de
 * cópia mais antiga. A falha de um vai ao log com o id e não para os outros.
 * O corte dos dias da taxa anda junto, dentro do mesmo prazo: o fã-clube que a
 * cópia não alcança numa noite só guarda dias a mais (37.11).
 */
export async function copyFanClubCounts(
  db: Firestore,
  options: FanClubCopyOptions,
): Promise<FanClubCopyResult> {
  const { now, deadline, clock = Date.now, log = logger } = options;
  const max = options.max ?? FAN_CLUB_COPY_MAX;
  const snap = await fanClubsOf(db)
    .where('status', 'in', ['active', 'paused'])
    .orderBy('counts.at')
    .limit(max)
    .get();
  const ids = snap.docs.map((doc) => doc.id);
  const result: FanClubCopyResult = {
    selected: ids.length,
    copied: 0,
    failed: 0,
    deferred: 0,
    unfeatured: 0,
    monthsClosed: 0,
    daysCut: 0,
  };
  let next = 0;
  const worker = async () => {
    while (next < ids.length && clock() < deadline) {
      const clubId = ids[next]!;
      next += 1;
      try {
        const one = await copyFanClubCount(db, clubId, now, options.readCounts);
        if (one.copied) result.copied += 1;
        if (one.unfeatured) result.unfeatured += 1;
        if (one.monthClosed) result.monthsClosed += 1;
        result.daysCut += one.daysCut;
      } catch (error) {
        result.failed += 1;
        log.error('fan-clubs: a cópia da noite de um fã-clube falhou', {
          clubId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  const workers = Math.min(options.concurrency ?? FAN_CLUB_COPY_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workers }, worker));
  result.deferred = ids.length - next;
  log.info('fan-clubs: a cópia da noite', result);
  return result;
}

/**
 * O passo da cópia no handler do `closeStatsDays`, no `finally` do
 * fechamento: nunca lança (a falha da cópia não pode derrubar o fechamento do
 * dia, nem mudar o erro dele), e o erro vai ao log. Devolve o resultado, ou
 * null quando a cópia inteira falhou.
 */
export async function runFanClubCopyStep(
  db: Firestore,
  options: FanClubCopyOptions,
): Promise<FanClubCopyResult | null> {
  const log = options.log ?? logger;
  try {
    return await copyFanClubCounts(db, options);
  } catch (error) {
    log.error('fan-clubs: a cópia da noite falhou', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
