import {
  FieldPath,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { centralPointsRef, walletRef } from '../points/award';
import { parseRankWeek, type RankKey, type RankScope, type RankWeek } from './model';

// As consultas do ranking (bloco 8, 23.4), num lugar só para as rotas, o
// retrato e a virada: a lista na ordem do ranking (pontos da temporada
// decrescentes, quem chegou primeiro, o id do documento) e as três contagens
// que dão a posição na mesma ordem. Mudou a ordem aqui, muda em todo lugar, no
// RANKING_QUERY_SHAPES e no índice.

/** O documento do ranking de um fã no recorte: a carteira ou o `centralPoints` da central. */
export function rankDocRef(db: Firestore, uid: string, scope: RankScope): DocumentReference {
  return scope.kind === 'global' ? walletRef(db, uid) : centralPointsRef(db, uid, scope.artistId);
}

/** Os filtros do recorte e da temporada, sem o de pontos (a lista e as contagens partem daqui). */
function scopeBase(db: Firestore, seasonId: string, scope: RankScope): Query {
  const base: Query =
    scope.kind === 'global'
      ? db.collection('wallets')
      : db
          .collectionGroup('centralPoints')
          .where('artistId', '==', scope.artistId)
          .where('member', '==', true);
  return base.where('seasonId', '==', seasonId);
}

/** A lista do ranking: quem tem pontos na temporada, na ordem (23.4). */
export function rankingQuery(db: Firestore, seasonId: string, scope: RankScope): Query {
  return scopeBase(db, seasonId, scope)
    .where('seasonPoints', '>', 0)
    .orderBy('seasonPoints', 'desc')
    .orderBy('seasonPointsAt', 'asc')
    .orderBy(FieldPath.documentId(), 'asc');
}

/** Os valores da chave para o `startAfter` e o `endBefore` da lista. */
export function keyValues(
  db: Firestore,
  scope: RankScope,
  key: RankKey,
): [number, Timestamp | null, DocumentReference] {
  return [
    key.points,
    key.atMs === null ? null : Timestamp.fromMillis(key.atMs),
    rankDocRef(db, key.uid, scope),
  ];
}

/** A agregação `count()` de uma consulta. */
export type CountQuery = ReturnType<Query['count']>;

/**
 * As contagens de quem vem antes de `key` na ordem da lista (com `inclusive`,
 * também ele), cada uma com os filtros do recorte e da temporada (23.4):
 * A, mais pontos; B, os mesmos pontos e chegada antes; C, os mesmos pontos, o
 * mesmo instante e o id antes. Sem cursor dentro do `count()`: os filtros
 * fazem o papel dele. Com o instante nulo na chave (não acontece pelo núcleo,
 * que grava o instante em todo ponto de temporada), nada vem antes dele pela
 * chegada: B sai, e C compara os nulos.
 */
export function countAheadQueries(
  db: Firestore,
  seasonId: string,
  scope: RankScope,
  key: RankKey,
  inclusive: boolean,
): CountQuery[] {
  const base = scopeBase(db, seasonId, scope);
  const ref = rankDocRef(db, key.uid, scope);
  const idOp = inclusive ? '<=' : '<';
  const same = base.where('seasonPoints', '==', key.points);
  const queries = [base.where('seasonPoints', '>', key.points).count()];
  if (key.atMs === null) {
    queries.push(
      same.where('seasonPointsAt', '==', null).where(FieldPath.documentId(), idOp, ref).count(),
    );
  } else {
    const at = Timestamp.fromMillis(key.atMs);
    queries.push(same.where('seasonPointsAt', '<', at).count());
    queries.push(
      same.where('seasonPointsAt', '==', at).where(FieldPath.documentId(), idOp, ref).count(),
    );
  }
  return queries;
}

/** Uma linha do ranking lida (da carteira ou do `centralPoints`). */
export type RankRow = {
  uid: string;
  ref: DocumentReference;
  points: number;
  atMs: number | null;
  rankWeek: RankWeek | null;
  /** As conquistas da carteira (só no geral): quem já tem a de posição sai na própria página. */
  achievements: Record<string, unknown>;
};

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** O uid dono do documento do ranking: a carteira é `wallets/{uid}`, a central, `wallets/{uid}/centralPoints/{id}`. */
export function rankRowOf(doc: QueryDocumentSnapshot | DocumentSnapshot): RankRow {
  const data = doc.data() ?? {};
  const uid =
    doc.ref.parent.id === 'wallets' ? doc.id : (doc.ref.parent.parent?.id ?? String(data.uid));
  const at = data.seasonPointsAt;
  return {
    uid,
    ref: doc.ref,
    points: num(data.seasonPoints),
    atMs: at instanceof Timestamp ? at.toMillis() : null,
    rankWeek: parseRankWeek(data.rankWeek),
    achievements:
      typeof data.achievements === 'object' && data.achievements !== null
        ? (data.achievements as Record<string, unknown>)
        : {},
  };
}

/** A chave de uma linha lida. */
export const keyOf = (row: Pick<RankRow, 'points' | 'atMs' | 'uid'>): RankKey => ({
  points: row.points,
  atMs: row.atMs,
  uid: row.uid,
});
