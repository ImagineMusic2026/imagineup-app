import { router } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { PillButton } from '@/components/pill-button';
import { PressableScale } from '@/components/pressable-scale';
import { PhotoFallback, RemoteImage } from '@/components/remote-image';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { VerifiedBadge } from '@/components/verified-badge';
import { RsvpChip } from '@/domains/agenda';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing, typography } from '@/theme';
import { formatRelativeAgoSpoken, formatRelativeShort } from '@/utils/date';
import { formatCompact, formatNumber, formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import { useSharePost } from '../hooks/use-share-post';
import type { Post } from '../types';

// A partir daqui, a contagem vira "12 mil" para caber na pílula.
const COMPACT_FROM = 10_000;
const TEXT_LINES = 3;
const SHOW_ICON_SIZE = 22;

// A linha de pílulas cresce até o alvo de 44 com a pílula (23) no meio. A sobra
// em cima faz o vão até o texto (9 no protótipo, 10,5 aqui) e a de baixo entra
// nos 14 do fim da linha: o desenho fica igual e o toque chega a 44.
const PILL_HEIGHT = typography.chipSmall.lineHeight + spacing.xs * 2 + borderWidths.default * 2;
const CHIP_OUTSET = (layout.minTouchTarget - PILL_HEIGHT) / 2;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

function openPost(postId: string): void {
  router.push({ pathname: '/post/[postId]', params: { postId } });
}

function likesLabel(count: number): string {
  return count === 1 ? t('post.likesOne') : t('post.likes', { count: formatNumber(count) });
}

/** Miniatura: a mídia (placeholder de marca sem foto) ou, no post de show, o bloco ciano. */
function PostThumbnail({ post }: { post: Post }) {
  if (post.media) {
    return (
      <RemoteImage
        uri={post.media.thumbnailUrl}
        fallback={{ kind: post.kind === 'event' ? 'events' : 'brand', seed: post.id }}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return (
    <View style={styles.showTile}>
      <PhotoFallback seed={post.id} variant="events" stripes={null} />
      <Icon icon={CalendarDays} size={SHOW_ICON_SIZE} color={colors.events} />
      <Text variant="thumbLabel" color={colors.events}>
        {t('post.show')}
      </Text>
    </View>
  );
}

/**
 * `spokenTime` é o "há 2 horas" do post: com o autor, diz de qual post é cada
 * compartilhar, para os vários "Compartilhar" do mural não saírem iguais na
 * lista de botões do leitor de tela (o mesmo artista tem vários posts).
 */
function ShareChips({ post, spokenTime }: { post: Post; spokenTime: string }) {
  const share = useSharePost();
  // Sem pontos nas regras (ou zero), o chip não promete "+N".
  const points = post.sharePointsPerVisit ?? 0;
  const author = post.artist.name;
  const likes =
    post.likeCount >= COMPACT_FROM ? formatCompact(post.likeCount) : formatNumber(post.likeCount);

  return (
    <>
      <PillButton
        label={
          points > 0 ? t('post.share', { points: formatPointsDelta(points) }) : t('post.sharePlain')
        }
        accessibilityLabel={
          points > 0
            ? t('post.shareLabel', { author, time: spokenTime, points: formatPointsSpoken(points) })
            : t('post.shareLabelPlain', { author, time: spokenTime })
        }
        tone="points"
        onPress={() => share(post)}
      />
      <Pill label={likes} accessibilityLabel={likesLabel(post.likeCount)} />
    </>
  );
}

export interface PostRowProps {
  post: Post;
}

/**
 * Linha compacta do mural na home (1b): miniatura, autor com selo, tempo e
 * texto, e as pílulas embaixo. Não há pressável em volta de tudo: a
 * miniatura e o bloco de texto abrem o post (a miniatura, repetida, fica fora
 * do leitor de tela), e as pílulas são irmãs, cada uma com o próprio rótulo.
 * Post de show leva o "Eu vou", a mesma presença da agenda; os outros,
 * "Compartilhar +N" e a contagem de curtidas.
 */
export function PostRow({ post }: PostRowProps) {
  const now = new Date();
  const author = post.artist.verified
    ? t('post.author', { name: post.artist.name })
    : post.artist.name;
  const spokenTime = formatRelativeAgoSpoken(post.createdAt, now);
  const blockLabel = t('post.blockLabel', { author, time: spokenTime, text: post.text });
  const withThumbnail = post.media !== null || post.event !== null;

  return (
    <View style={styles.row}>
      {withThumbnail ? (
        <PressableScale
          onPress={() => openPost(post.id)}
          {...hiddenFromReader}
          style={styles.thumbnail}
        >
          <PostThumbnail post={post} />
        </PressableScale>
      ) : null}
      <View style={styles.body}>
        <PressableScale
          onPress={() => openPost(post.id)}
          accessibilityLabel={blockLabel}
          style={styles.block}
        >
          <View style={styles.author}>
            <Text variant="label" numberOfLines={1} style={styles.authorName}>
              {post.artist.name}
            </Text>
            {post.artist.verified ? <VerifiedBadge size={13} /> : null}
            <Text variant="metaSmall" color={colors.textMuted}>
              {t('post.meta', { time: formatRelativeShort(post.createdAt, now) })}
            </Text>
          </View>
          <Text
            variant="bodySmall"
            color={colors.textBody}
            numberOfLines={TEXT_LINES}
            style={styles.text}
          >
            {post.text}
          </Text>
        </PressableScale>
        <View style={styles.chips}>
          {post.event ? (
            <RsvpChip eventId={post.event.id} eventTitle={post.event.title} />
          ) : (
            <ShareChips post={post} spokenTime={spokenTime} />
          )}
        </View>
      </View>
    </View>
  );
}

/** Divisória de ponta a ponta entre dois posts, com o vão de cima do seguinte. */
export function PostDivider() {
  return <View style={styles.divider} />;
}

const SKELETON_ROWS = 3;
const SKELETON_TEXT_WIDTHS = ['40%', '92%', '70%'] as const;

/** Esqueleto do mural: três linhas com a miniatura e as barras de texto. */
export function PostRowsSkeleton({ accessibilityLabel }: { accessibilityLabel?: string }) {
  return (
    <SkeletonGroup accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <View key={row} style={[styles.row, styles.skeletonRow]}>
          <Skeleton height={layout.postThumb} width={layout.postThumb} radius={radii.md} />
          <View style={[styles.body, styles.skeletonText]}>
            {SKELETON_TEXT_WIDTHS.map((width) => (
              <Skeleton
                key={width}
                tone="raised"
                height={typography.bodySmall.fontSize}
                width={width}
              />
            ))}
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.itemGap,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.cardPadding - CHIP_OUTSET,
  },
  thumbnail: {
    width: layout.postThumb,
    height: layout.postThumb,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  showTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  // Autor e uma linha de texto dão 40: post curto sem miniatura ficaria sem o alvo de 44.
  block: {
    minHeight: layout.minTouchTarget,
  },
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
  },
  authorName: {
    flexShrink: 1,
  },
  text: {
    marginTop: spacing.metaGap,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.chipGap,
  },
  divider: {
    height: borderWidths.default,
    backgroundColor: colors.divider,
    marginBottom: spacing.cardPadding,
  },
  skeletonRow: {
    paddingBottom: spacing.cardPadding,
  },
  skeletonText: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
