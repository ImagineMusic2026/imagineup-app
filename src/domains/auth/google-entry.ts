import { FirebaseError } from 'firebase/app';
import {
  getAdditionalUserInfo,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  type OAuthCredential,
  type User,
} from 'firebase/auth';

import { getFirebaseAuth } from '@/firebase';
import type { TranslationKey } from '@/i18n';
import { GoogleSignInError, googleIdToken, signOutGoogle } from '@/services/google-sign-in';

import { SessionEndedError } from './api';

type GooglePasswordLink = { email: string; credential: OAuthCredential };
let pendingLink: GooglePasswordLink | null = null;
let linkCleanup: Promise<void> | undefined;

export type GoogleSignInResult =
  | { kind: 'signedIn'; user: User; isNewUser: boolean }
  | { kind: 'link'; email: string };

export function forgetPendingGoogleLink(): void {
  if (!pendingLink) return;
  pendingLink = null;
  linkCleanup = signOutGoogle();
}

export async function signInWithGoogle(): Promise<GoogleSignInResult | null> {
  forgetPendingGoogleLink();
  await linkCleanup;
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  if (auth.currentUser) throw new SessionEndedError('A entrada já foi concluída.');

  const google = await googleIdToken();
  if (!google) return null;
  const credential = GoogleAuthProvider.credential(google.idToken);

  try {
    if (auth.currentUser) throw new SessionEndedError('A entrada já foi concluída.');
    const result = await signInWithCredential(auth, credential);
    return {
      kind: 'signedIn',
      user: result.user,
      isNewUser: getAdditionalUserInfo(result)?.isNewUser === true,
    };
  } catch (error) {
    if (
      error instanceof FirebaseError &&
      error.code === 'auth/account-exists-with-different-credential'
    ) {
      // O token fica na memória até confirmar a senha da conta existente.
      pendingLink = { email: google.email.trim().toLowerCase(), credential };
      return { kind: 'link', email: google.email };
    }
    await signOutGoogle();
    throw error;
  }
}

export type GoogleLinkOutcome = 'linked' | 'failed';

/** Liga a credencial pendente à conta que o Firebase acabou de autenticar com senha. */
export async function linkPendingGoogle(user: User): Promise<GoogleLinkOutcome | null> {
  const link = pendingLink;
  pendingLink = null;
  if (!link) return null;
  if (
    user.email?.trim().toLowerCase() !== link.email ||
    getFirebaseAuth().currentUser?.uid !== user.uid
  ) {
    void signOutGoogle();
    return 'failed';
  }
  try {
    await linkWithCredential(user, link.credential);
    return 'linked';
  } catch {
    void signOutGoogle();
    return 'failed';
  }
}

export function googleSignInErrorKey(error: unknown): TranslationKey {
  if (error instanceof GoogleSignInError) {
    return error.reason === 'playServices'
      ? 'auth.google.errors.playServices'
      : 'auth.google.errors.unavailable';
  }
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/operation-not-allowed':
      case 'auth/invalid-credential':
        return 'auth.google.errors.unavailable';
      case 'auth/network-request-failed':
        return 'auth.errors.network';
      case 'auth/too-many-requests':
        return 'auth.errors.tooManyRequests';
    }
  }
  return 'auth.google.errors.unknown';
}
