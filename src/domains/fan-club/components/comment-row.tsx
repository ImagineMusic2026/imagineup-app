import { router } from 'expo-router';
import { Ellipsis } from 'lucide-react-native';
import { useEffect, useRef, type Ref } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { PressableScale } from '@/components/pressable-scale';
import { Text, type TextInstance } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { fanProfileHref } from '@/domains/profile';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors, isLargeText, layout, motion, spacing } from '@/theme';
import { formatRelativeAgoSpoken, formatRelativeShort } from '@/utils/date';

import type { FanClubCommentLine } from '../types';
import { MentionText } from './mention-text';

// A linha do comentário do fã-clube (seção 37, 37.9, item 4). A linha do
// Mural (`CommentRow`) é um pressável só, e um @ no texto seria pressável
// dentro de pressável. Aqui a linha não é pressável: o autor (o avatar, o
// nome, o @ e a marca "Gestor") é o pressável que abre o perfil; o texto é um
// `Text` com os @ como links em linha, que o leitor acha pelo rotor e pelo
// menu de links; e o "Responder", o "Ocultar" e o "Reexibir" do gestor, o
// "Pedir revisão" do autor e o botão de opções são irmãos deles (a etapa 7 de
// 37.13). A linha local (enviando, "Não enviado" e "Não publicado") vem do
// Mural, um pressável só, sem link (os @ só se resolvem no servidor).

// Avatar apagado enquanto vai ou oculto: é imagem, o contraste vale para o texto.
const DIM_AVATAR_OPACITY = 0.5;
// O recuo da resposta: um nível, o avatar e o vão, como o texto do comentário de cima.
const NESTED_INDENT = layout.avatar.sm.size + spacing.listGap;
// Os três pontos das opções, num alvo de 44, como no Mural.
const OPTIONS_ICON_SIZE = 16;

export interface FanClubCommentRowProps {
  comment: FanClubCommentLine;
  /** Relógio da tela (`useNow`), para o "2 h" andar sozinho. */
  now: Date;
  /** Do próprio fã: "Você", com o nome e a foto de agora. */
  mine: boolean;
  me: { name: string | null; photoURL: string | null };
  /** Quem vê é o gestor do fã-clube: o oculto diz "Oculto por você". */
  viewerIsOwner: boolean;
  /** Uma resposta, recuada um nível (R7). */
  nested?: boolean;
  /** "Responder": de quem pode comentar, no comentário entregue e à vista. */
  onReply?: () => void;
  /** O botão de opções (Denunciar e Bloquear), no comentário de outro, à vista (37.9, item 10). */
  onOptions?: () => void;
  /** "Ocultar", do gestor, no comentário de outro, à vista (37.6). */
  onHide?: () => void;
  /** "Reexibir", do gestor, no que ele ocultou. */
  onUnhide?: () => void;
  /** "Pedir revisão", do autor, no oculto pelo gestor, uma vez por ocultar. */
  onRequestReview?: () => void;
  /**
   * Um pedido de moderação está indo, ou sem internet: o "Ocultar", o
   * "Reexibir" e o "Pedir revisão" ficam desligados.
   */
  busy?: boolean;
  /** Toque na linha que não foi enviada (tenta de novo) ou não foi publicada (devolve o texto). */
  onRetry?: () => void;
  /** A conta suspensa: o "Não publicado" só diz o motivo, sem toque. */
  refusedLocked?: boolean;
  /** Abre a central de um @ do texto. */
  onOpenArtist: (artistId: string) => void;
  /** O primeiro foco da linha (o autor), para o leitor chegar a ela ao abrir as respostas. */
  focusRef?: Ref<View>;
}

/** O nome que a linha mostra: "Você", o nome, o @ ou "Fã". */
function displayName(comment: FanClubCommentLine, mine: boolean): string {
  if (mine) return t('post.comments.you');
  const { name, username } = comment.author;
  return name ?? (username ? `@${username}` : t('post.comments.fallbackName'));
}

/**
 * O autor para o leitor de tela: o nome, o @, a marca de gestor e quando
 * ("Thalita Santos, @thalitasan, gestor do fã-clube, há 2 horas").
 */
function authorLabel(comment: FanClubCommentLine, mine: boolean, now: Date): string {
  const { name, username } = comment.author;
  const parts = [displayName(comment, mine)];
  if (!mine && name && username) parts.push(`@${username}`);
  if (comment.isManager) parts.push(t('fanClub.comments.managerLabel'));
  parts.push(formatRelativeAgoSpoken(comment.createdAt, now));
  return parts.join(', ');
}

/**
 * Um comentário entregue: o autor (pressável que abre o perfil, menos no
 * "Você"), o texto com os links e as ações, irmãs deles: "Responder", o
 * "Ocultar" do gestor e o botão de opções (Denunciar e Bloquear) nos
 * comentários dos outros (37.9, itens 4 e 10). O oculto pelo gestor aparece
 * esmaecido com a `Pill` e sem "Responder" (ninguém responde ao que está
 * oculto): para o gestor, "Oculto por você" e "Reexibir"; para o autor,
 * "Oculto pelo gestor" e "Pedir revisão" (depois, "Revisão pedida" ou "A
 * equipe manteve oculto"). Com a fonte grande, o nome não corta: o @ e a hora
 * descem para baixo dele, e as ações quebram a linha.
 */
export function FanClubCommentRow(props: FanClubCommentRowProps) {
  if (props.comment.status !== undefined) return <LocalCommentRow {...props} />;
  return <DeliveredCommentRow {...props} />;
}

function DeliveredCommentRow({
  comment,
  now,
  mine,
  me,
  viewerIsOwner,
  nested = false,
  onReply,
  onOptions,
  onHide,
  onUnhide,
  onRequestReview,
  busy = false,
  onOpenArtist,
  focusRef,
}: FanClubCommentRowProps) {
  const largeText = isLargeText(useWindowDimensions().fontScale);
  const hidden = comment.hidden === 'manager';
  const { author } = comment;
  const name = displayName(comment, mine);
  const testID = `club-comment-${comment.id}`;
  const reply = onReply && !hidden ? onReply : undefined;
  // O estado do pedido de revisão, só para o autor (o `review` só vem para ele).
  const reviewState =
    comment.review === 'kept'
      ? t('fanClub.comments.reviewKept')
      : comment.review === 'requested'
        ? t('fanClub.comments.reviewRequested')
        : null;
  const hasActions = hidden || !!reply || !!onHide;
  // O "Ocultar" e o "Reexibir" do gestor dividem o mesmo lugar na fileira.
  const toggleHidden = hidden ? onUnhide : onHide;

  // O "Pedir revisão" que o servidor confirmou dá lugar ao estado: o foco do
  // leitor vai a ele, no lugar do botão que sumiu.
  const reviewRef = useRef<TextInstance>(null);
  const previousReview = useRef(reviewState);
  useEffect(() => {
    const appeared = previousReview.current === null && reviewState !== null;
    previousReview.current = reviewState;
    if (!appeared) return;
    const timer = setTimeout(() => {
      if (reviewRef.current) AccessibilityInfo.sendAccessibilityEvent(reviewRef.current, 'focus');
    }, motion.duration.fast);
    return () => clearTimeout(timer);
  }, [reviewState]);

  const head = (
    <>
      <View style={hidden && styles.dimAvatar}>
        <Avatar
          name={mine ? (me.name ?? author.name) : (author.name ?? author.username)}
          id={author.uid}
          photoUrl={mine ? me.photoURL : author.photoURL}
          size="sm"
        />
      </View>
      <View style={[styles.head, largeText && styles.headWrap]}>
        <Text
          variant="label"
          color={hidden ? colors.textSubtle : colors.text}
          numberOfLines={largeText ? undefined : 1}
          style={styles.name}
        >
          {name}
        </Text>
        {!mine && author.name && author.username ? (
          <Text
            variant="metaSmall"
            color={colors.textMuted}
            numberOfLines={largeText ? undefined : 1}
            style={styles.handle}
          >
            {`@${author.username}`}
          </Text>
        ) : null}
        {comment.isManager ? <Pill label={t('fanClub.comments.manager')} size="xs" caps /> : null}
        <Text variant="metaSmall" color={colors.textMuted}>
          {t('post.meta', { time: formatRelativeShort(comment.createdAt, now) })}
        </Text>
      </View>
    </>
  );

  return (
    <View style={[styles.row, nested && styles.nested]} testID={testID}>
      <View style={styles.top}>
        {mine ? (
          // O próprio fã não abre o próprio perfil daqui, como no Mural.
          <View
            ref={focusRef}
            accessible
            accessibilityLabel={authorLabel(comment, mine, now)}
            style={styles.author}
            testID={`${testID}-author`}
          >
            {head}
          </View>
        ) : (
          <PressableScale
            ref={focusRef}
            onPress={() => router.push(fanProfileHref(author.uid))}
            accessibilityRole="link"
            accessibilityLabel={authorLabel(comment, mine, now)}
            accessibilityHint={t('fanProfile.openHint', { name })}
            style={styles.author}
            testID={`${testID}-author`}
          >
            {head}
          </PressableScale>
        )}
        {onOptions ? (
          <PressableScale
            onPress={onOptions}
            haptic="tap"
            accessibilityRole="button"
            accessibilityLabel={t('fanClub.comments.options', { name })}
            style={styles.options}
            testID={`${testID}-options`}
          >
            <Icon icon={Ellipsis} size={OPTIONS_ICON_SIZE} color={colors.textMuted} />
          </PressableScale>
        ) : null}
      </View>
      <View style={styles.body}>
        <MentionText
          text={comment.text}
          mentions={comment.mentions}
          onOpenArtist={onOpenArtist}
          color={hidden ? colors.textTertiary : colors.textBody}
          testID={`${testID}-text`}
        />
        {hasActions ? (
          <View style={styles.actions}>
            {hidden ? (
              <Pill
                label={t(
                  viewerIsOwner
                    ? 'fanClub.comments.hiddenByYou'
                    : 'fanClub.comments.hiddenByManager',
                )}
                size="xs"
                testID={`${testID}-hidden`}
              />
            ) : null}
            {reply ? (
              <TextLink
                label={t('fanClub.comments.reply')}
                onPress={reply}
                textVariant="labelCompact"
                accessibilityLabel={t('fanClub.comments.replyLabel', { name })}
                accessibilityHint={t('fanClub.comments.replyHint')}
                testID={`${testID}-reply`}
              />
            ) : null}
            {/* Um lugar só: a troca segue na mesma view, e o foco do leitor não pula. */}
            {toggleHidden ? (
              <TextLink
                label={t(hidden ? 'fanClub.comments.unhide' : 'fanClub.comments.hide')}
                onPress={toggleHidden}
                textVariant="labelCompact"
                accessibilityLabel={t(
                  hidden ? 'fanClub.comments.unhideLabel' : 'fanClub.comments.hideLabel',
                  { name },
                )}
                disabled={busy}
                testID={`${testID}-${hidden ? 'unhide' : 'hide'}`}
              />
            ) : null}
            {hidden && !viewerIsOwner && reviewState ? (
              <Text
                ref={reviewRef}
                variant="caption"
                color={colors.textSecondary}
                style={styles.reviewState}
                testID={`${testID}-review`}
              >
                {reviewState}
              </Text>
            ) : null}
            {hidden && !reviewState && onRequestReview ? (
              <TextLink
                label={t('fanClub.comments.requestReview')}
                onPress={onRequestReview}
                textVariant="labelCompact"
                accessibilityHint={t('fanClub.comments.requestReviewHint')}
                disabled={busy}
                testID={`${testID}-request-review`}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** O rótulo da linha local: o autor, o estado e o texto, como no Mural. */
function localLabel(comment: FanClubCommentLine, name: string): string {
  const params = { author: name, text: comment.text };
  if (comment.status === 'failed') return t('post.comments.failedLabel', params);
  if (comment.status === 'refused') return t('post.comments.refusedLabel', params);
  return t('post.comments.pendingLabel', params);
}

/**
 * A linha do fã que ainda não está na lista do servidor, no molde do Mural:
 * apagada com "enviando…"; "Não enviado" em laranja, um botão que tenta de
 * novo; "Não publicado" (o filtro), um botão que devolve o texto ao campo, ou,
 * com a conta suspensa, só o motivo. É um pressável só, ligado quando o toque
 * faz algo, para o leitor não perder o foco quando ela troca de estado. Entra
 * por um valor animado de opacidade, nunca pelo `entering` do Reanimated.
 */
function LocalCommentRow({
  comment,
  mine,
  me,
  nested = false,
  onRetry,
  refusedLocked = false,
}: FanClubCommentRowProps) {
  const largeText = isLargeText(useWindowDimensions().fontScale);
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    opacity.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [opacity, reducedMotion]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const pending = comment.status === 'pending';
  const refused = comment.status === 'refused';
  const lockedRefusal = refused && refusedLocked;
  const failed = !pending && !lockedRefusal;
  const name = displayName(comment, mine);
  const key = comment.localId ?? comment.id;

  return (
    <Animated.View style={fade}>
      <PressableScale
        onPress={failed ? onRetry : undefined}
        haptic={failed ? 'tap' : null}
        scaleTo={failed ? motion.pressScale : 1}
        focusable={failed}
        accessibilityRole={failed ? 'button' : 'none'}
        accessibilityLabel={localLabel(comment, name)}
        accessibilityHint={
          failed ? t(refused ? 'post.comments.refusedHint' : 'post.comments.retryHint') : undefined
        }
        style={[styles.localRow, nested && styles.nested]}
        testID={`club-comment-${key}`}
      >
        <View style={styles.dimAvatar}>
          <Avatar
            name={mine ? (me.name ?? comment.author.name) : comment.author.name}
            id={comment.author.uid}
            photoUrl={mine ? me.photoURL : comment.author.photoURL}
            size="sm"
          />
        </View>
        <View style={styles.localBody}>
          <View style={[styles.head, largeText && styles.headWrap]}>
            <Text
              variant="label"
              color={pending ? colors.textSubtle : colors.text}
              numberOfLines={largeText ? undefined : 1}
              style={styles.name}
            >
              {name}
            </Text>
            {pending ? (
              <Text variant="metaSmall" color={colors.textSecondary}>
                {t('post.comments.sending')}
              </Text>
            ) : null}
          </View>
          <Text
            variant="body"
            color={pending ? colors.textTertiary : colors.textBody}
            style={styles.localText}
          >
            {comment.text}
          </Text>
          {pending ? null : (
            <Text variant="caption" color={colors.danger} style={styles.localText}>
              {t(
                lockedRefusal
                  ? 'post.comments.refusedLocked'
                  : refused
                    ? 'post.comments.refused'
                    : 'post.comments.failed',
              )}
            </Text>
          )}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  // A resposta começa onde o texto do comentário de cima começa.
  nested: {
    marginLeft: NESTED_INDENT,
  },
  // O autor e, ao lado dele, o botão de opções: irmãos, nunca um dentro do outro.
  top: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // O autor é um alvo de 44, com o avatar e a linha do nome.
  author: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.listGap,
    minHeight: layout.minTouchTarget,
  },
  dimAvatar: {
    opacity: DIM_AVATAR_OPACITY,
  },
  head: {
    flex: 1,
    minWidth: 0,
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
  handle: {
    flexShrink: 1,
  },
  // A ponta do alvo encosta na margem da tela, e o ícone fica alinhado ao texto.
  options: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -(layout.minTouchTarget - OPTIONS_ICON_SIZE) / 2,
  },
  // O texto e as ações ficam alinhados ao nome, depois do avatar.
  body: {
    marginLeft: NESTED_INDENT,
    alignItems: 'flex-start',
  },
  // "Responder", "Ocultar", a marca do oculto e o pedido de revisão, numa
  // fileira que quebra com a fonte grande.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.lg,
  },
  reviewState: {
    paddingVertical: spacing.xs,
  },
  localRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.listGap,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.listGap,
  },
  localBody: {
    flex: 1,
    minWidth: 0,
  },
  localText: {
    marginTop: spacing.xs,
  },
});
