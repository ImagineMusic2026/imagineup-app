import { MessageCircle } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Glyph } from '@/components/glyph';
import { Icon } from '@/components/icon';
import { pillPaddingVertical } from '@/components/pill';
import { PillButton } from '@/components/pill-button';
import { PointsToast } from '@/components/points-toast';
import { RsvpChip } from '@/domains/agenda';
import { t } from '@/i18n';
import { borderWidths, colors, layout, spacing, typography } from '@/theme';
import { formatCompact, formatNumber, formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import { useSharePoints, useSharePost } from '../hooks/use-share-post';
import type { LikeAward } from '../queries';
import type { Post } from '../types';
import { ACTION_COUNT_COLOR, ACTION_ICON_COLOR, ACTION_ICON_SIZE, LikeHeart } from './like-heart';

// A partir daqui, a contagem vira "12 mil" para caber na pílula (como na home).
const COMPACT_FROM = 10_000;
const SHARE_ICON_SIZE = 15;

// A pílula (ícone de 16 com 8 em cima e embaixo, 34 no total) fica no meio do
// alvo de 44: a sobra sai do padding da linha, e o desenho continua com 12 em
// cima e 16 embaixo.
const PILL_HEIGHT =
  Math.max(ACTION_ICON_SIZE, typography.labelCompact.lineHeight) +
  pillPaddingVertical.md * 2 +
  borderWidths.default * 2;
const PILL_OUTSET = (layout.minTouchTarget - PILL_HEIGHT) / 2;
// O "+N" da curtida nasce no topo da pílula, não no do alvo de 44.
const LIKE_TOAST_BOTTOM = layout.minTouchTarget - PILL_OUTSET;

function countText(count: number): string {
  return count >= COMPACT_FROM ? formatCompact(count) : formatNumber(count);
}

function likesSpoken(count: number): string {
  return count === 1 ? t('post.likesOne') : t('post.likes', { count: formatNumber(count) });
}

function commentsSpoken(count: number): string {
  return count === 1
    ? t('post.comments.countOne')
    : t('post.comments.count', { count: formatNumber(count) });
}

export interface PostActionsProps {
  post: Post;
  onToggleLike: () => void;
  /** Pontos da curtida que concluiu uma missão: sobem num "+N" do botão. */
  likeAward?: LikeAward | null;
  /** "Comentar" leva o foco ao campo do comentário. */
  onComment: () => void;
}

/**
 * Curtir, comentar e compartilhar (da 1a), cada um uma pílula com alvo de 44.
 * Curtir é um estado ligado para o leitor de tela; compartilhar é lima porque
 * rende ponto, e o "+2" vem das regras do painel (sem ele, só "Compartilhar").
 * O post de show leva o "Eu vou" da agenda no lugar do compartilhar, como na
 * home, no tamanho das outras pílulas da linha.
 */
export function PostActions({ post, onToggleLike, likeAward = null, onComment }: PostActionsProps) {
  const share = useSharePost();
  const points = useSharePoints(post);

  return (
    <View style={styles.row}>
      <View>
        <PillButton
          size="md"
          label={countText(post.likeCount)}
          labelColor={post.likedByMe ? colors.text : ACTION_COUNT_COLOR}
          leading={<LikeHeart liked={post.likedByMe} />}
          selected={post.likedByMe}
          // Curtir vibra pelo evento `like` (na mutação); descurtir, com o toque comum.
          haptic={post.likedByMe ? 'tap' : null}
          accessibilityLabel={t('post.details.likeLabel', { likes: likesSpoken(post.likeCount) })}
          onPress={onToggleLike}
          testID="post-like"
        />
        <PointsToast
          points={likeAward?.points ?? 0}
          trigger={likeAward?.id ?? null}
          announcement={likeAward?.announcement}
          haptic={likeAward?.haptic}
          style={{ bottom: LIKE_TOAST_BOTTOM }}
          testID="post-like-points"
        />
      </View>
      <PillButton
        size="md"
        label={countText(post.commentCount)}
        labelColor={ACTION_COUNT_COLOR}
        leading={<Icon icon={MessageCircle} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
        accessibilityLabel={t('post.details.commentLabel', {
          comments: commentsSpoken(post.commentCount),
        })}
        onPress={onComment}
        testID="post-comment"
      />
      <View style={styles.spacer} />
      {post.event ? (
        <RsvpChip size="md" eventId={post.event.id} eventTitle={post.event.title} />
      ) : (
        <PillButton
          size="md"
          tone="points"
          label={
            points > 0
              ? t('post.share', { points: formatPointsDelta(points) })
              : t('post.sharePlain')
          }
          leading={<Glyph name="share" size={SHARE_ICON_SIZE} color={colors.onPoints} />}
          pillStyle={styles.sharePill}
          accessibilityLabel={
            points > 0
              ? t('post.details.shareLabel', { points: formatPointsSpoken(points) })
              : t('post.details.shareLabelPlain')
          }
          onPress={() => share(post)}
          testID="post-share"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md - PILL_OUTSET,
    paddingBottom: spacing.lg - PILL_OUTSET,
  },
  spacer: {
    flexGrow: 1,
  },
  // 9 x 14 no protótipo, com 7 entre a seta e o texto: mais largo que o curtir.
  sharePill: {
    paddingHorizontal: spacing.cardPadding,
    gap: spacing.chipGap,
  },
});
