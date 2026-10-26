import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { colors, fonts, layout, radii, spacing, typography } from '@/theme';

import { levelFraction, nextLevelCaption, nextLevelSpoken } from '../describe-profile';
import type { MyProgress } from '../types';
import { LevelBadge } from './level-badge';

// Tamanho do selo enquanto o nível carrega (o "NÍVEL 7 · PURAINHA" do protótipo).
const BADGE_SKELETON = { width: 150, height: 23 };
const CAPTION_SKELETON_WIDTH = '70%';

export interface LevelProgressProps {
  /** Nível e XP de nível: o selo, a barra e o "Faltam ...". */
  progress: MyProgress;
  /** Muda a cada subida de nível que o fã vê (`useLevelUp`): o selo festeja. */
  celebration?: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * O nível embaixo da bio da 1e, no lugar do card de pontos: o selo "NÍVEL 7 ·
 * PURAINHA", uma barra fina e "Faltam 2.520 pts para o nível 8 · Xodó". A
 * barra conta o XP de nível, que nunca cai, e anda junto com o anel do avatar
 * (mesma duração e curva; na subida de nível, as duas recomeçam do 0).
 *
 * Um elemento só para o leitor, lido como progresso: "Faltam 2.520 pontos para
 * o nível 8, Xodó." O nível de agora o leitor já ouviu no hero.
 */
export function LevelProgress({ progress, celebration = null, style, testID }: LevelProgressProps) {
  const fraction = levelFraction(progress);
  const caption = nextLevelCaption(progress);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={nextLevelSpoken(progress)}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      testID={testID}
      style={style}
    >
      <LevelBadge level={progress.level} celebration={celebration} style={styles.badge} />
      <ProgressBar
        key={progress.level.number}
        value={fraction}
        size="xs"
        style={styles.bar}
        testID={testID ? `${testID}-bar` : undefined}
      />
      <Text variant="caption" color={colors.textMuted}>
        {'text' in caption ? (
          caption.text
        ) : (
          <>
            {caption.before}
            <Text variant="caption" style={styles.amount}>
              {caption.amount}
            </Text>
            {caption.after}
          </>
        )}
      </Text>
    </View>
  );
}

/** O nível enquanto chega, com as medidas do de verdade. */
export function LevelProgressSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Skeleton
        height={BADGE_SKELETON.height}
        width={BADGE_SKELETON.width}
        radius={radii.pill}
        style={styles.badge}
      />
      <Skeleton height={layout.progressBar.xs} radius={radii.pill} style={styles.bar} />
      <Skeleton height={typography.caption.lineHeight} width={CAPTION_SKELETON_WIDTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
  },
  bar: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  amount: {
    fontFamily: fonts.manropeBold,
    color: colors.text,
  },
});
