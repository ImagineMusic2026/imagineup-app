import { AccessibilityInfo } from 'react-native';

import { useFollowArtistsMutation } from '@/domains/artists';
import { playStackExit } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';

/**
 * Fim da 1l: segue as centrais escolhidas e, só depois de a API confirmar,
 * apaga a escolha de artistas até o fundo escuro e marca o onboarding como
 * concluído. Quem troca para as abas é o guard; a troca de grupo na pilha raiz
 * é seca, por isso a saída em fade vem antes. O botão segue "salvando" até o
 * fim, e um toque a mais não segue de novo.
 */
export function useFinishOnboarding() {
  return useFollowArtistsMutation({
    onFollowed: async () => {
      haptics.trigger('confirm');
      await playStackExit('onboarding');
      usePreferencesStore.getState().completeOnboarding();
    },
    onError: () => {
      haptics.trigger('error');
      // O erro aparece acima do botão; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t('onboarding.chooseArtists.saveError'));
    },
  });
}
