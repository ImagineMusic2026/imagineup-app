import { CalendarCheck, CalendarDays } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { borderWidths, colors, layout, motion } from '@/theme';

import { headerButtonLabel } from '../describe-checkin';
import type { CheckinPanel } from '../hooks/use-checkin-panel';
import { useEnterFade } from '../hooks/use-enter-fade';
import type { CheckinState } from '../types';

// O círculo de 40 no alvo de 44, na medida do avatar ao lado.
const CIRCLE = layout.avatar.xl.size;
const ICON_SIZE = 20;
const ICON_STROKE = 2;
// A bolinha de 10 no canto de cima do círculo, com o contorno da cor do fundo
// para descolar dele.
const DOT = 10;
const DOT_RING = 2;
const DOT_INSET = (layout.minTouchTarget - CIRCLE) / 2;
// O halo rosa nasce do tamanho do círculo, cresce até 1,5 vez e some; de novo
// a cada 1,6 s, enquanto o de hoje está por fazer e o card está fechado.
const HALO_SCALE = 1.5;
const HALO_OPACITY = 0.35;
const PULSE_DURATION = 1600;

/**
 * O pulso do halo, por valor animado: de 0 (o halo do tamanho do círculo) a 1
 * (crescido e apagado), em laço. Parado, fica em 1, apagado. Com reduzir
 * movimento, não pulsa: a bolinha sozinha diz que o de hoje está por fazer.
 */
function useHaloPulse(active: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(1);
  const pulsing = active && !reducedMotion;

  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(progress);
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(withTiming(1, { duration: PULSE_DURATION, easing: motion.easing.out }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [pulsing, progress]);

  return useAnimatedStyle(() => ({
    opacity: (1 - progress.get()) * HALO_OPACITY,
    transform: [{ scale: 1 + progress.get() * (HALO_SCALE - 1) }],
  }));
}

export interface CheckinHeaderButtonProps {
  panel: CheckinPanel;
  /**
   * A tela à vista (o `useIsFocused` da Início). Fora dela (outra aba, uma
   * tela por cima), o halo não pulsa: o laço gastaria bateria à toa.
   */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * O ícone do check-in no topo da Início, ao lado do avatar (desenho do dono
 * de 25/11/2026): com o de hoje por fazer, o calendário com a bolinha rosa e
 * o halo pulsando; feito, o calendário com o check, em lima, sem bolinha. O
 * toque abre e fecha o card embaixo da saudação. Só aparece com a resposta do
 * servidor e a chave ligada, e entra em fade.
 */
export function CheckinHeaderButton({ panel, active = true, style }: CheckinHeaderButtonProps) {
  if (!panel.state) return null;
  return (
    <HeaderButton
      state={panel.state}
      open={panel.open}
      active={active}
      onPress={panel.toggle}
      style={style}
    />
  );
}

/**
 * Um botão só para o leitor de tela, com o estado no rótulo ("Check-in de
 * hoje por fazer, vale 5 pontos") e o `expanded` do card. A bolinha e o halo
 * são desenho, dentro do pressável, sem foco nem papel.
 */
function HeaderButton({
  state,
  open,
  active,
  onPress,
  style,
}: {
  state: CheckinState;
  open: boolean;
  active: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const fade = useEnterFade();
  const pending = !state.checkedInToday;
  const halo = useHaloPulse(pending && !open && active);

  return (
    <Animated.View testID="checkin-header" style={[fade, style]}>
      <PressableScale
        onPress={onPress}
        haptic="selection"
        accessibilityLabel={headerButtonLabel(state)}
        accessibilityHint={t(open ? 'checkin.header.closeHint' : 'checkin.header.openHint')}
        accessibilityState={{ expanded: open }}
        testID="checkin-header-button"
        style={styles.target}
      >
        <Animated.View
          pointerEvents="none"
          testID="checkin-header-halo"
          style={[styles.halo, halo]}
        />
        <View style={[styles.circle, open && styles.circleOpen]}>
          <Icon
            icon={pending ? CalendarDays : CalendarCheck}
            size={ICON_SIZE}
            strokeWidth={ICON_STROKE}
            color={pending ? colors.text : colors.points}
          />
        </View>
        {pending ? (
          <View pointerEvents="none" testID="checkin-header-dot" style={styles.dot} />
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: colors.accent,
  },
  // O vidro escuro dos cards da Início, com a borda deles.
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: CIRCLE / 2,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Aberto, a borda acende, como o campo em foco.
  circleOpen: {
    borderColor: colors.borderOutline,
    backgroundColor: colors.surfaceRaised,
  },
  dot: {
    position: 'absolute',
    top: DOT_INSET,
    right: DOT_INSET,
    width: DOT + DOT_RING * 2,
    height: DOT + DOT_RING * 2,
    borderRadius: (DOT + DOT_RING * 2) / 2,
    borderWidth: DOT_RING,
    borderColor: colors.background,
    backgroundColor: colors.accent,
  },
});
