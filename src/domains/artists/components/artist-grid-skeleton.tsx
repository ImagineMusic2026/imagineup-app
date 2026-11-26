import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { borderWidths, colors, layout, motion, radii, spacing } from '@/theme';

// Barras do nome e dos fãs, nas medidas do texto que vai chegar.
const NAME_BAR = { height: 12, width: '52%' } as const;
const FANS_BAR = { height: 9, width: '32%' } as const;
const COLUMNS = 2;

function SkeletonCard({ height }: { height: number }) {
  return (
    <View testID="artist-grid-skeleton-card" style={[styles.card, { height }]}>
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

export interface ArtistGridSkeletonProps {
  /** Quantos cards: os quatro do destaque na 1l, a primeira tela da grade na Explorar. */
  count: number;
  /** O que o leitor de tela ouve no foco único ("Carregando os artistas"), via `t()`. */
  accessibilityLabel: string;
  /** Altura de cada card: a do card da 1l, ou a da grade da Explorar (4:5 da coluna). */
  tileHeight?: number;
}

/**
 * A grade de artistas enquanto eles carregam (1l, a sheet de todos os
 * artistas e a vitrine da Explorar), com um pulso só e um foco só. Quando os
 * artistas chegam, fica no lugar um instante e sai em fade enquanto a grade
 * entra por cima: sumindo num quadro, sobravam quadros vazios até a grade
 * montar (os cards levam alguns quadros para desenhar). Com reduzir
 * movimento, sai na hora (o Reanimated segue a opção do sistema). A
 * quantidade e a altura vêm de quem chama: o esqueleto não importa o
 * `onboarding` nem o `explore`.
 */
export function ArtistGridSkeleton({
  count,
  accessibilityLabel,
  tileHeight = layout.artistTileHeight,
}: ArtistGridSkeletonProps) {
  const rows = Math.ceil(count / COLUMNS);
  return (
    <Animated.View exiting={FadeOut.delay(motion.duration.fast).duration(motion.duration.base)}>
      <SkeletonGroup accessibilityLabel={accessibilityLabel} style={styles.grid}>
        {Array.from({ length: rows }, (_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: COLUMNS }, (_, column) => (
              <SkeletonCard key={column} height={tileHeight} />
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
