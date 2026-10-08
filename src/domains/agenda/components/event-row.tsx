import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ListRow } from '@/components/list-row';
import { borderWidths, colors, LARGE_TEXT_SCALE, layout, spacing } from '@/theme';

import { eventDateBadge, eventPlace, eventRowLabel } from '../describe-event';
import type { AgendaEvent } from '../types';
import { DateBadge } from './date-badge';
import { RsvpButton } from './rsvp-button';

export interface EventRowProps {
  event: AgendaEvent;
  /** Relógio da tela, para o "Hoje" no selo. */
  now: Date;
  testID?: string;
}

// O alvo de 44 do "Eu vou" cabe na linha de 64 sem esticá-la: sobra 3 em cima
// e embaixo da divisória de 38, dentro do padding de 12 da linha.
const TRAILING_OVERLAP = (layout.dateDivider - layout.minTouchTarget) / 2;

/**
 * Linha de show da agenda (1m): data, divisória, título e cidade, e o "Eu vou"
 * à direita. Não é pressável (não há tela de detalhe do show): data, título e
 * cidade são lidos juntos, e o "Eu vou" tem foco próprio, com o nome do show.
 *
 * Com a fonte grande, o "Eu vou" desce para baixo do título: ao lado, ele (e
 * mais ainda o "Confirmado") deixava o título sem espaço, cortado no meio da
 * palavra.
 */
export function EventRow({ event, now, testID }: EventRowProps) {
  const badge = eventDateBadge(event, now);
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;

  return (
    <ListRow
      title={event.title}
      meta={eventPlace(event)}
      // Título longo quebra em duas linhas em vez de sumir nas reticências; com
      // a fonte grande, quebra inteiro.
      titleNumberOfLines={stacked ? undefined : 2}
      trailingPlacement={stacked ? 'below' : 'end'}
      leading={
        <>
          <DateBadge day={badge.day} month={badge.month} variant="plain" />
          <View style={styles.divider} />
        </>
      }
      trailing={
        <RsvpButton
          eventId={event.id}
          eventTitle={event.title}
          look="row"
          style={stacked ? styles.rsvpBelow : styles.rsvp}
          testID={testID ? `${testID}-rsvp` : undefined}
        />
      }
      gap="rowGap"
      padding="md"
      accessibilityGroup="content"
      accessibilityLabel={eventRowLabel(event, now)}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  divider: {
    width: borderWidths.default,
    height: layout.dateDivider,
    backgroundColor: colors.track,
  },
  rsvp: {
    marginVertical: TRAILING_OVERLAP,
  },
  // Embaixo, a sobra do alvo de 44 entra um pouco no padding do card, para o
  // botão não ficar mais longe da borda de baixo que do título.
  rsvpBelow: {
    marginBottom: -spacing.xs,
  },
});
