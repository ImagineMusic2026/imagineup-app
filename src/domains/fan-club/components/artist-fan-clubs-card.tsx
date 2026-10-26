import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { t } from '@/i18n';
import { layout, radii, spacing, typography } from '@/theme';

import { useArtistFanClubsQuery, useFanClubGate } from '../queries';
import { fanClubHref } from '../share';
import type { FanClubCard } from '../types';
import { FanClubRow } from './fan-club-row';

/** O card mostra até 3: os destacados primeiro, depois os mais seguidos (a ordem do servidor). */
const CARD_CLUBS = 3;
// O link de 44 fica no meio da linha do título, sem esticá-la (como os top fãs).
const LINK_OUTSET = (layout.minTouchTarget - typography.micro.lineHeight) / 2;

export interface ArtistFanClubsCardProps {
  artistId: string;
  /** O nome da central, para o "Ver todos" dizer de quem; `null` enquanto ela chega. */
  artistName: string | null;
}

/**
 * O card "Fã-clubes" da página do artista (34.9, item 8), no cabeçalho da 1d,
 * depois do botão da central, no molde do card dos top fãs: até 3 fã-clubes,
 * o oficial com o selo ao lado do nome (34.23), e "Ver todos", que abre a
 * lista paginada na pilha da aba. Só depois da trava; some sem fã-clube,
 * enquanto a lista chega e quando a consulta falha: o resto da página
 * continua. O conteúdo de fã nunca entra no Mural, na grade nem no `/feed`.
 */
export function ArtistFanClubsCard({ artistId, artistName }: ArtistFanClubsCardProps) {
  const { live } = useFanClubGate();
  const query = useArtistFanClubsQuery(artistId, live !== null);
  const clubs = query.data?.pages[0]?.items.slice(0, CARD_CLUBS) ?? [];
  if (live === null || clubs.length === 0) return null;

  const openClub = (club: FanClubCard): void => {
    router.push(fanClubHref(club.id));
  };

  return (
    <View style={styles.wrap}>
      <Card style={styles.card} testID="artist-fan-clubs">
        <View style={styles.header}>
          {/* Caixa alta no texto, não no estilo: no Android o textTransform mede a
              linha em minúsculas e corta o fim dela. */}
          <Text
            variant="chip"
            accessibilityRole="header"
            accessibilityLabel={t('fanClub.artistCard.title')}
            style={styles.title}
          >
            {t('fanClub.artistCard.title').toUpperCase()}
          </Text>
          <TextLink
            label={t('fanClub.artistCard.seeAll')}
            textVariant="micro"
            accessibilityLabel={
              artistName
                ? t('fanClub.artistCard.seeAllLabel', { artist: artistName })
                : t('fanClub.artistCard.seeAll')
            }
            accessibilityHint={t('fanClub.artistCard.seeAllHint')}
            onPress={() =>
              router.push({
                pathname: '/fa-clubes-do-artista/[artistaId]',
                params: { artistaId: artistId },
              })
            }
            style={styles.link}
            testID="artist-fan-clubs-see-all"
          />
        </View>
        <View style={styles.rows}>
          {clubs.map((club) => (
            <FanClubRow
              key={club.id}
              club={club}
              onPress={openClub}
              testID={`artist-fan-club-${club.id}`}
            />
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: spacing.cardPadding,
    paddingBottom: spacing.sm,
  },
  card: {
    marginHorizontal: spacing.gutter,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  // Com flexShrink, o Android media o título mais estreito do que desenha e cortava a última palavra.
  title: {
    flex: 1,
  },
  link: {
    marginVertical: -LINK_OUTSET,
  },
  rows: {
    marginTop: spacing.md,
    gap: spacing.listGap,
  },
});
