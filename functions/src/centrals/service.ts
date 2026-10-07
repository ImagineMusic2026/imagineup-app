import {
  AggregateField,
  FieldPath,
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import type { Artist, ArtistDetails, FanCentral } from '../api/contract';
import type { SeasonConfig } from '../points/config';
import {
  addDailyCount,
  addMembershipCounts,
  applyAwards,
  centralFromDoc,
  centralPointsRef,
  planAwards,
  requireFan,
  retryOnAlreadyExists,
  runContext,
  setCentralMember,
  walletRef,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { dayKey, nextDayStart, type AwardEntry } from '../points/model';
import { shownPoints, shownSeason } from '../ranking/model';
import { archivedCentralRanks, liveCentralRank } from '../ranking/service';
import {
  artistDetailsView,
  artistRecord,
  artistView,
  CENTRALS_MAX,
  CentralError,
  exactMillis,
  exceedsEntryLimit,
  FAN_SHARD_COUNT,
  fanCentralView,
  fanShardOf,
  isPublished,
  safeCount,
  secondsUntil,
  shouldCopyFanCount,
  sortFanCentrals,
  sumFanShards,
  type ArtistRecord,
  type JoinVia,
} from './model';

// Centrais de verdade no Firestore (bloco 4): o vínculo do fã em
// users/{uid}/centrals/{artistId}, o fanCount em shards
// (artistStats/{artistId}/fanShards/{n}) copiado para artists/{id} pela fila
// syncArtistFanCount, e as leituras das rotas. A ordem de uma rota que grava é
// a de sempre: chave e fã (runIdempotent), leituras do domínio, planAwards,
// gravações do domínio. docs/arquitetura-api.md, seção 19.

/** Código gRPC de índice que falta (FAILED_PRECONDITION). */
const FAILED_PRECONDITION = 9;

/** Vínculos listados por página na exclusão de conta. */
const LEAVE_ALL_PAGE = 200;

type Log = Pick<typeof logger, 'error'>;

export function artistRef(db: Firestore, artistId: string): DocumentReference {
  return db.collection('artists').doc(artistId);
}

/** As centrais do fã: users/{uid}/centrals. */
export function membershipsRef(db: Firestore, uid: string): CollectionReference {
  return db.collection('users').doc(uid).collection('centrals');
}

/** O vínculo do fã com uma central. Só o servidor grava. */
export function membershipRef(db: Firestore, uid: string, artistId: string): DocumentReference {
  return membershipsRef(db, uid).doc(artistId);
}

/** Os shards do fanCount de uma central. */
export function fanShardsRef(db: Firestore, artistId: string): CollectionReference {
  return db.collection('artistStats').doc(artistId).collection('fanShards');
}

export function fanShardRef(db: Firestore, artistId: string, shard: number): DocumentReference {
  return fanShardsRef(db, artistId).doc(String(shard));
}

function recordOf(snap: DocumentSnapshot | undefined): ArtistRecord | null {
  return snap?.exists ? artistRecord(snap.id, snap.data() ?? {}) : null;
}

/**
 * +1 ou -1 num shard do fanCount, sem ler: increment com merge. Um shard
 * sozinho pode ficar negativo; só a soma vale.
 */
function bumpFanShard(
  tx: Transaction,
  db: Firestore,
  artistId: string,
  shard: number,
  delta: 1 | -1,
  at: Timestamp,
): void {
  tx.set(
    fanShardRef(db, artistId, shard),
    { count: FieldValue.increment(delta), updatedAt: at },
    { merge: true },
  );
}

/** O que a entrada leu: as centrais pedidas (null quando não existe) e de quais o fã já é membro. */
export type JoinRead = {
  artists: Map<string, ArtistRecord | null>;
  members: Set<string>;
};

/**
 * Leituras da entrada, num getAll só: artists/{id} e o vínculo de cada id.
 * A leitura da central fica na transação de propósito: é ela que põe em ordem
 * a entrada e o deleteArtist ou o setArtistStatus da mesma central.
 */
export async function readJoin(
  tx: Transaction,
  db: Firestore,
  uid: string,
  artistIds: readonly string[],
): Promise<JoinRead> {
  const ids = [...new Set(artistIds)];
  if (ids.length === 0) return { artists: new Map(), members: new Set() };
  const snaps = await tx.getAll(
    ...ids.flatMap((id) => [artistRef(db, id), membershipRef(db, uid, id)]),
  );
  const artists = new Map<string, ArtistRecord | null>();
  const members = new Set<string>();
  ids.forEach((id, index) => {
    artists.set(id, recordOf(snaps[index * 2]));
    if (snaps[index * 2 + 1]!.exists) members.add(id);
  });
  return { artists, members };
}

export type JoinOutcome = {
  plan: AwardPlan;
  /** As centrais em que o fã entrou agora (sem as que ele já seguia). */
  joined: string[];
};

/**
 * Entrada em uma ou mais centrais, depois das leituras (readJoin):
 * 1. central que não existe ou não está publicada recusa tudo (artist_not_found);
 * 2. as novas são as publicadas sem vínculo; com alguma, o fã que já fez
 *    CENTRAL_ENTRIES_PER_DAY entradas hoje é recusado (too_many_entries);
 * 3. planAwards com um central_join por nova (uma vez na vida por central) e
 *    uma unidade `join` de missão por nova (bloco 7, 22.4);
 * 4. vínculo, +1 num shard do fanCount e `joined` no shard do painel de cada
 *    nova, e +1 no `central_entry` do dia na carteira do fã;
 * 5. `member: true` no `centralPoints` de cada nova (bloco 8, 23.7), a partir
 *    do que o planAwards já leu para o central_join (sem o documento, ele
 *    nasce zerado): o fã entra no ranking da central com os pontos que já
 *    tinha nela.
 * O runIdempotent (ou o runJoinCentrals) grava o plano depois.
 */
export async function joinCentrals(
  tx: Transaction,
  db: Firestore,
  read: JoinRead,
  options: { fan: FanContext; award: AwardContext; artistIds: readonly string[]; via: JoinVia },
): Promise<JoinOutcome> {
  const { fan, award, via } = options;
  const ids = [...new Set(options.artistIds)];
  const missing = ids.filter((id) => !isPublished(read.artists.get(id)));
  if (missing.length > 0) throw new CentralError('artist_not_found', { artistIds: missing });

  const joined = ids.filter((id) => !read.members.has(id));
  // O teto do dia vale para o fã que chama; o seed (sistema) não conta.
  const countsEntry = award.actor.type === 'fan' && joined.length > 0;
  const day = dayKey(award.now);
  const limit = award.config.actionCaps.central_entry;
  if (
    countsEntry &&
    exceedsEntryLimit(fan.wallet.days[day]?.count.central_entry ?? 0, joined.length, limit)
  ) {
    throw new CentralError(
      'too_many_entries',
      { limit },
      secondsUntil(nextDayStart(award.now), award.now),
    );
  }
  const entries: AwardEntry[] = joined.map((id) => ({
    kind: 'earn',
    source: 'central_join',
    eventId: id,
    artistId: id,
    subject: { type: 'artist', id },
  }));
  const plan = await planAwards(
    tx,
    db,
    [
      {
        uid: fan.uid,
        fan,
        entries,
        ticks: joined.map((id) => ({ action: 'join', key: id, on: { artistIds: [id] } })),
      },
    ],
    award,
  );

  const at = Timestamp.fromMillis(award.now);
  const shard = fanShardOf(award.shard);
  for (const id of joined) {
    tx.create(membershipRef(db, fan.uid, id), {
      uid: fan.uid,
      artistId: id,
      via,
      joinedAt: at,
      schemaVersion: 1,
    });
    bumpFanShard(tx, db, id, shard, 1, at);
  }
  addMembershipCounts(
    plan,
    joined.map((artistId) => ({ artistId, kind: 'joined' as const })),
  );
  if (countsEntry) addDailyCount(plan, fan, 'central_entry');
  for (const id of joined) setCentralMember(plan, fan.uid, id, true);
  return { plan, joined };
}

/** O vínculo lido, com o `joinedAt` em ms. */
type Membership = { artistId: string; joinedAt: number | null };

function membershipOf(snap: DocumentSnapshot): Membership {
  return { artistId: snap.id, joinedAt: exactMillis(snap.get('joinedAt')) };
}

export type FollowRead = JoinRead & {
  /** As centrais que o fã já seguia, com a data do vínculo. */
  followed: Membership[];
};

/**
 * Leituras do `POST /me/artists`: a subcoleção do fã inteira (até 240) e, num
 * getAll, as centrais pedidas e as já seguidas, mais o vínculo das pedidas
 * que a lista não trouxe. Tudo antes de gravar.
 */
export async function readFollow(
  tx: Transaction,
  db: Firestore,
  uid: string,
  artistIds: readonly string[],
): Promise<FollowRead> {
  const list = await tx.get(membershipsRef(db, uid).limit(CENTRALS_MAX));
  const followed = list.docs.map(membershipOf);
  const followedIds = new Set(followed.map((item) => item.artistId));
  const requested = [...new Set(artistIds)];
  const artistIdsToRead = [...new Set([...requested, ...followedIds])];
  const unknownMemberships = requested.filter((id) => !followedIds.has(id));
  const snaps = await tx.getAll(
    ...artistIdsToRead.map((id) => artistRef(db, id)),
    ...unknownMemberships.map((id) => membershipRef(db, uid, id)),
  );
  const artists = new Map<string, ArtistRecord | null>();
  artistIdsToRead.forEach((id, index) => artists.set(id, recordOf(snaps[index])));
  const members = new Set(followedIds);
  unknownMemberships.forEach((id, index) => {
    const snap = snaps[artistIdsToRead.length + index]!;
    if (snap.exists) {
      members.add(id);
      followed.push(membershipOf(snap));
    }
  });
  return { artists, members, followed };
}

/**
 * As centrais publicadas que o fã segue depois do `POST /me/artists`, na
 * ordem de "Suas centrais": as de antes mais as novas.
 */
export function followedAfter(read: FollowRead, joined: readonly string[], now: number): string[] {
  const items = [
    ...read.followed,
    ...joined.map((artistId) => ({ artistId, joinedAt: now })),
  ].flatMap((item) => {
    const artist = read.artists.get(item.artistId);
    return isPublished(artist) ? [{ ...item, order: artist.order }] : [];
  });
  return sortFanCentrals(items).map((item) => item.artistId);
}

/**
 * Saída da central (`DELETE /me/centrals/:artistId`): lê o vínculo e os pontos
 * do fã na central, planeja sem lançamentos (só a atividade de quem chama) e,
 * com vínculo, apaga, tira 1 de um shard do fanCount, soma `left` no shard do
 * painel e grava `member: false` no `centralPoints` (bloco 8, 23.7: o fã sai
 * do ranking da central; sem o documento, nada, porque ele nunca pontuou
 * nela). Sem vínculo, nada. Não mexe em ponto: sair não tira os pontos, e
 * entrar de novo não paga a entrada outra vez. Vale em qualquer status da
 * central.
 */
export async function leaveCentral(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; artistId: string },
): Promise<{ plan: AwardPlan; left: boolean }> {
  const { fan, award, artistId } = options;
  const ref = membershipRef(db, fan.uid, artistId);
  const [membership, points] = await tx.getAll(ref, centralPointsRef(db, fan.uid, artistId));
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  if (!membership!.exists) return { plan, left: false };
  tx.delete(ref);
  bumpFanShard(tx, db, artistId, fanShardOf(award.shard), -1, Timestamp.fromMillis(award.now));
  addMembershipCounts(plan, [{ artistId, kind: 'left' }]);
  if (points!.exists) {
    setCentralMember(plan, fan.uid, artistId, false, centralFromDoc(artistId, points!.data()));
  }
  return { plan, left: true };
}

/**
 * Entrada fora da API: o seed dos emuladores. Abre a transação, exige o perfil
 * (sem marcar atividade), lê, entra e grava o plano, como a rota faria.
 */
export async function runJoinCentrals(
  db: Firestore,
  uid: string,
  artistIds: readonly string[],
  options: RunOptions & { via: JoinVia },
): Promise<JoinOutcome> {
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx) => {
      const [profile, wallet] = await tx.getAll(
        db.collection('users').doc(uid),
        walletRef(db, uid),
      );
      const fan = await requireFan(tx, db, uid, profile!, wallet!, options.now, {
        markActivity: false,
      });
      const read = await readJoin(tx, db, uid, artistIds);
      const award: AwardContext = runContext(options);
      const outcome = await joinCentrals(tx, db, read, {
        fan,
        award,
        artistIds,
        via: options.via,
      });
      applyAwards(tx, db, outcome.plan);
      return outcome;
    }),
  );
}

/** Shard do fanCount sorteado, de 0 até FAN_SHARD_COUNT menos 1. */
function pickFanShard(random: () => number): number {
  return Math.min(FAN_SHARD_COUNT - 1, Math.floor(random() * FAN_SHARD_COUNT));
}

/**
 * Exclusão de conta: tira o fã de todas as centrais, descontando o fanCount.
 * Lista os vínculos em páginas de 200 e, por página, uma transação relê cada
 * um e, se ainda existe, apaga e tira 1 de um shard sorteado. Repetir é
 * seguro: o que já saiu não desconta de novo. Não grava fluxo no painel (a
 * exclusão não é `left`). Roda depois de o perfil sair (deleteUserData).
 */
export async function leaveAllCentrals(
  db: Firestore,
  uid: string,
  options: { random?: () => number; now?: () => number } = {},
): Promise<number> {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  let removed = 0;
  let last: string | null = null;
  for (;;) {
    let query = membershipsRef(db, uid).orderBy(FieldPath.documentId()).limit(LEAVE_ALL_PAGE);
    if (last !== null) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) return removed;
    removed += await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...page.docs.map((doc) => doc.ref));
      const at = Timestamp.fromMillis(now());
      let count = 0;
      for (const snap of snaps) {
        if (!snap.exists) continue;
        tx.delete(snap.ref);
        bumpFanShard(tx, db, snap.id, pickFanShard(random), -1, at);
        count += 1;
      }
      return count;
    });
    last = page.docs.at(-1)!.id;
    if (page.size < LEAVE_ALL_PAGE) return removed;
  }
}

// --- Leituras das rotas (GET) --------------------------------------------------

/** As centrais publicadas, na ordem do painel (`GET /artists`). Índice status + order. */
export async function readPublishedArtists(db: Firestore): Promise<Artist[]> {
  const snap = await db
    .collection('artists')
    .where('status', '==', 'published')
    .orderBy('order')
    .limit(CENTRALS_MAX)
    .get();
  return snap.docs.map((doc) => artistView(artistRecord(doc.id, doc.data())));
}

/** Soma de `totalPoints` dos fãs numa central. */
export type CentralPointsAggregate = (artistId: string) => Promise<number>;

/** O "PTS DA CENTRAL" pelo grupo `centralPoints` (índice artistId + totalPoints). */
export function centralPointsAggregate(db: Firestore): CentralPointsAggregate {
  return async (artistId) => {
    const snap = await db
      .collectionGroup('centralPoints')
      .where('artistId', '==', artistId)
      .aggregate({ total: AggregateField.sum('totalPoints') })
      .get();
    return snap.data().total ?? 0;
  };
}

/**
 * "PTS DA CENTRAL". Sem o índice (só em produção: o emulador não exige), a
 * soma falha com o código 9: em vez de derrubar a 1d inteira por um número
 * auxiliar, vale 0, com o erro no log (a mensagem traz o link do índice).
 * Qualquer outro erro segue.
 */
export async function sumCentralPoints(
  artistId: string,
  aggregate: CentralPointsAggregate,
  log: Log = logger,
): Promise<number> {
  try {
    return safeCount(await aggregate(artistId));
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== FAILED_PRECONDITION) throw error;
    log.error('centrals: soma do PTS DA CENTRAL sem índice', {
      artistId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/** Quantos posts no ar a central tem (bloco 6: o `countArtistPosts` do mural). */
export type ArtistPostCounter = (artistId: string) => Promise<number>;

/**
 * A página da central (`GET /artists/:id`): a central, o vínculo do fã, a
 * soma do "PTS DA CENTRAL" e, desde o bloco 6, o `count()` dos posts no ar,
 * em paralelo. Central que não existe ou não está publicada: 404. O contador
 * dos posts vem de fora (a rota passa o do mural), para este arquivo não
 * importar o mural, que importa daqui.
 */
export async function readArtistDetails(
  db: Firestore,
  uid: string,
  artistId: string,
  aggregate: CentralPointsAggregate = centralPointsAggregate(db),
  countPosts: ArtistPostCounter = async () => 0,
): Promise<ArtistDetails> {
  const [artist, membership, points, posts] = await Promise.all([
    artistRef(db, artistId).get(),
    membershipRef(db, uid, artistId).get(),
    sumCentralPoints(artistId, aggregate),
    countPosts(artistId),
  ]);
  const record = recordOf(artist);
  if (!isPublished(record)) throw new CentralError('artist_not_found', { artistId });
  return artistDetailsView(
    record,
    membership.exists ? { joinedAt: membershipOf(membership).joinedAt } : null,
    points,
    posts,
  );
}

/**
 * "Suas centrais" (`GET /me/centrals`): os vínculos do fã e, num getAll, a
 * central e os pontos dele em cada uma, os da temporada mostrada (bloco 8,
 * decisão 4 de 23.1). Central que não existe ou não está publicada fica de
 * fora (o vínculo continua e volta quando ela voltar ao ar). A posição
 * (`fanRank`, 23.2) é a do `/me/rank` da central: ao vivo, a mesma conta
 * (`liveCentralRank`), só onde o fã é membro e pontuou; na temporada fechada,
 * a linha dele no arquivo (uma leitura para todas).
 */
export async function readFanCentrals(
  db: Firestore,
  uid: string,
  config: SeasonConfig,
  now: number,
): Promise<FanCentral[]> {
  const list = await membershipsRef(db, uid).limit(CENTRALS_MAX).get();
  if (list.empty) return [];
  const shown = shownSeason(config, now);
  const memberships = list.docs.map(membershipOf);
  const [snaps, archived] = await Promise.all([
    db.getAll(
      ...memberships.map(({ artistId }) => artistRef(db, artistId)),
      ...memberships.map(({ artistId }) => centralPointsRef(db, uid, artistId)),
    ),
    shown?.source === 'archive'
      ? archivedCentralRanks(db, uid, shown.season.id)
      : Promise.resolve(new Map<string, number>()),
  ]);
  const visible = memberships.flatMap((membership, index) => {
    const artist = recordOf(snaps[index]);
    if (!isPublished(artist)) return [];
    const points = snaps[memberships.length + index]!;
    const seasonPoints = points.exists
      ? shownPoints(
          {
            seasonId: typeof points.get('seasonId') === 'string' ? points.get('seasonId') : null,
            seasonPoints: safeCount(points.get('seasonPoints')),
          },
          shown,
        )
      : 0;
    const member = points.exists && points.get('member') === true;
    return [{ membership, artist, seasonPoints, member }];
  });
  const ranks = await Promise.all(
    visible.map(({ membership, seasonPoints, member }) => {
      if (!shown) return null;
      if (shown.source === 'archive') return archived.get(membership.artistId) ?? null;
      return member && seasonPoints > 0
        ? liveCentralRank(db, uid, shown, membership.artistId)
        : null;
    }),
  );
  const items = visible.map(({ membership, artist, seasonPoints }, index) => ({
    ...membership,
    order: artist.order,
    view: fanCentralView(artist, membership.joinedAt, seasonPoints, ranks[index] ?? null),
  }));
  return sortFanCentrals(items).map((item) => item.view);
}

// --- fanCount: a cópia da soma dos shards ---------------------------------------

export type FanCountSync = {
  status: 'copied' | 'stale' | 'missing';
  /** A soma dos shards (0 quando deu negativo). */
  fanCount: number;
};

/**
 * Soma os shards fora de transação (para não travar as entradas que gravam
 * neles) e, numa transação que lê artists/{id}, copia `fanCount` e
 * `fanCountAt` (o instante da leitura) quando a leitura é mais nova que a
 * última cópia. Central apagada: não grava nada. Não toca no `updatedAt`, que
 * é o carimbo das edições da equipe. Repetir é seguro.
 */
export async function syncFanCount(
  db: Firestore,
  artistId: string,
  log: Log = logger,
): Promise<FanCountSync> {
  const shards = await fanShardsRef(db, artistId).get();
  let sum = sumFanShards(shards.docs.map((doc) => doc.get('count')));
  if (sum < 0) {
    log.error('centrals: soma dos shards do fanCount negativa', { artistId, sum });
    sum = 0;
  }
  const readTime = shards.readTime;
  return db.runTransaction(async (tx): Promise<FanCountSync> => {
    const artist = await tx.get(artistRef(db, artistId));
    if (!artist.exists) return { status: 'missing', fanCount: sum };
    if (!shouldCopyFanCount(exactMillis(artist.get('fanCountAt')), exactMillis(readTime)!)) {
      return { status: 'stale', fanCount: sum };
    }
    tx.update(artist.ref, { fanCount: sum, fanCountAt: readTime });
    return { status: 'copied', fanCount: sum };
  });
}

/**
 * O número de fãs que decide o `deleteArtist` (has-fans), lido na transação:
 * a soma dos shards (nunca abaixo de 0) quando há shard, e o `fanCount` de
 * artists/{id} quando não há nenhum (central de antes do bloco 4). Devolve
 * também os shards, que o deleteArtist apaga junto com a central.
 */
export async function readFanCountForDelete(
  tx: Transaction,
  db: Firestore,
  artistId: string,
  fanCount: unknown,
): Promise<{ fans: number; shards: DocumentReference[] }> {
  const shards = await tx.get(fanShardsRef(db, artistId));
  if (shards.empty) return { fans: safeCount(fanCount), shards: [] };
  return {
    fans: Math.max(0, sumFanShards(shards.docs.map((doc) => doc.get('count')))),
    shards: shards.docs.map((doc) => doc.ref),
  };
}
