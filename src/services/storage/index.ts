import AsyncStorage from '@react-native-async-storage/async-storage';

import { StorageKeys } from './keys';

/**
 * AsyncStorage em vez de MMKV por enquanto: roda no Expo Go, que é o único jeito
 * de testar no iPhone enquanto não há conta Apple nem Mac. Trocar por MMKV é
 * mudar só este arquivo.
 */
async function getJSON<T>(key: StorageKeys): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
}

async function setJSON<T>(key: StorageKeys, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function remove(key: StorageKeys): Promise<void> {
  await AsyncStorage.removeItem(key);
}

export const storage = { getJSON, setJSON, remove };

export { StorageKeys };
