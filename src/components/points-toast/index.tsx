import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Pill } from '@/components/pill';
import { useHaptics } from '@/hooks/use-haptics';
import type { HapticEvent } from '@/services/haptics';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { motion, spacing } from '@/theme';
import { formatNumber, formatPointsDelta } from '@/utils/number';

export type PointsToastTrigger = string | number;

export interface PointsToastProps {
  /** Pontos ganhos (`pointsAwarded` da resposta da API). Zero ou menos não mostra nada. */
  points: number;
  /**
   * Chave que muda a cada ganho (id da resposta, contador). O toast sai quando
   * ela muda; o valor da montagem não conta, para voltar à tela não repetir.
   */
  trigger: PointsToastTrigger | null;
  /**
   * Frase única para o leitor de tela quando o ganho vem junto de outra
   * mensagem ("Comentário enviado. Mais 2 pontos"). Padrão: só os pontos.
   */
  announcement?: string;
  /**
   * Só a pílula, sem toque e sem anúncio: quem chama já avisou o fã. A 1g toca
   * e anuncia as missões concluídas na própria tela, porque a célula da lista
   * pode nem estar montada.
   */
  silent?: boolean;
  /**
   * O toque do ganho (bloco 7): `levelUp` com subida de nível, `missionComplete`
   * com missão concluída, e o padrão, `pointsEarned` (`describeRewards`).
   */
  haptic?: HapticEvent;
  /** Por padrão nasce centralizado na borda de cima do pai. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Toast {
  /** Conta os ganhos desta pílula: a mesma chave pode voltar depois de outra. */
  id: number;
  points: number;
  /** `null`: sem toque e sem anúncio. */
  announcement: string | null;
  haptic: HapticEvent;
}

// Sobe 12 e some no tempo do contador: aparece rápido, fica e apaga.
const RISE = spacing.md;
const FADE_IN = motion.duration.fast;
const FADE_OUT = motion.duration.base;
const HOLD = motion.duration.counter - FADE_IN - FADE_OUT;

/** "Mais 20 pontos", para quem junta o ganho a outra mensagem no `announcement`. */
export function pointsToastAnnouncement(points: number): string {
  if (points === 1) return t('components.pointsToast.announcementOne');
  return t('components.pointsToast.announcement', { points: formatNumber(points) });
}

/**
 * Pílula lima "+N" que sobe de onde o ponto nasceu e some (entrar na central,
 * comentar, "Eu vou", missão). Cada ganho dá um toque `pointsEarned` e um
 * anúncio só; a pílula fica fora do leitor de tela, que já ouviu o anúncio, e
 * não recebe toque. Com reduzir movimento, aparece parada pelo mesmo tempo.
 */
export function PointsToast({
  points,
  trigger,
  announcement,
  silent = false,
  haptic = 'pointsEarned',
  style,
  testID,
}: PointsToastProps) {
  const reducedMotion = usePrefersReducedMotion();
  const playHaptic = useHaptics();
  const [seenTrigger, setSeenTrigger] = useState(trigger);
  const [toast, setToast] = useState<Toast | null>(null);
  const [gains, setGains] = useState(0);
  const announced = useRef(0);
  const opacity = useSharedValue(0);
  const lift = useSharedValue(0);

  // A troca da chave vira toast no próprio render (o jeito do React de reagir
  // a uma prop que mudou), com os pontos e a frase daquele ganho.
  if (trigger !== seenTrigger) {
    setSeenTrigger(trigger);
    if (trigger !== null && points > 0) {
      setGains(gains + 1);
      setToast({
        id: gains + 1,
        points,
        announcement: silent ? null : (announcement ?? pointsToastAnnouncement(points)),
        haptic,
      });
    }
  }

  // Separado da animação: se o efeito rodar de novo, o fã não ouve duas vezes.
  useEffect(() => {
    if (!toast || toast.announcement === null || announced.current === toast.id) return;
    announced.current = toast.id;
    playHaptic(toast.haptic);
    // Na fila, no iOS: os pontos chegam com a resposta, logo depois do anúncio
    // da ação ("Presença confirmada"), e o anúncio simples cortaria o anterior.
    AccessibilityInfo.announceForAccessibilityWithOptions(toast.announcement, { queue: true });
  }, [toast, playHaptic]);

  useEffect(() => {
    if (!toast) return;
    const { id } = toast;
    // Cada ganho começa do chão, inclusive o que chega com a pílula anterior no ar.
    lift.set(0);
    if (reducedMotion) {
      opacity.set(1);
    } else {
      opacity.set(0);
      opacity.set(
        withSequence(
          withTiming(1, { duration: FADE_IN, easing: motion.easing.out }),
          withDelay(HOLD, withTiming(0, { duration: FADE_OUT, easing: motion.easing.inOut })),
        ),
      );
      lift.set(withTiming(-RISE, { duration: motion.duration.counter, easing: motion.easing.out }));
    }
    // O relógio do JS desmonta a pílula; um ganho novo no meio dela continua.
    const timer = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, motion.duration.counter);
    return () => {
      clearTimeout(timer);
      cancelAnimation(opacity);
      cancelAnimation(lift);
    };
  }, [toast, reducedMotion, opacity, lift]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: lift.get() }],
  }));

  if (!toast) return null;

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.toast, style, animatedStyle]}
    >
      <Pill label={formatPointsDelta(toast.points)} tone="points" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Faixa da largura do pai, com a pílula no meio: vale para pai em linha ou em coluna.
  toast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    alignItems: 'center',
  },
});
