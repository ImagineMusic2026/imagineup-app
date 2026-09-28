import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

import { firebaseEnv } from '@/config/env';

export const isFirebaseConfigured = firebaseEnv !== null;

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
    projectId: firebaseEnv.firebaseProjectId,
    storageBucket: firebaseEnv.firebaseStorageBucket,
    messagingSenderId: firebaseEnv.firebaseMessagingSenderId,
    appId: firebaseEnv.firebaseAppId,
  });
}
