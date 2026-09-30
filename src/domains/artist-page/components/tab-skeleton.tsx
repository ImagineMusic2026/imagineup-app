import type { Ref } from 'react';
import { StyleSheet, type View } from 'react-native';

import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { radii, spacing } from '@/theme';

// Altura das linhas de missão (1g), de show (1m) e do ranking (1f), perto do desenho.
const ROW_HEIGHT = 64;
const ROWS = 4;

export interface TabSkeletonProps {
  /** "Carregando as missões", via `t()`. */
  accessibilityLabel: string;
  /** Para levar o foco do leitor de tela até o "Carregando". */
  ref?: Ref<View>;
}

/** Missões, shows ou posições chegando: linhas escuras no lugar das de verdade. */
export function TabSkeleton({ accessibilityLabel, ref }: TabSkeletonProps) {
  return (
    <SkeletonGroup ref={ref} accessibilityLabel={accessibilityLabel} style={styles.group}>
      {Array.from({ length: ROWS }, (_, index) => (
        <Skeleton key={index} height={ROW_HEIGHT} radius={radii.lg} />
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.listGap,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.gutter,
  },
});
