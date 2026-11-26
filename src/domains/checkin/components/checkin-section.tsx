import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { pillMinHeight } from '@/components/pill';
import { PointsToast } from '@/components/points-toast';
// O `RevealExpandable` pelo arquivo: o index do perfil puxa o Firebase e fecharia um ciclo (a 1e).
import { RevealExpandable } from '@/domains/profile/components/expandable';
import { useIsOnline } from '@/hooks/use-is-online';
import { useScreenReaderEnabled } from '@/hooks/use-screen-reader-enabled';
import { layout, spacing } from '@/theme';

import type { CheckinPanel } from '../hooks/use-checkin-panel';
import { useCheckinMutation } from '../queries';
import type { CheckinState } from '../types';
import { CheckinCard } from './checkin-card';

// A faixa do "+N": larga o bastante para a pílula não quebrar o número.
const TOAST_WIDTH = layout.minTouchTarget * 2;
// Depois do check-in, o card fica aberto o bastante para o "+N" subir (0,7 s)
// e o dia marcado aparecer na trilha, e fecha sozinho.
export const CLOSE_AFTER_CHECKIN_MS = 1500;
// O espaço até a saudação e até a missão do dia, dentro do recorte: fechado,
// o card não ocupa nada. Os 4 de baixo somam aos 6 de cima da missão: 10
// entre os dois cards.
const GAP_TOP = spacing.metaGap;
const GAP_BOTTOM = spacing.xs;

export interface CheckinSectionProps {
  panel: CheckinPanel;
  /** Vai no conteúdo do card, dentro do recorte, depois do espaço de cima e de baixo. */
  style?: StyleProp<ViewStyle>;
}

/**
 * O card do check-in diário da Início, embaixo da saudação, que o ícone do
 * calendário abre e fecha (`useCheckinPanel`, desenho do dono de 25/11/2026).
 * Nasce fechado e só existe com a resposta do servidor e a chave ligada:
 * carregando, com a chave desligada, com a `api` de antes (o 404) ou com a
 * consulta falhando sem resposta, não mostra nada, sem esqueleto, sem erro,
 * sem anúncio e sem toque. Fechado, tem altura 0: a Início não pula quando o
 * estado chega.
 */
export function CheckinSection({ panel, style }: CheckinSectionProps) {
  if (!panel.state) return null;
  return (
    <CheckinPanelView
      state={panel.state}
      now={panel.now}
      open={panel.open}
      onClose={panel.close}
      style={style}
    />
  );
}

/**
 * Fecha o card passado o `CLOSE_AFTER_CHECKIN_MS` depois de cada check-in que
 * deu certo com ele aberto (o `completed` da mutação), e só dele: o estado
 * "feito" que chega por uma busca (o check-in feito noutro aparelho) troca o
 * botão pelo pé do "feito" e deixa o card aberto. Nada fecha se o fã fechar
 * antes, se o dia virar e o de hoje voltar a estar por fazer (a resposta de um
 * toque perto da meia-noite), ou com o leitor de tela ligado: lá, o card fica
 * aberto para o anúncio do check-in não ser cortado, e o fã fecha pelo ícone.
 */
function useCloseAfterCheckin(
  completed: number,
  day: string,
  open: boolean,
  onClose: () => void,
): void {
  const screenReader = useScreenReaderEnabled();
  const [seen, setSeen] = useState(completed);
  // O dia (o `resetsAt`) em que o check-in pediu para fechar, ou null. O dia, e
  // não o "feito": a resposta do toque e o estado no cache podem chegar à tela
  // em renders diferentes, e a do toque perto da meia-noite pode nem aparecer.
  const [closingDay, setClosingDay] = useState<string | null>(null);
  if (completed !== seen) {
    setSeen(completed);
    setClosingDay(open && !screenReader ? day : null);
  }
  if (closingDay !== null && (!open || screenReader || day !== closingDay)) setClosingDay(null);
  const closing = closingDay !== null;

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      setClosingDay(null);
      onClose();
    }, CLOSE_AFTER_CHECKIN_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);
}

/**
 * O card abre e fecha como gaveta, o `RevealExpandable` do perfil (os tempos
 * de `motion.reveal`, com o conteúdo fora do fluxo do recorte), na hora com
 * reduzir movimento, sem `entering` nem `LinearTransition`. Ele monta fechado,
 * com altura 0, fora do toque e do leitor, assim que o estado chega: medido
 * antes do primeiro toque, abre todas as vezes pelo mesmo caminho. Montado só
 * na primeira abertura, ele começava o caminho com a altura 0 e pulava para
 * quase aberto quando a medida chegava (o "abre na hora" do dono, 25/11/2026).
 * No Android, apaga composto fora da tela: sem isso, o fundo do card, a borda
 * e o botão apagariam cada um sozinho.
 *
 * O "+N" sobe do canto de cima, à direita, e mora sempre aqui, fora do
 * recorte: dentro do card, sairia cortado quando ele fecha, e montado junto
 * com o ganho, ignoraria o gatilho. A seção fica por cima da missão do dia,
 * para o "+N" de um check-in cuja resposta chega com o card já fechado não
 * sumir embaixo dela.
 */
function CheckinPanelView({
  state,
  now,
  open,
  onClose,
  style,
}: {
  state: CheckinState;
  now: Date;
  open: boolean;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const online = useIsOnline();
  const { checkin, award, completed, isPending, failure } = useCheckinMutation();
  useCloseAfterCheckin(completed, state.resetsAt, open, onClose);

  return (
    <View testID="checkin-section" style={styles.section}>
      <RevealExpandable
        open={open}
        needsOffscreenAlphaCompositing
        style={[styles.content, style]}
        testID="checkin-panel"
      >
        <CheckinCard
          state={state}
          now={now}
          online={online}
          pending={isPending}
          failure={failure}
          onCheckin={checkin}
        />
      </RevealExpandable>
      <View pointerEvents="none" style={styles.toastAnchor}>
        <PointsToast
          points={award?.points ?? 0}
          trigger={award?.id ?? null}
          announcement={award?.announcement}
          haptic={award?.haptic}
          testID="checkin-points"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    zIndex: 1,
  },
  content: {
    paddingTop: GAP_TOP,
    paddingBottom: GAP_BOTTOM,
  },
  // A pílula nasce inteira dentro do card, a 8 da borda de cima dele, e sobe dali.
  toastAnchor: {
    position: 'absolute',
    top: GAP_TOP + pillMinHeight.sm + spacing.sm,
    right: spacing.gutter,
    width: TOAST_WIDTH,
  },
});
