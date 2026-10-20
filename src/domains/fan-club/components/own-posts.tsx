import { useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Pill } from '@/components/pill';
import { RemoteImage } from '@/components/remote-image';
import { SectionLabel } from '@/components/section-label';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';
import { formatDate } from '@/utils/date';

import { POST_REJECT_REASON_TEXTS, POST_STATUS_TEXTS } from '../describe';
import { useMyFanClubPostsQuery, useRemoveFanClubPostMutation } from '../queries';
import type { OwnFanClubPost } from '../types';

const THUMB_WIDTH = 48;
const THUMB_HEIGHT = 60;
const TEXT_LINES = 3;

/** O rótulo da linha: o status, o texto, a foto, a data e, na recusada, o motivo. */
function rowLabel(post: OwnFanClubPost): string {
  const parts = [
    t('fanClub.mine.posts.rowLabel', {
      status: t(POST_STATUS_TEXTS[post.status]),
      text: post.text,
      date: formatDate(post.submittedAt),
    }),
  ];
  if (post.kind === 'photo') parts.push(t('fanClub.mine.posts.withPhoto'));
  if (post.status === 'rejected' && post.rejectReason) {
    parts.push(
      t('fanClub.mine.posts.reason', { reason: t(POST_REJECT_REASON_TEXTS[post.rejectReason]) }),
    );
  }
  return parts.join(' ');
}

interface RowProps {
  post: OwnFanClubPost;
  /** Retirar ou tirar do ar esta linha, ou nada (outro status, ou o fã-clube fora do ar). */
  onRemove?: () => void;
  removing: boolean;
  disabled: boolean;
  error: TranslationKey | null;
}

/**
 * Uma publicação do gestor: a miniatura (só em análise e no ar, que são as que
 * têm a foto), o status numa `Pill`, o texto, a data e, na recusada, o motivo.
 * O conteúdo é um foco só; o "Retirar" (em análise) e o "Tirar do ar" (no ar)
 * são irmãos dele, com foco próprio.
 */
function OwnPostRow({ post, onRemove, removing, disabled, error }: RowProps) {
  const pending = post.status === 'pending';
  return (
    <Card variant="compact" style={styles.row} testID={`fan-club-own-post-${post.id}`}>
      <View accessible accessibilityLabel={rowLabel(post)} style={styles.content}>
        {post.thumb ? (
          <RemoteImage
            uri={post.thumb.url}
            fallback={{ kind: 'surface', seed: post.id }}
            style={styles.thumb}
          />
        ) : null}
        <View style={styles.texts}>
          <Pill label={t(POST_STATUS_TEXTS[post.status])} size="xs" style={styles.pill} />
          <Text variant="body" numberOfLines={TEXT_LINES}>
            {post.text}
          </Text>
          <Text variant="caption" color={colors.textMuted}>
            {post.kind === 'photo'
              ? t('fanClub.mine.posts.dateWithPhoto', { date: formatDate(post.submittedAt) })
              : formatDate(post.submittedAt)}
          </Text>
          {post.status === 'rejected' && post.rejectReason ? (
            <Text variant="caption" color={colors.textSecondary}>
              {t('fanClub.mine.posts.reason', {
                reason: t(POST_REJECT_REASON_TEXTS[post.rejectReason]),
              })}
            </Text>
          ) : null}
        </View>
      </View>
      {onRemove ? (
        <Button
          label={t(pending ? 'fanClub.mine.posts.withdraw' : 'fanClub.mine.posts.remove')}
          accessibilityLabel={t(
            pending ? 'fanClub.mine.posts.withdrawLabel' : 'fanClub.mine.posts.removeLabel',
          )}
          variant="secondary"
          size="sm"
          onPress={onRemove}
          loading={removing}
          disabled={disabled}
          style={styles.action}
          testID={`fan-club-own-post-${post.id}-remove`}
        />
      ) : null}
      {error ? (
        <Text variant="caption" color={colors.danger}>
          {t(error)}
        </Text>
      ) : null}
    </Card>
  );
}

export interface OwnPostsProps {
  /** O fã-clube no ar para o gestor: só então ele retira e tira do ar. */
  canRemove: boolean;
}

/**
 * "Minhas publicações" (34.9, item 5): as do gestor em todos os status, 10 por
 * página, com "Ver mais publicações". Retirar a em análise e tirar do ar a
 * publicada pedem confirmação; no sucesso, a linha troca de status e o leitor
 * ouve o resultado, e a falha fica na própria linha.
 */
export function OwnPosts({ canRemove }: OwnPostsProps) {
  const online = useIsOnline();
  const posts = useMyFanClubPostsQuery(true);
  const remove = useRemoveFanClubPostMutation();
  const [failure, setFailure] = useState<{ postId: string; key: TranslationKey } | null>(null);
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];

  const run = (post: OwnFanClubPost) => {
    setFailure(null);
    const done =
      post.status === 'pending' ? 'fanClub.mine.posts.withdrawn' : 'fanClub.mine.posts.removed';
    remove.mutate(post.id, {
      onSuccess: () => {
        haptics.trigger('success');
        AccessibilityInfo.announceForAccessibility(t(done));
      },
      onError: (error) => {
        const key = actionRefusal(error, 'clubRemovePost').key;
        setFailure({ postId: post.id, key });
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(t(key));
      },
    });
  };

  const confirm = (post: OwnFanClubPost) => {
    const pending = post.status === 'pending';
    Alert.alert(
      t(pending ? 'fanClub.mine.posts.withdrawTitle' : 'fanClub.mine.posts.removeTitle'),
      t(pending ? 'fanClub.mine.posts.withdrawBody' : 'fanClub.mine.posts.removeBody'),
      [
        { text: t('fanClub.mine.posts.cancel'), style: 'cancel' },
        {
          text: t(pending ? 'fanClub.mine.posts.withdraw' : 'fanClub.mine.posts.remove'),
          style: 'destructive',
          onPress: () => run(post),
        },
      ],
    );
  };

  return (
    <View testID="fan-club-own-posts">
      <SectionLabel>{t('fanClub.mine.posts.title')}</SectionLabel>
      {posts.isPending ? (
        <Skeleton height={THUMB_HEIGHT + spacing.lg * 2} tone="surface" />
      ) : posts.isError && items.length === 0 ? (
        <EmptyState
          tone="error"
          message={t('fanClub.mine.posts.error')}
          actionLabel={t('common.retry')}
          onAction={() => void posts.refetch()}
        />
      ) : items.length === 0 ? (
        <Text variant="body" color={colors.textSecondary} testID="fan-club-own-posts-empty">
          {t('fanClub.mine.posts.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {items.map((post) => {
            const removable =
              canRemove && (post.status === 'pending' || post.status === 'published');
            const busy = remove.isPending && remove.variables === post.id;
            return (
              <OwnPostRow
                key={post.id}
                post={post}
                onRemove={removable ? () => confirm(post) : undefined}
                removing={busy}
                disabled={!online || remove.isPending}
                error={failure?.postId === post.id ? failure.key : null}
              />
            );
          })}
          {posts.hasNextPage ? (
            <Button
              label={t('fanClub.mine.posts.more')}
              variant="ghost"
              onPress={() => void posts.fetchNextPage()}
              loading={posts.isFetchingNextPage}
              disabled={posts.isFetchingNextPage}
              testID="fan-club-own-posts-more"
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.listGap,
  },
  row: {
    gap: spacing.md,
  },
  content: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  pill: {
    alignSelf: 'flex-start',
  },
  action: {
    alignSelf: 'flex-start',
  },
});
