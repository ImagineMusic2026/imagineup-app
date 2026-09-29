import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AvatarStack } from '@/components/avatar';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';
import { colors, layout, spacing } from '@/theme';

export interface MoreArtistsCardProps {
  /** Os primeiros artistas fora da grade, para a pilha de avatares. */
  preview: readonly Artist[];
  /** Quantos artistas ficaram fora da grade. */
  count: number;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Célula tracejada "+18 artistas" da 1l: abre a sheet com todos. É um alvo só,
 * com o rótulo inteiro; o "Ver todos" de dentro é texto, não um segundo botão,
 * e os avatares são decorativos.
 */
export function MoreArtistsCard({
  preview,
  count,
  onPress,
  disabled,
  style,
}: MoreArtistsCardProps) {
  return (
    <Card
      variant="dashed"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={t('onboarding.chooseArtists.moreLabel', { count })}
      style={[styles.card, style]}
    >
      <AvatarStack
        people={preview.map((artist) => ({
          id: artist.id,
          name: artist.name,
          photoUrl: artist.photoURL,
        }))}
        size="xs"
      />
      <Text variant="buttonSmall" style={styles.centered}>
        {t('onboarding.chooseArtists.more', { count })}
      </Text>
      <Text variant="micro" color={colors.accent} style={styles.centered}>
        {t('onboarding.chooseArtists.seeAll')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    height: layout.artistTileHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.gridGap,
  },
  // Com a fonte grande, o "+18 artistas" quebra centralizado, como o "Buscar por nome".
  centered: {
    textAlign: 'center',
  },
});
