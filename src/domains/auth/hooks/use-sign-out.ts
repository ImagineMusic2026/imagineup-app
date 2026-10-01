import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

import { signOut } from '../api';

/**
 * Sair da conta (Ajustes). Quem limpa o resto é o listener do Auth, como em
 * toda sessão que termina: as abas saem em fade, o cache do React Query vai
 * embora (também o do disco), o uid da última sessão é esquecido, e só então
 * o guard leva à entrada. Não passa pela fila offline: sair funciona sem rede.
 */
export function useSignOut() {
  return useMutation<void, Error, void>({
    mutationFn: () => signOut(),
    networkMode: 'always',
    retry: false,
    onError: () => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('settings.signOutError'));
    },
  });
}
