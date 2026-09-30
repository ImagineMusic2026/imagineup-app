import { StyleSheet, View } from 'react-native';

import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { t } from '@/i18n';
import { borderWidths, layout, radii, spacing, typography } from '@/theme';

import { CHIP_HEIGHT, CHIP_SLACK } from './month-chips';

const CHIP_WIDTHS = [64, 58, 70] as const;
// A sobrelinha do primeiro mês ("OUTUBRO").
const MONTH_LABEL_WIDTH = 70;
const ROWS = 3;
// A linha de show: a divisória de 38 e o padding de 12, com a borda.
const ROW_HEIGHT = layout.dateDivider + spacing.md * 2 + borderWidths.default * 2;

/**
 * Esqueleto da agenda (1m) abaixo do título, que já é o de verdade: três
 * chips, o destaque, a sobrelinha do primeiro mês e três linhas, com as
 * medidas de verdade para nada saltar quando os shows chegam. Pulsam juntos e
 * são lidos como "Carregando a agenda".
 */
export function AgendaSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('agenda.loading')}>
      <View style={styles.chips}>
        {CHIP_WIDTHS.map((width) => (
          <Skeleton
            key={width}
            tone="raised"
            width={width}
            height={CHIP_HEIGHT}
            radius={radii.pill}
          />
        ))}
      </View>
      <View style={styles.body}>
        <Skeleton tone="surface" height={layout.eventHeroMinHeight} radius={radii.xl} />
        {/* O mesmo espaço da `SectionLabel` `month` (18 em cima, 10 embaixo). */}
        <View style={styles.monthLabel}>
          <Skeleton tone="line" width={MONTH_LABEL_WIDTH} height={typography.overline.lineHeight} />
        </View>
        <View style={styles.rows}>
          {Array.from({ length: ROWS }, (_, row) => (
            <Skeleton key={row} tone="surface" height={ROW_HEIGHT} radius={radii.lg} />
          ))}
        </View>
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  chips: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.chipGap,
    paddingHorizontal: spacing.gutter,
  },
  body: {
    paddingTop: spacing.blockGap - CHIP_SLACK,
    paddingHorizontal: spacing.gutter,
  },
  monthLabel: {
    paddingTop: spacing.blockGap,
    paddingBottom: spacing.listGap,
  },
  rows: {
    gap: spacing.listGap,
  },
});
