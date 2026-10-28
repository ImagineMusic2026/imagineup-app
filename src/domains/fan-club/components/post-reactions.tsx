import { Heart, MessageCircle, Share2 } from 'lucide-react-native';
import { useEffect, type ReactNode, type Ref } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { PillButton } from '@/components/pill-button';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import {
  ACTION_COUNT_COLOR,
  ACTION_ICON_COLOR,
  ACTION_ICON_SIZE,
  LikeHeart,
} from '@/domains/posts';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { borderWidths, colors, layout, motion, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import { FAN_CLUB_REACTION_EMOJI, FAN_CLUB_REACTIONS, type FanClubReaction } from '../consts';
import { commentsSpoken, countText, reactionName, reactionsSpoken } from '../format';
import { reactActionName, reactionOfAction, topReactions } from '../reactions';
import type { FanClubReactionCounts } from '../types';

// As peças da reação e dos totais no card da publicação do fã-clube (seção 37,
// 37.9, itens 1 e 2): o botão da reação (tocar curte, segurar abre a fileira),
// o total só para ler de quem não segue, o total dos comentários e a fileira
// dos 5 emojis, desenhada no próprio card (sem popover nem `Modal`, que a
// célula da FlashList e o carrossel da Início cortariam).

/** O segurar que abre a fileira dos emojis (37.9, item 1). */
export const REACTION_LONG_PRESS_MS = 400;

/** O emoji da fileira, num alvo de 44, com o círculo do escolhido (cresce com a fonte). */
const PICKER_EMOJI_CIRCLE = 40;

/** O emoji, só desenho: quem fala é o pressável ou o rótulo de fora. */
function Emoji({ reaction, large = false }: { reaction: FanClubReaction; large?: boolean }) {
  return (
    <Text variant={large ? 'titleCard' : 'label'} color={colors.text}>
      {FAN_CLUB_REACTION_EMOJI[reaction]}
    </Text>
  );
}

/**
 * Até 3 emojis, os mais usados, ao lado do total. Com o total zerado, nem a
 * peça (o `gap` da Pill sobraria depois do número).
 */
function topEmojis(counts: FanClubReactionCounts | undefined): ReactNode {
  const top = topReactions(counts);
  if (top.length === 0) return undefined;
  return (
    <Text variant="label" color={colors.text}>
      {top.map((reaction) => FAN_CLUB_REACTION_EMOJI[reaction]).join('')}
    </Text>
  );
}

/** A pílula que não é botão (os totais de quem não reage), num alvo de 44 para alinhar na fileira. */
function StaticPill({ children }: { children: ReactNode }) {
  return <View style={styles.staticTarget}>{children}</View>;
}

export interface ReactionButtonProps {
  reactionCount: number;
  reactionCounts: FanClubReactionCounts | undefined;
  mine: FanClubReaction | null;
  /** Um toque: o emoji (null tira a reação). */
  onReact: (reaction: FanClubReaction | null) => void;
  /** Segurar, ou a ação "Escolher reação" do leitor: abre a fileira. */
  onChoose: () => void;
  /** A reação pela ação do leitor de tela, que o card anuncia (o foco não sai do botão). */
  onReactFromReader: (reaction: FanClubReaction | null) => void;
  ref?: Ref<View>;
  testID?: string;
}

/**
 * O botão da reação: o coração (ou o emoji escolhido) com o total e, ao lado,
 * os mais usados. Tocar reage com o coração, ou tira a reação; segurar (400
 * ms) abre a fileira. O leitor ouve "Reagir, 12 reações" e o estado ("você
 * reagiu com fogo"), sem o emoji, e alcança o segurar e cada emoji pelas
 * ações (no molde do carrossel da apresentação).
 */
export function ReactionButton({
  reactionCount,
  reactionCounts,
  mine,
  onReact,
  onChoose,
  onReactFromReader,
  ref,
  testID,
}: ReactionButtonProps) {
  const reactions = reactionsSpoken(reactionCount);
  const actions: AccessibilityActionInfo[] = [
    { name: 'longpress', label: t('fanClub.reactions.choose') },
    ...FAN_CLUB_REACTIONS.map((reaction) => ({
      name: reactActionName(reaction),
      label: t('fanClub.reactions.reactWith', { name: reactionName(reaction) }),
    })),
    ...(mine === null ? [] : [{ name: 'clear', label: t('fanClub.reactions.clear') }]),
  ];

  const onAction = (event: AccessibilityActionEvent): void => {
    const { actionName } = event.nativeEvent;
    if (actionName === 'longpress') {
      onChoose();
      return;
    }
    if (actionName === 'clear') {
      onReactFromReader(null);
      return;
    }
    const reaction = reactionOfAction(actionName);
    if (reaction !== null) onReactFromReader(reaction);
  };

  return (
    <PillButton
      ref={ref}
      size="md"
      label={countText(reactionCount)}
      labelColor={mine === null ? ACTION_COUNT_COLOR : colors.text}
      leading={
        mine === null || mine === 'heart' ? (
          <LikeHeart liked={mine === 'heart'} />
        ) : (
          <Emoji reaction={mine} />
        )
      }
      trailing={topEmojis(reactionCounts)}
      selected={mine !== null}
      // Reagir vibra pelo evento `like` (na mutação); tirar, com o toque comum.
      haptic={mine === null ? null : 'tap'}
      accessibilityLabel={
        mine === null
          ? t('fanClub.reactions.label', { reactions })
          : t('fanClub.reactions.labelMine', { reactions, name: reactionName(mine) })
      }
      accessibilityHint={t(mine === null ? 'fanClub.reactions.hint' : 'fanClub.reactions.hintMine')}
      onPress={() => onReact(mine === null ? 'heart' : null)}
      onLongPress={onChoose}
      delayLongPress={REACTION_LONG_PRESS_MS}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
      testID={testID}
    />
  );
}

/**
 * O total das reações só para ler, numa `Pill`, de quem não segue e não é o
 * gestor (37.9, item 1), como as curtidas na Início: "12 reações".
 */
export function ReactionTotal({
  reactionCount,
  reactionCounts,
  testID,
}: {
  reactionCount: number;
  reactionCounts: FanClubReactionCounts | undefined;
  testID?: string;
}) {
  return (
    <StaticPill>
      <Pill
        size="md"
        label={countText(reactionCount)}
        labelColor={ACTION_COUNT_COLOR}
        leading={<Icon icon={Heart} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
        trailing={topEmojis(reactionCounts)}
        accessibilityLabel={reactionsSpoken(reactionCount)}
        testID={testID}
      />
    </StaticPill>
  );
}

/**
 * O botão dos comentários (37.9, itens 1 e 3; a etapa 6 de 37.13): o ícone e o
 * total, lido "4 comentários", tocável para todos. Na página e na Início,
 * abre a tela da publicação; no cabeçalho dela, leva o foco ao campo.
 */
export function CommentButton({
  count,
  onPress,
  hint,
  testID,
}: {
  count: number;
  onPress: () => void;
  hint: string;
  testID?: string;
}) {
  return (
    <PillButton
      size="md"
      label={countText(count)}
      labelColor={ACTION_COUNT_COLOR}
      leading={<Icon icon={MessageCircle} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
      accessibilityLabel={commentsSpoken(count)}
      accessibilityHint={hint}
      onPress={onPress}
      testID={testID}
    />
  );
}

/**
 * O Compartilhar do card, só com o ícone, no molde do botão dos comentários:
 * desde 27/10/2026, a pedido do dono, a reação, os comentários e o
 * Compartilhar cabem numa linha só, também no card estreito da Início. O
 * leitor ouve o rótulo inteiro ("Compartilhar o fã-clube X. Publicação: ...").
 */
export function ShareButton({
  onPress,
  accessibilityLabel,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <PillButton
      size="md"
      label=""
      leading={<Icon icon={Share2} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
    />
  );
}

/**
 * O total dos comentários só como número, onde o card não tem para onde levar
 * (quem desenha o card sem o `onOpenComments`): "4 comentários".
 */
export function CommentTotal({ count, testID }: { count: number; testID?: string }) {
  return (
    <StaticPill>
      <Pill
        size="md"
        label={countText(count)}
        labelColor={ACTION_COUNT_COLOR}
        leading={<Icon icon={MessageCircle} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
        accessibilityLabel={commentsSpoken(count)}
        testID={testID}
      />
    </StaticPill>
  );
}

/**
 * Os totais da publicação só para ler, dentro de um foco só (o card de "Minhas
 * publicações" do gestor, 37.9, item 8): as reações, com os mais usados, e os
 * comentários, em pílulas pequenas. Quem fala é o rótulo de quem as mostra
 * ("12 reações, 4 comentários"); quem reagiu nunca aparece (R8).
 */
export function PostTotals({
  reactionCount,
  reactionCounts,
  commentCount,
  testID,
}: {
  reactionCount: number;
  reactionCounts: FanClubReactionCounts | undefined;
  commentCount: number;
  testID?: string;
}) {
  return (
    <View style={styles.totals} testID={testID}>
      <Pill
        size="sm"
        label={countText(reactionCount)}
        labelColor={ACTION_COUNT_COLOR}
        leading={<Icon icon={Heart} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
        trailing={topEmojis(reactionCounts)}
      />
      <Pill
        size="sm"
        label={countText(commentCount)}
        labelColor={ACTION_COUNT_COLOR}
        leading={<Icon icon={MessageCircle} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />}
      />
    </View>
  );
}

export interface ReactionPickerProps {
  mine: FanClubReaction | null;
  onPick: (reaction: FanClubReaction) => void;
  onClose: () => void;
  /** O primeiro emoji, que recebe o foco do leitor quando a fileira abre. */
  firstRef: Ref<View>;
  testID?: string;
}

/**
 * A fileira dos 5 emojis e o "Fechar", no lugar da fileira de ações, dentro do
 * card. Aparece por um valor animado de opacidade (o molde do `PaneFade`),
 * nunca pelo `entering` do Reanimated (que apagou a tela no Android); com
 * reduzir movimento, aparece de uma vez. Cada emoji é um botão "Reagir com
 * fogo", com o estado do escolhido.
 */
export function ReactionPicker({ mine, onPick, onClose, firstRef, testID }: ReactionPickerProps) {
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

  return (
    <Animated.View style={[styles.picker, fade]} testID={testID}>
      {FAN_CLUB_REACTIONS.map((reaction, index) => {
        const chosen = reaction === mine;
        return (
          <PressableScale
            key={reaction}
            ref={index === 0 ? firstRef : undefined}
            onPress={() => onPick(reaction)}
            // Reagir vibra pelo evento `like`, na mutação.
            haptic={null}
            accessibilityLabel={t('fanClub.reactions.reactWith', { name: reactionName(reaction) })}
            accessibilityState={{ selected: chosen }}
            style={styles.emojiTarget}
            testID={testID ? `${testID}-${reaction}` : undefined}
          >
            <View style={[styles.emojiCircle, chosen && styles.emojiChosen]}>
              <Emoji reaction={reaction} large />
            </View>
          </PressableScale>
        );
      })}
      <Button
        label={t('fanClub.reactions.close')}
        variant="ghost"
        size="sm"
        onPress={onClose}
        accessibilityLabel={t('fanClub.reactions.closeLabel')}
        testID={testID ? `${testID}-close` : undefined}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  staticTarget: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  emojiTarget: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiCircle: {
    minWidth: PICKER_EMOJI_CIRCLE,
    minHeight: PICKER_EMOJI_CIRCLE,
    padding: spacing.xxs,
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    borderColor: colors.transparent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiChosen: {
    backgroundColor: withAlpha(colors.accent, tints.soft.fill),
    borderColor: withAlpha(colors.accent, tints.soft.border),
  },
});
