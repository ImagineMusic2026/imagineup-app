import { isFirebaseConfigured } from '@/firebase';
import { isGoogleSignInAvailable } from '@/services/google-sign-in';

import { fillMissingProfileName } from '../api';
import { googleSignInErrorKey, signInWithGoogle } from '../google-entry';
import type { SocialProvider } from '../social-entry';
import { useSocialEntry, type SocialEntry } from './use-social-entry';

export type { SocialEntryOutcome as GoogleEntryOutcome } from './use-social-entry';

/** O Google no núcleo da entrada social: só no Android, fora do Expo Go (seção 39). */
const GOOGLE: SocialProvider = {
  signIn: signInWithGoogle,
  signingInKey: 'auth.google.signingIn',
  errorKey: googleSignInErrorKey,
  settleNewProfileName: (result, profile) =>
    fillMissingProfileName(result.user.uid, profile, result.profileName),
  logName: 'Google',
};

export function useGoogleEntry(): SocialEntry {
  return useSocialEntry(GOOGLE, isFirebaseConfigured && isGoogleSignInAvailable());
}
