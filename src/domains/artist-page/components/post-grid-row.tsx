import { router } from 'expo-router';
import { CalendarDays, Play } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { PhotoFallback, RemoteImage } from '@/components/remote-image';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import type { Post } from '@/domains/posts';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing } from '@/theme';

import { GRID_COLUMNS } from '../consts';
import { postCellLabel } from '../describe';

const TEXT_LINES = 4;
const PLAY_ICON_SIZE = 16;
const PLAY_BADGE_SIZE = 28;
const SHOW_ICON_SIZE = 20;
const SKELETON_ROWS = 2;

function openPost(postId: string): void {
  router.push({ pathname: '/post/[postId]', params: { postId } });
}

/** O que a célula mostra: a mídia, o bloco ciano do show ou o começo do texto. */
function CellContent({ post }: { post: Post }) {
  if (post.media) {
    return (
      <>
        <RemoteImage
          uri={post.media.thumbnailUrl}
          fallback={{ kind: 'brand', seed: post.id }}
          style={StyleSheet.absoluteFill}
        />
        {post.kind === 'video' ? (
          <View style={styles.play}>
            <Icon icon={Play} size={PLAY_ICON_SIZE} color={colors.text} />
          </View>
        ) : null}
      </>
    );
  }
  if (post.event) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.show]}>
        <PhotoFallback seed={post.id} variant="events" stripes={null} />
        <Icon icon={CalendarDays} size={SHOW_ICON_SIZE} color={colors.events} />
        <Text variant="thumbLabel" color={colors.events}>
          {t('post.show')}
        </Text>
      </View>
    );
  }
  // Por dentro da célula: padding no pressável somaria à largura dele na linha.
  return (
    <View style={[StyleSheet.absoluteFill, styles.textCell]}>
      <Text variant="bodyXs" color={colors.textBody} numberOfLines={TEXT_LINES}>
        {post.text}
      </Text>
    </View>
  );
}

export interface PostGridRowProps {
  /** Até três posts; a última linha da grade pode vir incompleta. */
  posts: readonly Post[];
  now: Date;
}

/**
 * Uma linha da grade de posts da central (1d): três células na proporção do
 * protótipo (118,7 x 104), cada uma abre o post (fora das abas, por cima da
 * tab bar). Post sem mídia mostra o começo do texto; vídeo leva o play; show,
 * o bloco ciano da agenda. Cada célula é um alvo só, lido com o autor, a hora
 * e o texto. Os lugares vazios da última linha seguram a largura das outras.
 */
export function PostGridRow({ posts, now }: PostGridRowProps) {
  const empty = Math.max(0, GRID_COLUMNS - posts.length);
  return (
    <View style={styles.row}>
      {posts.map((post) => (
        <PressableScale
          key={post.id}
          onPress={() => openPost(post.id)}
          accessibilityLabel={postCellLabel(post, now)}
          testID={`artist-post-${post.id}`}
          style={styles.cell}
        >
          <CellContent post={post} />
        </PressableScale>
      ))}
      {Array.from({ length: empty }, (_, index) => (
        <View key={`empty-${index}`} testID="artist-post-slot" style={styles.slot} />
      ))}
    </View>
  );
}

/** A grade chegando: duas linhas de células escuras. */
export function PostGridSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('artist.posts.loading')} style={styles.skeleton}>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: GRID_COLUMNS }, (_, column) => (
            <View key={column} style={styles.slot}>
              <Skeleton tone="raised" height="100%" radius={radii.xxs} />
            </View>
          ))}
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.iconLabelGap,
    paddingHorizontal: spacing.gutter,
  },
  cell: {
    flex: 1,
    aspectRatio: layout.gridCellAspect,
    borderRadius: radii.xxs,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  textCell: {
    padding: spacing.listGap,
    borderRadius: radii.xxs,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  slot: {
    flex: 1,
    aspectRatio: layout.gridCellAspect,
  },
  play: {
    position: 'absolute',
    top: spacing.xs + spacing.xxs,
    right: spacing.xs + spacing.xxs,
    width: PLAY_BADGE_SIZE,
    height: PLAY_BADGE_SIZE,
    borderRadius: PLAY_BADGE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassDark,
  },
  show: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  skeleton: {
    gap: spacing.iconLabelGap,
  },
});
