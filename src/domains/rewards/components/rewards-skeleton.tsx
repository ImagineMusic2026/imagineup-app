import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { SectionLabel } from '@/components/section-label';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { t } from '@/i18n';
import { borderWidths, layout, radii, spacing, typography } from '@/theme';

const ROWS = 2;
const COLUMNS = 2;
// O bloco do preço: a entrelinha do `chip`, o padding e a borda.
const PRICE_HEIGHT = typography.chip.lineHeight + spacing.metaGap * 2 + borderWidths.default * 2;

function CardSkeleton() {
  return (
    <Card padding="md" style={styles.card}>
      <Skeleton tone="line" height={layout.rewardTileHeight} radius={radii.xs} />
      <Skeleton tone="line" width="70%" height={typography.label.lineHeight} style={styles.title} />
      <Skeleton
        tone="line"
        width="55%"
        height={typography.metaSmall.lineHeight}
        style={styles.subtitle}
      />
      <Skeleton tone="line" height={PRICE_HEIGHT} radius={radii.xxs} />
    </Card>
  );
}

/**
 * Esqueleto da 1h abaixo do título, que já é o de verdade: o destaque, a
 * sobrelinha (com o texto de verdade, como no protótipo) e quatro cards com
 * as mesmas medidas, para nada saltar quando a loja chega. Pulsam juntos e
 * são lidos como "Carregando as recompensas".
 */
export function RewardsSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('rewards.loading')}>
      <Skeleton tone="sunken" height={layout.rewardHeroMinHeight} radius={radii.xxl} />
      <SectionLabel>{t('rewards.sections.reachable')}</SectionLabel>
      <View style={styles.grid}>
        {Array.from({ length: ROWS }, (_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: COLUMNS }, (_, column) => (
              <CardSkeleton key={column} />
            ))}
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.gridGap,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.gridGap,
  },
  card: {
    flex: 1,
  },
  title: {
    marginTop: spacing.gridGap,
  },
  subtitle: {
    marginTop: spacing.metaGap,
    marginBottom: spacing.listGap,
  },
});
