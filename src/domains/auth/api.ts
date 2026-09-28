import { FirebaseError } from 'firebase/app';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';

import type { TranslationKey } from '@/i18n';
import { getFirebaseAuth, isFirebaseConfigured } from '@/services/firebase';
import type { SessionUser } from '@/stores/session';

export function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

/**
 * Métodos de entrada ainda em aberto: o protótipo pede Apple e celular, e o
 * Firebase está com e-mail/senha e link por e-mail. E-mail e senha ficam como
 * base até a decisão.
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(getFirebaseAuth());
}

/** Avisa a cada mudança de sessão. Sem Firebase configurado, responde "deslogado". */
export function listenToAuth(callback: (user: SessionUser | null) => void): () => void {
  if (!isFirebaseConfigured) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(getFirebaseAuth(), (user) =>
    callback(user ? toSessionUser(user) : null),
  );
}

export function authErrorMessageKey(error: unknown): TranslationKey {
  if (!(error instanceof FirebaseError)) return 'auth.errors.unknown';
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'auth.errors.invalidCredentials';
    case 'auth/too-many-requests':
      return 'auth.errors.tooManyRequests';
    case 'auth/network-request-failed':
      return 'auth.errors.network';
    default:
      return 'auth.errors.unknown';
  }
}
