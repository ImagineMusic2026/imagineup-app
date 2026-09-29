import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ListRow } from '@/components/list-row';
import { Pill } from '@/components/pill';
import { PointsToast } from '@/components/points-toast';
import { Text } from '@/components/text';
import { borderWidths, colors, layout, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatPointsDelta } from '@/utils/number';

import { missionHint, missionLabel, missionMeta } from '../describe-mission';
import type { Mission } from '../types';
import { CheckBadge } from './check-badge';
import { MissionIcon } from './mission-icon';

export interface MissionRowProps {
  mission: Mission;
  /** Toque na aberta (leva à ação da missão) e na bloqueada (anuncia quando abre). */
  onPress: (mission: Mission) => void;
  /**
   * Muda quando a missão acabou de ser concluída diante do fã: o check entra
   * crescendo e o "+N" sobe. O toque e o anúncio são da tela.
   */
  celebration?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Valor à direita: "+20" em lima tingido, o check da concluída ou o "+50" apagado da bloqueada. */
function Reward({ mission, celebration }: Pick<MissionRowProps, 'mission' | 'celebration'>) {
  const points = formatPointsDelta(mission.rewardPoints);
  switch (mission.status) {
    case 'completed':
      return <CheckBadge celebration={celebration} />;
    case 'locked':
      return (
        <Text variant="chip" color={colors.textMuted}>
          {points}
        </Text>
      );
    default:
      return <Pill label={points} tone="pointsTint" />;
  }
}

/**
 * Linha de missão da 1g nos quatro estados: disponível e em andamento (tocável,
 * leva à ação), concluída (sem toque) e bloqueada (o toque dá o haptic
 * `locked` e quem chama anuncia a dica). Um rótulo só para a linha inteira,
 * com os pontos.
 *
 * A bloqueada não usa a opacidade .5 do protótipo no todo, que levaria a meta
 * abaixo do texto mínimo: os textos ficam em `textMuted`, e só as superfícies
 * apagam (fundo do card e quadro do cadeado), o que ainda sobe o contraste.
 *
 * O "+N" da conclusão mora sempre ao lado da linha, com a chave da missão:
 * montado junto com a festa ele ignoraria o gatilho, e numa célula
 * reaproveitada por outra missão ele recomeça do zero.
 */
export function MissionRow({ mission, onPress, celebration, style, testID }: MissionRowProps) {
  const common = {
    title: mission.title,
    meta: missionMeta(mission),
    leading: <MissionIcon mission={mission} />,
    trailing: <Reward mission={mission} celebration={celebration} />,
    accessibilityLabel: missionLabel(mission),
    testID,
  };
  const pressable = mission.status === 'active' || mission.status === 'locked';

  return (
    <View style={style}>
      {pressable ? (
        <ListRow
          {...common}
          tone={mission.status === 'locked' ? 'locked' : 'default'}
          onPress={() => onPress(mission)}
          accessibilityHint={missionHint(mission)}
          style={mission.status === 'locked' ? styles.lockedCard : undefined}
        />
      ) : (
        <ListRow {...common} />
      )}
      {/* O "+N" sobe do check. Fica fora da linha, que remonta ao deixar de ser tocável. */}
      <View pointerEvents="none" style={styles.toastRail}>
        <View style={styles.toastAnchor}>
          <PointsToast
            key={mission.id}
            points={mission.rewardPoints}
            trigger={mission.status === 'completed' ? (celebration ?? null) : null}
            silent
          />
        </View>
      </View>
    </View>
  );
}

// A pílula "+N" precisa de largura para não quebrar o número; a faixa dela fica
// centrada no check, na altura dele.
const TOAST_WIDTH = layout.minTouchTarget * 2;

const styles = StyleSheet.create({
  // O card inteiro a .5 do protótipo, só no fundo: sobre o fundo da tela, o
  // mesmo tom (15, 15, 21) que ele desenha.
  lockedCard: {
    backgroundColor: withAlpha(colors.surface, 0.5),
  },
  // Coluna do valor à direita, da altura da linha, com o check no meio.
  toastRail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: spacing.cardPadding + borderWidths.default - (TOAST_WIDTH - layout.checkBadge) / 2,
    justifyContent: 'center',
  },
  toastAnchor: {
    width: TOAST_WIDTH,
    height: layout.checkBadge,
  },
});
