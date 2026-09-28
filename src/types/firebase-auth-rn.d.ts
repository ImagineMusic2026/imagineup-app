import type { Persistence } from 'firebase/auth';

// `getReactNativePersistence` existe no build react-native do @firebase/auth,
// mas os tipos públicos não o declaram.
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
