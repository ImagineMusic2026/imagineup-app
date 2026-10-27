import { FlashList } from '@shopify/flash-list';
import { TextAlignStart } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ChipGroup, type ChipItem } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { RemoteImage } from '@/components/remote-image';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';
import { formatDate } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import { sentence } from '@/utils/text';

import { POST_REJECT_REASON_TEXTS, POST_STATUS_TEXTS } from '../describe';
import { excerptOf } from '../format';
import { postsIn, type PostFilter } from '../manager';
import { useMyFanClubPostsQuery, useRemoveFanClubPostMutation } from '../queries';
import type { MyFanClubClub, OwnFanClubPost } from '../types';

// A miniatura em 4:5, na altura da 4c.
const THUMB_HEIGHT = 70;
const THUMB_WIDTH = 56;
const TEXT_LINES = 3;
// Com menos que isto no filtro e mais páginas no servidor, a lista busca a seguinte sozinha.
const FILTER_FILL = 10;

const FILTER_LABELS: Record<PostFilter, TranslationKey> = {
  'no-ar': 'fanClub.manager.posts.filters.published',
  'em-analise': 'fanClub.manager.posts.filters.pending',
  recusadas: 'fanClub.manager.posts.filters.rejected',
  outras: 'fanClub.manager.posts.filters.others',
};

const EMPTY_TEXTS: Record<PostFilter, TranslationKey> = {
  'no-ar': 'fanClub.manager.posts.empty.published',
  'em-analise': 'fanClub.manager.posts.empty.pending',
  recusadas: 'fanClub.manager.posts.empty.rejected',
  outras: 'fanClub.manager.posts.empty.others',
};

/** O rótulo da linha: o status, o texto, a data, a foto e, na recusada, o motivo. */
function rowLabel(post: OwnFanClubPost): string {
  const parts = [
    t('fanClub.mine.posts.rowLabel', {
      status: t(POST_STATUS_TEXTS[post.status]),
      // O ponto depois do texto só quando falta ("Quem vem?" fica como está).
      text: sentence(post.text),
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
  /** Retirar ou tirar do ar esta publicação, ou nada (outro status). */
  onRemove?: () => void;
  removing: boolean;
  disabled: boolean;
  error: TranslationKey | null;
}

/**
 * Um card da 4c: a miniatura (só em análise e no ar, as que têm a foto; o
 * texto sem foto leva o ícone de texto), o status, a data, o texto e, na
 * recusada, o motivo. O conteúdo é um foco só; o "Retirar" (em análise) e o
 * "Tirar do ar" (no ar) são irmãos dele, com foco próprio. A linha não guarda
 * estado: o ocupado e a falha vêm da lista, pelo id.
 */
function OwnPostCard({ post, onRemove, removing, disabled, error }: RowProps) {
  const pending = post.status === 'pending';
  return (
    <Card variant="compact" style={styles.card} testID={`fan-club-own-post-${post.id}`}>
      <View accessible accessibilityLabel={rowLabel(post)} style={styles.content}>
        {post.thumb ? (
          <RemoteImage
            uri={post.thumb.url}
            fallback={{ kind: 'surface', seed: post.id }}
            style={styles.thumb}
          />
        ) : (
          <View style={[styles.thumb, styles.textThumb]}>
            <Icon icon={TextAlignStart} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.texts}>
          <View style={styles.meta}>
            <Pill label={t(POST_STATUS_TEXTS[post.status])} size="xs" caps />
            <Text variant="caption" color={colors.textMuted} style={styles.date}>
              {post.kind === 'photo'
                ? t('fanClub.mine.posts.dateWithPhoto', { date: formatDate(post.submittedAt) })
                : formatDate(post.submittedAt)}
            </Text>
          </View>
          <Text variant="label" numberOfLines={TEXT_LINES}>
            {post.text}
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
        // Numa fileira, da altura do rótulo: direto na coluna, o Button esticaria.
        <View style={styles.actionRow}>
          <Button
            label={t(pending ? 'fanClub.mine.posts.withdraw' : 'fanClub.mine.posts.remove')}
            accessibilityLabel={t(
              pending ? 'fanClub.mine.posts.withdrawLabel' : 'fanClub.mine.posts.removeLabel',
              { excerpt: excerptOf(post.text) },
            )}
            variant="secondary"
            size="sm"
            onPress={onRemove}
            loading={removing}
            disabled={disabled}
            style={styles.action}
            testID={`fan-club-own-post-${post.id}-remove`}
          />
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" color={colors.danger}>
          {t(error)}
        </Text>
      ) : null}
    </Card>
  );
}

function ItemGap() {
  return <View style={styles.gap} />;
}

type PostsQuery = ReturnType<typeof useMyFanClubPostsQuery>;

/**
 * A página seguinte chegando, ou a que falhou, com "Tentar de novo" só para
 * ela. Com o filtro vazio, quem mostra a espera é o esqueleto, e não o rodapé.
 */
function PostsFooter({ query, empty }: { query: PostsQuery; empty: boolean }) {
  if (query.isFetchNextPageError) {
    return (
      <EmptyState
        tone="error"
        message={t('fanClub.manager.posts.moreError')}
        actionLabel={t('common.retry')}
        onAction={() => void query.fetchNextPage({ cancelRefetch: false })}
        actionLoading={query.isFetchingNextPage}
        style={styles.footer}
      />
    );
  }
  if (query.isFetchingNextPage && !empty) {
    return <ActivityIndicator color={colors.textMuted} style={styles.footer} />;
  }
  return null;
}

/** As publicações carregando, a falha (com "Tentar de novo") ou o filtro vazio. */
function PostsEmpty({
  query,
  filter,
  total,
}: {
  query: PostsQuery;
  filter: PostFilter;
  total: number;
}) {
  // A espera só enquanto a busca anda: sem internet, a página seguinte fica
  // parada, e o filtro diz que está vazio, em vez de carregar para sempre.
  if (query.isPending || query.isFetchingNextPage) {
    return (
      <SkeletonGroup accessibilityLabel={t('fanClub.manager.posts.loading')}>
        <Skeleton height={THUMB_HEIGHT + spacing.lg * 2} tone="surface" radius={radii.lg} />
      </SkeletonGroup>
    );
  }
  if (query.isError && total === 0) {
    return (
      <EmptyState
        tone="error"
        message={t('fanClub.mine.posts.error')}
        actionLabel={t('common.retry')}
        onAction={() => void query.refetch()}
        actionLoading={query.isFetching}
      />
    );
  }
  return (
    <View testID="fan-club-own-posts-empty">
      <EmptyState message={t(total === 0 ? 'fanClub.mine.posts.empty' : EMPTY_TEXTS[filter])} />
    </View>
  );
}

export interface ManagerPostsProps {
  club: MyFanClubClub;
  filter: PostFilter;
  onFilter: (filter: PostFilter) => void;
  /** A altura da barra do modo gestor, que fica por cima da lista. */
  bottomInset: number;
}

/**
 * A aba Publicações do modo gestor (a 4c, só com o que o fã-clube tem): as do
 * gestor em todos os status (`GET /me/fan-club/posts`, 10 por página), nos
 * filtros No ar, Em análise, Recusadas e Outras (a retirada, a tirada do ar e
 * a oculta pela equipe), com a frase de que a equipe revisa e até 3 esperam
 * por vez. Numa FlashList: a página seguinte vem pelo fim da lista e, quando o
 * filtro tem poucas, sozinha. Retirar a em análise e tirar do ar a publicada
 * pedem confirmação e valem em qualquer status do fã-clube, como no servidor;
 * no sucesso, o card troca de status (e de filtro), o leitor ouve o resultado,
 * e a falha fica no próprio card.
 */
export function ManagerPosts({ club, filter, onFilter, bottomInset }: ManagerPostsProps) {
  const online = useIsOnline();
  const posts = useMyFanClubPostsQuery(true);
  const remove = useRemoveFanClubPostMutation();
  const [failure, setFailure] = useState<{ postId: string; key: TranslationKey } | null>(null);
  const all = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = postsIn(all, filter);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = posts;

  // Filtro com poucas e mais páginas no servidor: busca a seguinte sem esperar
  // a rolagem, que numa lista curta não chega ao fim.
  const short = shown.length < FILTER_FILL;
  useEffect(() => {
    if (short && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [short, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const run = (post: OwnFanClubPost) => {
    setFailure(null);
    remove.mutate(post.id, {
      onSuccess: (updated) => {
        haptics.trigger('success');
        AccessibilityInfo.announceForAccessibility(
          t(
            updated.status === 'withdrawn'
              ? 'fanClub.mine.posts.withdrawn'
              : 'fanClub.mine.posts.removed',
          ),
        );
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

  // As contagens do servidor só nos dois filtros que ele conta.
  const counts: Partial<Record<PostFilter, number>> = {
    'no-ar': club.postCount,
    'em-analise': club.pendingPosts,
  };
  const chips: ChipItem<PostFilter>[] = (Object.keys(FILTER_LABELS) as PostFilter[]).map(
    (value) => {
      const label = t(FILTER_LABELS[value]);
      const count = counts[value];
      return count === undefined
        ? { value, label }
        : {
            value,
            label: t('fanClub.manager.posts.filterCount', { label, count: formatNumber(count) }),
            accessibilityLabel: t('fanClub.manager.posts.filterCountLabel', {
              label,
              count: formatNumber(count),
            }),
          };
    },
  );

  const busyId = remove.isPending ? remove.variables : null;

  return (
    <FlashList<OwnFanClubPost>
      data={shown}
      keyExtractor={(post) => post.id}
      getItemType={(post) => (post.thumb ? 'photo' : 'text')}
      renderItem={({ item }) => {
        const removable = item.status === 'pending' || item.status === 'published';
        return (
          <OwnPostCard
            post={item}
            onRemove={removable ? () => confirm(item) : undefined}
            removing={busyId === item.id}
            disabled={!online || remove.isPending}
            error={failure?.postId === item.id ? failure.key : null}
          />
        );
      }}
      extraData={{ busyId, online, failure }}
      ItemSeparatorComponent={ItemGap}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="titlePage" accessibilityRole="header">
            {t('fanClub.manager.posts.title')}
          </Text>
          <ChipGroup
            items={chips}
            value={filter}
            onChange={onFilter}
            style={styles.chips}
            testID="fan-club-posts-filter"
          />
          <Text variant="caption" color={colors.textSecondary} testID="fan-club-posts-note">
            {t('fanClub.manager.posts.note')}
          </Text>
        </View>
      }
      ListEmptyComponent={<PostsEmpty query={posts} filter={filter} total={all.length} />}
      ListFooterComponent={<PostsFooter query={posts} empty={shown.length === 0} />}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
          void fetchNextPage({ cancelRefetch: false });
        }
      }}
      contentContainerStyle={{
        paddingHorizontal: spacing.gutter,
        paddingBottom: bottomInset + spacing.xl,
      }}
      showsVerticalScrollIndicator={false}
      testID="fan-club-own-posts"
    />
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  chips: {
    marginHorizontal: -spacing.gutter,
  },
  card: {
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
  textThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xxs,
  },
  date: {
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: 'row',
  },
  action: {
    flexShrink: 1,
  },
  gap: {
    height: spacing.listGap,
  },
  footer: {
    paddingVertical: spacing.lg,
  },
});
