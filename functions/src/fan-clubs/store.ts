import {
  FieldPath,
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import { fanShardOf } from '../centrals/model';
import {
  applicationRecord,
  fanClubRecord,
  isLiveFanClub,
  type ApplicationRecord,
  type FanClubCountField,
  type FanClubCredit,
  type FanClubRecord,
} from './model';

// Onde o fã-clube mora no Firestore (docs/arquitetura-api.md, 34.4) e os
// passos que outros módulos chamam sem passar pelo service: a pausa pela
// suspensão (a Moderação), as cópias do perfil do gestor (a tarefa
// `syncFanProfile`), a consulta do `has-content` (o `removeArtist`) e, desde a
// etapa 3 de 34.14, as gravações da atribuição (o marcador do crédito e os
// shards dos números, que as centrais e o convite gravam). Só importa o model
// (e o puro das centrais), para nenhum desses módulos puxar a API, os pontos
// ou a equipe por aqui.

export const fanClubsOf = (db: Firestore): CollectionReference => db.collection('fanClubs');

export const fanClubRef = (db: Firestore, clubId: string): DocumentReference =>
  fanClubsOf(db).doc(clubId);

/** `fanClubApplications/{uid}`: a candidatura, uma por fã (decisão 12). */
export const applicationRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('fanClubApplications').doc(uid);

/** `fanClubApplicationPrivate/{uid}`: as redes e o texto de divulgação (decisão 14). */
export const applicationPrivateRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('fanClubApplicationPrivate').doc(uid);

/** `artistPrivate/{id}`: as caixas do fã-clube (decisão 9) moram aqui. */
export const artistPrivateRef = (db: Firestore, artistId: string): DocumentReference =>
  db.collection('artistPrivate').doc(artistId);

/**
 * `users/{uid}/fanClubFollows/{clubId}`: o vínculo de seguir (decisões 26 a
 * 34). Nasce na etapa 4 de 34.14; a página e a lista do artista já leem o
 * `isFollowing` por ele.
 */
export const fanClubFollowRef = (db: Firestore, uid: string, clubId: string): DocumentReference =>
  db.collection('users').doc(uid).collection('fanClubFollows').doc(clubId);

/** `fanClubPosts/{postId}`: as publicações, fora de `posts/{id}` (decisão 17). */
export const fanClubPostsOf = (db: Firestore): CollectionReference => db.collection('fanClubPosts');

export const fanClubPostRef = (db: Firestore, postId: string): DocumentReference =>
  fanClubPostsOf(db).doc(postId);

/** `fanClubReports/{reporterUid}_{postId}`: a denúncia, fechada para todos (decisão 18). */
export const fanClubReportsOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubReports');

/** `fanClubReportQueue/{postId}`: a fila das denúncias de uma publicação, com a rodada. */
export const fanClubReportQueueRef = (db: Firestore, postId: string): DocumentReference =>
  db.collection('fanClubReportQueue').doc(postId);

/**
 * `users/{uid}/uploads/fanClubPost`: a vaga de envio da foto da publicação
 * (34.6), com os dois nomes e o prazo. Só o servidor grava; a regra do Storage
 * lê. Sai com o perfil, no `recursiveDelete` da exclusão.
 */
export const fanClubUploadSlotRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('users').doc(uid).collection('uploads').doc('fanClubPost');

/**
 * `users/{uid}/fanClubCredits/{artistId}`: o marcador do crédito de entrada,
 * uma vez por pessoa e artista (decisão 23). Sai com o perfil, no
 * `recursiveDelete` da exclusão.
 */
export const fanClubCreditRef = (db: Firestore, uid: string, artistId: string): DocumentReference =>
  db.collection('users').doc(uid).collection('fanClubCredits').doc(artistId);

/** `fanClubStats/{clubId}/fanClubShards`: os números do fã-clube em 16 shards (decisão 24). */
export const fanClubShardsOf = (db: Firestore, clubId: string): CollectionReference =>
  db.collection('fanClubStats').doc(clubId).collection('fanClubShards');

export const fanClubShardRef = (db: Firestore, clubId: string, shard: number): DocumentReference =>
  fanClubShardsOf(db, clubId).doc(String(shard));

/**
 * Os números a somar numa transação, por fã-clube (o link do convite e o
 * crédito podem ser de fã-clubes diferentes): uma gravação por fã-clube no
 * fim, pelo `writeFanClubCounts`.
 */
export type FanClubCountsDelta = Map<string, Partial<Record<FanClubCountField, number>>>;

/** Soma 1 num número do fã-clube, no que a transação vai gravar. */
export function addFanClubCount(
  delta: FanClubCountsDelta,
  clubId: string,
  field: FanClubCountField,
): void {
  const counts = delta.get(clubId) ?? {};
  counts[field] = (counts[field] ?? 0) + 1;
  delta.set(clubId, counts);
}

/**
 * Grava os números somados num shard de cada fã-clube, sem ler: `increment`
 * com `merge` (o documento nasce com a primeira soma) e o `updatedAt`. O shard
 * é o sorteio da transação (`award.shard`, de novo a cada tentativa) reduzido
 * aos 16 (`fanShardOf`), como o `fanCount` das centrais. Sem soma, nada.
 */
export function writeFanClubCounts(
  tx: Transaction,
  db: Firestore,
  delta: FanClubCountsDelta,
  shard: number,
  at: Timestamp,
): void {
  for (const [clubId, counts] of delta) {
    const fields: DocumentData = { updatedAt: at };
    for (const [field, value] of Object.entries(counts)) {
      if (value) fields[field] = FieldValue.increment(value);
    }
    tx.set(fanClubShardRef(db, clubId, fanShardOf(shard)), fields, { merge: true });
  }
}

/** Soma 1 num número só de um fã-clube (o link, a visita): o `writeFanClubCounts` de uma soma. */
export function writeFanClubCount(
  tx: Transaction,
  db: Firestore,
  clubId: string,
  field: FanClubCountField,
  shard: number,
  at: Timestamp,
): void {
  writeFanClubCounts(tx, db, new Map([[clubId, { [field]: 1 }]]), shard, at);
}

/** O marcador do crédito (decisão 23): quem trouxe, por onde e quando. */
export function writeFanClubCredit(
  tx: Transaction,
  db: Firestore,
  uid: string,
  credit: FanClubCredit,
  at: Timestamp,
): void {
  tx.create(fanClubCreditRef(db, uid, credit.artistId), {
    artistId: credit.artistId,
    clubId: credit.clubId,
    via: credit.via,
    at,
    schemaVersion: 1,
  });
}

/** As publicações de um autor, em qualquer status. Índice automático do `authorUid`. */
export const fanClubPostsOfAuthor = (db: Firestore, uid: string) =>
  fanClubPostsOf(db).where('authorUid', '==', uid);

/** O destaque desligado: a pausa, o encerramento, a suspensão e a lápide (decisão 35). */
export const FEATURE_OFF = {
  featured: false,
  featuredAt: null,
  featuredUntil: null,
  featuredBy: null,
} as const;

/**
 * Os fã-clubes ativos ou pausados de um artista, um basta: o `removeArtist`
 * recusa `has-content` com eles (34.14, etapa 1). Igualdade e `in`: a junção
 * dos índices de um campo atende.
 */
export const liveFanClubsOfArtist = (db: Firestore, artistId: string) =>
  fanClubsOf(db).where('artistId', '==', artistId).where('status', 'in', ['active', 'paused']);

/** A candidatura do fã lida na transação, ou null sem ela. */
async function readApplicationOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<ApplicationRecord | null> {
  const application = await tx.get(applicationRef(db, uid));
  return application.exists ? applicationRecord(uid, application.data() ?? {}) : null;
}

/** O fã-clube da candidatura aprovada, se ele ainda é do fã; null sem ele. */
async function readClubOfApplication(
  tx: Transaction,
  db: Firestore,
  application: ApplicationRecord | null,
): Promise<{ ref: DocumentReference; record: FanClubRecord } | null> {
  if (application?.status !== 'approved' || application.clubId === null) return null;
  const club = await tx.get(fanClubRef(db, application.clubId));
  if (!club.exists) return null;
  const record = fanClubRecord(club.id, club.data() ?? {});
  return record.ownerUid === application.uid ? { ref: club.ref, record } : null;
}

/**
 * O fã-clube da candidatura aprovada do fã, na transação de quem chama: a
 * candidatura e, com o `clubId`, o fã-clube, se ele ainda é do fã. Só
 * leituras (quem chama grava depois de ler tudo).
 */
export async function readOwnClubOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<{ ref: DocumentReference; record: FanClubRecord } | null> {
  return readClubOfApplication(tx, db, await readApplicationOf(tx, db, uid));
}

/**
 * O fã-clube ativo do fã, para a suspensão pausar (decisão 33). Null sem
 * fã-clube ativo dele.
 */
export async function readActiveClubOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<{ ref: DocumentReference; clubId: string } | null> {
  const own = await readOwnClubOf(tx, db, uid);
  if (own === null || own.record.status !== 'active') return null;
  return { ref: own.ref, clubId: own.record.id };
}

/**
 * O WhatsApp é exigido agora (decisão 14): com a candidatura pendente (ele é
 * obrigatório nela, e a aprovação não o confere) ou com o fã-clube ativo ou
 * pausado (é o canal dos prêmios). O `PUT /me/contact` recusa apagar com
 * `contact_required`. Uma leitura com a pendente, até duas com a aprovada; a
 * transação que aprova grava a candidatura lida aqui, e uma das duas repete.
 */
export async function contactRequired(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<boolean> {
  const application = await readApplicationOf(tx, db, uid);
  if (application?.status === 'pending') return true;
  const own = await readClubOfApplication(tx, db, application);
  return own !== null && isLiveFanClub(own.record.status);
}

/** A pausa pela suspensão do gestor (decisão 33): `paused`, o motivo, a data e o destaque fora. */
export function pauseForSuspension(tx: Transaction, ref: DocumentReference, at: Timestamp): void {
  tx.update(ref, {
    status: 'paused',
    statusReason: 'suspended',
    pausedAt: at,
    ...FEATURE_OFF,
    updatedAt: at,
  });
}

/** As cópias do perfil que o fã-clube e a candidatura guardam (o nome, o @ e a foto). */
export type OwnerCopies = { name: string | null; username: string | null; photoURL: string | null };

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export function ownerCopiesOf(profile: DocumentData): OwnerCopies {
  return {
    name: textOrNull(profile.displayName),
    username: textOrNull(profile.username),
    photoURL: textOrNull(profile.photoURL),
  };
}

/** Os fã-clubes de um gestor, em qualquer status (a lápide já não tem dono). Índice automático. */
export const fanClubsOfOwner = (db: Firestore, uid: string) =>
  fanClubsOf(db).where('ownerUid', '==', uid);

/** Publicações por página (e por transação) nas cópias do autor (34.5). */
export const POST_COPIES_PAGE = 100;

/**
 * As cópias do perfil na candidatura, nos fã-clubes e nas publicações do fã
 * (34.5, a tarefa `syncFanProfile`): primeiro uma transação que lê o perfil,
 * a candidatura e os fã-clubes dele (o de agora e os encerrados, que o painel
 * ainda lista) e regrava o `fan*` da candidatura e o `owner*` de cada
 * fã-clube só quando diferem; depois o `author*` das publicações dele, em
 * páginas de 100, cada uma numa transação que relê o perfil. Sem o perfil (a
 * exclusão da conta no meio), não grava. Devolve quantos documentos regravou.
 */
export async function syncFanClubCopies(db: Firestore, uid: string): Promise<number> {
  const written = await syncOwnerCopies(db, uid);
  return written === null ? 0 : written + (await syncPostCopies(db, uid));
}

/** O `author*` das publicações do fã, em páginas pela ordem do id; o perfil apagado no meio para. */
async function syncPostCopies(db: Firestore, uid: string): Promise<number> {
  const query = fanClubPostsOfAuthor(db, uid)
    .orderBy(FieldPath.documentId())
    .limit(POST_COPIES_PAGE);
  let written = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const cursor: QueryDocumentSnapshot | null = last;
    const page = await db.runTransaction(async (tx) => {
      const profile = await tx.get(db.collection('users').doc(uid));
      if (!profile.exists) return null;
      const snap: QuerySnapshot = await tx.get(cursor ? query.startAfter(cursor) : query);
      const copies = ownerCopiesOf(profile.data() ?? {});
      let count = 0;
      for (const post of snap.docs) {
        const data = post.data();
        if (
          (data.authorName ?? null) === copies.name &&
          (data.authorUsername ?? null) === copies.username &&
          (data.authorPhotoURL ?? null) === copies.photoURL
        ) {
          continue;
        }
        tx.update(post.ref, {
          authorName: copies.name,
          authorUsername: copies.username,
          authorPhotoURL: copies.photoURL,
        });
        count += 1;
      }
      return { size: snap.size, last: snap.docs[snap.docs.length - 1] ?? null, count };
    });
    if (page === null) return written;
    written += page.count;
    last = page.last;
    if (page.size < POST_COPIES_PAGE) return written;
  }
}

/** A candidatura e os fã-clubes do fã, numa transação; null sem o perfil. */
async function syncOwnerCopies(db: Firestore, uid: string): Promise<number | null> {
  return db.runTransaction(async (tx) => {
    const [profile, application] = await tx.getAll(
      db.collection('users').doc(uid),
      applicationRef(db, uid),
    );
    if (!profile!.exists) return null;
    const clubs = await tx.get(fanClubsOfOwner(db, uid));
    const copies = ownerCopiesOf(profile!.data() ?? {});
    let written = 0;
    const app = application!.exists ? (application!.data() ?? {}) : null;
    if (
      app !== null &&
      ((app.fanName ?? null) !== copies.name ||
        (app.fanUsername ?? null) !== copies.username ||
        (app.fanPhotoURL ?? null) !== copies.photoURL)
    ) {
      tx.update(application!.ref, {
        fanName: copies.name,
        fanUsername: copies.username,
        fanPhotoURL: copies.photoURL,
      });
      written += 1;
    }
    for (const club of clubs.docs) {
      const data = club.data();
      if (
        (data.ownerName ?? null) === copies.name &&
        (data.ownerUsername ?? null) === copies.username &&
        (data.ownerPhotoURL ?? null) === copies.photoURL
      ) {
        continue;
      }
      tx.update(club.ref, {
        ownerName: copies.name,
        ownerUsername: copies.username,
        ownerPhotoURL: copies.photoURL,
      });
      written += 1;
    }
    return written;
  });
}
