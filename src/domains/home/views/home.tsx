import { FlashList } from '@shopify/flash-list';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { useFanCentralsQuery } from '@/domains/artists';
import { DailyMissionSection, useDailyMissionQuery } from '@/domains/missions';
import { PostDivider, PostRow, PostRowsSkeleton, useFeedQuery, type Post } from '@/domains/posts';
import { useWatchMyProfile } from '@/domains/profile';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { CentralsSection } from '../components/centrals-carousel';
import { HomeHeader } from '../components/home-header';
import { useAnnounceWhen } from '../hooks/use-announce-when';
import { useHomeRefresh } from '../hooks/use-home-refresh';

/** Tipos de célula da FlashList: cada um reaproveita só células do mesmo desenho. */
function postItemType(post: Post): 'event' | 'media' | 'text' {
  if (post.event) return 'event';
  return post.media ? 'media' : 'text';
}

/** Tudo o que vem antes do mural, de ponta a ponta (o carrossel sai da margem). */
function HomeListHeader() {
  return (
    <View>
      <HomeHeader />
      <DailyMissionSection style={styles.mission} />
      <CentralsSection />
      <SectionHeader title={t('home.feed.title')} style={styles.feedTitle} />
    </View>
  );
}

type FeedState = 'loading' | 'error' | 'empty';

function FeedPlaceholder({
  state,
  retrying,
  onRetry,
}: {
  state: FeedState;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (state === 'loading') return <PostRowsSkeleton accessibilityLabel={t('home.feed.loading')} />;
  if (state === 'error') {
    return (
      <EmptyState
        tone="error"
        message={t('home.feed.loadError')}
        onAction={onRetry}
        actionLoading={retrying}
      />
    );
  }
  return <EmptyState message={t('home.feedEmpty')} />;
}

/**
 * Pé do mural: a próxima página chegando ou, com posts na tela, a busca que
 * falhou (a página seguinte ou a de puxar para atualizar), com "Tentar de novo".
 */
function FeedFooter({
  feed,
  hasPosts,
}: {
  feed: ReturnType<typeof useFeedQuery>;
  hasPosts: boolean;
}) {
  if (feed.isError && hasPosts) {
    return (
      <EmptyState
        tone="error"
        message={t('home.feed.updateError')}
        onAction={() => void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())}
        actionLoading={feed.isFetching}
      />
    );
  }
  if (feed.isFetchingNextPage) {
    return <ActivityIndicator color={colors.textMuted} style={styles.nextPage} />;
  }
  return null;
}

/**
 * As falhas de carga da home anunciadas num lugar só, cada uma quando passa a
 * aparecer: a busca de novo (com o botão ocupado) não repete o anúncio.
 */
function useAnnounceHomeFailures(postCount: number): void {
  const mission = useDailyMissionQuery();
  const centrals = useFanCentralsQuery();
  const feed = useFeedQuery();

  const settled = (query: { isError: boolean; isFetching: boolean }) =>
    query.isError && !query.isFetching;
  useAnnounceWhen(settled(mission) && mission.data === undefined, t('missions.daily.loadError'));
  useAnnounceWhen(settled(centrals) && centrals.data === undefined, t('home.centrals.loadError'));
  // Sem posts, o erro ocupa o mural; com posts, ele aparece no pé da lista.
  useAnnounceWhen(settled(feed) && postCount === 0, t('home.feed.loadError'));
  useAnnounceWhen(settled(feed) && postCount > 0, t('home.feed.updateError'));
}

/**
 * 1b. Home gamificada: saudação com o avatar, missão do dia, "Suas centrais"
 * e o mural "Do seu fandom", numa FlashList só que rola junto. O header e o
 * mural passam por baixo da tab bar. Puxar para baixo atualiza tudo.
 */
export function HomeScreen() {
  const bottomInset = useTabBarInset();
  useWatchMyProfile();
  const feed = useFeedQuery();
  const { refreshing, refresh } = useHomeRefresh();
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const feedState: FeedState = feed.isPending ? 'loading' : feed.isError ? 'error' : 'empty';
  useAnnounceHomeFailures(posts.length);

  return (
    <Screen padded={false} contentStyle={styles.screen}>
      <FlashList<Post>
        data={posts}
        keyExtractor={(post) => post.id}
        getItemType={postItemType}
        renderItem={({ item }) => <PostRow post={item} />}
        ItemSeparatorComponent={PostDivider}
        ListHeaderComponent={<HomeListHeader />}
        ListEmptyComponent={
          <FeedPlaceholder
            state={feedState}
            retrying={feed.isFetching}
            onRetry={() => void feed.refetch()}
          />
        }
        ListFooterComponent={<FeedFooter feed={feed} hasPosts={posts.length > 0} />}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceRaised}
          />
        }
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  mission: {
    marginTop: spacing.metaGap,
  },
  feedTitle: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.listGap,
  },
  nextPage: {
    paddingVertical: spacing.lg,
  },
});
