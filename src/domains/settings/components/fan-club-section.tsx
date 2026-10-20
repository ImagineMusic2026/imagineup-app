import { router } from 'expo-router';
import { ChevronRight, Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { ListRow } from '@/components/list-row';
import { SectionLabel } from '@/components/section-label';
import { hasNewPrize, settingsRowOf, useShownFanClub } from '@/domains/fan-club';
import { t } from '@/i18n';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';

const TRAILING_ICON_SIZE = 18;

/**
 * O bloco "Fã-clube" dos Ajustes (seção 34, 34.9, item 1), entre o Perfil e a
 * Segurança: a linha "Tenha seu fã-clube" (ou "Meu fã-clube", com o fã-clube
 * aprovado), com a meta do estado, que abre o "/meu-fa-clube". Só aparece com
 * o programa aberto ou com candidatura (decisão 9), e nunca sem a resposta do
 * servidor novo: com a `api` de antes da publicação (o 404), sem resposta ou
 * com o programa fechado para quem nunca se candidatou, os Ajustes ficam como
 * eram. "Novo prêmio" vale até o gestor abrir o "Meu fã-clube" (decisão 51),
 * só depois de o aparelho ler a marca de visto.
 */
export function FanClubSection() {
  const { mine } = useShownFanClub();
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  const seenAt = useFanClubPrizeStore((state) => (uid ? state.seen[uid] : undefined));
  const hydrated = useFanClubPrizeStore((state) => state.hydrated);
  if (!mine) return null;

  const row = settingsRowOf(mine, hydrated && hasNewPrize(mine.club, seenAt));
  const title = t(row.titleKey);
  const meta = t(row.metaKey, row.artist ? { artist: row.artist } : undefined);

  return (
    <>
      <SectionLabel>{t('fanClub.settings.section')}</SectionLabel>
      <View style={styles.rows}>
        <ListRow
          leading={<IconTile icon={Users} tone="glass" />}
          title={title}
          meta={meta}
          trailing={<Icon icon={ChevronRight} size={TRAILING_ICON_SIZE} color={colors.textMuted} />}
          onPress={() => router.push('/meu-fa-clube')}
          accessibilityLabel={`${title}. ${meta}`}
          accessibilityHint={t('fanClub.settings.hint')}
          testID="settings-fan-club"
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
