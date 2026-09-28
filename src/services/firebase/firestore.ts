import { getFirestore, type Firestore } from 'firebase/firestore';

import { getFirebaseApp } from './app';

/**
 * Firestore `(default)` do projeto imagine-up, em southamerica-east1. No SDK JS
 * o cache do Firestore fica só em memória no React Native; o offline do app vem
 * do cache persistido do React Query.
 */
export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}
