import type { Ref } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/button';
import { PhotoCard } from '@/components/photo-card';
import { Text } from '@/components/text';
import { colors, layout, radii, spacing } from '@/theme';

import { LARGE_TEXT_SCALE } from '../consts';
import { eventDateBadge, eventMeta, featuredEventLabel, inviteButtonText } from '../describe-event';
import type { AgendaEvent } from '../types';
import { DateBadge } from './date-badge';
import { RsvpButton } from './rsvp-button';

export interface EventHeroCardProps {
  event: AgendaEvent;
  /** Relógio da tela, para o "Hoje" no selo. */
  now: Date;
  /** "Chamar amigos": abre o convite para este show. */
  onInvite: (event: AgendaEvent) => void;
  /** O bloco de data, título e meta, para levar o foco do leitor de tela até o show. */
  infoRef?: Ref<View>;
  testID?: string;
}

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

// Os botões desenham 30 dentro do alvo de 44: a sobra de baixo entra no
// padding do card, para o botão ficar a 14 da borda, como no protótipo.
const ACTIONS_SLACK = (layout.minTouchTarget - layout.buttonHeight.sm) / 2;
// 11 da meta ao botão no protótipo, descontada a sobra de cima do alvo.
const ACTIONS_TOP = spacing.gridGap - ACTIONS_SLACK;

/**
 * Show em destaque da agenda (1m): foto (ou o bloco ciano), véu, selo de data
 * em vidro, título, "artistas · cidade · hora" e dois botões, "Eu vou" e
 * "Chamar amigos +N". O card não é pressável (não há tela de detalhe do show):
 * a informação é um foco só para o leitor de tela, e cada botão tem o seu.
 */
export function EventHeroCard({ event, now, onInvite, infoRef, testID }: EventHeroCardProps) {
  const badge = eventDateBadge(event, now);
  const invite = inviteButtonText(event);
  // Com a fonte grande, título e meta quebram inteiros em vez de cortar.
  const lines = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE ? undefined : 2;

  return (
    <PhotoCard
      uri={event.imageUrl}
      fallback={{ kind: 'events', seed: event.id }}
      scrim="eventHero"
      minHeight={layout.eventHeroMinHeight}
      radius={radii.xl}
      topLeft={
        <View {...hiddenFromReader}>
          <DateBadge day={badge.day} month={badge.month} variant="glass" />
        </View>
      }
      testID={testID}
    >
      <View ref={infoRef} accessible accessibilityLabel={featuredEventLabel(event, now)}>
        <Text variant="titleEvent" numberOfLines={lines}>
          {event.title}
        </Text>
        <Text
          variant="caption"
          color={colors.textSecondary}
          numberOfLines={lines}
          style={styles.meta}
        >
          {eventMeta(event)}
        </Text>
      </View>
      <View style={styles.actions}>
        <RsvpButton
          eventId={event.id}
          eventTitle={event.title}
          look="hero"
          testID={testID ? `${testID}-rsvp` : undefined}
        />
        <Button
          label={invite.label}
          accessibilityLabel={invite.accessibilityLabel}
          variant="pointsTinted"
          size="sm"
          onPress={() => onInvite(event)}
          style={styles.invite}
          testID={testID ? `${testID}-invite` : undefined}
        />
      </View>
    </PhotoCard>
  );
}

const styles = StyleSheet.create({
  meta: {
    marginTop: spacing.metaGap,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    marginTop: ACTIONS_TOP,
    marginBottom: -ACTIONS_SLACK,
  },
  // Com a fonte grande, o convite quebra o rótulo em vez de sair do card.
  invite: {
    flexShrink: 1,
  },
});
