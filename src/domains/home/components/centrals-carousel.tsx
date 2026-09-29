import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { SectionHeader } from '@/components/section-header';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import {
  CentralCard,
  useCentralCardMetrics,
  useFanCentralsQuery,
  type FanCentral,
} from '@/domains/artists';
import { t } from '@/i18n';
import { colors, motion, radii, spacing } from '@/theme';

const SKELETON_CARDS = 3;
const JOIN_ICON_SIZE = 22;

function CarouselGap() {
  return <View style={styles.gap} />;
}

function CentralsSkeleton() {
  const card = useCentralCardMetrics();
  return (
    <SkeletonGroup accessibilityLabel={t('home.centrals.loading')} style={styles.skeletonRow}>
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <Skeleton key={index} height={card.minHeight} width={card.width} radius={radii.lg} />
      ))}
    </SkeletonGroup>
  );
}

/** Sem central (raro: a 1l pede 3), um alvo tracejado que leva à aba Explorar. */
function JoinCentralCard() {
  const card = useCentralCardMetrics();
  return (
    <View style={styles.padded}>
      <Card
        variant="dashed"
        onPress={() => router.navigate('/explorar')}
        accessibilityLabel={t('home.centrals.join')}
        style={[styles.joinCard, { width: card.width, minHeight: card.minHeight }]}
      >
        <Icon icon={Plus} size={JOIN_ICON_SIZE} color={colors.textSecondary} />
        <Text variant="labelCompact" color={colors.textSecondary} style={styles.joinLabel}>
          {t('home.centrals.join')}
        </Text>
      </Card>
    </View>
  );
}

/**
 * A FlashList horizontal só sabe a própria altura depois de medir os cards: no
 * primeiro quadro ela teria altura zero, e o mural subiria e desceria de volta.
 * O piso da altura do card segura a faixa desde o primeiro quadro.
 */
function Carousel({ centrals }: { centrals: FanCentral[] }) {
  const card = useCentralCardMetrics();
  return (
    <Animated.View
      entering={FadeIn.duration(motion.duration.base)}
      style={{ minHeight: card.minHeight }}
    >
      <FlashList<FanCentral>
        horizontal
        data={centrals}
        keyExtractor={(central) => central.artistId}
        renderItem={({ item }) => <CentralCard central={item} />}
        ItemSeparatorComponent={CarouselGap}
        contentContainerStyle={styles.carousel}
        showsHorizontalScrollIndicator={false}
        // Encaixa um card por vez ao soltar o dedo: largura do card mais o vão.
        snapToInterval={card.width + spacing.gridGap}
        decelerationRate="fast"
      />
    </Animated.View>
  );
}

/**
 * "Suas centrais" (1b): cabeçalho com "Ver todas" (leva ao Perfil, onde a 1e
 * lista todas as centrais) e o carrossel de ponta a ponta, com a margem de 18
 * dentro da rolagem.
 */
export function CentralsSection() {
  const centrals = useFanCentralsQuery();

  // A busca de novo que falha com as centrais na tela mantém o carrossel.
  let content;
  if (centrals.isPending) {
    content = <CentralsSkeleton />;
  } else if (centrals.data === undefined) {
    content = (
      <EmptyState
        tone="error"
        message={t('home.centrals.loadError')}
        onAction={() => void centrals.refetch()}
        actionLoading={centrals.isFetching}
      />
    );
  } else if (centrals.data.length === 0) {
    content = <JoinCentralCard />;
  } else {
    content = <Carousel centrals={centrals.data} />;
  }

  return (
    <View>
      <SectionHeader
        title={t('home.centrals.title')}
        action={{
          label: t('home.centrals.seeAll'),
          accessibilityLabel: t('home.centrals.seeAllLabel'),
          onPress: () => router.navigate('/perfil'),
        }}
        style={styles.padded}
      />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  padded: {
    paddingHorizontal: spacing.gutter,
  },
  carousel: {
    paddingHorizontal: spacing.gutter,
  },
  gap: {
    width: spacing.gridGap,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.gridGap,
    paddingHorizontal: spacing.gutter,
    overflow: 'hidden',
  },
  joinCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  joinLabel: {
    textAlign: 'center',
  },
});
