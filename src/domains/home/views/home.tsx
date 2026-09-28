import { FlashList } from '@shopify/flash-list';
import { StyleSheet, View } from 'react-native';

import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useFeedQuery, type Post } from '@/domains/posts';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { GreetingHeader } from '../components/greeting-header';

/**
 * 1b. O feed é uma FlashList só, com saudação, missão do dia e centrais no
 * header. Cada tipo de post vira um `getItemType` quando os cards entrarem.
 */
export function HomeScreen() {
  const bottomInset = useTabBarInset();
  const feed = useFeedQuery();
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen padded={false}>
      <FlashList<Post>
        data={posts}
        keyExtractor={(post) => post.id}
        renderItem={({ item }) => (
          <Text variant="body" style={styles.item}>
            {item.text}
          </Text>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <GreetingHeader />
            <Placeholder designRef="1b" />
          </View>
        }
        ListEmptyComponent={
          <Text variant="body" color={colors.textMuted} style={styles.empty}>
            {t('home.feedEmpty')}
          </Text>
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.sectionTop,
  },
  item: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.itemGap,
  },
  empty: {
    paddingHorizontal: spacing.gutter,
  },
});
