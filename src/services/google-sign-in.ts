import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { firebaseEnv, googleWebClientId } from '@/config/env';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

export type GoogleSignInFailure = 'unavailable' | 'playServices' | 'noIdToken';

export class GoogleSignInError extends Error {
  constructor(readonly reason: GoogleSignInFailure) {
    super(`Entrar com Google: ${reason}`);
    this.name = 'GoogleSignInError';
  }
}

export interface GoogleIdToken {
  idToken: string;
  email: string;
}

export function isGoogleSignInAvailable(): boolean {
  return Platform.OS === 'android' && !!firebaseEnv && !!googleWebClientId && !isRunningInExpoGo();
}

let loaded: GoogleSignInModule | null = null;

function loadGoogle(): GoogleSignInModule | null {
  if (!isGoogleSignInAvailable()) return null;
  if (loaded) return loaded;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo Go não inclui o módulo nativo.
  const google = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  google.GoogleSignin.configure({ webClientId: googleWebClientId });
  loaded = google;
  return google;
}

export async function googleIdToken(): Promise<GoogleIdToken | null> {
  const google = loadGoogle();
  if (!google) throw new GoogleSignInError('unavailable');

  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = google;
  try {
    const ready = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    if (!ready) throw new GoogleSignInError('playServices');

    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;

    const { idToken, user } = response.data;
    if (!idToken) throw new GoogleSignInError('noIdToken');
    return { idToken, email: user.email };
  } catch (error) {
    if (!isErrorWithCode(error)) throw error;
    switch (error.code) {
      case statusCodes.SIGN_IN_CANCELLED:
      case statusCodes.IN_PROGRESS:
        return null;
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        throw new GoogleSignInError('playServices');
      default:
        throw error;
    }
  }
}

export async function signOutGoogle(): Promise<void> {
  try {
    await loadGoogle()?.GoogleSignin.signOut();
  } catch {
    // A sessão do Firebase já foi encerrada.
  }
}

export async function revokeGoogleAccess(): Promise<void> {
  try {
    await loadGoogle()?.GoogleSignin.revokeAccess();
  } catch {
    // A exclusão da conta já foi confirmada pelo Firebase.
  }
  await signOutGoogle();
}
