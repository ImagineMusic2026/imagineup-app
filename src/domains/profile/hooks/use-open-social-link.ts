import { useState } from 'react';
import { Linking } from 'react-native';

import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';

/**
 * Abre o link de uma rede fora do app (`Linking.openURL`, que cai no app da
 * rede quando instalado). A falha liga o `failed`, para quem mostra pôr o
 * aviso "Não deu para abrir o link." embaixo, anunciado, com o toque de erro;
 * a tentativa seguinte o apaga.
 */
export function useOpenSocialLink(): { open: (url: string) => void; failed: boolean } {
  const [failed, setFailed] = useState(false);
  useAnnounceWhen(failed, t('fanProfile.openError'));

  const open = (url: string): void => {
    setFailed(false);
    Linking.openURL(url).catch(() => {
      haptics.trigger('error');
      setFailed(true);
    });
  };

  return { open, failed };
}
