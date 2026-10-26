import { LockSimpleIcon } from 'phosphor-react-native/src/icons/LockSimple';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { colors, isLargeText, radii, spacing, typography } from '@/theme';

import {
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_SLOTS,
  ACHIEVEMENT_TONE_COLORS,
  FALLBACK_ACHIEVEMENT_ICON,
} from '../consts';
import { achievementLabel } from '../describe-profile';
import type { Achievement } from '../types';

// O ícone da medalha, sem quadro em volta: ele é o desenho da peça.
const ICON_SIZE = 34;
const LABEL_SKELETON_WIDTH = '70%';

export interface AchievementTileProps {
  achievement: Achievement;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Conquistada, o ícone dela em duotone na cor do assunto; bloqueada, o
 * cadeado em duotone cinza. O Phosphor desenha sem papel de acessibilidade, e
 * a peça em volta é o elemento do leitor.
 */
function AchievementIcon({ achievement }: { achievement: Achievement }) {
  if (!achievement.unlockedAt) {
    return <LockSimpleIcon size={ICON_SIZE} color={colors.textMuted} weight="duotone" />;
  }
  const Medal = ACHIEVEMENT_ICONS[achievement.icon] ?? FALLBACK_ACHIEVEMENT_ICON;
  return (
    <Medal size={ICON_SIZE} color={ACHIEVEMENT_TONE_COLORS[achievement.tone]} weight="duotone" />
  );
}

/**
 * Peça de conquista da 1e, "clean" a pedido do dono (26/10/2026): sem o
 * quadro tingido nem a borda tracejada de antes, só o ícone de medalha do
 * Phosphor (duotone, na cor do assunto: rosa, lima ou ciano) e o nome
 * embaixo, em branco; bloqueada, o cadeado e o nome em `textMuted`. Ainda não
 * é tocável (não há tela de conquistas): o leitor ouve o nome e se está
 * conquistada, num elemento só. Com a fonte maior, o nome quebra em mais
 * linhas e a peça cresce na altura.
 */
export function AchievementTile({ achievement, style, testID }: AchievementTileProps) {
  const unlocked = achievement.unlockedAt !== null;

  return (
    <View
      accessible
      accessibilityLabel={achievementLabel(achievement)}
      testID={testID}
      style={[styles.tile, style]}
    >
      <AchievementIcon achievement={achievement} />
      <Text
        variant="caption"
        color={unlocked ? colors.text : colors.textMuted}
        style={styles.label}
      >
        {achievement.title}
      </Text>
    </View>
  );
}

/**
 * Quatro peças por linha; com a fonte grande, duas. Sem o quadro, o nome
 * cresce até 200%, e na quarta parte de um aparelho de 360 uma palavra como
 * "Backstage" não caberia e quebraria no meio.
 */
function useRowStyles() {
  const { fontScale } = useWindowDimensions();
  const large = isLargeText(fontScale);
  return { row: [styles.row, large && styles.rowWrap], tile: large ? styles.half : null };
}

/** A linha das peças de conquista, na ordem do servidor. */
export function AchievementsRow({
  achievements,
  style,
  testID,
}: {
  achievements: readonly Achievement[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const layout = useRowStyles();
  return (
    <View testID={testID} style={[layout.row, style]}>
      {achievements.slice(0, ACHIEVEMENT_SLOTS).map((achievement) => (
        <AchievementTile
          key={achievement.id}
          achievement={achievement}
          testID={`profile-achievement-${achievement.id}`}
          style={layout.tile}
        />
      ))}
    </View>
  );
}

/** A linha de peças enquanto as conquistas chegam (dentro de um `SkeletonGroup`). */
export function AchievementsSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const layout = useRowStyles();
  return (
    <View style={[layout.row, style]}>
      {Array.from({ length: ACHIEVEMENT_SLOTS }, (_, index) => (
        <View key={index} style={[styles.tile, layout.tile]}>
          <Skeleton height={ICON_SIZE} circle />
          <Skeleton
            height={typography.caption.lineHeight}
            width={LABEL_SKELETON_WIDTH}
            radius={radii.xxs}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.metaGap,
    paddingVertical: spacing.xs,
  },
  label: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.tileGap,
  },
  rowWrap: {
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  // Duas por linha: a metade menos o vão (40% de base, e o resto cresce).
  half: {
    flexBasis: '40%',
  },
});
