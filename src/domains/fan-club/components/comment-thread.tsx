import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text, type TextInstance } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { t } from '@/i18n';
import { colors, layout, motion, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

import { isDelivered, mergeReplies, replyTotal } from '../comments';
import { useFanClubCommentsQuery } from '../queries';
import type { FanClubCommentLine } from '../types';
import { FanClubCommentRow } from './comment-row';

// O recuo da resposta, um nível (R7), igual ao da linha.
const NESTED_INDENT = layout.avatar.sm.size + spacing.listGap;

/** Quem vê a conversa: a conta, o "Você" de agora e o que ela pode fazer. */
export interface CommentViewer {
  uid: string | null;
  me: { name: string | null; photoURL: string | null };
  /** O gestor do fã-clube: vê as respostas que ocultou no "Ver N respostas". */
  isOwner: boolean;
  /** Segue ou é o gestor, sem a conta suspensa: responde. */
  canReply: boolean;
  suspended: boolean;
}

export interface CommentThreadProps {
  /** O comentário de cima. */
  comment: FanClubCommentLine;
  postId: string;
  now: Date;
  viewer: CommentViewer;
  /** As respostas desta conversa estão abertas (a tela guarda, para a célula reciclada). */
  expanded: boolean;
  onExpand: (commentId: string) => void;
  /** As respostas do fã que ainda não estão na lista do servidor, da mais antiga. */
  localReplies: readonly FanClubCommentLine[];
  onReply: (comment: FanClubCommentLine) => void;
  onRetry: (localId: string) => void;
  onOpenArtist: (artistId: string) => void;
}

/** "Ver 3 respostas", "Ver 1 resposta". */
function seeRepliesText(count: number): string {
  if (count === 1) return t('fanClub.comments.seeRepliesOne');
  return t('fanClub.comments.seeReplies', { count: formatNumber(count) });
}

/**
 * Uma conversa da tela da publicação (seção 37, 37.9, item 3): o comentário
 * de cima e, embaixo dele, "Ver N respostas", que carrega as respostas
 * (`?replyTo=`, da mais antiga) e as mostra recuadas um nível, com "Ver mais
 * respostas" quando há outra página. Para o gestor, o "Ver N respostas" soma
 * as que ele ocultou. As do fã que ainda vão ficam no fim. Abrir as respostas
 * leva o foco do leitor de tela à primeira que chegou (o "Ver" some), e o "Ver
 * mais respostas", à primeira da página nova. Sem nada para mostrar (as
 * respostas sumiram, ou o fã bloqueou quem respondeu), a frase "Nenhuma
 * resposta para mostrar." recebe o foco; a página nova vazia e sem outra o
 * devolve à última resposta. A página vazia com mais adiante pede a seguinte
 * sozinha, uma vez, como a lista dos de cima.
 */
export function CommentThread({
  comment,
  postId,
  now,
  viewer,
  expanded,
  onExpand,
  localReplies,
  onReply,
  onRetry,
  onOpenArtist,
}: CommentThreadProps) {
  const delivered = isDelivered(comment);
  const replies = useFanClubCommentsQuery(postId, comment.id, expanded && delivered);
  const server = replies.data?.pages.flatMap((page) => page.items) ?? [];
  const lines = expanded ? mergeReplies(server, localReplies) : [...localReplies];
  const total = replyTotal(comment, viewer.isOwner);
  const name = comment.author.name ?? t('post.comments.fallbackName');
  const focusTarget = useRef<View>(null);
  const emptyRef = useRef<TextInstance>(null);
  // A posição da resposta que recebe o foco quando chegar (abrir, ver mais).
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const loaded = server.length;
  // As respostas chegaram todas, sem erro e sem nada indo.
  const settled =
    expanded &&
    delivered &&
    !replies.isPending &&
    !replies.isFetching &&
    !replies.isError &&
    !replies.hasNextPage;
  // Abertas, sem nenhuma para mostrar: o "Ver" sumiu, e a frase fica no lugar dele.
  const settledEmpty = settled && lines.length === 0;
  // A página nova não trouxe nada e não há outra: o "Ver mais" some, e o foco
  // vai à última resposta que já estava.
  const focusAt =
    focusIndex !== null && settled && loaded > 0 && loaded <= focusIndex ? loaded - 1 : focusIndex;

  useEffect(() => {
    if (focusAt === null || (!settledEmpty && loaded <= focusAt)) return;
    const timer = setTimeout(() => {
      const node = settledEmpty ? emptyRef.current : focusTarget.current;
      if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
      setFocusIndex(null);
    }, motion.duration.fast);
    return () => clearTimeout(timer);
  }, [loaded, focusAt, settledEmpty]);

  // A última página chegou vazia e ainda há mais: pede a seguinte, uma vez por
  // página, como a lista dos de cima (`PostContent`).
  const pages = replies.data?.pages;
  const lastPage = pages?.at(-1);
  const emptyWithMore =
    expanded && !!lastPage && lastPage.items.length === 0 && lastPage.nextCursor !== null;
  const autoLoaded = useRef(0);
  const pageCount = pages?.length ?? 0;
  useEffect(() => {
    if (!emptyWithMore || autoLoaded.current >= pageCount) return;
    if (replies.isFetchingNextPage || replies.isFetchNextPageError) return;
    autoLoaded.current = pageCount;
    void replies.fetchNextPage({ cancelRefetch: false });
  }, [emptyWithMore, pageCount, replies]);

  useAnnounceWhen(
    expanded && replies.isError && !replies.isFetching,
    t('fanClub.comments.repliesError'),
  );

  const expand = (): void => {
    setFocusIndex(0);
    onExpand(comment.id);
  };
  const loadMore = (): void => {
    if (replies.isFetchingNextPage) return;
    setFocusIndex(loaded);
    void replies.fetchNextPage({ cancelRefetch: false });
  };
  // A resposta nunca nasce embaixo de um comentário oculto (37.6): o gestor vê
  // as respostas do comentário de cima que ocultou, sem o "Responder" (o
  // servidor recusaria com o 404 do comentário).
  const replyHandler = (line: FanClubCommentLine) =>
    viewer.canReply && isDelivered(line) && comment.hidden !== 'manager'
      ? () => onReply(line)
      : undefined;

  return (
    <View testID={`club-thread-${comment.localId ?? comment.id}`}>
      <FanClubCommentRow
        comment={comment}
        now={now}
        mine={viewer.uid !== null && comment.author.uid === viewer.uid}
        me={viewer.me}
        viewerIsOwner={viewer.isOwner}
        onReply={replyHandler(comment)}
        onRetry={() => onRetry(comment.id)}
        refusedLocked={viewer.suspended}
        onOpenArtist={onOpenArtist}
      />
      {delivered && !expanded && total > 0 ? (
        <TextLink
          label={seeRepliesText(total)}
          onPress={expand}
          textVariant="labelCompact"
          accessibilityLabel={t('fanClub.comments.seeRepliesLabel', {
            replies: seeRepliesText(total),
            name,
          })}
          style={styles.more}
          testID={`club-thread-${comment.id}-replies`}
        />
      ) : null}
      {expanded && replies.isPending ? (
        <ActivityIndicator
          color={colors.textMuted}
          accessibilityLabel={t('fanClub.comments.repliesLoading')}
          style={[styles.more, styles.loading]}
        />
      ) : null}
      {expanded && replies.isError && replies.data === undefined ? (
        <View style={styles.more}>
          <Text variant="caption" color={colors.danger}>
            {t('fanClub.comments.repliesError')}
          </Text>
          <TextLink
            label={t('common.retry')}
            onPress={() => void replies.refetch()}
            textVariant="labelCompact"
            style={styles.retry}
          />
        </View>
      ) : null}
      {lines.map((line, index) => (
        <FanClubCommentRow
          key={line.localId ?? line.id}
          comment={line}
          now={now}
          nested
          mine={viewer.uid !== null && line.author.uid === viewer.uid}
          me={viewer.me}
          viewerIsOwner={viewer.isOwner}
          onReply={replyHandler(line)}
          onRetry={() => onRetry(line.id)}
          refusedLocked={viewer.suspended}
          onOpenArtist={onOpenArtist}
          focusRef={index === focusAt ? focusTarget : undefined}
        />
      ))}
      {settledEmpty ? (
        <Text
          ref={emptyRef}
          variant="caption"
          color={colors.textMuted}
          style={styles.more}
          testID={`club-thread-${comment.id}-empty`}
        >
          {t('fanClub.comments.noReplies')}
        </Text>
      ) : null}
      {expanded && replies.hasNextPage ? (
        <TextLink
          label={t('fanClub.comments.moreReplies')}
          onPress={loadMore}
          textVariant="labelCompact"
          accessibilityLabel={t('fanClub.comments.moreRepliesLabel', { name })}
          disabled={replies.isFetchingNextPage}
          style={styles.more}
          testID={`club-thread-${comment.id}-more`}
        />
      ) : null}
      {expanded && replies.isFetchNextPageError ? (
        <Text variant="caption" color={colors.danger} style={styles.more}>
          {t('fanClub.comments.repliesError')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // "Ver N respostas" e "Ver mais respostas" no recuo das respostas.
  more: {
    alignSelf: 'flex-start',
    marginLeft: spacing.gutter + NESTED_INDENT,
  },
  loading: {
    minHeight: layout.minTouchTarget,
  },
  retry: {
    alignSelf: 'flex-start',
  },
});
