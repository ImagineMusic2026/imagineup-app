import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

import { EMULATOR_PROJECT_ID, firebaseEmulatorHost, firebaseEnv } from '@/config/env';

export const isFirebaseConfigured = firebaseEnv !== null;

/**
 * Com os emuladores, o app usa o projeto demo dos scripts (`npm run emulators`):
 * o que não estiver emulado falha, em vez de cair no imagine-up-app de verdade.
 */
export { EMULATOR_PROJECT_ID };

/**
 * SDK JS do Firebase (não o @react-native-firebase): funciona no Expo Go, que é
 * como o iPhone vai ser testado até existir conta Apple. Inicialização
 * preguiçosa e segura para Fast Refresh.
 */
export function getFirebaseApp(): FirebaseApp {
  if (!firebaseEnv) {
    throw new Error('Firebase sem configuração. Preencha o .env a partir do .env.example.');
  }
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: firebaseEnv.firebaseApiKey,
    authDomain: firebaseEnv.firebaseAuthDomain,
    projectId: firebaseEmulatorHost ? EMULATOR_PROJECT_ID : firebaseEnv.firebaseProjectId,
    storageBucket: firebaseEnv.firebaseStorageBucket,
    messagingSenderId: firebaseEnv.firebaseMessagingSenderId,
    appId: firebaseEnv.firebaseAppId,
  });
}
