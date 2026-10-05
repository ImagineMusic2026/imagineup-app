import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';

import { reportId } from './model';

// Onde mora a moderação do bloco 6: as denúncias, a fila da seção Moderação e
// as listas de bloqueio, que a API, o painel e a exclusão de conta usam.
// docs/arquitetura-api.md, 21.3.

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
