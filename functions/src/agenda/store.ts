import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';

import { eventRecord, type EventRecord } from './model';

// Onde mora a agenda (bloco 6): os caminhos dos shows e das presenças, que a
// agenda, o mural (o post de show) e a exclusão de conta usam.
// docs/arquitetura-api.md, 21.3.

export function eventsRef(db: Firestore): CollectionReference {
  return db.collection('events');
}

export function eventRef(db: Firestore, eventId: string): DocumentReference {
  return eventsRef(db).doc(eventId);
}

/** As presenças do fã (com o estado): users/{uid}/eventRsvps. */
export function rsvpsRef(db: Firestore, uid: string): CollectionReference {
  return db.collection('users').doc(uid).collection('eventRsvps');
}

export function rsvpRef(db: Firestore, uid: string, eventId: string): DocumentReference {
  return rsvpsRef(db, uid).doc(eventId);
}

export function eventOf(snap: DocumentSnapshot | undefined): EventRecord | null {
  return snap?.exists ? eventRecord(snap.id, snap.data() ?? {}) : null;
}
