import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ListRow, type ListRowVariant } from '@/components/list-row';
import { Pill } from '@/components/pill';
import { t } from '@/i18n';
import { isLargeText, spacing } from '@/theme';

import { personName, postsCountText, roundFollowersText } from '../format';
import type { FanClubCard } from '../types';

export interface FanClubRowProps {
  club: FanClubCard;
  onPress: (club: FanClubCard) => void;
  /** `compact` no card da 1d; `card` na lista do "Ver todos". */
  variant?: ListRowVariant;
  testID?: string;
}

/**
 * Um fã-clube da lista do artista (34.9, item 8): o gestor, o nome, "por @x ·
 * N publicações · N seguidores" (os seguidores da cópia da noite,
 * arredondados) e as pílulas "Destaque" e "Seguindo". Um botão só, que abre a
 * página; o leitor ouve a faixa "não oficial" antes do nome, e as pílulas no
 * rótulo. Com a fonte grande, as pílulas descem para baixo do nome.
 */
export function FanClubRow({ club, onPress, variant = 'compact', testID }: FanClubRowProps) {
  const { fontScale } = useWindowDimensions();
  const owner = personName(club.owner);
  const posts = postsCountText(club.postCount);
  const followers = roundFollowersText(club.followers);
  const label = [
    t('fanClub.artistCard.rowLabel', { name: club.name, owner, followers, posts }),
    club.featured ? t('fanClub.artistCard.featuredLabel') : null,
    club.isFollowing ? t('fanClub.artistCard.followingLabel') : null,
  ]
    .filter(Boolean)
    .join(' ');
  const pills =
    club.featured || club.isFollowing ? (
      <View style={styles.pills}>
        {club.featured ? (
          <Pill label={t('fanClub.page.featured')} tone="accentStrong" size="xs" />
        ) : null}
        {club.isFollowing ? (
          <Pill label={t('fanClub.page.following')} tone="neutral" size="xs" />
        ) : null}
      </View>
    ) : undefined;

  const common = {
    variant,
    leading: (
      <Avatar name={club.owner.name} id={club.owner.uid} photoUrl={club.owner.photoURL} size="sm" />
    ),
    title: club.name,
    meta: t('fanClub.artistCard.rowMeta', { owner, posts, followers }),
    onPress: () => onPress(club),
    accessibilityHint: t('fanClub.artistCard.hint'),
    testID,
  } as const;

  return pills ? (
    <ListRow
      {...common}
      trailing={pills}
      trailingPlacement={isLargeText(fontScale) ? 'below' : 'end'}
      accessibilityLabel={label}
    />
  ) : (
    <ListRow {...common} accessibilityLabel={label} />
  );
}

const styles = StyleSheet.create({
  pills: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
});
