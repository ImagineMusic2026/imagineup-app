import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { colors, spacing, type TypographyVariant } from '@/theme';

import { OfficialBadge, type OfficialBadgeSize } from './official-badge';

export interface ClubNameProps {
  name: string;
  /** Oficializado pela equipe: o selo logo depois do nome (34.23). */
  official: boolean;
  variant?: TypographyVariant;
  color?: string;
  badgeSize?: OfficialBadgeSize;
  testID?: string;
}

/**
 * O nome do fã-clube com o selo de oficial ao lado, no molde do nome do
 * artista com o selo de verificado (o autor do post): o nome quebra, e o selo
 * fica ao lado dele. Sem papel nem rótulo próprios: quem mostra põe o
 * "fã-clube oficial" no rótulo do bloco (`clubNameLabel`).
 */
export function ClubName({
  name,
  official,
  variant = 'label',
  color = colors.text,
  badgeSize = 14,
  testID,
}: ClubNameProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Text variant={variant} color={color} style={styles.name}>
        {name}
      </Text>
      {official ? <OfficialBadge size={badgeSize} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
  },
  name: {
    flexShrink: 1,
  },
});
