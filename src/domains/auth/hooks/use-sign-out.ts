import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

import { signOut } from '../api';
import { clearHandedOffEmail } from '../email-handoff';

/**
 * Sair da conta (Ajustes). Quem limpa o resto é o listener do Auth, como em
 * toda sessão que termina: as abas saem em fade, o cache do React Query vai
 * embora (também o do disco), o uid da última sessão é esquecido, e só então
 * o guard leva à entrada. Não passa pela fila offline: sair funciona sem rede.
 *
 * Antes, esquece o e-mail guardado para o login: o da troca de e-mail
 * (seção 29, frente D) ainda não entra antes de o fã abrir o link.
 */
export function useSignOut() {
  return useMutation<void, Error, void>({
    mutationFn: () => {
      clearHandedOffEmail();
      return signOut();
    },
    networkMode: 'always',
    retry: false,
    onError: () => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('settings.signOutError'));
    },
  });
}
