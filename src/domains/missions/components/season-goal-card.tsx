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
import { formatCompact, formatNumber } from '@/utils/number';

import type { SeasonGoal } from '../types';

// Anel de 62 com traço 7 e furo de 48 no protótipo.
const RING_SIZE = 62;
const RING_STROKE = 7;
/**
 * Acima disso o "4,1 mil/5 mil" não cabe no furo de 48 (passa de 80 pt na
 * fonte do anel): a meta por pontos mostra a porcentagem no furo e os números
 * numa linha abaixo do título (22.7).
 */
const RING_NUMBER_MAX = 999;

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
 *
 * A meta pode contar os pontos da temporada (bloco 7, o painel escolhe): com
 * alvo acima de 999, o furo mostra a porcentagem, arredondada para baixo
 * ("82%"), e a linha "4,1 mil de 5 mil pontos" vem abaixo do título; o leitor
 * de tela ouve os números inteiros.
 */
export function SeasonGoalCard({ season, style }: SeasonGoalCardProps) {
  const ring = useSeasonRing();
  const { title, description, completedCount, targetCount } = season;
  const done = Math.min(completedCount, targetCount);
  const reached = targetCount > 0 && completedCount >= targetCount;
  const numberColor = reached ? colors.points : colors.text;
  const byPoints = season.metric === 'points';
  const large = byPoints && targetCount > RING_NUMBER_MAX;
  const percent = targetCount > 0 ? Math.floor((done / targetCount) * 100) : 0;
  const progress = byPoints
    ? t('missions.season.pointsMeta', {
        done: formatNumber(done),
        total: formatNumber(targetCount),
      })
    : t('missions.progressLabel', {
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
        {large ? (
          <Text variant="headingSection" color={numberColor}>
            {t('missions.season.percent', { percent: formatNumber(percent) })}
          </Text>
        ) : (
          <Text variant="headingSection" color={numberColor}>
            {formatNumber(done)}
            <Text variant="counterSuffix" color={reached ? colors.points : colors.textMuted}>
              {`/${formatNumber(targetCount)}`}
            </Text>
          </Text>
        )}
      </ProgressRing>
      <View style={styles.texts}>
        <Text variant="headingSection">{title}</Text>
        {large ? (
          <Text
            variant="bodyXs"
            color={reached ? colors.points : colors.textSecondary}
            style={styles.description}
          >
            {t('missions.season.pointsMeta', {
              done: formatCompact(done),
              total: formatCompact(targetCount),
            })}
          </Text>
        ) : null}
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
