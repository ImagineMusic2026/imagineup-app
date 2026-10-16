import { setVideoCacheSizeAsync } from 'expo-video';

import '@/providers/app-providers';
import { configureVideoCache, VIDEO_CACHE_BYTES } from '@/services/video-cache';

/**
 * O teto do cache de vídeo pedido pelo `AppProviders` (seção 33 de
 * docs/arquitetura-api.md, decisão 20): uma vez, no carregamento do módulo,
 * antes de qualquer player (o `expo-video` recusa com um player vivo). Aqui o
 * serviço é o de verdade, sobre o `setVideoCacheSizeAsync` do expo-video falso
 * do `jest.setup.js`; os imports do módulo rodam antes de qualquer teste.
 */

// O build do Firebase que o Jest resolve é ESM: os domínios que o módulo
// registra chegam a ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: false,
}));
// Sem o aviso do `env.ts` real, que o Jest carregaria sem o .env.
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
  googleWebClientId: undefined,
}));
jest.mock('@/services/video-cache', () => {
  const actual =
    jest.requireActual<typeof import('@/services/video-cache')>('@/services/video-cache');
  return { ...actual, configureVideoCache: jest.fn(actual.configureVideoCache) };
});

// O que o carregamento do módulo fez, lido antes de qualquer teste.
const atLoad = {
  configured: jest.mocked(configureVideoCache).mock.calls.length,
  cacheSizes: jest.mocked(setVideoCacheSizeAsync).mock.calls.map(([bytes]) => bytes),
  players: jest.requireMock<{ mockPlayers: unknown[] }>('expo-video').mockPlayers.length,
};

describe('AppProviders e o cache de vídeo', () => {
  it('pede o teto de 200 MB uma vez, ao carregar o módulo, sem player nenhum', () => {
    expect(atLoad.configured).toBe(1);
    expect(atLoad.cacheSizes).toEqual([VIDEO_CACHE_BYTES]);
    expect(VIDEO_CACHE_BYTES).toBe(200 * 1024 * 1024);
    expect(atLoad.players).toBe(0);
  });
});
