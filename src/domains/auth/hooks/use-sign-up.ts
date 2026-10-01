import { useMutation } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import {
  authErrorMessageKey,
  claimPendingInvite,
  fillMissingProfileName,
  signUpWithEmail,
  waitForProfile,
} from '../api';
import type { SignUpForm } from '../schemas';
import { playAuthExit } from './use-auth-exit';

/**
 * Cadastro por e-mail e senha:
 * 1. cria a conta e põe o nome nela logo em seguida (a função de cadastro lê
 *    o nome atual da conta para gerar o @);
 * 2. espera o perfil (`users/{uid}`) nascer, com prazo; se ele nasceu sem
 *    nome (o nome chegou depois da espera da função), grava o nome da sessão
 *    nele, sem esperar a gravação;
 * 3. apaga as telas de conta em fade e solta o fã;
 * 4. manda o convite guardado, se houver, já sem segurar o fã.
 *
 * A conta nasce logada no passo 1, e o guard tiraria a tela na hora: o
 * `holdAuth` segura o fã fora até o passo 3. Quem troca para a escolha de
 * artistas é o guard, quando ele solta.
 */
export function useSignUp() {
  return useMutation<void, Error, SignUpForm>({
    mutationFn: async (form) => {
      const release = useSessionStore.getState().holdAuth();
      try {
        const user = await signUpWithEmail(form);
        // Conta nova nunca escolheu artistas, mesmo que outra conta já tenha
        // concluído a escolha neste aparelho (o "concluído" fica no aparelho).
        usePreferencesStore.getState().resetOnboarding();
        // O listener de sessão já pode ter gravado a conta sem nome; o nome
        // novo vale para as telas desde já.
        useSessionStore.getState().setSignedIn(user);
        const profile = await waitForProfile(user.uid);
        // Sem await: a falha (ou a falta de rede) não segura nem derruba o cadastro.
        void fillMissingProfileName(user.uid, profile, user.displayName).catch((error: unknown) => {
          if (__DEV__) console.warn('[auth] O nome não foi para o perfil no cadastro.', error);
        });
        haptics.trigger('success');
        await playAuthExit();
      } finally {
        release();
      }
      // Fora da espera: o fã já segue para a 1l enquanto o convite vai à API.
      void claimPendingInvite().catch(() => undefined);
    },
    onMutate: () => {
      AccessibilityInfo.announceForAccessibility(t('auth.signUp.creating'));
    },
    onError: (error) => {
      haptics.trigger('error');
      // O erro aparece embaixo do botão; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(authErrorMessageKey(error, 'signUp')));
    },
    // Criar a conta não entra na fila offline: sem rede, o erro aparece na hora.
    networkMode: 'always',
    retry: false,
  });
}
