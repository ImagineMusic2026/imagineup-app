import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { artistKeys, type ArtistDetails } from '@/domains/artists';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, radii, spacing } from '@/theme';

import { FanClubRow } from '../components/fan-club-row';
import { isDefinitiveRefusal } from '../entry';
import { useArtistFanClubsQuery, useFanClubGate } from '../queries';
import { fanClubHref } from '../share';
import type { FanClubCard } from '../types';

const SKELETON_ROWS = 3;
const SKELETON_ROW_HEIGHT = 64;

function ItemGap() {
  return <View style={styles.gap} />;
}

function openClub(club: FanClubCard): void {
  router.push(fanClubHref(club.id));
}

/**
 * "Fã-clubes do artista" (`/fa-clubes-do-artista/[artistaId]`, 34.9, item 8):
 * o "Ver todos" do card da 1d, na pilha da aba de onde veio, como a central. A
 * lista paginada do `GET /artists/:artistId/fan-clubs` (20 por página, os
 * destacados primeiro), com o selo ao lado do nome dos oficiais (34.23).
 * Inerte antes da abertura: sem a resposta da trava, diz que o fã-clube não
 * está disponível e não chama mais nada.
 */
export function ArtistFanClubsScreen() {
  const params = useLocalSearchParams<{ artistaId: string }>();
  const artistId = typeof params.artistaId === 'string' ? params.artistaId : '';
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const { query: gate, live } = useFanClubGate();
  const query = useArtistFanClubsQuery(artistId, live !== null);
  // O nome do artista no subtítulo: da central em cache (a 1d abriu a lista),
  // sem buscar; a frio, o subtítulo sai sem o nome.
  const client = useQueryClient();
  const name = client.getQueryData<ArtistDetails>(artistKeys.detail(artistId))?.name;
  const clubs = query.data?.pages.flatMap((page) => page.items) ?? [];
  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && query.data === undefined, t('fanClub.artistCard.listError'));
  useAnnounceWhen(settled && query.isFetchNextPageError, t('fanClub.artistCard.listMoreError'));
  const failed = live === null && gate.isError && !isDefinitiveRefusal(gate.error);
  useAnnounceWhen(focused && failed && !gate.isFetching, t('fanClub.loadError'));

  let empty;
  if (live === null) {
    empty = gate.isPending ? (
      <ListSkeleton />
    ) : failed ? (
      <EmptyState
        tone="error"
        message={t('fanClub.loadError')}
        onAction={() => void gate.refetch()}
        actionLoading={gate.isFetching}
      />
    ) : (
      <View testID="fan-club-not-available">
        <EmptyState message={t('fanClub.notAvailable')} />
      </View>
    );
  } else if (query.isPending) {
    empty = <ListSkeleton />;
  } else if (query.data === undefined) {
    empty = (
      <EmptyState
        tone="error"
        message={t('fanClub.artistCard.listError')}
        onAction={() => void query.refetch()}
        actionLoading={query.isFetching}
      />
    );
  } else if (!query.isFetchNextPageError) {
    empty = <EmptyState message={t('fanClub.artistCard.listEmpty')} />;
  }

  return (
    <Screen contentStyle={styles.screen}>
      <FlashList<FanClubCard>
        data={live === null ? [] : clubs}
        keyExtractor={(club) => club.id}
        renderItem={({ item }) => (
          <FanClubRow
            club={item}
            onPress={openClub}
            variant="card"
            testID={`artist-fan-club-${item.id}`}
          />
        )}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <View style={live === null ? undefined : styles.header}>
            <LargeTitleHeader
              title={t('fanClub.artistCard.listTitle')}
              subtitle={
                live === null
                  ? undefined
                  : name
                    ? t('fanClub.artistCard.listSubtitle', { artist: name })
                    : t('fanClub.artistCard.listSubtitleNoName')
              }
              showBack
            />
          </View>
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          query.isFetchNextPageError ? (
            <EmptyState
              tone="error"
              message={t('fanClub.artistCard.listMoreError')}
              onAction={() => void query.fetchNextPage({ cancelRefetch: false })}
              actionLoading={query.isFetchingNextPage}
            />
          ) : query.isFetchingNextPage ? (
            <ActivityIndicator color={colors.textMuted} style={styles.nextPage} />
          ) : null
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
            void query.fetchNextPage({ cancelRefetch: false });
          }
        }}
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
        testID="artist-fan-clubs-list"
      />
    </Screen>
  );
}

function ListSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('fanClub.artistCard.listLoading')} style={styles.skeleton}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} height={SKELETON_ROW_HEIGHT} radius={radii.lg} />
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  header: {
    marginBottom: spacing.md,
  },
  gap: {
    height: spacing.listGap,
  },
  skeleton: {
    gap: spacing.listGap,
    marginTop: spacing.lg,
  },
  nextPage: {
    paddingVertical: spacing.lg,
  },
});
