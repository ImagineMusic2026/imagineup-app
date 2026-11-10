import { Flame } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { colors } from '@/theme';

import { streakPillLabel, streakText } from '../describe-checkin';
import { useCheckin } from '../hooks/use-checkin';
import { useEnterFade } from '../hooks/use-enter-fade';

// A chama na altura do texto da pílula.
const FLAME_SIZE = 12;
const FLAME_STROKE = 2.2;

export interface CheckinStreakPillProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * A sequência do check-in na 1e, embaixo do nível: a pílula "4 dias seguidos"
 * com a chama em lima, com o rótulo próprio ("Sequência de check-in: 4 dias
 * seguidos"). Lê a mesma consulta do card da Início (`GET /me/checkin`), e só
 * aparece com a resposta do servidor, a chave ligada e a sequência valendo:
 * carregando, com a chave desligada, com a consulta falhando ou sem
 * sequência, nada aparece e nada é anunciado. Neutra, com o lima só na chama:
 * a sequência não é ponto.
 */
export function CheckinStreakPill({ style }: CheckinStreakPillProps) {
  const { state } = useCheckin();
  if (!state || state.streak <= 0) return null;
  return <StreakPill streak={state.streak} style={style} />;
}

/** A pílula, que entra em fade por valor animado quando o estado chega (`useEnterFade`). */
function StreakPill({ streak, style }: { streak: number; style?: StyleProp<ViewStyle> }) {
  const fade = useEnterFade();

  return (
    <Animated.View style={[styles.pill, style, fade]}>
      <Pill
        label={streakText(streak)}
        tone="neutral"
        leading={
          <Icon icon={Flame} size={FLAME_SIZE} color={colors.points} strokeWidth={FLAME_STROKE} />
        }
        accessibilityLabel={streakPillLabel(streak)}
        testID="checkin-streak"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A pílula fica do tamanho do texto, no começo da linha, como o selo do nível.
  pill: {
    alignSelf: 'flex-start',
  },
});
