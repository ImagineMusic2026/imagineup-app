import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';

import { profileReportId, reportId } from './model';

// Onde mora a moderação do bloco 6: as denúncias, a fila da seção Moderação e
// as listas de bloqueio, que a API, o painel e a exclusão de conta usam.
// docs/arquitetura-api.md, 21.3. Desde as exigências das lojas (seção 29,
// 29.3), a denúncia de perfil, com a fila dela numa coleção separada.

export function reportsRef(db: Firestore): CollectionReference {
  return db.collection('commentReports');
}

/** A denúncia de um fã a um comentário: uma por fã e comentário. */
export function reportRef(
  db: Firestore,
  commentId: string,
  reporterUid: string,
): DocumentReference {
  return reportsRef(db).doc(reportId(commentId, reporterUid));
}

export function queueRef(db: Firestore): CollectionReference {
  return db.collection('moderationQueue');
}

/** O item da fila de um comentário denunciado (o id do comentário é único no banco). */
export function queueItemRef(db: Firestore, commentId: string): DocumentReference {
  return queueRef(db).doc(commentId);
}

export function blockListsRef(db: Firestore): CollectionReference {
  return db.collection('blockLists');
}

/** Quem este fã bloqueou. Só o servidor lê. */
export function blockListRef(db: Firestore, uid: string): DocumentReference {
  return blockListsRef(db).doc(uid);
}

/** As denúncias de perfil (seção 29): só o servidor lê e grava. */
export function profileReportsRef(db: Firestore): CollectionReference {
  return db.collection('profileReports');
}

/** A denúncia de um fã a um perfil: uma por alvo e fã, regravada a cada rodada. */
export function profileReportRef(
  db: Firestore,
  targetUid: string,
  reporterUid: string,
): DocumentReference {
  return profileReportsRef(db).doc(profileReportId(targetUid, reporterUid));
}

/**
 * A fila das denúncias de perfil (29.3), separada da `moderationQueue`: o
 * painel publicado lê post e comentário de todo item daquela fila.
 */
export function profileQueueRef(db: Firestore): CollectionReference {
  return db.collection('profileReportQueue');
}

/** O item da fila de um fã denunciado (o id é o uid dele). */
export function profileQueueItemRef(db: Firestore, uid: string): DocumentReference {
  return profileQueueRef(db).doc(uid);
}
