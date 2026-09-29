import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { t } from '@/i18n';
import { borderWidths, colors, layout, motion, radii, spacing } from '@/theme';

import { FEATURED_COUNT } from '../consts';

// Barras do nome e dos fãs, nas medidas do texto que vai chegar.
const NAME_BAR = { height: 12, width: '52%' } as const;
const FANS_BAR = { height: 9, width: '32%' } as const;
const COLUMNS = 2;

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton tone="line" height={NAME_BAR.height} width={NAME_BAR.width} radius={radii.pill} />
      <Skeleton
        tone="line"
        height={FANS_BAR.height}
        width={FANS_BAR.width}
        radius={radii.pill}
        style={styles.fans}
      />
    </View>
  );
}

/**
 * A grade da 1l enquanto os artistas carregam: os quatro cards do destaque,
 * com um pulso só e um foco só ("Carregando os artistas"). Quando os artistas
 * chegam, fica no lugar um instante e sai em fade enquanto a grade entra por
 * cima: sumindo num quadro, sobravam quadros vazios até a grade montar (os
 * cards levam alguns quadros para desenhar). Com reduzir movimento, sai na
 * hora (o Reanimated segue a opção do sistema).
 */
export function ArtistGridSkeleton() {
  const rows = Math.ceil(FEATURED_COUNT / COLUMNS);
  return (
    <Animated.View exiting={FadeOut.delay(motion.duration.fast).duration(motion.duration.base)}>
      <SkeletonGroup accessibilityLabel={t('onboarding.chooseArtists.loading')} style={styles.grid}>
        {Array.from({ length: rows }, (_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: COLUMNS }, (_, column) => (
              <SkeletonCard key={column} />
            ))}
          </View>
        ))}
      </SkeletonGroup>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.itemGap,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.itemGap,
  },
  card: {
    flex: 1,
    height: layout.artistTileHeight,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.gridGap,
    paddingBottom: spacing.listGap,
    borderRadius: radii.lg,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  fans: {
    marginTop: spacing.xs,
  },
});
