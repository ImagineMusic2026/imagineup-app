import { Check } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PointsToast } from '@/components/points-toast';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { borderWidths, colors, layout, motion, radii, spacing, tints, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { useIsGoing, useRsvpMutation } from '../queries';

export interface RsvpChipProps {
  eventId: string;
  /** Nome do show, para o leitor de tela saber a que o "Eu vou" se refere. */
  eventTitle: string;
  /** Vai no alvo de toque (margem, `alignSelf`), não na pílula. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// "Eu vou": superfície com borda ciano, como a pílula de shows (`Pill` events).
// Confirmado: ciano tingido com check (proposta padrão da 1m, 8,42:1).
const REST = { background: colors.surfaceRaised, border: colors.events };
const GOING = {
  background: withAlpha(colors.events, tints.soft.fill),
  border: withAlpha(colors.events, tints.soft.border),
};
const TIMING = { duration: motion.duration.base, easing: motion.easing.out };
const CHECK_SIZE = 12;
const CHECK_STROKE = 2.6;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

interface LabelWidths {
  rest: number;
  going: number;
}

/** Largura de um rótulo medida fora da pílula, sem nada apertando o texto. */
function widthOf(event: LayoutChangeEvent): number {
  return Math.ceil(event.nativeEvent.layout.width);
}

function RestLabel() {
  return (
    <Text variant="chipSmall" color={colors.events}>
      {t('agenda.rsvp.go')}
    </Text>
  );
}

function GoingLabel() {
  return (
    <>
      <Icon icon={Check} size={CHECK_SIZE} color={colors.events} strokeWidth={CHECK_STROKE} />
      <Text variant="chipSmall" color={colors.events}>
        {t('agenda.rsvp.going')}
      </Text>
    </>
  );
}

/**
 * "Eu vou" do post de show da home (1b): a presença é a mesma da agenda (1m).
 * Tocar confirma ou desfaz na hora (otimista); a cor anda para o ciano
 * tingido em HSV, a pílula acompanha a largura de "Confirmado" e os rótulos
 * trocam em fade, recortados por ela, tudo no mesmo tempo e pelo mesmo valor
 * animado. A primeira presença rende pontos, e a pílula lima "+N" sobe do
 * chip. Com reduzir movimento, troca na hora.
 *
 * Os dois rótulos ficam sempre montados, um sobre o outro, e a largura da
 * pílula sai das larguras deles, medidas fora dela. Montar o rótulo novo
 * (entrada e saída do Reanimated) ou animar o layout (`LinearTransition`)
 * fazia a pílula dar um tranco no primeiro quadro, para o lado contrário.
 *
 * Na lista, a FlashList reaproveita a célula de um post para outro: quando o
 * show muda, cor, largura e rótulo vão direto para o estado dele, sem animar.
 * A presença que chega do servidor na primeira carga também não anima: só o
 * toque anima.
 */
export function RsvpChip({ eventId, eventTitle, style, testID }: RsvpChipProps) {
  const known = useIsGoing(eventId);
  const going = known ?? false;
  const rsvp = useRsvpMutation(eventId);
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(going ? 1 : 0);
  const shown = useRef({ eventId, loaded: known !== undefined });
  const [restWidth, setRestWidth] = useState<number | null>(null);
  const [goingWidth, setGoingWidth] = useState<number | null>(null);
  const widths: LabelWidths | null =
    restWidth !== null && goingWidth !== null ? { rest: restWidth, going: goingWidth } : null;

  useEffect(() => {
    const target = going ? 1 : 0;
    // Show trocado (célula reaproveitada) ou presença que acabou de carregar: sem animar.
    const jump = reducedMotion || shown.current.eventId !== eventId || !shown.current.loaded;
    shown.current = { eventId, loaded: known !== undefined };
    progress.set(jump ? target : withTiming(target, TIMING));
  }, [going, known, eventId, reducedMotion, progress]);

  const restLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const goingLabelStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.get(),
      [0, 1],
      [REST.background, GOING.background],
      'HSV',
    ),
    borderColor: interpolateColor(progress.get(), [0, 1], [REST.border, GOING.border], 'HSV'),
    // Antes de medir, a pílula fica com a largura do rótulo do estado atual.
    ...(widths && {
      width: PILL_CHROME + interpolate(progress.get(), [0, 1], [widths.rest, widths.going]),
    }),
  }));

  const status = t(going ? 'agenda.rsvp.going' : 'agenda.rsvp.go');
  const awarded = rsvp.data?.eventId === eventId ? rsvp.data.pointsAwarded : 0;
  // Com a largura medida, cada rótulo fica com a dele: a pílula mais estreita
  // recorta o texto em vez de quebrá-lo em duas linhas no meio da troca.
  const restFixed = widths && { width: widths.rest };
  const goingFixed = widths && { width: widths.going };

  return (
    <View style={[styles.anchor, style]}>
      <PressableScale
        onPress={() => rsvp.setGoing(!going)}
        haptic={going ? 'tap' : 'confirm'}
        accessibilityLabel={t('agenda.rsvp.label', { status, show: eventTitle })}
        accessibilityHint={going ? t('agenda.rsvp.cancelHint') : undefined}
        accessibilityState={{ selected: going }}
        testID={testID}
        style={styles.target}
      >
        <Animated.View style={[styles.pill, surfaceStyle]}>
          {/* O rótulo do estado atual dá a altura; o outro fica por cima, sumindo. */}
          <Animated.View
            style={[styles.content, restFixed, going && styles.overlay, restLabelStyle]}
          >
            <RestLabel />
          </Animated.View>
          <Animated.View
            style={[styles.content, goingFixed, !going && styles.overlay, goingLabelStyle]}
          >
            <GoingLabel />
          </Animated.View>
        </Animated.View>
      </PressableScale>
      {/* Réguas invisíveis: a largura natural de cada rótulo, com a fonte do aparelho. */}
      <View pointerEvents="none" {...hiddenFromReader} style={styles.rulers}>
        <View style={styles.content} onLayout={(event) => setRestWidth(widthOf(event))}>
          <RestLabel />
        </View>
        <View style={styles.content} onLayout={(event) => setGoingWidth(widthOf(event))}>
          <GoingLabel />
        </View>
      </View>
      <PointsToast
        points={awarded}
        trigger={rsvp.isSuccess ? rsvp.submittedAt : null}
        style={styles.toast}
      />
    </View>
  );
}

// Medidas da `Pill` `sm` (6 x 11 no protótipo, com a borda de 1).
const PILL_MIN_HEIGHT = typography.chipSmall.lineHeight + spacing.xs * 2 + borderWidths.default * 2;
// O que a pílula soma ao rótulo na largura: padding e borda dos dois lados.
const PILL_CHROME = spacing.gridGap * 2 + borderWidths.default * 2;
// A pílula fica no meio do alvo de 44: o "+N" nasce no topo dela, não no do alvo.
const TOAST_BOTTOM = layout.minTouchTarget - (layout.minTouchTarget - PILL_MIN_HEIGHT) / 2;
// Largura livre das réguas: nenhum rótulo chega perto disso, nem com a fonte grande.
const RULER_WIDTH = 1000;

const styles = StyleSheet.create({
  anchor: {
    alignItems: 'flex-start',
  },
  target: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    minHeight: PILL_MIN_HEIGHT,
    justifyContent: 'center',
    // Os rótulos ficam com a própria largura, sem esticar com a pílula.
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.gridGap,
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    // Recorta o rótulo novo enquanto a pílula ainda cresce até a largura dele.
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Sobre o rótulo do estado atual, preso à esquerda do padding da pílula.
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: spacing.gridGap,
  },
  rulers: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RULER_WIDTH,
    alignItems: 'flex-start',
    opacity: 0,
  },
  toast: {
    bottom: TOAST_BOTTOM,
  },
});
