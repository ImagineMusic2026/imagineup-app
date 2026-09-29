import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ProgressRing } from '@/components/progress-ring';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { t } from '@/i18n';
import { layout, radii, spacing, typography } from '@/theme';

import { useSeasonRing } from './season-goal-card';

// O card lima tem 90 no protótipo, com o título numa linha; a sobrelinha ocupa
// a largura de "Hoje" em caixa alta. As barras de texto têm a entrelinha das
// variantes que elas guardam.
const FEATURED_HEIGHT = 90;
const LABEL_WIDTH = 44;
const ROWS = 3;

/** Título e meta de um card: uma barra mais larga em cima, uma mais curta embaixo. */
function TextBars({ top, bottom }: { top: number; bottom: number }) {
  return (
    <View style={styles.texts}>
      <Skeleton tone="line" width="62%" height={top} />
      <Skeleton tone="line" width="42%" height={bottom} style={styles.meta} />
    </View>
  );
}

/**
 * Esqueleto da 1g abaixo do título, que já é o de verdade, montado com as
 * mesmas peças da lista (para ter a altura dela e não saltar quando os dados
 * chegam): a meta da temporada com o trilho do anel, a sobrelinha, o card lima
 * e três linhas com o quadro do ícone. Pulsam juntos e são lidos como
 * "Carregando as missões".
 */
export function MissionsSkeleton() {
  const ring = useSeasonRing();

  return (
    <SkeletonGroup accessibilityLabel={t('missions.loading')}>
      <Card variant="large" style={[styles.row, styles.season]}>
        <ProgressRing progress={0} size={ring.size} strokeWidth={ring.strokeWidth} />
        <TextBars
          top={typography.headingSection.lineHeight}
          bottom={typography.bodyXs.lineHeight}
        />
      </Card>
      <View style={styles.label}>
        <Skeleton tone="line" width={LABEL_WIDTH} height={typography.overline.lineHeight} />
      </View>
      <View style={styles.list}>
        <Skeleton tone="points" height={FEATURED_HEIGHT} radius={radii.lg} />
        {Array.from({ length: ROWS }, (_, index) => (
          <Card key={index} style={styles.row}>
            <Skeleton
              tone="line"
              width={layout.iconTile}
              height={layout.iconTile}
              radius={radii.xs}
            />
            <TextBars top={typography.label.lineHeight} bottom={typography.caption.lineHeight} />
          </Card>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  // Os mesmos vãos dos cards de verdade: 12 nas linhas e 15 na meta da temporada.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.itemGap,
  },
  season: {
    gap: spacing.titleToChips,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
  label: {
    paddingTop: spacing.sectionLabelTop,
    paddingBottom: spacing.listGap,
  },
  list: {
    gap: spacing.listGap,
  },
});
