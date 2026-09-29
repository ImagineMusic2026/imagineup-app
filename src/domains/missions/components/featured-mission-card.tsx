import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PointsToast } from '@/components/points-toast';
import { PressableScale } from '@/components/pressable-scale';
import { ProgressBar } from '@/components/progress-bar';
import { Stripes } from '@/components/stripes';
import { Text } from '@/components/text';
import { colors, layout, radii, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatPointsDelta } from '@/utils/number';

import { missionHint, missionLabel, missionMeta } from '../describe-mission';
import type { Mission } from '../types';
import { CheckBadge } from './check-badge';
import { MissionIcon } from './mission-icon';

// Tinta sobre o lima com os alfas do protótipo da 1g: listras a .08, meta a .65
// (cerca de 6:1, passa) e trilho da barra a .16.
const STRIPES_ALPHA = 0.08;
const META_COLOR = withAlpha(colors.onPoints, 0.65);
const TRACK_COLOR = withAlpha(colors.onPoints, 0.16);
const TOAST_WIDTH = layout.minTouchTarget * 2;

export interface FeaturedMissionCardProps {
  mission: Mission;
  /** Toque no card aberto (leva à ação da missão) ou bloqueado (anuncia quando abre). */
  onPress: (mission: Mission) => void;
  /** Muda quando a missão acabou de ser concluída diante do fã (o toque e o anúncio são da tela). */
  celebration?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Card lima da missão em destaque, no topo de "Hoje" (1g). É a missão do dia
 * da home, mas aqui o card inteiro é o alvo: sem botão dentro, com um rótulo
 * só ("Leve 5 pessoas para o clipe novo do Netto. 3 de 5. Vale 20 pontos, 2
 * por visita e 10 por cadastro.") e a dica de para onde leva. Concluído, fica
 * lima até o dia virar, com a barra cheia e o check no lugar do "+20", sem toque.
 */
export function FeaturedMissionCard({
  mission,
  onPress,
  celebration,
  style,
  testID,
}: FeaturedMissionCardProps) {
  const completed = mission.status === 'completed';
  const { target } = mission.progress;
  const done = completed ? target : Math.min(mission.progress.current, target);
  const label = missionLabel(mission);

  const content: ReactNode = (
    <>
      <Stripes preset="onPoints" alpha={STRIPES_ALPHA} />
      <View style={styles.top}>
        <MissionIcon mission={mission} onPoints />
        <View style={styles.texts}>
          <Text variant="buttonSmall" color={colors.onPoints}>
            {mission.title}
          </Text>
          <Text variant="labelSmall" color={META_COLOR} style={styles.meta}>
            {missionMeta(mission)}
          </Text>
        </View>
        <View style={styles.reward}>
          {completed ? (
            <CheckBadge tone="onPoints" celebration={celebration} />
          ) : (
            <Text variant="points" color={colors.onPoints}>
              {formatPointsDelta(mission.rewardPoints)}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.progressRow}>
        <ProgressBar
          value={target > 0 ? done / target : 0}
          track={TRACK_COLOR}
          fill={colors.onPoints}
          style={styles.bar}
        />
        <Text variant="chip" color={colors.onPoints}>
          {`${done}/${target}`}
        </Text>
      </View>
    </>
  );

  const card =
    mission.status === 'active' || mission.status === 'locked' ? (
      <PressableScale
        onPress={() => onPress(mission)}
        haptic={mission.status === 'locked' ? 'locked' : 'tap'}
        accessibilityLabel={label}
        accessibilityHint={missionHint(mission)}
        testID={testID}
        style={styles.card}
      >
        {content}
      </PressableScale>
    ) : (
      <View accessible accessibilityLabel={label} testID={testID} style={styles.card}>
        {content}
      </View>
    );

  // O "+N" da conclusão sobe da borda de cima do card, sobre o check, por fora
  // do recorte das listras. Mora sempre aqui, com a chave da missão: montado
  // junto com a festa, ele ignoraria o gatilho.
  return (
    <View style={style}>
      {card}
      <View pointerEvents="none" style={styles.toastAnchor}>
        <PointsToast
          key={mission.id}
          points={mission.rewardPoints}
          trigger={completed ? (celebration ?? null) : null}
          silent
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.points,
    borderRadius: radii.lg,
    padding: spacing.cardPadding,
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
  reward: {
    alignItems: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.listGap,
    marginTop: spacing.rowGap,
  },
  bar: {
    flex: 1,
  },
  // Faixa larga o bastante para a pílula não quebrar o número, centrada no check.
  toastAnchor: {
    position: 'absolute',
    top: 0,
    right: spacing.cardPadding - (TOAST_WIDTH - layout.checkBadge) / 2,
    width: TOAST_WIDTH,
  },
});
