import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';

// Onde as mensagens do Suporte moram (docs/arquitetura-api.md, seção 38,
// 38.4): `supportMessages/{id}`, uma por envio, com o id automático. Só o
// servidor grava (a rota e a callable); a seção `support` do painel lê.

export function supportMessagesRef(db: Firestore): CollectionReference {
  return db.collection('supportMessages');
}

export function supportMessageRef(db: Firestore, id: string): DocumentReference {
  return supportMessagesRef(db).doc(id);
}
