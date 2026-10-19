import type {
  DocumentReference,
  Firestore,
  Timestamp,
  Transaction,
} from 'firebase-admin/firestore';

import type { FanContact } from '../api/contract';
import { contactWhatsapp, type ContactSource } from './model';

// Onde o contato do fã mora (seção 35): `users/{uid}/contact/main`, debaixo do
// perfil, para o `recursiveDelete` da exclusão de conta o levar junto. As
// regras fecham a subcoleção para todos, até para o próprio fã e para a
// equipe: o fã lê e troca o número pelo `GET` e o `PUT /me/contact`, e a
// equipe o vê pelo `getRedemptionContacts`.

/** O id do documento único do contato. */
export const FAN_CONTACT_DOC_ID = 'main';

export function fanContactRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('users').doc(uid).collection('contact').doc(FAN_CONTACT_DOC_ID);
}

/** O documento gravado (34.4): o número (`null` depois que o fã apaga), onde foi gravado e quando. */
export function fanContactDoc(
  whatsapp: string | null,
  source: ContactSource,
  at: Timestamp,
): { whatsapp: string | null; source: ContactSource; updatedAt: Timestamp } {
  return { whatsapp, source, updatedAt: at };
}

/**
 * Grava o contato na transação de quem chama, sem ler antes: o resgate
 * (`source: 'store'`) e o `PUT /me/contact` (`'app'`); com a seção 34, a
 * candidatura (`'fanclub'`). O `merge` não apaga campo que outra seção
 * acrescente ao documento.
 */
export function writeFanContact(
  tx: Transaction,
  db: Firestore,
  uid: string,
  whatsapp: string | null,
  source: ContactSource,
  at: Timestamp,
): void {
  tx.set(fanContactRef(db, uid), fanContactDoc(whatsapp, source, at), { merge: true });
}

/** `GET /me/contact`: o número guardado, ou `null`. Uma leitura. */
export async function readFanContact(db: Firestore, uid: string): Promise<FanContact> {
  const snap = await fanContactRef(db, uid).get();
  return { whatsapp: contactWhatsapp(snap.data()) };
}
