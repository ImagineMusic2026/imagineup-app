import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { signOutGoogle } from '@/services/google-sign-in';

import { signOut } from '../api';
import { clearHandedOffEmail } from '../email-handoff';

/**
 * Sai da conta neste aparelho: esquece o e-mail guardado para o login (o da
 * troca de e-mail, seção 29, frente D, ainda não entra antes de o fã abrir o
 * link), sai do Google no aparelho, para o seletor de contas aparecer na
 * próxima vez (seção 33, decisão 10; sem esperar e sem lançar), e sai do
 * Firebase. A Apple não tem sair. O último jeito de entrar fica no aparelho.
 */
export function signOutOfApp(): Promise<void> {
  clearHandedOffEmail();
  void signOutGoogle();
  return signOut();
}

/**
 * Sair da conta (Ajustes). Quem limpa o resto é o listener do Auth, como em
 * toda sessão que termina: as abas saem em fade, o cache do React Query vai
 * embora (também o do disco), o uid da última sessão é esquecido, e só então
 * o guard leva à entrada. Não passa pela fila offline: sair funciona sem rede.
 */
export function useSignOut() {
  return useMutation<void, Error, void>({
    mutationFn: signOutOfApp,
    networkMode: 'always',
    retry: false,
    onError: () => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('settings.signOutError'));
    },
  });
}
