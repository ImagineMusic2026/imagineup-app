import { router } from 'expo-router';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { SectionHeader } from '@/components/section-header';
import { useFanCentralsQuery } from '@/domains/artists';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { t } from '@/i18n';
import { spacing } from '@/theme';

import { useFanClubFeedQuery, useFanClubGate, useShareFanClub } from '../queries';
import { fanClubHref } from '../share';
import type { FanClubPost } from '../types';
import { FanClubPostCard } from './club-post-card';

// O cartão deixa à vista um pedaço do seguinte, que diz que a fileira rola.
const PEEK = 40;
const CARD_MAX_WIDTH = 320;
const SCROLL_THROTTLE = 64;

/**
 * "Dos seus fã-clubes" da Início (34.9, item 9, e decisão 30): entre as Suas
 * centrais e o título do mural, as publicações no ar dos fã-clubes que o fã
 * segue, numa fileira que rola de lado, de ponta a ponta (10 por página: a
 * seguinte chega perto do fim). Só depois da trava e só com publicação:
 * carregando, sem nada ou com a consulta falhando, nada aparece, e o mural
 * continua. Cada cartão tem o nome do fã-clube, com o selo do oficial (que
 * abre a página), o Compartilhar e o Denunciar (a mesma sheet da página),
 * como a App Store 1.2 e o Google Play pedem junto do conteúdo. O `/feed`
 * oficial não muda.
 */
export function FanClubFeedSection() {
  const { live } = useFanClubGate();
  const feed = useFanClubFeedQuery(live !== null);
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  if (live === null || posts.length === 0) return null;
  return <FeedCarousel feed={feed} posts={posts} />;
}

/**
 * A fileira, só depois da trava e com publicação: o compartilhar (com o código
 * de convite, `GET /me/invite`) mora aqui, para nada sair antes da abertura.
 */
function FeedCarousel({
  feed,
  posts,
}: {
  feed: ReturnType<typeof useFanClubFeedQuery>;
  posts: FanClubPost[];
}) {
  const { width } = useWindowDimensions();
  const now = useNow();
  const share = useShareFanClub();
  const centrals = useFanCentralsQuery();
  useAnnounceWhen(feed.isFetchNextPageError && !feed.isFetching, t('fanClub.feed.moreError'));
  const cardWidth = Math.min(width - spacing.gutter * 2 - PEEK, CARD_MAX_WIDTH);
  // O artista da mensagem de compartilhar, das centrais do fã (seguir faz entrar
  // nelas); sem ele, a mensagem sai sem o artista.
  const artistName = (artistId: string): string | null =>
    centrals.data?.find((central) => central.artistId === artistId)?.name ?? null;

  const loadMoreNearEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const nearEnd = contentOffset.x + layoutMeasurement.width >= contentSize.width - cardWidth;
    if (nearEnd && feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) {
      void feed.fetchNextPage({ cancelRefetch: false });
    }
  };

  const openReport = (post: FanClubPost): void => {
    router.push({
      pathname: '/denunciar-publicacao/[publicacaoId]',
      params: { publicacaoId: post.id },
    });
  };

  return (
    <View testID="home-fan-club-feed">
      <SectionHeader title={t('fanClub.feed.title')} style={styles.padded} />
      <ScrollView
        horizontal
        onScroll={loadMoreNearEnd}
        scrollEventThrottle={SCROLL_THROTTLE}
        contentContainerStyle={styles.carousel}
        showsHorizontalScrollIndicator={false}
        testID="home-fan-club-feed-list"
      >
        {posts.map((item) => (
          <FanClubPostCard
            key={item.id}
            post={item}
            now={now}
            variant="feed"
            canReport
            onShare={(post) =>
              share({ id: post.clubId, name: post.clubName, artistName: artistName(post.artistId) })
            }
            onReport={openReport}
            onOpenClub={(post) => router.push(fanClubHref(post.clubId))}
            style={{ width: cardWidth }}
            testID={`home-fan-club-post-${item.id}`}
          />
        ))}
      </ScrollView>
      {feed.isFetchNextPageError ? (
        <EmptyState
          tone="error"
          message={t('fanClub.feed.moreError')}
          onAction={() => void feed.fetchNextPage({ cancelRefetch: false })}
          actionLoading={feed.isFetchingNextPage}
          style={styles.padded}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  padded: {
    paddingHorizontal: spacing.gutter,
  },
  carousel: {
    gap: spacing.gridGap,
    paddingHorizontal: spacing.gutter,
    // Os cartões da fileira ficam com a altura de cada um, sem esticar.
    alignItems: 'flex-start',
  },
});
