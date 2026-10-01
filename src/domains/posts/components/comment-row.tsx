import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { PressableScale } from '@/components/pressable-scale';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { VerifiedBadge } from '@/components/verified-badge';
import { t } from '@/i18n';
import { colors, layout, motion, spacing, typography } from '@/theme';
import { formatRelativeAgoSpoken, formatRelativeShort } from '@/utils/date';

import { LARGE_TEXT_SCALE } from '../consts';
import type { PostComment } from '../types';

// Avatar apagado enquanto o comentário vai: é imagem, o contraste vale para o texto.
const PENDING_AVATAR_OPACITY = 0.5;

/** O comentário novo desce do lugar dele em fade (o `ReducedMotionConfig` desliga sozinho). */
const ENTERING = FadeInDown.duration(motion.duration.base);

export interface CommentRowProps {
  comment: PostComment;
  /** Relógio da tela (`useNow`), para o "1 h" andar sozinho. */
  now: Date;
  /** O fã acabou de mandar este: a linha entra com o fade. */
  animateIn?: boolean;
  /** Comentário do próprio fã: "Você" no lugar do nome, como o card "Você" da 1f. */
  mine?: boolean;
  /** Toque na linha que não foi enviada. */
  onRetry?: () => void;
}

function nameOf(comment: PostComment, mine: boolean): string {
  return mine ? t('post.comments.you') : comment.authorName;
}

function authorOf(comment: PostComment, mine: boolean): string {
  return comment.authorIsArtist
    ? t('post.author', { name: comment.authorName })
    : nameOf(comment, mine);
}

function rowLabel(comment: PostComment, now: Date, mine: boolean): string {
  const params = { author: authorOf(comment, mine), text: comment.text };
  if (comment.status === 'pending') return t('post.comments.pendingLabel', params);
  if (comment.status === 'failed') return t('post.comments.failedLabel', params);
  return t('post.comments.rowLabel', {
    ...params,
    time: formatRelativeAgoSpoken(comment.createdAt, now),
  });
}

/**
 * Um comentário: avatar de 34, nome (com o selo quando é o artista), a hora
 * e o texto. Os do próprio fã dizem "Você", com as iniciais dele no avatar.
 * Para o leitor de tela, a linha é um elemento só ("Thalita S., há 1 hora:
 * ..."). O do fã que ainda vai fica apagado com "enviando…"; o que falhou diz
 * "Não enviado" em laranja e vira um botão que tenta de novo. Sem curtida em
 * comentário: o fã só curte o post.
 *
 * Toda linha é o mesmo pressável, só ligado quando falhou: trocar o elemento
 * de fora (um `View` enviando, um botão no "Não enviado", outro `View` depois
 * de gravado) recriava a view nativa, e o leitor de tela perdia o foco ao
 * tentar de novo. Fora do "Não enviado", ela não recebe o foco do teclado nem
 * o clique do Android (`focusable`), e o leitor não a trata como botão.
 *
 * Com a fonte grande (1,3 em diante), o nome não corta: quebra em linhas e a
 * hora desce para baixo dele.
 *
 * O apagado não usa opacidade na linha: texto a .5 do branco .9 reprovaria o
 * contraste. As cores descem até o mínimo do app (.5) e o avatar fica a .5.
 */
export function CommentRow({
  comment,
  now,
  animateIn = false,
  mine = false,
  onRetry,
}: CommentRowProps) {
  const pending = comment.status === 'pending';
  const failed = comment.status === 'failed';
  const key = comment.localId ?? comment.id;
  const largeText = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;

  const content = (
    <>
      <View style={pending && styles.pendingAvatar}>
        <Avatar
          name={comment.authorName}
          id={comment.authorId}
          photoUrl={comment.authorAvatarUrl}
          size="sm"
        />
      </View>
      <View style={styles.body}>
        <View style={[styles.head, largeText && styles.headWrap]}>
          <Text
            variant="label"
            color={pending ? colors.textSubtle : colors.text}
            numberOfLines={largeText ? undefined : 1}
            style={styles.name}
          >
            {nameOf(comment, mine)}
          </Text>
          {comment.authorIsArtist ? <VerifiedBadge size={13} /> : null}
          {failed ? null : (
            <Text variant="metaSmall" color={pending ? colors.textSecondary : colors.textMuted}>
              {pending
                ? t('post.comments.sending')
                : t('post.meta', { time: formatRelativeShort(comment.createdAt, now) })}
            </Text>
          )}
        </View>
        <Text
          variant="bodySmall"
          color={pending ? colors.textTertiary : colors.textBody}
          style={styles.text}
        >
          {comment.text}
        </Text>
        {failed ? (
          <Text variant="caption" color={colors.danger} style={styles.text}>
            {t('post.comments.failed')}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    // A chave remonta a linha quando a célula da lista passa a mostrar outro
    // comentário: o fade só roda na montagem, e só no que o fã acabou de mandar.
    <Animated.View key={key} entering={animateIn ? ENTERING : undefined}>
      <PressableScale
        onPress={failed ? onRetry : undefined}
        haptic={failed ? 'tap' : null}
        scaleTo={failed ? motion.pressScale : 1}
        focusable={failed}
        accessibilityRole={failed ? 'button' : 'none'}
        accessibilityLabel={rowLabel(comment, now, mine)}
        accessibilityHint={failed ? t('post.comments.retryHint') : undefined}
        style={styles.row}
        testID={`comment-${key}`}
      >
        {content}
      </PressableScale>
    </Animated.View>
  );
}

const SKELETON_ROWS = 3;

/** Esqueleto dos comentários: três linhas com o círculo de 34 e duas barras. */
export function CommentRowsSkeleton({ accessibilityLabel }: { accessibilityLabel?: string }) {
  return (
    <SkeletonGroup accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <View key={row} style={styles.row}>
          <Skeleton circle height={layout.avatar.sm.size} tone="raised" />
          <View style={[styles.body, styles.skeletonText]}>
            <Skeleton height={typography.metaSmall.fontSize} width="36%" tone="raised" />
            <Skeleton height={typography.bodySmall.fontSize} width="82%" tone="raised" />
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
    gap: spacing.listGap,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.listGap,
  },
  pendingAvatar: {
    opacity: PENDING_AVATAR_OPACITY,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
  },
  headWrap: {
    flexWrap: 'wrap',
  },
  name: {
    flexShrink: 1,
  },
  text: {
    marginTop: spacing.xs,
  },
  skeletonText: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
