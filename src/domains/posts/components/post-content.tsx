import { CalendarDays, Play } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { RemoteImage } from '@/components/remote-image';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing, typography } from '@/theme';
import { formatDayMonth, formatLongDate, formatShowTime, formatShowTimeSpoken } from '@/utils/date';

import type { Post, PostEvent, PostMedia } from '../types';

// A proporção real da mídia fica entre 4:5 (em pé) e 16:9 (deitada); fora
// disso, o recorte: uma foto muito alta empurraria os comentários para longe.
const MIN_MEDIA_ASPECT = 4 / 5;
const MAX_MEDIA_ASPECT = 16 / 9;

// A marca de vídeo da grade da 1d: ícone de 16 num círculo de vidro escuro.
const VIDEO_MARK_SIZE = 28;
const VIDEO_MARK_ICON_SIZE = 16;
const EVENT_ICON_SIZE = 18;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/** Largura sobre altura da mídia no detalhe; sem as medidas, a da 1a (402:236). */
export function mediaAspectRatio(media: Pick<PostMedia, 'width' | 'height'>): number {
  const { width, height } = media;
  if (!width || !height || width <= 0 || height <= 0) return layout.mediaAspectDefault;
  return Math.min(MAX_MEDIA_ASPECT, Math.max(MIN_MEDIA_ASPECT, width / height));
}

/**
 * A mídia de ponta a ponta, sem raio. O app não toca vídeo: o post de vídeo
 * mostra a miniatura com a marca pequena de vídeo no canto de cima, a mesma da
 * grade da 1d, e não um botão de play no meio, que prometeria tocar. Para o
 * leitor de tela, a mídia é uma imagem com o que ela é e de quem é o post.
 */
function PostMediaBlock({ post, media }: { post: Post; media: PostMedia }) {
  const video = post.kind === 'video';
  const uri = video ? media.thumbnailUrl : (media.url ?? media.thumbnailUrl);
  const label = t(video ? 'post.details.videoLabel' : 'post.details.photoLabel', {
    artist: post.artist.name,
  });

  return (
    <View style={[styles.media, { aspectRatio: mediaAspectRatio(media) }]}>
      <RemoteImage
        uri={uri}
        fallback={{ kind: 'brand', seed: post.id }}
        accessibilityLabel={label}
        style={StyleSheet.absoluteFill}
      />
      {video ? (
        <View pointerEvents="none" {...hiddenFromReader} style={styles.videoMark}>
          <Icon icon={Play} size={VIDEO_MARK_ICON_SIZE} color={colors.text} filled />
        </View>
      ) : null}
    </View>
  );
}

/**
 * O show do post de show: ícone ciano, nome e "3 out · 22 h · Aracaju, SE",
 * lido por extenso. O "Eu vou" fica nas ações, como na home.
 */
function PostEventLine({ event }: { event: PostEvent }) {
  const date = formatDayMonth(event.startsAt);
  const time = formatShowTime(event.startsAt);

  return (
    <View
      accessible
      accessibilityLabel={t('post.details.eventLabel', {
        title: event.title,
        date: formatLongDate(event.startsAt),
        time: formatShowTimeSpoken(event.startsAt),
        city: event.city,
      })}
      style={styles.event}
    >
      <Icon icon={CalendarDays} size={EVENT_ICON_SIZE} color={colors.events} />
      <View style={styles.eventText}>
        <Text variant="label" numberOfLines={2}>
          {event.title}
        </Text>
        <Text variant="caption" color={colors.textMuted}>
          {t('post.details.eventMeta', { date, time, city: event.city })}
        </Text>
      </View>
    </View>
  );
}

export interface PostContentProps {
  post: Post;
}

/**
 * O corpo do post no detalhe: o texto inteiro (dá para selecionar e copiar),
 * o show (post de show) e a mídia. Um post tem uma mídia só.
 */
export function PostContent({ post }: PostContentProps) {
  return (
    <View>
      {post.text ? (
        <Text variant="body" color={colors.textBody} selectable style={styles.text}>
          {post.text}
        </Text>
      ) : null}
      {post.event ? <PostEventLine event={post.event} /> : null}
      {post.media ? <PostMediaBlock post={post} media={post.media} /> : null}
    </View>
  );
}

const SKELETON_TEXT_WIDTHS = ['92%', '64%'] as const;

/** Esqueleto do post: autor (avatar de 38 e duas barras), texto e mídia. */
export function PostSkeleton({ accessibilityLabel }: { accessibilityLabel?: string }) {
  const avatar = layout.avatar.lg.size;
  return (
    <SkeletonGroup accessibilityLabel={accessibilityLabel}>
      <View style={styles.skeletonAuthor}>
        <Skeleton circle height={avatar} tone="raised" />
        <View style={styles.skeletonAuthorText}>
          <Skeleton height={typography.label.fontSize} width="40%" tone="raised" />
          <Skeleton height={typography.caption.fontSize} width="28%" tone="raised" />
        </View>
      </View>
      <View style={styles.skeletonText}>
        {SKELETON_TEXT_WIDTHS.map((width) => (
          <Skeleton key={width} height={typography.body.fontSize} width={width} tone="raised" />
        ))}
      </View>
      <Skeleton
        height="auto"
        radius={0}
        tone="raised"
        style={{ aspectRatio: layout.mediaAspectDefault }}
      />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  text: {
    paddingHorizontal: spacing.gutter,
    marginBottom: spacing.md,
  },
  event: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.listGap,
    marginHorizontal: spacing.gutter,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  eventText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  media: {
    width: '100%',
    backgroundColor: colors.surfaceRaised,
  },
  videoMark: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: VIDEO_MARK_SIZE,
    height: VIDEO_MARK_SIZE,
    borderRadius: VIDEO_MARK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // O triângulo parece deslocado para a esquerda no meio exato do círculo.
    paddingLeft: spacing.xxs,
    backgroundColor: colors.glassDark,
  },
  skeletonAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.listGap,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.listGap,
    paddingBottom: spacing.gridGap,
  },
  skeletonAuthorText: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonText: {
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    marginBottom: spacing.md,
  },
});
