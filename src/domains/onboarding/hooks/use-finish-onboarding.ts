import { AccessibilityInfo } from 'react-native';

import { useFollowArtistsMutation } from '@/domains/artists';
import { playStackExit } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { isAccountSuspended } from '@/services/api/errors';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';

/** Apaga a escolha de artistas até o fundo escuro e conclui o onboarding. */
async function leaveOnboarding(): Promise<void> {
  await playStackExit('onboarding');
  usePreferencesStore.getState().completeOnboarding();
}

/**
 * Fim da 1l: segue as centrais escolhidas e, só depois de a API confirmar,
 * apaga a escolha de artistas até o fundo escuro e marca o onboarding como
 * concluído. Quem troca para as abas é o guard; a troca de grupo na pilha raiz
 * é seca, por isso a saída em fade vem antes. O botão segue "salvando" até o
 * fim, e um toque a mais não segue de novo.
 *
 * A conta suspensa (403 `account_suspended`, num aparelho novo) conclui o
 * onboarding sem seguir, como no sucesso e sem pontos: antes, a 1l prendia o
 * suspenso. Quem explica é o `Alert` "Conta suspensa" do `SuspensionWatcher`
 * (seção 29, frente E). Os outros erros dizem a frase da recusa (o teto do
 * dia de entrar, o ritmo) ou a genérica, acima do botão.
 */
export function useFinishOnboarding() {
  return useFollowArtistsMutation({
    onFollowed: async () => {
      haptics.trigger('confirm');
      await leaveOnboarding();
    },
    onError: (error) => {
      if (isAccountSuspended(error)) {
        void leaveOnboarding();
        return;
      }
      haptics.trigger('error');
      // O erro aparece acima do botão; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(actionRefusal(error, 'follow').key));
    },
  });
}
