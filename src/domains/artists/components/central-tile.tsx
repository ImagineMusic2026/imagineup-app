import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PhotoCard } from '@/components/photo-card';
import { pillForeground, Pill } from '@/components/pill';
import { Scrim } from '@/components/scrim';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing } from '@/theme';

import { artistCardLabel, fansText } from '../selection';
import type { Artist } from '../types';

export interface CentralTileProps {
  /** O `fanCount` é o que o card mostra: o de "Suas centrais" nas do fã, que já soma ele. */
  artist: Artist;
  /** O fã está nesta central: a pílula "Na central" e o rótulo dizem isso. */
  member: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// O nome quebra em até 2 linhas com a fonte grande, como no card da 1l.
const NAME_LINES = 2;
const MEMBER_ICON_SIZE = 10;
// A foto da central é 3:4 e o card é mais largo que alto: ela sobra embaixo.
// Ela sobe um quarto dessa sobra (o `object-position` do CSS), e o rosto, que
// nas fotos das centrais fica no terço de cima, sai inteiro acima do texto.
const PHOTO_POSITION = { top: '25%', left: '50%' } as const;
// O véu fica preso ao texto, e não ao card: com a fonte grande, o nome quebra,
// o bloco sobe, e o véu sobe junto. Altura fixa, para a curva do degradê
// (`centralTileCopy`) terminar sempre no topo do texto.
const { fade: VEIL_FADE, below: VEIL_BELOW } = layout.centralTileVeil;

/** Abre a central na pilha da aba de onde o fã veio (a Explorar, na vitrine). */
function openCentral(artistId: string): void {
  router.push({ pathname: '/artista/[artistaId]', params: { artistaId: artistId } });
}

/**
 * Card de uma central na grade da Explorar (seção 29, frente G), nas medidas do
 * card da 1l: a foto (o placeholder de marca sem ela), o nome, "N fãs" e, nas
 * centrais do fã, a pílula "Na central". A foto ocupa o card todo, sem véu por
 * cima dela; só o texto tem o seu, que começa transparente e escurece até o
 * contraste do texto (o véu da 1l fechava a partir da metade do card e cobria
 * o rosto). O card inteiro é um alvo só ("Netto Brito, 412 mil fãs, você está
 * na central", dica "Abre a central"), e nada dentro dele é pressável. A altura
 * é mínima, não fixa: com a fonte a 200%, o card cresce.
 */
export function CentralTile({ artist, member, style, testID }: CentralTileProps) {
  const card = artistCardLabel(artist);

  return (
    <PhotoCard
      uri={artist.photoURL}
      fallback={{ kind: 'brand', seed: artist.id }}
      minHeight={layout.artistTileHeight}
      radius={radii.lg}
      contentPosition={PHOTO_POSITION}
      topLeft={
        member ? (
          <Pill
            label={t('explore.member')}
            tone="neutral"
            size="xs"
            leading={<Icon icon={Check} size={MEMBER_ICON_SIZE} color={pillForeground.neutral} />}
          />
        ) : undefined
      }
      onPress={() => openCentral(artist.id)}
      accessibilityLabel={member ? t('explore.memberLabel', { label: card }) : card}
      accessibilityHint={t('explore.tileHint')}
      testID={testID}
      style={[styles.card, style]}
    >
      <Scrim preset="centralTileCopy" style={styles.copyVeil} />
      <Text variant="buttonSmall" numberOfLines={NAME_LINES}>
        {artist.name}
      </Text>
      <Text variant="micro" color={colors.textSubtle} numberOfLines={1} style={styles.fans}>
        {fansText(artist.fanCount)}
      </Text>
    </PhotoCard>
  );
}

const styles = StyleSheet.create({
  // As medidas do card da 1l: o texto a 11 dos lados e a 10 do pé, a pílula
  // a 9 do topo, e a borda neutra em volta.
  card: {
    paddingTop: spacing.tileGap,
    paddingHorizontal: spacing.gridGap,
    paddingBottom: spacing.listGap,
    borderWidth: borderWidths.default,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  // De borda a borda: a curva acima do texto e o véu atrás dele até passar do
  // pé do card, que corta o resto.
  copyVeil: {
    top: -VEIL_FADE,
    bottom: 'auto',
    height: VEIL_FADE + VEIL_BELOW,
    left: -spacing.gridGap,
    right: -spacing.gridGap,
  },
  fans: {
    marginTop: spacing.xs,
  },
});
