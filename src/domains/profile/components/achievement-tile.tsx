import { Lock } from 'lucide-react-native';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Glyph } from '@/components/glyph';
import { Icon } from '@/components/icon';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { borderWidths, colors, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import {
  ACHIEVEMENT_GLYPHS,
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_SLOTS,
  ACHIEVEMENT_TONE_COLORS,
  FALLBACK_ACHIEVEMENT_ICON,
} from '../consts';
import { achievementLabel } from '../describe-profile';
import type { Achievement } from '../types';

const ICON_SIZE = 24;
// O cadeado do protótipo (22) ocupa menos da caixa que o `Lock` do lucide: em
// 18, o desenho fica do tamanho dele (13,5 x 15), e o traço de 2,1 fica com a
// espessura do dele na tela (1,6).
const LOCK_SIZE = 18;
const LOCK_STROKE = 2.1;

export interface AchievementTileProps {
  achievement: Achievement;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function AchievementIcon({ achievement }: { achievement: Achievement }) {
  if (!achievement.unlockedAt) {
    return <Icon icon={Lock} size={LOCK_SIZE} color={colors.textMuted} strokeWidth={LOCK_STROKE} />;
  }
  const color = ACHIEVEMENT_TONE_COLORS[achievement.tone];
  const glyph = ACHIEVEMENT_GLYPHS[achievement.icon];
  if (glyph) return <Glyph name={glyph} size={ICON_SIZE} color={color} />;
  return (
    <Icon
      icon={ACHIEVEMENT_ICONS[achievement.icon] ?? FALLBACK_ACHIEVEMENT_ICON}
      size={ICON_SIZE}
      color={color}
    />
  );
}

/**
 * Lado da peça quadrada: a linha ocupa a largura da tela menos as margens, em
 * `ACHIEVEMENT_SLOTS` peças com o vão entre elas.
 */
function useTileSide(): number {
  const { width } = useWindowDimensions();
  const gaps = (ACHIEVEMENT_SLOTS - 1) * spacing.tileGap;
  return (width - 2 * spacing.gutter - gaps) / ACHIEVEMENT_SLOTS;
}

/**
 * Peça de conquista da 1e: tingida na cor do assunto (rosa, lima ou ciano)
 * quando conquistada, com o rótulo em branco (texto rosa sobre rosa tingido
 * reprova contraste); bloqueada, superfície com borda tracejada, cadeado e
 * rótulo em `textMuted`. Ainda não é tocável (não há tela de conquistas): o
 * leitor ouve o nome e se está conquistada, num elemento só.
 *
 * Quadrada com a fonte padrão; com a fonte maior, continua com pelo menos o
 * lado do quadrado e cresce na altura quando o rótulo pede, em vez de
 * cortá-lo. A linha fica da altura da peça mais alta.
 */
export function AchievementTile({ achievement, style, testID }: AchievementTileProps) {
  const { fontScale } = useWindowDimensions();
  const side = useTileSide();
  const unlocked = achievement.unlockedAt !== null;
  const tone = ACHIEVEMENT_TONE_COLORS[achievement.tone];

  return (
    <View
      accessible
      accessibilityLabel={achievementLabel(achievement)}
      testID={testID}
      style={[
        styles.tile,
        fontScale > 1 ? [styles.grow, { minHeight: side }] : styles.square,
        unlocked
          ? {
              backgroundColor: withAlpha(tone, tints.soft.fill),
              borderColor: withAlpha(tone, tints.soft.border),
            }
          : styles.locked,
        style,
      ]}
    >
      <AchievementIcon achievement={achievement} />
      <Text
        variant="microLabel"
        color={unlocked ? colors.text : colors.textMuted}
        style={styles.label}
      >
        {achievement.title}
      </Text>
    </View>
  );
}

/** A linha das peças de conquista, na ordem do servidor. */
export function AchievementsRow({
  achievements,
  style,
}: {
  achievements: readonly Achievement[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      {achievements.slice(0, ACHIEVEMENT_SLOTS).map((achievement) => (
        <AchievementTile
          key={achievement.id}
          achievement={achievement}
          testID={`profile-achievement-${achievement.id}`}
        />
      ))}
    </View>
  );
}

/** A linha de peças enquanto as conquistas chegam (dentro de um `SkeletonGroup`). */
export function AchievementsSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      {Array.from({ length: ACHIEVEMENT_SLOTS }, (_, index) => (
        <View key={index} style={[styles.cell, styles.square]}>
          <Skeleton height="100%" radius={radii.lg} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.metaGap,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: borderWidths.default,
  },
  square: {
    aspectRatio: 1,
  },
  grow: {
    paddingVertical: spacing.md,
  },
  // Branco a .16 tracejado, como no protótipo: "ainda não".
  locked: {
    backgroundColor: colors.surface,
    borderColor: colors.borderOutline,
    borderStyle: 'dashed',
  },
  label: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.tileGap,
  },
  cell: {
    flex: 1,
  },
});
