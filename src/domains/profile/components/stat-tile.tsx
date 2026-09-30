import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, radii, spacing, typography } from '@/theme';
import { formatNumber } from '@/utils/number';

import { statLabel, type StatKind } from '../describe-profile';
import type { FanStats } from '../types';

const STAT_ORDER: readonly StatKind[] = ['linksCreated', 'peopleBrought', 'seasons'];
// O número e o rótulo do esqueleto, no tamanho do que vem.
const NUMBER_WIDTH = 34;
const LABEL_WIDTH = '80%';

export interface StatTileProps {
  value: number;
  /** "links criados", já no singular ou no plural. */
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Caixa de número da 1e ("63 links criados"). Não é tocável; um elemento só
 * para o leitor. Cresce com a fonte do sistema em vez de cortar o rótulo.
 */
export function StatTile({ value, label, style, testID }: StatTileProps) {
  return (
    <Card
      variant="compact"
      accessible
      accessibilityLabel={t('profile.stats.label', { value: formatNumber(value), label })}
      testID={testID}
      style={[styles.tile, style]}
    >
      <Text variant="titleHeader">{formatNumber(value)}</Text>
      <Text variant="statCaption" color={colors.textMuted} style={styles.label}>
        {label}
      </Text>
    </Card>
  );
}

/** Os três números do fã, lado a lado (o terceiro é provisório: "temporadas"). */
export function FanStatsRow({ stats, style }: { stats: FanStats; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      {STAT_ORDER.map((kind) => (
        <StatTile
          key={kind}
          value={stats[kind]}
          label={statLabel(kind, stats[kind])}
          testID={`profile-stat-${kind}`}
          style={styles.cell}
        />
      ))}
    </View>
  );
}

/** As três caixas enquanto os números chegam (dentro do `SkeletonGroup` da tela). */
export function FanStatsSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      {STAT_ORDER.map((kind) => (
        <Card key={kind} variant="compact" style={[styles.tile, styles.cell]}>
          <Skeleton height={typography.titleHeader.lineHeight} width={NUMBER_WIDTH} tone="line" />
          <Skeleton
            height={typography.statCaption.lineHeight}
            width={LABEL_WIDTH}
            radius={radii.xxs}
            tone="line"
            style={styles.label}
          />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 12 em cima e embaixo, 11 dos lados, como no protótipo.
  tile: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gridGap,
  },
  label: {
    marginTop: spacing.metaGap,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.tileGap,
  },
  cell: {
    flex: 1,
  },
});
