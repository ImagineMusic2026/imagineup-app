import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

let configured = false;

/**
 * Liga o React Query ao aparelho: sem internet, consultas e mutações ficam
 * pausadas (e o cache salvo continua na tela); ao voltar para o app, o que
 * estiver velho é buscado de novo.
 */
export function setupReactQueryForReactNative(): () => void {
  if (configured) return () => undefined;
  configured = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );

  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
  });

  return () => {
    subscription.remove();
    configured = false;
  };
}
