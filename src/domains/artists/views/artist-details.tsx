import { useLocalSearchParams } from 'expo-router';

import { BackHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';

/**
 * 1d. Rota compartilhada: abre dentro da aba de onde veio (Início, Explorar ou
 * Perfil) e mantém a tab bar. A capa colapsável e as abas internas (Mural,
 * Missões, Agenda, Ranking) entram com a tela real.
 */
export function ArtistDetailsScreen() {
  const { artistaId } = useLocalSearchParams<{ artistaId: string }>();
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <BackHeader title={t('artist.title')} />
      <Placeholder designRef={`1d · ${artistaId ?? ''}`} />
    </Screen>
  );
}
