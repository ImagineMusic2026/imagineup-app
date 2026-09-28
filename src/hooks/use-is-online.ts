import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

const subscribe = (callback: () => void): (() => void) => onlineManager.subscribe(callback);
const getSnapshot = (): boolean => onlineManager.isOnline();

/** Mesmo sinal de conexão que o React Query usa para pausar e retomar. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
