import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams, useNavigationContainerRef } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { BackHeader } from '@/components/header';
import { PointsToast } from '@/components/points-toast';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import {
  CommentComposer,
  CommentRowsSkeleton,
  commentKey,
  mergeComments,
  openArtistOverStack,
  type CommentComposerHandle,
  type ComposerSelection,
} from '@/domains/posts';
import { useFanIdentity, useSuspension, useWatchMyProfile } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useIsOnline } from '@/hooks/use-is-online';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { useNow } from '@/hooks/use-now';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { alertActionRefusal } from '@/services/refusal-alert';
import { borderWidths, colors, motion, radii, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

import { FanClubPostCard } from '../components/club-post-card';
import { placeOwnHidden } from '../comments';
import {
  CommentThread,
  type CommentModeration,
  type CommentViewer,
} from '../components/comment-thread';
import { FollowToComment } from '../components/follow-to-comment';
import { MentionSuggestions } from '../components/mention-suggestions';
import { fanClubErrorText } from '../describe';
import { isDefinitiveRefusal } from '../entry';
import { mentionDraftAt, replyPrefix, sameDraft, type MentionDraft } from '../mentions';
import {
  cachedFanClubCommentReview,
  useAddFanClubCommentMutation,
  useFanClubCommentsQuery,
  useFanClubGate,
  useFanClubMentionsQuery,
  useFanClubPostQuery,
  useFollowFanClubMutation,
  useHideFanClubCommentMutation,
  useLocalFanClubComments,
  useRequestFanClubCommentReviewMutation,
  useShareFanClub,
  type FanClubCommentRefusal,
  type FanClubReplyTarget,
} from '../queries';
import type { FanClubCommentLine, FanClubPostDetails, MentionSuggestion } from '../types';

const isIOS = Platform.OS === 'ios';
const SKELETON_HEIGHT = 180;
const NO_LINES: readonly FanClubCommentLine[] = [];

/**
 * O 404 da publicação: a que saiu do ar, a de fã-clube que não aparece e a
 * rota que não existe no servidor de antes (37.16) dizem o mesmo.
 */
const isGone = (error: unknown): boolean => error instanceof ApiError && error.kind === 'notFound';

/**
 * O link "Escrever para a equipe" embaixo da frase da recusa: a conta
 * suspensa e o texto recusado pelo filtro têm; o teto e o respondido que saiu, não.
 */
const REFUSAL_CONTACT: Record<FanClubCommentRefusal['type'], TranslationKey | null> = {
  suspended: 'suspension.mailSubject',
  content: 'contentFilter.mailSubject',
  dailyLimit: null,
  replyGone: null,
};

/**
 * "/fa-clube/publicacao/[publicacaoId]" (seção 37, 37.9, item 3; a etapa 6 de
 * 37.13): a tela da publicação, na pilha raiz, por cima das abas, no molde do
 * `post/[postId]`: o card da publicação no cabeçalho e os comentários,
 * com o campo preso ao pé. Inerte antes da abertura, como a página: sem a
 * resposta da trava, diz que o fã-clube não está disponível e não chama mais
 * nada. No 404: "Esta publicação não está mais disponível."
 */
export function FanClubPostScreen() {
  const params = useLocalSearchParams<{ publicacaoId: string }>();
  const postId = typeof params.publicacaoId === 'string' ? params.publicacaoId : '';
  return <PostScreen key={postId} postId={postId} />;
}

function PostScreen({ postId }: { postId: string }) {
  const focused = useIsFocused();
  const { query: gate, live } = useFanClubGate();
  const post = useFanClubPostQuery(postId, live !== null);
  // Vale também com a publicação no cache: a busca que falha deixa o dado antigo no lugar.
  const missing = isGone(post.error);
  const gateFailed = live === null && gate.isError && !isDefinitiveRefusal(gate.error);
  const failed = post.data === undefined && post.isError && !missing;

  useAnnounceWhen(focused && gateFailed && !gate.isFetching, t('fanClub.loadError'));
  useAnnounceWhen(focused && live !== null && missing, t('fanClub.postNotFound'));
  useAnnounceWhen(focused && failed && !post.isFetching, t('fanClub.postScreen.loadError'));

  if (live !== null && post.data && !missing) {
    return <PostContent post={post.data} updatedAt={post.dataUpdatedAt} />;
  }

  let body;
  if (live === null) {
    body = gate.isPending ? (
      <PostSkeleton />
    ) : gateFailed ? (
      <EmptyState
        tone="error"
        message={t('fanClub.loadError')}
        onAction={() => void gate.refetch()}
        actionLoading={gate.isFetching}
      />
    ) : (
      <View testID="fan-club-post-not-available">
        <EmptyState message={t('fanClub.notAvailable')} />
      </View>
    );
  } else if (missing) {
    // O voltar é o do título: um segundo "Voltar" só repetiria para o leitor.
    body = (
      <View testID="fan-club-post-not-found">
        <EmptyState message={t('fanClub.postNotFound')} />
      </View>
    );
  } else if (failed) {
    body = (
      <EmptyState
        tone="error"
        message={t('fanClub.postScreen.loadError')}
        onAction={() => void post.refetch()}
        actionLoading={post.isFetching}
      />
    );
  } else {
    body = <PostSkeleton />;
  }

  return (
    <Screen padded={false} contentStyle={styles.screen}>
      <ScreenHeader />
      <View style={styles.placeholder}>{body}</View>
    </Screen>
  );
}

function ScreenHeader() {
  return (
    <View style={styles.header}>
      <BackHeader title={t('fanClub.postScreen.title')} />
    </View>
  );
}

function PostSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('fanClub.postScreen.loading')}>
      <Skeleton height={SKELETON_HEIGHT} tone="surface" radius={radii.lg} />
    </SkeletonGroup>
  );
}

/** O modo resposta: para quem vai, o @ que abre o texto e o nome na linha. */
interface ReplyState {
  target: FanClubReplyTarget;
  /** "@fulano ", ou vazio quando quem foi respondido não tem @. */
  prefix: string;
  label: string;
  cancelLabel: string;
}

type CommentsState = 'loading' | 'error' | 'ready';

/**
 * A publicação com os comentários, só depois da trava. Uma lista só: o card
 * (a variante da página) é o cabeçalho da FlashList, e os comentários de cima
 * são os itens, do mais novo ao mais antigo, cada um com as respostas dele
 * (`CommentThread`). O campo fica fora dela, no pé, no `KeyboardAvoidingView`
 * em volta do `Screen`, como no Mural. No cabeçalho, o botão dos comentários
 * do card leva o foco ao campo (ou ao "Seguir o fã-clube" de quem não segue).
 * A página vazia com mais adiante pede a seguinte sozinha, uma vez.
 *
 * Quem segue e o gestor comentam e respondem; quem não segue lê e vê o
 * "Seguir o fã-clube" no lugar do campo; o suspenso vê a frase da suspensão.
 * "Responder" põe o campo no modo resposta, com o @ de quem foi respondido no
 * começo do texto (R7); a resposta enviada abre as respostas da conversa, e a
 * recusada volta ao campo no modo resposta dela. O seguir mora aqui, e não no
 * pé: o pé troca no próprio sucesso, e o "+N" da entrada sobe da tela.
 *
 * A moderação (37.6 e 37.9, itens 4 e 10; a etapa 7 de 37.13): o botão de
 * opções dos comentários dos outros abre a sheet "Opções do comentário"
 * (Denunciar e Bloquear); o gestor oculta e reexibe; o autor vê os dele
 * ocultos pelo gestor (o `ownHidden`), pela data, e pede revisão. Ocultar,
 * Reexibir e Pedir revisão confirmam por `Alert`.
 */
function PostContent({ post, updatedAt }: { post: FanClubPostDetails; updatedAt: number }) {
  useWatchMyProfile();
  const queryClient = useQueryClient();
  const navigation = useNavigationContainerRef();
  const { uid, name: myName, photoURL: myPhotoURL } = useFanIdentity();
  const keyboardVisible = useKeyboardVisible();
  const clock = useNow();
  const reducedMotion = usePrefersReducedMotion();
  const share = useShareFanClub();
  const { suspended } = useSuspension();
  const online = useIsOnline();
  const comments = useFanClubCommentsQuery(post.id, null, true);
  const local = useLocalFanClubComments(post.id);
  const composer = useRef<CommentComposerHandle>(null);
  const followButton = useRef<View>(null);
  const listRef = useRef<FlashListRef<FanClubCommentLine>>(null);
  const scrollY = useRef(0);
  const pendingReveal = useRef<string | null>(null);
  const followedHere = useRef(false);
  const follow = useFollowFanClubMutation();
  const [footerHeight, setFooterHeight] = useState(0);
  // O modo resposta de cada envio, pelo id da linha: a resposta recusada volta com ele.
  const sentReplies = useRef(new Map<string, ReplyState>());
  const [reply, setReply] = useState<ReplyState | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const canComment = post.isFollowing || post.isOwner;
  // O relógio anda de minuto em minuto; o dado que acabou de chegar pode ser mais novo que ele.
  const now = new Date(Math.max(clock.getTime(), updatedAt, comments.dataUpdatedAt));

  const commenting = useAddFanClubCommentMutation(
    { id: post.id, clubId: post.clubId, isOwner: post.isOwner },
    {
      restoreDraft: (text, localId) => {
        const restored = composer.current?.restore(text) ?? false;
        if (restored && localId !== null) {
          const previous = sentReplies.current.get(localId);
          sentReplies.current.delete(localId);
          if (previous) setReply(previous);
        }
        return restored;
      },
      focusDraft: () => composer.current?.focus(),
      suspended,
      // Só o modo resposta para o comentário que saiu: o de outro, aberto depois, fica.
      onReplyGone: (gone) =>
        setReply((current) => (current && current.target.commentId === gone ? null : current)),
    },
  );

  const viewer: CommentViewer = {
    uid,
    me: { name: myName, photoURL: myPhotoURL },
    isOwner: post.isOwner,
    canReply: canComment && !suspended,
    suspended,
  };

  const serverComments = comments.data?.pages.flatMap((page) => page.items) ?? [];
  // Os do fã ocultos pelo gestor entram pela data (o `ownHidden` da primeira página, 37.9, item 4).
  const placed = placeOwnHidden<FanClubCommentLine>(
    serverComments,
    comments.data?.pages[0]?.ownHidden,
  );
  const localTop = local.comments.filter((line) => line.replyToId === null);
  const items = mergeComments<FanClubCommentLine>(localTop, placed.top);
  const localReplies = (threadId: string): FanClubCommentLine[] =>
    local.comments.filter((line) => line.replyToId === threadId).reverse();
  const commentsState: CommentsState = comments.isPending
    ? 'loading'
    : comments.isError && comments.data === undefined
      ? 'error'
      : 'ready';
  // O total da publicação soma os do fã que ainda vão.
  const pendingCount = local.comments.filter((line) => line.status === 'pending').length;
  const current =
    pendingCount > 0 && post.commentCount !== undefined
      ? { ...post, commentCount: post.commentCount + pendingCount }
      : post;
  const commentTotal = current.commentCount ?? serverComments.length;

  useAnnounceWhen(commentsState === 'error' && !comments.isFetching, t('post.comments.loadError'));
  useAnnounceWhen(
    comments.isFetchNextPageError && !comments.isFetching,
    t('post.comments.moreError'),
  );

  // O comentário de cima novo entrou no topo e a lista já o desenhou: se ele
  // está fora da vista (o teclado encolheu a lista), ela rola só até ele.
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

  // Quem seguiu pelo pé da tela ganha o campo no lugar: o foco vai até ele.
  const focusAfterFollow = useEffectEvent(() => {
    if (!followedHere.current) return;
    followedHere.current = false;
    composer.current?.focus();
  });
  useEffect(() => {
    if (canComment) focusAfterFollow();
  }, [canComment]);

  // A última página chegou vazia e ainda há mais: pede a seguinte, uma vez por página.
  const pages = comments.data?.pages;
  const lastPage = pages?.at(-1);
  const emptyWithMore = !!lastPage && lastPage.items.length === 0 && lastPage.nextCursor !== null;
  const autoLoaded = useRef(0);
  const pageCount = pages?.length ?? 0;
  useEffect(() => {
    if (!emptyWithMore || autoLoaded.current >= pageCount) return;
    if (comments.isFetchingNextPage || comments.isFetchNextPageError) return;
    autoLoaded.current = pageCount;
    void comments.fetchNextPage({ cancelRefetch: false });
  }, [emptyWithMore, pageCount, comments]);

  const loadMore = (): void => {
    if (!comments.hasNextPage || comments.isFetchingNextPage || comments.isFetchNextPageError) {
      return;
    }
    void comments.fetchNextPage({ cancelRefetch: false });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  };

  const openArtist = (artistId: string): void =>
    openArtistOverStack(navigation.getRootState(), artistId);

  // O botão dos comentários do card, no cabeçalho: leva o foco ao campo, ao
  // "Seguir o fã-clube" de quem não segue, ou à frase da conta suspensa.
  const focusComposer = (): void => {
    if (canComment || suspended) {
      composer.current?.focus();
      return;
    }
    focusSoon(followButton);
  };

  const expand = (commentId: string): void => {
    setExpanded((open) => new Set(open).add(commentId));
  };

  // "Responder": o campo no modo resposta, com o @ de quem foi respondido no
  // começo do texto (no lugar do @ da resposta anterior, se ele ainda está lá).
  const startReply = (comment: FanClubCommentLine): void => {
    const username = comment.author.username;
    const prefix = username ? replyPrefix(username) : '';
    const handle = composer.current;
    if (handle) {
      const text = handle.getText();
      const previous = reply?.prefix ?? '';
      const replaced = previous !== '' && text.startsWith(previous) ? previous.length : 0;
      // O texto já começa com o @ certo, ou não há @ a pôr nem a tirar: o campo
      // só ganha o foco, sem mexer no texto nem no cursor.
      const keep = prefix === '' ? replaced === 0 : text.startsWith(prefix);
      if (keep) handle.focus();
      else handle.replaceRange(0, replaced, prefix);
    }
    const name = comment.author.name ?? t('post.comments.fallbackName');
    setReply({
      target: { commentId: comment.id, threadId: comment.replyToId ?? comment.id },
      prefix,
      label: username
        ? t('fanClub.comments.replyingTo', { username })
        : t('fanClub.comments.replyingToName', { name }),
      cancelLabel: t('fanClub.comments.cancelReply', { name: username ? `@${username}` : name }),
    });
  };

  const cancelReply = (): void => {
    const handle = composer.current;
    const prefix = reply?.prefix ?? '';
    if (handle && prefix !== '' && handle.getText().startsWith(prefix)) {
      handle.replaceRange(0, prefix.length, '');
    } else {
      handle?.focus();
    }
    setReply(null);
    // Depois de o foco chegar ao campo, na fila: a leitura do campo não corta a frase.
    setTimeout(
      () =>
        AccessibilityInfo.announceForAccessibilityWithOptions(t('fanClub.comments.replyCanceled'), {
          queue: true,
        }),
      motion.duration.fast * 2,
    );
  };

  const send = (text: string): void => {
    const target = reply?.target ?? null;
    const localId = commenting.send(text, target);
    if (reply) sentReplies.current.set(localId, reply);
    if (target) {
      // A resposta aparece embaixo do comentário de cima: as respostas dele abrem.
      expand(target.threadId);
      setReply(null);
    } else {
      pendingReveal.current = localId;
    }
  };

  const hide = useHideFanClubCommentMutation(post.id);
  const review = useRequestFanClubCommentReviewMutation(post.id);

  // O ocultar e o reexibir do gestor (37.6), confirmados por `Alert`: o
  // sucesso anuncia, e a recusa (o `staff_decided`, o fã-clube parado, o
  // comentário que saiu) diz a frase num `Alert`, que foca e anuncia. O
  // suspenso fica com o "Conta suspensa" do `SuspensionWatcher`.
  const confirmHidden = (comment: FanClubCommentLine, hidden: boolean): void => {
    Alert.alert(
      t(hidden ? 'fanClub.comments.hideTitle' : 'fanClub.comments.unhideTitle'),
      t(hidden ? 'fanClub.comments.hideBody' : 'fanClub.comments.unhideBody'),
      [
        { text: t('fanClub.comments.cancel'), style: 'cancel' },
        {
          text: t(hidden ? 'fanClub.comments.hideConfirm' : 'fanClub.comments.unhideConfirm'),
          style: hidden ? 'destructive' : 'default',
          onPress: () =>
            hide.mutate(
              { comment, hidden },
              {
                onSuccess: () => {
                  haptics.trigger('success');
                  AccessibilityInfo.announceForAccessibility(
                    t(hidden ? 'fanClub.comments.hiddenDone' : 'fanClub.comments.unhiddenDone'),
                  );
                },
                onError: (error) => {
                  haptics.trigger('error');
                  const refusal = actionRefusal(error, 'clubCommentHide');
                  // O suspenso: o "Conta suspensa", com "Escrever para a equipe".
                  if (alertActionRefusal(refusal.type, 'clubCommentHide')) return;
                  Alert.alert(t(fanClubErrorText(error)?.key ?? refusal.key));
                },
              },
            ),
        },
      ],
    );
  };

  // O "Pedir revisão" do autor (37.6), uma vez por ocultar, confirmado por
  // `Alert`. O `already_requested` diz o estado da lista nova: pedido noutro
  // aparelho, ou mantido pela equipe. O teto do dia abre o "Limite de hoje",
  // e o suspenso fica com o "Conta suspensa" do `SuspensionWatcher`.
  const confirmReview = (comment: FanClubCommentLine): void => {
    Alert.alert(t('fanClub.comments.reviewTitle'), t('fanClub.comments.reviewBody'), [
      { text: t('fanClub.comments.cancel'), style: 'cancel' },
      {
        text: t('fanClub.comments.reviewConfirm'),
        onPress: () =>
          review.mutate(comment.id, {
            onSuccess: (result) => {
              haptics.trigger('success');
              const state =
                result.status === 'requested'
                  ? 'requested'
                  : cachedFanClubCommentReview(queryClient, post.id, comment.id);
              if (state === null) return;
              AccessibilityInfo.announceForAccessibility(
                t(state === 'kept' ? 'fanClub.comments.reviewKept' : 'fanClub.comments.reviewSent'),
              );
            },
            onError: (error) => {
              haptics.trigger('error');
              const refusal = actionRefusal(error, 'clubCommentReview');
              if (alertActionRefusal(refusal.type, 'clubCommentReview')) return;
              Alert.alert(t(fanClubErrorText(error)?.key ?? refusal.key));
            },
          }),
      },
    ]);
  };

  const moderation: CommentModeration = {
    // A sheet "Opções do comentário" do fã-clube (37.9, item 10): Denunciar e Bloquear.
    onOptions: (comment) =>
      router.push({
        pathname: '/comentario-fa-clube/[comentarioId]',
        params: { comentarioId: comment.id, publicacao: post.id },
      }),
    onHide: (comment) => confirmHidden(comment, true),
    onUnhide: (comment) => confirmHidden(comment, false),
    onRequestReview: confirmReview,
    disabled: !online || hide.isPending || review.isPending,
  };

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

  // No pé, com comentários na tela: a lista ainda vindo, a página seguinte ou a falha.
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

  const header = (
    <View>
      <View style={styles.card}>
        <FanClubPostCard
          post={current}
          now={now}
          variant="page"
          canReport={!post.isOwner}
          canReact={canComment}
          onShare={() =>
            share({ id: post.clubId, name: post.clubName, artistName: post.artistName })
          }
          onReport={(item) =>
            router.push({
              pathname: '/denunciar-publicacao/[publicacaoId]',
              params: { publicacaoId: item.id },
            })
          }
          onOpenComments={focusComposer}
          commentsHint={t(
            suspended
              ? 'fanClub.comments.focusSuspendedHint'
              : canComment
                ? 'fanClub.comments.focusHint'
                : 'fanClub.comments.focusFollowHint',
          )}
          onOpenArtist={openArtist}
          testID="fan-club-post-card"
        />
      </View>
      <SectionHeader
        title={t('post.comments.title')}
        count={formatNumber(commentTotal)}
        spacing="compact"
        accessibilityLabel={t('post.comments.titleLabel', { count: formatNumber(commentTotal) })}
        style={styles.commentsTitle}
      />
    </View>
  );

  // O teclado flutuante do Android avisa altura zero: lá, o `KeyboardAvoidingView`
  // só liga com o teclado cobrindo o pé da tela; no iOS fica sempre ligado.
  return (
    <KeyboardAvoidingView behavior="padding" enabled={isIOS || keyboardVisible} style={styles.fill}>
      <Screen padded={false} contentStyle={styles.screen}>
        <ScreenHeader />
        <FlashList<FanClubCommentLine>
          ref={listRef}
          data={items}
          keyExtractor={commentKey}
          getItemType={(item) => (item.status === undefined ? 'comment' : 'local')}
          // A chave pela linha: as respostas abertas e o foco são da conversa,
          // e a célula reciclada para outra não pode herdá-los.
          renderItem={({ item }) => (
            <CommentThread
              key={commentKey(item)}
              comment={item}
              postId={post.id}
              now={now}
              viewer={viewer}
              expanded={expanded.has(item.id)}
              onExpand={expand}
              localReplies={localReplies(item.id)}
              hiddenReplies={placed.replies.get(item.id) ?? NO_LINES}
              moderation={moderation}
              onReply={startReply}
              onRetry={commenting.retry}
              onOpenArtist={openArtist}
            />
          )}
          extraData={{
            now: now.getTime(),
            expanded,
            viewer,
            local: local.comments,
            reply,
            moderationDisabled: moderation.disabled,
          }}
          ListHeaderComponent={header}
          ListEmptyComponent={renderPlaceholder()}
          ListFooterComponent={renderFooter()}
          // O comentário novo entra no topo e empurra os outros; a tela só rola se ele ficar fora da vista.
          maintainVisibleContentPosition={{ disabled: true }}
          onEndReached={loadMore}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={isIOS ? 'interactive' : 'on-drag'}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          testID="fan-club-comments-list"
        />
        {/* O pé troca do seguir para o campo no sucesso do seguir; o "+N" fica de fora da troca. */}
        <View
          style={styles.footer}
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        >
          {canComment || suspended ? (
            <CommentArea
              composerRef={composer}
              clubId={post.clubId}
              postId={post.id}
              onSend={send}
              sending={local.sending}
              keyboardVisible={keyboardVisible}
              suspended={suspended}
              refusal={
                commenting.refusal
                  ? {
                      text: t(commenting.refusal.key),
                      contact: REFUSAL_CONTACT[commenting.refusal.type],
                    }
                  : null
              }
              onEditAfterRefusal={commenting.dismissEditableRefusal}
              reply={
                reply
                  ? { label: reply.label, cancelLabel: reply.cancelLabel, onCancel: cancelReply }
                  : null
              }
            />
          ) : (
            <FollowToComment
              post={post}
              keyboardVisible={keyboardVisible}
              follow={follow}
              buttonRef={followButton}
              onFollowed={() => {
                followedHere.current = true;
              }}
            />
          )}
          {/* Depois do pé, para ficar por cima dele; nasce na borda de cima. */}
          <PointsToast
            points={follow.award?.points ?? 0}
            trigger={follow.award?.id ?? null}
            announcement={follow.award?.announcement}
            haptic={follow.award?.haptic}
            style={{ bottom: footerHeight + spacing.xs }}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** Leva o foco do leitor de tela ao elemento, depois de o toque terminar. */
function focusSoon(target: RefObject<View | null>): void {
  setTimeout(() => {
    if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
  }, motion.duration.fast);
}

interface CommentAreaProps {
  composerRef: RefObject<CommentComposerHandle | null>;
  clubId: string;
  postId: string;
  onSend: (text: string) => void;
  sending: boolean;
  keyboardVisible: boolean;
  suspended: boolean;
  refusal: { text: string; contact: TranslationKey | null } | null;
  onEditAfterRefusal: () => void;
  reply: { label: string; cancelLabel: string; onCancel: () => void } | null;
}

/**
 * O campo do Mural com a sugestão do @ (37.9, item 6): o @ que está sendo
 * digitado antes do cursor mora aqui, para a lista não redesenhar a cada
 * tecla. A conversa é pedida uma vez, quando o campo ganha o foco, e a barra
 * aparece acima do teclado com um "@" seguido de até 30 letras antes do
 * cursor. Escolher troca o @ digitado pelo @ inteiro e um espaço, com o foco
 * no campo.
 */
function CommentArea({
  composerRef,
  clubId,
  postId,
  onSend,
  sending,
  keyboardVisible,
  suspended,
  refusal,
  onEditAfterRefusal,
  reply,
}: CommentAreaProps) {
  const [draft, setDraft] = useState<MentionDraft | null>(null);
  const [opened, setOpened] = useState(false);
  const conversation = useFanClubMentionsQuery(clubId, postId, opened && !suspended);
  const latestDraft = useRef<MentionDraft | null>(null);

  const changeDraft = (text: string, selection: ComposerSelection): void => {
    const next = selection.start === selection.end ? mentionDraftAt(text, selection.end) : null;
    if (sameDraft(next, latestDraft.current)) return;
    latestDraft.current = next;
    setDraft(next);
  };

  const pick = (item: MentionSuggestion): void => {
    const current = latestDraft.current;
    if (!current) return;
    composerRef.current?.replaceRange(current.start, current.end, `@${item.username} `);
  };

  return (
    <CommentComposer
      ref={composerRef}
      onSend={onSend}
      sending={sending}
      award={null}
      keyboardVisible={keyboardVisible}
      suspended={suspended}
      refusal={refusal}
      onEditAfterRefusal={onEditAfterRefusal}
      reply={reply}
      onDraftChange={changeDraft}
      onFieldFocus={() => setOpened(true)}
      accessory={
        draft ? (
          <MentionSuggestions
            clubId={clubId}
            postId={postId}
            draft={draft}
            conversation={conversation.data?.items ?? []}
            onPick={pick}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  // O campo cuida da área segura de baixo.
  screen: {
    paddingBottom: 0,
  },
  header: {
    paddingHorizontal: spacing.gutter,
  },
  placeholder: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
  },
  fill: {
    flex: 1,
  },
  card: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
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
  // Por cima da lista: o "+N" do seguir sobe para fora do pé, sobre os comentários.
  footer: {
    zIndex: 1,
  },
});
