import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PhotoCard } from '@/components/photo-card';
import { pillForeground, Pill } from '@/components/pill';
import { Scrim } from '@/components/scrim';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, gradients, layout, radii, spacing } from '@/theme';

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
// Acima do texto, o véu do próprio bloco escurece a foto que o `artistTile`
// ainda deixa ver (fonte grande); com a fonte padrão, ele cai na faixa escura.
const COPY_FADE = spacing.xl;
const COPY_VEIL = gradients.scrims.artistTileCopy.colors[1];

/** Abre a central na pilha da aba de onde o fã veio (a Explorar, na vitrine). */
function openCentral(artistId: string): void {
  router.push({ pathname: '/artista/[artistaId]', params: { artistaId: artistId } });
}

/**
 * Card de uma central na grade da Explorar (seção 29, frente G), no desenho do
 * card da 1l: a foto (o placeholder de marca sem ela), o nome, "N fãs" e, nas
 * centrais do fã, a pílula "Na central". O card inteiro é um alvo só ("Netto
 * Brito, 412 mil fãs, você está na central", dica "Abre a central"), e nada
 * dentro dele é pressável. A altura é mínima, não fixa: com a fonte a 200%, o
 * card cresce.
 */
export function CentralTile({ artist, member, style, testID }: CentralTileProps) {
  const card = artistCardLabel(artist);

  return (
    <PhotoCard
      uri={artist.photoURL}
      fallback={{ kind: 'brand', seed: artist.id }}
      scrim="artistTile"
      minHeight={layout.artistTileHeight}
      radius={radii.lg}
      contentPosition="top"
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
      <View pointerEvents="none" style={styles.copyVeil} />
      <Scrim preset="artistTileCopy" style={styles.copyFade} />
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
  // Do topo do texto até o pé do card, de borda a borda.
  copyVeil: {
    position: 'absolute',
    top: 0,
    left: -spacing.gridGap,
    right: -spacing.gridGap,
    bottom: -spacing.listGap,
    backgroundColor: COPY_VEIL,
  },
  // A faixa logo acima do texto, do transparente ao véu.
  copyFade: {
    top: -COPY_FADE,
    bottom: '100%',
    left: -spacing.gridGap,
    right: -spacing.gridGap,
  },
  fans: {
    marginTop: spacing.xs,
  },
});
