import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing, typography } from '@/theme';

import { COLUMN_FLEX, podiumStepHeights, type PodiumPlace } from './podium';
import { POSITION_WIDTH } from './ranking-row';

// Na ordem da tela: 2º, 1º e 3º, com as larguras e os degraus do pódio.
const PODIUM_ORDER: readonly PodiumPlace[] = [2, 1, 3];
const ROWS = 5;
// A barra da posição, dentro da mesma largura que a linha reserva para ela.
const POSITION_BAR_WIDTH = 14;
const NAME_WIDTH = 132;
const CITY_WIDTH = 84;
const POINTS_WIDTH = 38;

/**
 * Esqueleto do ranking (1f) abaixo da temporada: o pódio com os três
 * avatares e os degraus, e cinco linhas, com as medidas de verdade para nada
 * saltar quando as posições chegam. Pulsam juntos e são lidos como
 * "Carregando o ranking". Título e chips ficam de verdade (na troca de chip,
 * só isto aparece).
 */
export function RankingSkeleton() {
  const steps = podiumStepHeights(useWindowDimensions().fontScale);

  return (
    <SkeletonGroup accessibilityLabel={t('ranking.loading')} style={styles.container}>
      <View style={styles.podium}>
        {PODIUM_ORDER.map((place) => (
          <View key={place} style={[styles.column, { flex: COLUMN_FLEX[place] }]}>
            <Skeleton
              circle
              tone="raised"
              height={layout.avatar[place === 1 ? 'podiumFirst' : 'podium'].size}
            />
            <Skeleton tone="sunken" height={steps[place]} radius={radii.sm} style={styles.step} />
          </View>
        ))}
      </View>
      <View style={styles.rows}>
        {Array.from({ length: ROWS }, (_, row) => (
          <View key={row} style={styles.row}>
            <View style={styles.position}>
              <Skeleton
                tone="line"
                width={POSITION_BAR_WIDTH}
                height={typography.points.fontSize}
              />
            </View>
            <Skeleton circle tone="raised" height={layout.avatar.md.size} />
            <View style={styles.texts}>
              <Skeleton tone="line" width={NAME_WIDTH} height={typography.label.fontSize} />
              <Skeleton tone="line" width={CITY_WIDTH} height={typography.metaSmall.fontSize} />
            </View>
            <Skeleton tone="line" width={POINTS_WIDTH} height={typography.points.fontSize} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.blockGap,
    paddingHorizontal: spacing.gutter,
  },
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.tileGap,
  },
  column: {
    alignItems: 'center',
  },
  step: {
    alignSelf: 'stretch',
    marginTop: spacing.tileGap,
  },
  rows: {
    paddingTop: spacing.sm,
  },
  // A linha de verdade: 11 em cima e embaixo, avatar de 36 e a borda.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.itemGap,
    paddingVertical: spacing.gridGap,
    borderBottomWidth: borderWidths.default,
    borderBottomColor: colors.transparent,
  },
  position: {
    width: POSITION_WIDTH,
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
});
