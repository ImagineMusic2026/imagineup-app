import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { pillMinHeight } from '@/components/pill';
import { PointsToast } from '@/components/points-toast';
// O `Expandable` pelo arquivo: o index do perfil puxa o Firebase e fecharia um ciclo (a 1e).
import { Expandable } from '@/domains/profile/components/expandable';
import { useIsOnline } from '@/hooks/use-is-online';
import { layout, spacing } from '@/theme';

import { useCheckin } from '../hooks/use-checkin';
import { useEnterFade } from '../hooks/use-enter-fade';
import { useCheckinMutation } from '../queries';
import type { CheckinState } from '../types';
import { CheckinCard } from './checkin-card';
import { CheckinDoneRow } from './checkin-done-row';

// A faixa do "+N": larga o bastante para a pílula não quebrar o número.
const TOAST_WIDTH = layout.minTouchTarget * 2;

export interface CheckinSectionProps {
  /** Vai na seção inteira (a margem até a saudação e até a missão do dia). */
  style?: StyleProp<ViewStyle>;
}

/**
 * O check-in diário pronto para a Início, entre o aviso da conta suspensa e a
 * missão do dia. Só aparece com a resposta do servidor e a chave ligada:
 * carregando, com a chave desligada, com a `api` de antes (o 404) ou com a
 * consulta falhando sem resposta, não mostra nada, sem esqueleto, sem erro,
 * sem anúncio e sem toque (a tela sobe). Com o dia virado, some até o estado
 * de hoje chegar. Quando chega, entra em fade por valor animado
 * (`useEnterFade`).
 */
export function CheckinSection({ style }: CheckinSectionProps) {
  const { state, now } = useCheckin();
  if (!state) return null;
  return <CheckinFaces state={state} now={now} style={style} />;
}

/**
 * As duas faces do check-in: o card aberto (o de hoje por fazer) e a linha do
 * "Check-in feito". A troca de uma para a outra, quando o servidor responde
 * ao toque, anda por altura e opacidade num valor animado, na hora com
 * reduzir movimento, sem `entering` nem `LinearTransition`. Cada face é um
 * `Expandable` do perfil (a peça da casa para o bloco que abre e fecha): o
 * conteúdo fica fora do fluxo do recorte, então a face fechada, com altura 0,
 * já tem a medida quando abre. Com o conteúdo no fluxo de um recorte de
 * altura 0, como na primeira versão daqui, a linha do "Check-in feito" não
 * abria no aparelho depois do toque (Android, Expo Go). A linha fica sempre
 * montada; o card, desde a primeira vez que aparece. No Android, cada face
 * apaga composta fora da tela: sem isso, o fundo do card, a borda e o botão
 * apagariam cada um sozinho no meio da troca.
 *
 * O "+N" sobe do canto de cima, à direita, onde a linha do "Check-in feito"
 * fica vazia, e mora sempre aqui, fora dos recortes das faces: dentro do
 * card, sairia cortado quando ele encolhe, e montado junto com o ganho,
 * ignoraria o gatilho.
 */
function CheckinFaces({
  state,
  now,
  style,
}: {
  state: CheckinState;
  now: Date;
  style?: StyleProp<ViewStyle>;
}) {
  const fade = useEnterFade();
  const online = useIsOnline();
  const { checkin, award, isPending, failure } = useCheckinMutation();
  const done = state.checkedInToday;
  // O card só monta quando o de hoje está por fazer; depois, fica para a troca animada.
  const [opened, setOpened] = useState(!done);
  if (!done && !opened) setOpened(true);

  return (
    <Animated.View testID="checkin-section" style={[style, fade]}>
      <Expandable open={!done} needsOffscreenAlphaCompositing testID="checkin-open">
        {opened ? (
          <CheckinCard
            state={state}
            now={now}
            online={online}
            pending={isPending}
            failure={failure}
            onCheckin={checkin}
          />
        ) : null}
      </Expandable>
      <Expandable open={done} needsOffscreenAlphaCompositing testID="checkin-closed">
        <CheckinDoneRow state={state} />
      </Expandable>
      <View pointerEvents="none" style={styles.toastAnchor}>
        <PointsToast
          points={award?.points ?? 0}
          trigger={award?.id ?? null}
          announcement={award?.announcement}
          haptic={award?.haptic}
          testID="checkin-points"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A pílula nasce inteira dentro da seção, a 8 da borda de cima, e sobe dali.
  toastAnchor: {
    position: 'absolute',
    top: pillMinHeight.sm + spacing.sm,
    right: spacing.gutter,
    width: TOAST_WIDTH,
  },
});
