import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Card } from '@/components/card';
import { ProgressRing } from '@/components/progress-ring';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

import type { SeasonGoal } from '../types';

// Anel de 62 com traço 7 e furo de 48 no protótipo.
const RING_SIZE = 62;
const RING_STROKE = 7;

/**
 * O anel cresce junto com a fonte do sistema (até 200%), para o "12/20" do
 * furo crescer como o resto do texto e continuar cabendo nele. O card não é
 * tocável e ganha altura.
 */
export function useSeasonRing(): { size: number; strokeWidth: number } {
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
  return { size: RING_SIZE * scale, strokeWidth: RING_STROKE * scale };
}

export interface SeasonGoalCardProps {
  season: SeasonGoal;
  style?: StyleProp<ViewStyle>;
}

/**
 * Meta da temporada no topo da 1g ("Semana do arrocha", 12/20): anel lima que
 * cresce até o valor, com o número em branco e o total pequeno e apagado.
 * Cumprida, o número fica lima e a descrição (do servidor) diz o prêmio. Não
 * é tocável: um foco só, com a barra lida como progresso.
 */
export function SeasonGoalCard({ season, style }: SeasonGoalCardProps) {
  const ring = useSeasonRing();
  const { title, description, completedCount, targetCount } = season;
  const done = Math.min(completedCount, targetCount);
  const reached = targetCount > 0 && completedCount >= targetCount;
  const numberColor = reached ? colors.points : colors.text;
  const progress = t('missions.progressLabel', {
    done: formatNumber(done),
    total: formatNumber(targetCount),
  });

  return (
    <Card
      variant="large"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('missions.season.label', { title, progress, description })}
      accessibilityValue={{ min: 0, max: targetCount, now: done }}
      style={[styles.card, style]}
    >
      <ProgressRing
        progress={targetCount > 0 ? done / targetCount : 0}
        size={ring.size}
        strokeWidth={ring.strokeWidth}
      >
        {/* Sem números tabulares: o valor não conta animado, e o "1" tabular da Sora tem pé. */}
        <Text variant="headingSection" color={numberColor}>
          {formatNumber(done)}
          <Text variant="counterSuffix" color={reached ? colors.points : colors.textMuted}>
            {`/${formatNumber(targetCount)}`}
          </Text>
        </Text>
      </ProgressRing>
      <View style={styles.texts}>
        <Text variant="headingSection">{title}</Text>
        <Text variant="bodyXs" color={colors.textTertiary} style={styles.description}>
          {description}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.titleToChips,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    marginTop: spacing.metaGap,
  },
});
