import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

import { firebaseEmulatorHost } from '@/config/env';

import { getFirebaseApp } from './config';

let db: Firestore | null = null;

/**
 * Firestore `(default)` do projeto imagine-up-app, em southamerica-east1. No SDK JS
 * o cache do Firestore fica só em memória no React Native; o offline do app vem
 * do cache persistido do React Query.
 */
export function getDb(): Firestore {
  if (db) return db;
  db = getFirestore(getFirebaseApp());
  if (firebaseEmulatorHost) {
    try {
      connectFirestoreEmulator(db, firebaseEmulatorHost, 8080);
    } catch {
      // Fast Refresh: o Firestore deste app já estava ligado ao emulador.
    }
  }
  return db;
}
