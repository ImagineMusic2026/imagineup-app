import { Flag, Share2 } from 'lucide-react-native';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout, motion, radii, spacing } from '@/theme';
import { formatRelativeAgo, formatRelativeAgoSpoken } from '@/utils/date';
import { sentence } from '@/utils/text';

import type { FanClubReaction } from '../consts';
import { clubNameLabel, excerptOf, reactionName } from '../format';
import { useReactToFanClubPostMutation } from '../queries';
import type { FanClubPost } from '../types';
import { ClubName } from './club-name';
import { CommentTotal, ReactionButton, ReactionPicker, ReactionTotal } from './post-reactions';

/** A foto do fã-clube é sempre 4:5 (decisão 15). */
const PHOTO_ASPECT = 4 / 5;
// A miniatura ao lado do texto, no cartão da Início.
const THUMB_WIDTH = 72;
// O texto do cartão da Início fica em 4 linhas; o leitor ouve o texto inteiro.
const FEED_TEXT_LINES = 4;

export type FanClubPostCardVariant = 'page' | 'feed';

export interface FanClubPostCardProps {
  post: FanClubPost;
  /** Relógio da tela (`useNow`), para o "há 2 h" andar sozinho. */
  now: Date;
  /**
   * - `page`: na página do fã-clube, o texto inteiro e a foto grande;
   * - `feed`: na Início, com o nome do fã-clube e o selo do oficial (que abrem
   *   a página), o texto em 4 linhas e a miniatura ao lado.
   */
  variant: FanClubPostCardVariant;
  /** Quem vê não é o gestor: o Denunciar aparece (a própria publicação não se denuncia). */
  canReport: boolean;
  /**
   * Quem vê segue o fã-clube ou é o gestor (decisão 10 de 36.1): reage. Os
   * outros veem o total das reações só para ler.
   */
  canReact: boolean;
  onShare: (post: FanClubPost) => void;
  onReport: (post: FanClubPost) => void;
  /** Só na Início: o nome abre a página do fã-clube. */
  onOpenClub?: (post: FanClubPost) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Leva o foco do leitor de tela ao elemento, depois de a troca aparecer. */
function focusSoon(target: RefObject<View | null>): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
  }, motion.duration.fast);
}

/**
 * Uma publicação no ar de um fã-clube (34.9, itens 7 e 9). O texto, a foto e
 * a data são um foco só; a reação, os totais, o Compartilhar (o link do
 * fã-clube, sem link próprio por publicação) e o Denunciar são irmãos, nunca
 * dentro de outro pressável. Na Início, o nome do fã-clube, com o selo do
 * oficial ao lado (34.23), abre a página.
 *
 * Desde a Fase 2 (seção 37, 37.9, itens 1 e 2), antes do Compartilhar e do
 * Denunciar, o botão da reação (tocar curte, segurar abre a fileira dos 5
 * emojis) e o total dos comentários; quem não segue e não é o gestor vê o
 * total das reações só para ler. Tudo só com o `reactionCount` na publicação,
 * que só o servidor da Fase 2 manda (37.16). A fileira dos emojis troca a de
 * ações dentro do próprio card: abrir leva o foco ao primeiro emoji, e fechar
 * o devolve ao botão. O aberto é estado do card, e a célula reciclada para
 * outra publicação volta fechada pela chave do `post.id` (quem desenha a
 * lista passa a chave).
 */
export function FanClubPostCard({
  post,
  now,
  variant,
  canReport,
  canReact,
  onShare,
  onReport,
  onOpenClub,
  style,
  testID,
}: FanClubPostCardProps) {
  const feed = variant === 'feed';
  const image = feed ? (post.thumb ?? post.photo) : (post.photo ?? post.thumb);
  const when = formatRelativeAgoSpoken(post.publishedAt, now);
  // Os botões dizem de qual publicação são: na página, todos são do mesmo fã-clube.
  const excerpt = excerptOf(post.text);
  // O texto do fã já pode terminar em "?" ou "!": o ponto entra só quando falta.
  const label = t(post.kind === 'photo' ? 'fanClub.post.labelPhoto' : 'fanClub.post.label', {
    text: sentence(post.text),
    when,
  });
  const engaged = post.reactionCount !== undefined;
  const mine = post.myReaction ?? null;
  const reaction = useReactToFanClubPostMutation(post.id);
  const [picking, setPicking] = useState(false);
  // Sem poder reagir (deixou de seguir), a fileira fecha: não volta aberta sozinha.
  const canPick = engaged && canReact;
  if (picking && !canPick) setPicking(false);
  const button = useRef<View>(null);
  const firstEmoji = useRef<View>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );
  const moveFocus = (target: RefObject<View | null>): void => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = focusSoon(target);
  };

  const openPicker = (): void => {
    haptics.trigger('selection');
    setPicking(true);
    moveFocus(firstEmoji);
  };
  const closePicker = (): void => {
    setPicking(false);
    moveFocus(button);
  };
  const pick = (next: FanClubReaction): void => {
    closePicker();
    if (next !== mine) reaction.react(next);
  };
  // Pela ação do leitor, o foco fica no botão: a frase diz o que mudou.
  const reactFromReader = (next: FanClubReaction | null): void => {
    if (next !== mine) reaction.react(next);
    AccessibilityInfo.announceForAccessibility(
      next === null
        ? t('fanClub.reactions.cleared')
        : t('fanClub.reactions.reacted', { name: reactionName(next) }),
    );
  };

  const reactionPart = canReact ? (
    <ReactionButton
      ref={button}
      reactionCount={post.reactionCount ?? 0}
      reactionCounts={post.reactionCounts}
      mine={mine}
      onReact={reaction.react}
      onChoose={openPicker}
      onReactFromReader={reactFromReader}
      testID={testID ? `${testID}-react` : undefined}
    />
  ) : (
    <ReactionTotal
      reactionCount={post.reactionCount ?? 0}
      reactionCounts={post.reactionCounts}
      testID={testID ? `${testID}-reactions` : undefined}
    />
  );

  return (
    <Card style={[styles.card, style]} testID={testID}>
      {feed && onOpenClub ? (
        <PressableScale
          onPress={() => onOpenClub(post)}
          accessibilityRole="link"
          accessibilityLabel={clubNameLabel(post.clubName, post.clubOfficial)}
          accessibilityHint={t('fanClub.post.openClubHint')}
          style={styles.club}
          testID={testID ? `${testID}-club` : undefined}
        >
          <ClubName name={post.clubName} official={post.clubOfficial} />
        </PressableScale>
      ) : null}
      <View accessible accessibilityLabel={label} style={feed ? styles.feedBody : undefined}>
        <View style={feed ? styles.feedText : undefined}>
          <Text variant="body" numberOfLines={feed ? FEED_TEXT_LINES : undefined}>
            {post.text}
          </Text>
          <Text variant="caption" color={colors.textMuted} style={styles.when}>
            {formatRelativeAgo(post.publishedAt, now)}
          </Text>
        </View>
        {image ? (
          <RemoteImage
            uri={image.url}
            fallback={{ kind: 'surface', seed: post.id }}
            style={feed ? styles.thumb : styles.photo}
          />
        ) : null}
      </View>
      {canPick && picking ? (
        <ReactionPicker
          mine={mine}
          onPick={pick}
          onClose={closePicker}
          firstRef={firstEmoji}
          testID={testID ? `${testID}-picker` : undefined}
        />
      ) : (
        <View style={styles.actions}>
          {engaged ? reactionPart : null}
          {engaged ? (
            <CommentTotal
              count={post.commentCount ?? 0}
              testID={testID ? `${testID}-comments` : undefined}
            />
          ) : null}
          <Button
            label={t('fanClub.post.share')}
            variant="ghost"
            size="sm"
            icon={Share2}
            onPress={() => onShare(post)}
            accessibilityLabel={t('fanClub.post.shareLabel', { name: post.clubName, excerpt })}
            testID={testID ? `${testID}-share` : undefined}
          />
          {canReport ? (
            <Button
              label={t('fanClub.post.report')}
              variant="ghost"
              size="sm"
              icon={Flag}
              onPress={() => onReport(post)}
              accessibilityLabel={t('fanClub.post.reportLabel', { excerpt })}
              accessibilityHint={t('fanClub.post.reportHint')}
              testID={testID ? `${testID}-report` : undefined}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  // O alvo de toque inteiro, mesmo com o nome numa linha só.
  club: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: layout.minTouchTarget,
  },
  feedBody: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  feedText: {
    flex: 1,
    minWidth: 0,
  },
  when: {
    marginTop: spacing.xs,
  },
  photo: {
    alignSelf: 'stretch',
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radii.lg,
    marginTop: spacing.md,
  },
  thumb: {
    width: THUMB_WIDTH,
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radii.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
