import { router } from 'expo-router';
import { Eye, Share2 } from 'lucide-react-native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { BackButton, HeaderIconButton } from '@/components/header';
import { Pill } from '@/components/pill';
import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { colors, isLargeText, layout, spacing } from '@/theme';

import { useShareFanClub } from '../queries';
import { fanClubHref } from '../share';
import type { FanClubStatus, MyFanClubClub } from '../types';
import { ClubMark } from './club-mark';
import { ClubName } from './club-name';

const STATUS_TEXTS: Record<FanClubStatus, TranslationKey> = {
  active: 'fanClub.mine.status.active',
  paused: 'fanClub.mine.status.paused',
  closed: 'fanClub.mine.status.closed',
};

/**
 * O cabeçalho do modo gestor (o Claude Design aprovado em 26/10/2026), fixo
 * em cima das quatro abas: o voltar, o ícone quadrado de iniciais, o nome com
 * o selo do oficial (34.23) e, embaixo, o selo "Gestor", o artista e o status.
 * O nome, o artista e o status são um foco só, com o papel de cabeçalho; o
 * ícone e o selo "Gestor" são desenho. À direita, só com o fã-clube no ar,
 * "Compartilhar meu fã-clube" e o olho, que abre a página como os fãs a veem.
 * Com a fonte grande, os dois botões descem para baixo do nome.
 */
export function ManagerHeader({ club }: { club: MyFanClubClub }) {
  const share = useShareFanClub();
  const large = isLargeText(useWindowDimensions().fontScale);
  const status = t(STATUS_TEXTS[club.status]);

  const actions = club.available ? (
    <View style={styles.actions}>
      <HeaderIconButton
        icon={Share2}
        onPress={() => share(club)}
        accessibilityLabel={t('fanClub.mine.share')}
        accessibilityHint={t('fanClub.mine.shareHint')}
        testID="fan-club-share"
      />
      <HeaderIconButton
        icon={Eye}
        onPress={() => router.push(fanClubHref(club.id))}
        accessibilityLabel={t('fanClub.mine.preview')}
        accessibilityHint={t('fanClub.mine.previewHint')}
        testID="fan-club-preview"
      />
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <BackButton />
        <ClubMark name={club.name} />
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={t(
            club.official ? 'fanClub.mine.headerOfficialLabel' : 'fanClub.mine.headerLabel',
            { name: club.name, artist: club.artistName, status },
          )}
          style={styles.texts}
          testID="fan-club-header"
        >
          <ClubName name={club.name} official={club.official} variant="button" badgeSize={14} />
          <View style={styles.meta}>
            <Pill label={t('fanClub.manager.badge')} tone="points" size="xs" caps />
            <Text variant="caption" color={colors.textMuted} style={styles.metaText}>
              {t('fanClub.manager.headerMeta', { artist: club.artistName, status })}
            </Text>
          </View>
        </View>
        {large ? null : actions}
      </View>
      {large && actions ? <View style={styles.below}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Com a fonte grande, o nome fica alto: a folga de cima o afasta da barra de status.
  root: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.xxs,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xxs,
    marginTop: spacing.xs,
  },
  metaText: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  below: {
    alignItems: 'flex-end',
  },
});
