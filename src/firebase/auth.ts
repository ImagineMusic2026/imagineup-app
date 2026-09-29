import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';

import { firebaseEmulatorHost } from '@/config/env';

import { getFirebaseApp } from './config';

let auth: Auth | null = null;

/** Auth com a sessão salva no aparelho, para o fã não precisar entrar de novo. */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const app = getFirebaseApp();
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
    if (firebaseEmulatorHost) {
      connectAuthEmulator(auth, `http://${firebaseEmulatorHost}:9099`, { disableWarnings: true });
    }
  } catch {
    // Fast Refresh: o Auth já tinha sido inicializado neste app.
    auth = getAuth(app);
  }
  auth.languageCode = 'pt-BR';
  return auth;
}
