import { router } from 'expo-router';
import { ChevronRight, Heart, Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { ListRow } from '@/components/list-row';
import { SectionLabel } from '@/components/section-label';
import {
  hasNewPrize,
  liveFanClub,
  settingsRowOf,
  shownFanClub,
  useMyFanClubQuery,
} from '@/domains/fan-club';
import { t } from '@/i18n';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';

const TRAILING_ICON_SIZE = 18;

/**
 * O bloco "Fã-clube" dos Ajustes (seção 34, 34.9, item 1), entre o Perfil e a
 * Conta: a linha "Tenha seu fã-clube" (ou "Meu fã-clube", com o fã-clube
 * aprovado), com a meta do estado, que abre o "/meu-fa-clube", e embaixo a
 * entrada fixa "Fã-clubes que sigo" (item 10). Nada aparece sem a resposta do
 * servidor novo: com a `api` de antes da publicação (o 404) ou sem resposta,
 * os Ajustes ficam como eram. A linha "Tenha seu fã-clube" só aparece com o
 * programa aberto ou com candidatura (decisão 9); "Fã-clubes que sigo" fica
 * também com o programa fechado, porque os fã-clubes que existem continuam.
 * "Novo prêmio" vale até o gestor abrir o "Meu fã-clube" (decisão 51), só
 * depois de o aparelho ler a marca de visto.
 */
export function FanClubSection() {
  const query = useMyFanClubQuery();
  const live = liveFanClub(query.data, query.error);
  const mine = shownFanClub(query.data, query.error);
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  const seenAt = useFanClubPrizeStore((state) => (uid ? state.seen[uid] : undefined));
  const hydrated = useFanClubPrizeStore((state) => state.hydrated);
  if (!live) return null;

  const row = mine ? settingsRowOf(mine, hydrated && hasNewPrize(mine.club, seenAt)) : null;
  const title = row ? t(row.titleKey) : '';
  const meta = row ? t(row.metaKey, row.artist ? { artist: row.artist } : undefined) : '';
  const chevron = <Icon icon={ChevronRight} size={TRAILING_ICON_SIZE} color={colors.textMuted} />;

  return (
    <>
      <SectionLabel>{t('fanClub.settings.section')}</SectionLabel>
      <View style={styles.rows}>
        {row ? (
          <ListRow
            leading={<IconTile icon={Users} tone="glass" />}
            title={title}
            meta={meta}
            trailing={chevron}
            onPress={() => router.push('/meu-fa-clube')}
            accessibilityLabel={`${title}. ${meta}`}
            accessibilityHint={t('fanClub.settings.hint')}
            testID="settings-fan-club"
          />
        ) : null}
        <ListRow
          leading={<IconTile icon={Heart} tone="glass" />}
          title={t('fanClub.follows.title')}
          meta={t('fanClub.follows.settingsMeta')}
          trailing={chevron}
          onPress={() => router.push('/fa-clubes-que-sigo')}
          accessibilityLabel={`${t('fanClub.follows.title')}. ${t('fanClub.follows.settingsMeta')}`}
          accessibilityHint={t('fanClub.follows.settingsHint')}
          testID="settings-fan-club-follows"
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing.listGap,
  },
});
