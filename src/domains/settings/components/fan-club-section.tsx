import { router } from 'expo-router';
import { Heart, Users } from 'lucide-react-native';

import { liveFanClub, settingsRowOf, shownFanClub, useMyFanClubQuery } from '@/domains/fan-club';
import { t } from '@/i18n';

import { MenuRow, MenuSection } from './menu';

/**
 * O bloco "Fã-clube" dos Ajustes (seção 34, 34.9, item 1), entre o "Perfil e
 * conta" e a "Privacidade e segurança", no molde do menu de referência do
 * dono, só com os títulos: a linha "Tenha seu fã-clube" (ou "Meu fã-clube",
 * com o fã-clube aprovado), que abre o "/meu-fa-clube", e embaixo a entrada
 * fixa "Fã-clubes que sigo" (item 10). Nada aparece sem a resposta do
 * servidor novo: com a `api` de antes da publicação (o 404) ou sem resposta,
 * os Ajustes ficam como eram. A linha "Tenha seu fã-clube" só aparece com o
 * programa aberto ou com candidatura (decisão 9); "Fã-clubes que sigo" fica
 * também com o programa fechado, porque os fã-clubes que existem continuam.
 * Desde 26/10/2026 a linha não mostra mais o estado embaixo ("Candidatura em
 * análise", "Novo prêmio"): o estado fica na tela que ela abre.
 */
export function FanClubSection() {
  const query = useMyFanClubQuery();
  const live = liveFanClub(query.data, query.error);
  const mine = shownFanClub(query.data, query.error);
  if (!live) return null;

  // O título não depende do prêmio: só a meta, que a linha não mostra.
  const title = mine ? t(settingsRowOf(mine, false).titleKey) : null;

  return (
    <MenuSection title={t('fanClub.settings.section')}>
      {title ? (
        <MenuRow
          icon={Users}
          title={title}
          trailing="chevron"
          onPress={() => router.push('/meu-fa-clube')}
          accessibilityHint={t('fanClub.settings.hint')}
          testID="settings-fan-club"
        />
      ) : null}
      <MenuRow
        icon={Heart}
        title={t('fanClub.follows.title')}
        trailing="chevron"
        onPress={() => router.push('/fa-clubes-que-sigo')}
        accessibilityHint={t('fanClub.follows.settingsHint')}
        testID="settings-fan-club-follows"
      />
    </MenuSection>
  );
}
