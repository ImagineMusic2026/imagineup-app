import { Search } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, spacing } from '@/theme';

export interface SearchArtistsCardProps {
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const ICON_SIZE = 26;

/** Célula tracejada "Buscar por nome" da 1l: abre a sheet de todos os artistas já na busca. */
export function SearchArtistsCard({ onPress, disabled, style }: SearchArtistsCardProps) {
  return (
    <Card
      variant="dashed"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={t('onboarding.chooseArtists.searchLabel')}
      style={[styles.card, style]}
    >
      <Icon icon={Search} size={ICON_SIZE} color={colors.textMuted} />
      <Text variant="labelCompact" color={colors.textSubtle} style={styles.label}>
        {t('onboarding.chooseArtists.search')}
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
  label: {
    textAlign: 'center',
  },
});
