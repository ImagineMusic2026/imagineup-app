import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/card';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, isLargeText, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

const SKELETON_WIDTH = 34;

export interface NumberCardProps {
  label: string;
  /** `null` enquanto o número carrega (o esqueleto no lugar). */
  value: number | null;
  testID?: string;
}

/**
 * Um número do "Meu fã-clube" ("Seguidores", "Visitas"), no molde da caixa de
 * número da 1e: não é tocável, e o leitor ouve o rótulo com o valor (34.9,
 * acessibilidade). O rótulo quebra em vez de cortar com a fonte grande.
 */
export function NumberCard({ label, value, testID }: NumberCardProps) {
  return (
    <Card
      variant="compact"
      accessible
      accessibilityLabel={
        value === null
          ? label
          : t('fanClub.mine.numberLabel', { label, value: formatNumber(value) })
      }
      testID={testID}
      style={styles.card}
    >
      {value === null ? (
        <Skeleton width={SKELETON_WIDTH} height={spacing.lg} tone="line" />
      ) : (
        <Text variant="titleHeader">{formatNumber(value)}</Text>
      )}
      <Text variant="caption" color={colors.textMuted} style={styles.label}>
        {label}
      </Text>
    </Card>
  );
}

export interface NumberGridProps {
  items: readonly NumberCardProps[];
  testID?: string;
}

/**
 * Os números em duas colunas; da fonte 1,3 em diante (`isLargeText`), um por
 * linha, para o rótulo não ficar espremido.
 */
export function NumberGrid({ items, testID }: NumberGridProps) {
  const single = isLargeText(useWindowDimensions().fontScale);
  return (
    <View style={styles.grid} testID={testID}>
      {items.map((item) => (
        <View key={item.label} style={single ? styles.full : styles.half}>
          <NumberCard {...item} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: spacing.xs,
  },
  label: {
    marginTop: spacing.xxs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.listGap,
  },
  // Duas por linha, com o vão entre elas.
  half: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  full: {
    flexBasis: '100%',
  },
});
