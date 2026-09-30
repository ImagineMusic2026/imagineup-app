import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { BackHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { useFanIdentity, useWatchMyProfile } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { useNow } from '@/hooks/use-now';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { borderWidths, colors, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

import { CommentComposer, type CommentComposerHandle } from '../components/comment-composer';
import { CommentRow, CommentRowsSkeleton } from '../components/comment-row';
import { PostActions } from '../components/post-actions';
import { PostAuthorRow } from '../components/post-author-row';
import { PostContent, PostSkeleton } from '../components/post-content';
import {
  useAddCommentMutation,
  useCommentsQuery,
  useLocalComments,
  usePostQuery,
  useToggleLikeMutation,
} from '../queries';
import type { Post, PostComment } from '../types';

const isIOS = Platform.OS === 'ios';

/** A mesma linha antes e depois de chegar ao servidor: o id local fica. */
export function commentKey(comment: PostComment): string {
  return comment.localId ?? comment.id;
}

/**
 * Os do fã que ainda não chegaram (os mais novos) em cima, depois os do
 * servidor, sem repetir: o que o servidor gravou fica escondido enquanto a
 * linha local dele ainda está na tela, e o comentário que uma página nova
 * traz de novo (a lista andou uma casa) aparece uma vez só.
 */
export function mergeComments(
  local: readonly PostComment[],
  server: readonly PostComment[],
): PostComment[] {
  const seen = new Set<string>();
  const merged: PostComment[] = [];
  for (const comment of [...local, ...server]) {
    const key = commentKey(comment);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(comment);
  }
  return merged;
}

/**
 * Comentários do fã que ainda vão e que a lista do servidor não tem: a
 * contagem do post só sobe quando o servidor grava (`commitComment`), e a tela
 * soma estes a ela. Vale também para o que voltou do disco com o app reaberto,
 * que chega sem o +1 no post buscado de novo.
 */
export function unsentCount(local: readonly PostComment[], server: readonly PostComment[]): number {
  const saved = new Set(server.map((comment) => comment.localId).filter(Boolean));
  return local.filter((comment) => comment.status === 'pending' && !saved.has(comment.id)).length;
}

/** Autor, texto, mídia, ações e o título dos comentários, antes da lista. */
function PostHeader({
  post,
  now,
  onToggleLike,
  onComment,
}: {
  post: Post;
  now: Date;
  onToggleLike: () => void;
  onComment: () => void;
}) {
  return (
    <View>
      <PostAuthorRow post={post} now={now} />
      <PostContent post={post} />
      <PostActions post={post} onToggleLike={onToggleLike} onComment={onComment} />
      <SectionHeader
        title={t('post.comments.title')}
        count={formatNumber(post.commentCount)}
        spacing="compact"
        accessibilityLabel={t('post.comments.titleLabel', {
          count: formatNumber(post.commentCount),
        })}
        style={styles.commentsTitle}
      />
    </View>
  );
}

type CommentsState = 'loading' | 'error' | 'ready';

/**
 * Tela do post com os comentários, sem desenho no protótipo (aprovada em
 * 2026-09-28 no visual das outras): o card completo da 1a, em tela cheia, com
 * os comentários embaixo e o campo preso ao pé. Fica fora das abas, sem tab
 * bar, porque tem teclado.
 *
 * Uma lista só: o post é o cabeçalho da FlashList, e o compositor fica fora
 * dela, no pé da tela. O `KeyboardAvoidingView` fica em volta do `Screen`,
 * colado ao topo da tela: ele mede a própria posição em relação ao pai, e
 * dentro do `Screen` (que começa abaixo da barra de status e do aviso de
 * offline) deixava o compositor meio coberto pelo teclado no Android. Os
 * comentários vão do mais novo ao mais antigo: o que o fã manda entra no
 * topo, logo abaixo do post, e a lista rola até ele se ele estiver fora da vista.
 */
export function PostDetailsScreen() {
  const { postId = '' } = useLocalSearchParams<{ postId: string }>();
  useWatchMyProfile();
  const { uid } = useFanIdentity();
  const keyboardVisible = useKeyboardVisible();
  const clock = useNow();
  const reducedMotion = usePrefersReducedMotion();
  const post = usePostQuery(postId);
  const comments = useCommentsQuery(postId);
  // O relógio da tela anda de minuto em minuto; o dado que acabou de chegar
  // pode ser mais novo que ele, e o post de "2 h" sairia "1 h".
  const now = new Date(Math.max(clock.getTime(), post.dataUpdatedAt, comments.dataUpdatedAt));
  const local = useLocalComments(postId);
  const like = useToggleLikeMutation();
  const composer = useRef<CommentComposerHandle>(null);
  const commenting = useAddCommentMutation(postId, {
    restoreDraft: (text) => composer.current?.restore(text) ?? false,
  });
  const listRef = useRef<FlashListRef<PostComment>>(null);
  const scrollY = useRef(0);
  const pendingReveal = useRef<string | null>(null);
  const [sentKeys, setSentKeys] = useState<ReadonlySet<string>>(() => new Set());

  const serverComments = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const items = mergeComments(local.comments, serverComments);
  const commentsState: CommentsState = comments.isPending
    ? 'loading'
    : comments.isError && comments.data === undefined
      ? 'error'
      : 'ready';

  const postMissing = post.error instanceof ApiError && post.error.kind === 'notFound';
  // Buscando de novo, o erro fica na tela com o botão ocupado; o anúncio sai uma vez.
  const postFailed = post.data === undefined && post.isError;
  const postSettledFailed = postFailed && !post.isFetching;
  useAnnounceWhen(postSettledFailed && postMissing, t('post.details.notFound'));
  useAnnounceWhen(postSettledFailed && !postMissing, t('post.details.loadError'));
  useAnnounceWhen(
    commentsState === 'error' && !comments.isFetching && post.data !== undefined,
    t('post.comments.loadError'),
  );
  useAnnounceWhen(
    comments.isFetchNextPageError && !comments.isFetching,
    t('post.comments.moreError'),
  );

  // O comentário novo entrou no topo e a lista já o desenhou (o efeito roda
  // depois do dela): se ele está fora da vista (o teclado encolheu a lista),
  // ela rola só até ele aparecer.
  const firstKey = items[0] ? commentKey(items[0]) : null;
  const revealNewComment = useEffectEvent(() => {
    if (pendingReveal.current === null || pendingReveal.current !== firstKey) return;
    pendingReveal.current = null;
    const list = listRef.current;
    const box = list?.getLayout(0);
    if (!list || !box) return;
    const top = box.y + list.getFirstItemOffset();
    const bottom = top + box.height;
    const viewport = list.getWindowSize().height;
    const y = scrollY.current;
    const offset = top < y ? top : bottom > y + viewport ? bottom - viewport : null;
    if (offset !== null) {
      list.scrollToOffset({ offset: Math.max(0, offset), animated: !reducedMotion });
    }
  });
  useEffect(() => {
    revealNewComment();
  }, [firstKey]);

  const send = (text: string): void => {
    const localId = commenting.send(text);
    pendingReveal.current = localId;
    setSentKeys((keys) => new Set(keys).add(localId));
  };

  // A página seguinte espera a busca a caminho em vez de cancelá-la.
  const loadMore = (): void => {
    if (!comments.hasNextPage || comments.isFetchingNextPage || comments.isFetchNextPageError) {
      return;
    }
    void comments.fetchNextPage({ cancelRefetch: false });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  };

  const header = (
    <View style={styles.header}>
      <BackHeader title={t('post.title')} />
    </View>
  );

  if (!post.data) {
    return (
      <Screen padded={false} contentStyle={styles.screen}>
        {header}
        {postFailed ? (
          postMissing ? (
            // O voltar é o do título: um segundo "Voltar" só repetiria para o leitor.
            <EmptyState message={t('post.details.notFound')} />
          ) : (
            <EmptyState
              tone="error"
              message={t('post.details.loadError')}
              onAction={() => void post.refetch()}
              actionLoading={post.isFetching}
            />
          )
        ) : (
          <PostSkeleton accessibilityLabel={t('post.details.loading')} />
        )}
      </Screen>
    );
  }

  const unsent = unsentCount(local.comments, serverComments);
  const current =
    unsent > 0 ? { ...post.data, commentCount: post.data.commentCount + unsent } : post.data;

  const renderPlaceholder = () => {
    if (commentsState === 'loading') {
      return <CommentRowsSkeleton accessibilityLabel={t('post.comments.loading')} />;
    }
    if (commentsState === 'error') {
      return (
        <EmptyState
          tone="error"
          message={t('post.comments.loadError')}
          onAction={() => void comments.refetch()}
          actionLoading={comments.isFetching}
        />
      );
    }
    return <EmptyState icon={MessageCircle} message={t('post.comments.empty')} />;
  };

  // No pé, com comentários na tela: a lista do servidor ainda vindo (os do
  // fã chegaram antes), a página seguinte ou a falha de uma das duas.
  const renderFooter = () => {
    if (items.length === 0) return null;
    if (commentsState !== 'ready') return renderPlaceholder();
    if (comments.isFetchNextPageError) {
      return (
        <EmptyState
          tone="error"
          message={t('post.comments.moreError')}
          onAction={() => void comments.fetchNextPage({ cancelRefetch: false })}
          actionLoading={comments.isFetchingNextPage}
        />
      );
    }
    if (comments.isFetchingNextPage) {
      return <ActivityIndicator color={colors.accent} style={styles.nextPage} />;
    }
    return null;
  };

  // O teclado flutuante do Android avisa altura zero e o topo dele acima da
  // barra de navegação: ligado, o `KeyboardAvoidingView` subia o compositor a
  // altura da barra, e o pé dele dobrava. No Android, ele só liga com o
  // teclado cobrindo o pé da tela. No iOS fica sempre ligado: ligar no mesmo
  // aviso do teclado perderia a animação dele, que sai desse aviso.
  return (
    <KeyboardAvoidingView behavior="padding" enabled={isIOS || keyboardVisible} style={styles.fill}>
      <Screen padded={false} contentStyle={styles.screen}>
        {header}
        <FlashList<PostComment>
          ref={listRef}
          data={items}
          keyExtractor={commentKey}
          renderItem={({ item }) => (
            <CommentRow
              comment={item}
              now={now}
              mine={uid !== null && item.authorId === uid}
              animateIn={item.status === 'pending' && sentKeys.has(commentKey(item))}
              onRetry={() => commenting.retry(item.id)}
            />
          )}
          extraData={now.getTime()}
          ListHeaderComponent={
            <PostHeader
              post={current}
              now={now}
              onToggleLike={() => like.toggle(current.id, !current.likedByMe)}
              onComment={() => composer.current?.focus()}
            />
          }
          ListEmptyComponent={renderPlaceholder()}
          ListFooterComponent={renderFooter()}
          // Sem segurar o que está à vista: o comentário novo entra no topo e
          // empurra os outros para baixo, e a tela só rola se ele ficar fora da vista.
          maintainVisibleContentPosition={{ disabled: true }}
          onEndReached={loadMore}
          onScroll={handleScroll}
          testID="comments-list"
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={isIOS ? 'interactive' : 'on-drag'}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
        <CommentComposer
          ref={composer}
          onSend={send}
          sending={local.sending}
          award={commenting.award}
          keyboardVisible={keyboardVisible}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // O compositor cuida da área segura de baixo.
  screen: {
    paddingBottom: 0,
  },
  header: {
    paddingHorizontal: spacing.gutter,
  },
  fill: {
    flex: 1,
  },
  list: {
    paddingBottom: spacing.lg,
  },
  commentsTitle: {
    paddingHorizontal: spacing.gutter,
    borderTopWidth: borderWidths.default,
    borderTopColor: colors.divider,
  },
  nextPage: {
    paddingVertical: spacing.lg,
  },
});
