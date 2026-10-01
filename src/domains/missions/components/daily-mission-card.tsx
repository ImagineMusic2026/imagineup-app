import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ProgressBar } from '@/components/progress-bar';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Stripes } from '@/components/stripes';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout, motion, radii, spacing, typography } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatTimeLeft, formatTimeLeftSpoken } from '@/utils/date';
import { formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import { inviteHref } from '../describe-mission';
import { useDailyMission } from '../hooks/use-daily-mission';
import type { DailyMission } from '../types';

// Tinta sobre o lima, com os alfas do protótipo: selo a .6 (4,97:1, passa AA
// com o peso 800) e trilho da barra a .16.
const BADGE_COLOR = withAlpha(colors.onPoints, 0.6);
const TRACK_COLOR = withAlpha(colors.onPoints, 0.16);

// Os botões desenham 36 dentro de um alvo de 44 (`mdCompact`): 4 sobram em cima
// e embaixo. O vão até a barra (15) e o padding de baixo do card (16) perdem
// esses 4, e o card fica com a altura do protótipo.
const BUTTON_OUTSET = (layout.minTouchTarget - layout.buttonHeight.mdCompact) / 2;
// O protótipo usa entrelinha 1 no "+20" (13) e no "3/5" (12); aqui elas são
// maiores, porque a Sora corta descendentes com entrelinha menor. Os vãos
// descontam a sobra para o título, a barra e os botões caírem onde o desenho
// põe: o "+20" sobra 3 (o vão até o título cai de 11 para 8) e o "3/5" sobra 2,
// 1 em cima e 1 embaixo da barra (os dois vãos de 15 caem para 14).
const POINTS_LEADING = typography.points.lineHeight - typography.points.fontSize;
const COUNTER_FONT_SIZE = 12;
const COUNTER_LEADING_HALF = (typography.chip.lineHeight - COUNTER_FONT_SIZE) / 2;

// "+20" pulsa uma vez quando a missão é concluída com a tela aberta.
const PULSE_SCALE = 1.12;
const CHECK_SIZE = 14;
const CHECK_STROKE = 2.6;

// Altura do card com a fonte padrão e o título em duas linhas (a do protótipo).
const SKELETON_HEIGHT = 184;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no',
  accessibilityElementsHidden: true,
} as const;

/**
 * Toque, anúncio e pulso do "+20" quando a missão é concluída diante do fã
 * (não ao montar). Como todo ganho de pontos, um toque e um anúncio só, na
 * fila para não cortar o que o leitor estiver falando. Com a home fora de
 * foco (o fã na 1g, que festeja a mesma missão), a conclusão passa em
 * silêncio: só a tela que o fã está vendo fala.
 *
 * A tela fora de foco pode só ver o dado novo quando volta a ele (a lista da
 * aba escondida não redesenha na hora): conclusão que chega junto com a volta
 * do foco também aconteceu longe da home, e não festeja.
 */
function useCompletionPulse(completed: boolean, rewardPoints: number, celebrate: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = useSharedValue(1);
  const wasCompleted = useRef(completed);
  const wasCelebrating = useRef(celebrate);

  useEffect(() => {
    const justCompleted = completed && !wasCompleted.current;
    const cameBack = celebrate && !wasCelebrating.current;
    wasCompleted.current = completed;
    wasCelebrating.current = celebrate;
    if (!justCompleted || !celebrate || cameBack) return;
    haptics.trigger('missionComplete');
    AccessibilityInfo.announceForAccessibilityWithOptions(
      t('missions.daily.completedAnnouncement', { points: formatPointsSpoken(rewardPoints) }),
      { queue: true },
    );
    if (reducedMotion) return;
    scale.set(
      withSequence(
        withSpring(PULSE_SCALE, motion.spring.gentle),
        withSpring(1, motion.spring.gentle),
      ),
    );
  }, [completed, rewardPoints, celebrate, reducedMotion, scale]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
}

/** Link de convite e compartilhamento saem do "Gerar meu link"; as outras ações, da 1g. */
function sharesLink(mission: DailyMission): boolean {
  return mission.action === 'share' || mission.action === 'invite';
}

export interface DailyMissionCardProps {
  mission: DailyMission;
  /** Relógio da contagem ("termina em 4 h"). */
  now: Date;
  /** Falso com a home fora de foco: a conclusão não toca, não anuncia nem pulsa. */
  celebrate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Card lima da missão do dia (1b), com as listras da marca. Não é pressável:
 * tem dois botões dentro. Selo e recompensa são lidos juntos e abrem a seção
 * como cabeçalho ("Missão de hoje, termina em 4 horas, vale 20 pontos"), como
 * "Suas centrais" e "Do seu fandom" abrem as delas; depois vêm o título e a
 * barra, um `progressbar` ("3 de 5"). O "3/5" visível fica fora do leitor.
 *
 * "Gerar meu link" abre a sheet de convite levando a missão e o post alvo (o
 * mesmo destino do card lima da 1g).
 * Concluída: barra cheia, "+20" com check e "Ver missões" como botão principal.
 */
export function DailyMissionCard({ mission, now, celebrate = true, style }: DailyMissionCardProps) {
  const completed = mission.status === 'completed';
  const { target } = mission.progress;
  const done = completed ? target : Math.min(mission.progress.current, target);
  const points = formatPointsSpoken(mission.rewardPoints);
  const badge = completed
    ? t('missions.daily.badgeCompleted')
    : t('missions.daily.badge', { time: formatTimeLeft(mission.endsAt, now) });
  const summary = completed
    ? t('missions.daily.summaryCompleted', { points })
    : t('missions.daily.summary', { time: formatTimeLeftSpoken(mission.endsAt, now), points });
  const rewardStyle = useCompletionPulse(completed, mission.rewardPoints, celebrate);
  const withLink = !completed && sharesLink(mission);

  return (
    <View style={[styles.card, style]}>
      <Stripes preset="onPoints" />
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={summary}
        style={styles.topRow}
      >
        <Text variant="overlineStrong" color={BADGE_COLOR} style={styles.badge}>
          {badge}
        </Text>
        <Animated.View style={[styles.reward, rewardStyle]}>
          {completed ? (
            <Icon
              icon={Check}
              size={CHECK_SIZE}
              color={colors.onPoints}
              strokeWidth={CHECK_STROKE}
            />
          ) : null}
          <Text variant="points" color={colors.onPoints}>
            {formatPointsDelta(mission.rewardPoints)}
          </Text>
        </Animated.View>
      </View>
      <Text
        variant="titleCard"
        color={colors.onPoints}
        textBreakStrategy="highQuality"
        lineBreakStrategyIOS="push-out"
        style={styles.title}
      >
        {mission.title}
      </Text>
      <View style={styles.progressRow}>
        <ProgressBar
          value={target > 0 ? done / target : 0}
          size="md"
          track={TRACK_COLOR}
          fill={colors.onPoints}
          accessibilityLabel={t('missions.daily.progress', { done, total: target })}
          accessibilityValue={{ min: 0, max: target, now: done }}
          style={styles.bar}
        />
        <Text variant="chip" color={colors.onPoints} {...hiddenFromReader}>
          {`${done}/${target}`}
        </Text>
      </View>
      <View style={styles.actions}>
        {withLink ? (
          <Button
            label={t('missions.daily.generateLink')}
            variant="onPoints"
            size="mdCompact"
            onPress={() => router.push(inviteHref(mission))}
            style={styles.main}
          />
        ) : null}
        <Button
          label={t('missions.daily.seeAll')}
          variant={withLink ? 'onPointsSoft' : 'onPoints'}
          size="mdCompact"
          // Na pilha da Ranking, com a 1f embaixo (a âncora), como o atalho do "+".
          onPress={() => router.navigate('/missoes', { withAnchor: true })}
          style={withLink ? undefined : styles.main}
        />
      </View>
    </View>
  );
}

/** Esqueleto no lugar do card, no lima tingido e sem listras. */
export function DailyMissionSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <SkeletonGroup accessibilityLabel={t('missions.daily.loading')} style={style}>
      <Skeleton tone="points" height={SKELETON_HEIGHT} radius={radii.xxl} style={styles.skeleton} />
    </SkeletonGroup>
  );
}

export interface DailyMissionSectionProps {
  /** Falso com a home fora de foco (ver `DailyMissionCard`). */
  celebrate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A missão do dia pronta para a home: esqueleto enquanto carrega, o card
 * entrando em fade quando ela chega e nada quando não há missão hoje (a tela
 * sobe). Expirada, some na hora. Se não carregou, a mensagem de erro com
 * "Tentar de novo" fica no lugar do card; o anúncio da falha é da tela.
 */
export function DailyMissionSection({ celebrate = true, style }: DailyMissionSectionProps) {
  const { mission, now, loading, failed, retrying, retry } = useDailyMission();
  if (loading) return <DailyMissionSkeleton style={style} />;
  if (failed) {
    return (
      <EmptyState
        tone="error"
        message={t('missions.daily.loadError')}
        onAction={retry}
        actionLoading={retrying}
        style={style}
      />
    );
  }
  if (!mission) return null;
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} style={style}>
      <DailyMissionCard mission={mission} now={now} celebrate={celebrate} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    borderRadius: radii.xxl,
    backgroundColor: colors.points,
    overflow: 'hidden',
    paddingTop: spacing.gutter,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.lg - BUTTON_OUTSET,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  badge: {
    flexShrink: 1,
  },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    marginTop: spacing.gridGap - POINTS_LEADING,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gridGap,
    marginTop: spacing.titleToChips - COUNTER_LEADING_HALF,
  },
  bar: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.titleToChips - COUNTER_LEADING_HALF - BUTTON_OUTSET,
  },
  main: {
    flex: 1,
  },
  skeleton: {
    marginHorizontal: spacing.gutter,
  },
});
