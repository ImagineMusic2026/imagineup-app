import {
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import type { LeaderboardEntry, LeaderboardPage, MyRank, Season } from '../api/contract';
import { artistRecord, CentralError, isPublished } from '../centrals/model';
import type { SeasonConfig } from '../points/config';
import {
  encodeRankCursor,
  RANKING_PAGE_SIZE,
  rankChange,
  rankTarget,
  seasonView,
  shownPoints,
  shownSeason,
  targetRead,
  type RankCursor,
  type RankKey,
  type RankScope,
  type ShownSeason,
} from './model';
import {
  countAheadQueries,
  keyOf,
  keyValues,
  rankDocRef,
  rankingQuery,
  rankRowOf,
  type RankRow,
} from './queries';

// As leituras do ranking para as rotas (bloco 8, 23.2): a temporada mostrada,
// a página do ranking, a posição do fã e a do "Suas centrais". A temporada da
// `season` (em andamento ou esperando a virada) é lida ao vivo, com a página,
// as contagens e o documento do fã numa transação só de leitura (o mesmo
// instante, sem trava e sem leitura a mais); a última fechada, do arquivo.

/** Código gRPC de índice que falta ou ainda monta (FAILED_PRECONDITION). */
const FAILED_PRECONDITION = 9;

type Log = Pick<typeof logger, 'error'>;

/** O resultado congelado de uma temporada: `seasons/{id}`. */
export function seasonArchiveRef(db: Firestore, seasonId: string): DocumentReference {
  return db.collection('seasons').doc(seasonId);
}

/** As linhas do arquivo: `seasons/{id}/standings/{uid}`. */
export function standingsRef(db: Firestore, seasonId: string): CollectionReference {
  return seasonArchiveRef(db, seasonId).collection('standings');
}

/** `GET /ranking/season`: a temporada mostrada, da configuração do cache. */
export function readSeason(config: SeasonConfig, now: number): { season: Season | null } {
  return { season: seasonView(shownSeason(config, now)) };
}

/** Quantos vêm antes de `key` na ordem da lista (com `inclusive`, também ele), na transação. */
export async function countAhead(
  tx: Transaction,
  db: Firestore,
  seasonId: string,
  scope: RankScope,
  key: RankKey,
  inclusive: boolean,
): Promise<number> {
  const snaps = await Promise.all(
    countAheadQueries(db, seasonId, scope, key, inclusive).map((query) => tx.get(query)),
  );
  return snaps.reduce((sum, snap) => sum + snap.data().count, 0);
}

/** O perfil de cada linha, num getAll fora da transação (perfil que sumiu: os três null). */
async function profilesOf(
  db: Firestore,
  uids: readonly string[],
): Promise<Map<string, Pick<LeaderboardEntry, 'displayName' | 'photoURL' | 'city'>>> {
  const unique = [...new Set(uids)];
  const out = new Map<string, Pick<LeaderboardEntry, 'displayName' | 'photoURL' | 'city'>>();
  if (unique.length === 0) return out;
  const snaps = await db.getAll(...unique.map((uid) => db.collection('users').doc(uid)));
  unique.forEach((uid, index) => out.set(uid, profileView(snaps[index])));
  return out;
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** O nome, a foto e a cidade do perfil, como a linha mostra. */
export function profileView(
  snap: DocumentSnapshot | undefined,
): Pick<LeaderboardEntry, 'displayName' | 'photoURL' | 'city'> {
  if (!snap?.exists) return { displayName: null, photoURL: null, city: null };
  return {
    displayName: textOrNull(snap.get('displayName')),
    photoURL: textOrNull(snap.get('photoURL')),
    city: textOrNull(snap.get('city')),
  };
}

/**
 * A central do recorte, publicada (404 `artist_not_found`, como as rotas do
 * bloco 4), ou, no ranking do painel (`requirePublished: false`, bloco 11),
 * só existindo, em qualquer status. Lida em paralelo com a página.
 */
async function requireArtist(
  db: Firestore,
  artistId: string,
  requirePublished: boolean,
): Promise<void> {
  const snap = await db.collection('artists').doc(artistId).get();
  const artist = snap.exists ? artistRecord(snap.id, snap.data() ?? {}) : null;
  const ok = requirePublished ? isPublished(artist) : artist !== null;
  if (!ok) throw new CentralError('artist_not_found', { artistId });
}

const archivePositionField = (scope: RankScope) =>
  scope.kind === 'global' ? 'position' : `centrals.${scope.artistId}.position`;

const archivePointsField = (scope: RankScope) =>
  scope.kind === 'global' ? 'points' : `centrals.${scope.artistId}.points`;

/**
 * Uma página do ranking (`GET /ranking`, 23.2): 20 linhas, a 21ª só diz que há
 * página seguinte. Ao vivo, a página e (com cursor) as contagens até ele na
 * mesma transação só de leitura; a posição da primeira linha é a contagem
 * mais 1. A temporada fechada vem do arquivo, pela posição guardada. O
 * ranking do painel (`getPanelRanking`, bloco 11) passa `requirePublished:
 * false`: a central precisa só existir.
 */
export async function readLeaderboard(
  db: Firestore,
  uid: string,
  config: SeasonConfig,
  now: number,
  scope: RankScope,
  cursor: RankCursor | null,
  options: { requirePublished?: boolean } = {},
): Promise<LeaderboardPage> {
  const shown = shownSeason(config, now);
  const artistCheck =
    scope.kind === 'artist'
      ? requireArtist(db, scope.artistId, options.requirePublished ?? true)
      : Promise.resolve();
  if (!shown) {
    await artistCheck;
    return { items: [], nextCursor: null };
  }
  const [page] = await Promise.all([
    shown.source === 'archive'
      ? readArchivePage(db, uid, shown, scope, cursor)
      : readLivePage(db, uid, shown, scope, cursor, now),
    artistCheck,
  ]);
  return page;
}

async function readLivePage(
  db: Firestore,
  uid: string,
  shown: ShownSeason,
  scope: RankScope,
  cursor: RankCursor | null,
  now: number,
): Promise<LeaderboardPage> {
  const seasonId = shown.season.id;
  let query = rankingQuery(db, seasonId, scope);
  if (cursor) query = query.startAfter(...keyValues(db, scope, cursor));
  const { rows, ahead } = await db.runTransaction(
    async (tx) => {
      const [snap, before] = await Promise.all([
        tx.get(query.limit(RANKING_PAGE_SIZE + 1)),
        cursor ? countAhead(tx, db, seasonId, scope, cursor, true) : Promise.resolve(0),
      ]);
      return { rows: snap.docs.map(rankRowOf), ahead: before };
    },
    { readOnly: true },
  );
  const shownRows = rows.slice(0, RANKING_PAGE_SIZE);
  const profiles = await profilesOf(
    db,
    shownRows.map((row) => row.uid),
  );
  const first = ahead + 1;
  const items = shownRows.map((row, index): LeaderboardEntry => ({
    position: first + index,
    userId: row.uid,
    ...profiles.get(row.uid)!,
    points: row.points,
    change: rankChange(row.rankWeek, first + index, shown, now),
    isMe: row.uid === uid,
  }));
  const last = shownRows.at(-1);
  return {
    items,
    nextCursor:
      rows.length > RANKING_PAGE_SIZE && last
        ? encodeRankCursor({ ...keyOf(last), position: first + shownRows.length - 1 })
        : null,
  };
}

async function readArchivePage(
  db: Firestore,
  uid: string,
  shown: ShownSeason,
  scope: RankScope,
  cursor: RankCursor | null,
): Promise<LeaderboardPage> {
  const positionField = archivePositionField(scope);
  let query = standingsRef(db, shown.season.id).orderBy(positionField);
  if (cursor) query = query.startAfter(cursor.position);
  const snap = await query.limit(RANKING_PAGE_SIZE + 1).get();
  const docs = snap.docs.slice(0, RANKING_PAGE_SIZE);
  const items = docs.map((doc): LeaderboardEntry => {
    const rowUid = typeof doc.get('uid') === 'string' ? (doc.get('uid') as string) : doc.id;
    return {
      position: doc.get(positionField) as number,
      userId: rowUid,
      displayName: textOrNull(doc.get('displayName')),
      photoURL: textOrNull(doc.get('photoURL')),
      city: textOrNull(doc.get('city')),
      points: (doc.get(archivePointsField(scope)) as number | undefined) ?? 0,
      change: 0,
      isMe: rowUid === uid,
    };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      snap.docs.length > RANKING_PAGE_SIZE && last
        ? encodeRankCursor({
            points: Math.max(1, last.points),
            atMs: null,
            uid: last.userId,
            position: last.position,
          })
        : null,
  };
}

/** A linha do fã no recorte, lida ao vivo: os pontos da temporada mostrada e, na central, o `member`. */
type LiveSelf = { row: RankRow | null; points: number; member: boolean };

function liveSelf(snap: DocumentSnapshot, shown: ShownSeason, scope: RankScope): LiveSelf {
  if (!snap.exists) return { row: null, points: 0, member: false };
  const row = rankRowOf(snap);
  const seasonId = snap.get('seasonId');
  const points = shownPoints(
    { seasonId: typeof seasonId === 'string' ? seasonId : null, seasonPoints: row.points },
    shown,
  );
  return { row, points, member: scope.kind === 'global' || snap.get('member') === true };
}

/**
 * A posição ao vivo de um fã no recorte: 1 mais as contagens de quem vem
 * antes, com o documento dele, na transação. Sem pontos na temporada (ou fora
 * dos membros, na central), null.
 */
async function livePosition(
  tx: Transaction,
  db: Firestore,
  shown: ShownSeason,
  scope: RankScope,
  self: LiveSelf,
): Promise<number | null> {
  if (!self.row || self.points <= 0 || !self.member) return null;
  return 1 + (await countAhead(tx, db, shown.season.id, scope, keyOf(self.row), false));
}

/**
 * `GET /me/rank` (23.2): a posição, os pontos e a meta, ao vivo numa
 * transação só de leitura (a posição, a meta e a linha do fã na lista saem do
 * mesmo instante); na temporada fechada, a posição da linha do arquivo.
 */
export async function readMyRank(
  db: Firestore,
  uid: string,
  config: SeasonConfig,
  now: number,
  scope: RankScope,
): Promise<MyRank> {
  const shown = shownSeason(config, now);
  const artistCheck =
    scope.kind === 'artist' ? requireArtist(db, scope.artistId, true) : Promise.resolve();
  if (!shown) {
    await artistCheck;
    return { position: null, points: 0, target: null };
  }
  const [rank] = await Promise.all([
    shown.source === 'archive'
      ? readArchiveRank(db, uid, shown, scope)
      : readLiveRank(db, uid, shown, scope),
    artistCheck,
  ]);
  return rank;
}

async function readLiveRank(
  db: Firestore,
  uid: string,
  shown: ShownSeason,
  scope: RankScope,
): Promise<MyRank> {
  const ended = shown.status === 'ended';
  return db.runTransaction(
    async (tx): Promise<MyRank> => {
      const self = liveSelf(await tx.get(rankDocRef(db, uid, scope)), shown, scope);
      const position = await livePosition(tx, db, shown, scope, self);
      const read = targetRead(position, shown.season.topTarget, ended);
      let rowPoints: number | null = null;
      if (read && self.row && position !== null) {
        // A N-ésima (fora do top) ou a de cima (de 2 a N): o começo da lista,
        // pelo índice dela, até essa linha (no máximo `topTarget`, 50). Nada de
        // `endBefore` com `limitToLast`: o SDK inverte as direções, e a consulta
        // invertida pediria outro índice composto (23.19).
        const rowsToRead = read === 'top' ? shown.season.topTarget : position - 1;
        const snap = await tx.get(rankingQuery(db, shown.season.id, scope).limit(rowsToRead));
        const row = snap.docs.at(rowsToRead - 1);
        rowPoints = row ? rankRowOf(row).points : null;
      }
      const target = rankTarget({
        position,
        points: self.points,
        topTarget: shown.season.topTarget,
        ended,
        rowPoints,
      });
      return {
        position,
        points: self.points,
        target,
        ...(scope.kind === 'artist' ? { member: self.member } : {}),
      };
    },
    { readOnly: true },
  );
}

async function readArchiveRank(
  db: Firestore,
  uid: string,
  shown: ShownSeason,
  scope: RankScope,
): Promise<MyRank> {
  const [doc, standing] = await db.getAll(
    rankDocRef(db, uid, scope),
    standingsRef(db, shown.season.id).doc(uid),
  );
  const seasonId = doc!.get('seasonId');
  const points = doc!.exists
    ? shownPoints(
        {
          seasonId: typeof seasonId === 'string' ? seasonId : null,
          seasonPoints: rankRowOf(doc!).points,
        },
        shown,
      )
    : 0;
  const position = standing!.exists ? standing!.get(archivePositionField(scope)) : undefined;
  return {
    position: typeof position === 'number' ? position : null,
    points,
    target: null,
  };
}

/**
 * A posição do fã numa central para "Suas centrais" (`fanRank`, 23.2): a
 * mesma conta do `/me/rank` da central, ao vivo, na transação só de leitura
 * dela. Contagem que falha com o código 9 (o índice que falta ou ainda monta)
 * vale null, com o erro no log, como o "PTS DA CENTRAL": "Suas centrais" não
 * cai pelo ranking. Outro erro sobe.
 */
export async function liveCentralRank(
  db: Firestore,
  uid: string,
  shown: ShownSeason,
  artistId: string,
  log: Log = logger,
): Promise<number | null> {
  const scope: RankScope = { kind: 'artist', artistId };
  try {
    return await db.runTransaction(
      async (tx) => {
        const self = liveSelf(await tx.get(rankDocRef(db, uid, scope)), shown, scope);
        return livePosition(tx, db, shown, scope, self);
      },
      { readOnly: true },
    );
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== FAILED_PRECONDITION) throw error;
    log.error('ranking: posição da central sem índice', {
      artistId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** As posições finais do fã nas centrais de uma temporada fechada, pela linha dele no arquivo. */
export async function archivedCentralRanks(
  db: Firestore,
  uid: string,
  seasonId: string,
): Promise<Map<string, number>> {
  const snap = await standingsRef(db, seasonId).doc(uid).get();
  const centrals = snap.exists ? snap.get('centrals') : undefined;
  const out = new Map<string, number>();
  if (typeof centrals !== 'object' || centrals === null) return out;
  for (const [artistId, value] of Object.entries(centrals as Record<string, unknown>)) {
    const position = (value as { position?: unknown } | null)?.position;
    if (typeof position === 'number') out.set(artistId, position);
  }
  return out;
}
