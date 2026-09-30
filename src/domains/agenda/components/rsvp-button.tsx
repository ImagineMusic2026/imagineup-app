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
import { MAX_FONT_SCALE, maxFontScaleOf, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import {
  borderWidths,
  colors,
  layout,
  motion,
  radii,
  spacing,
  tints,
  typography,
  type TypographyVariant,
} from '@/theme';
import { withAlpha } from '@/utils/color';

import { useIsGoing, useRsvpMutation } from '../queries';

/**
 * Onde o "Eu vou" aparece:
 * - `chip`: pílula do post de show da home (1b), com borda ciano;
 * - `hero`: botão pequeno rosa do show em destaque da agenda (1m), sem brilho;
 * - `row`: botão contornado das linhas da agenda (1m).
 *
 * Confirmado, os três ficam no ciano tingido com check (proposta padrão da
 * 1m, 8,42:1): ciano é a cor de shows.
 */
export type RsvpLook = 'chip' | 'hero' | 'row';

export interface RsvpButtonProps {
  eventId: string;
  /** Nome do show, para o leitor de tela saber a que o "Eu vou" se refere. */
  eventTitle: string;
  look: RsvpLook;
  /** Vai no alvo de toque (margem, `alignSelf`), não no desenho. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export type RsvpChipProps = Omit<RsvpButtonProps, 'look'>;

interface Tone {
  background: string;
  border: string;
  label: string;
}

interface LookStyle {
  rest: Tone;
  labelVariant: TypographyVariant;
  /** Até quanto o rótulo cresce com a fonte do sistema. */
  maxFontScale: number;
  /** Altura desenhada; o alvo de toque tem 44 em volta dela. */
  minHeight: number;
  paddingHorizontal: number;
  radius: number;
  checkSize: number;
  checkStroke: number;
  /**
   * Como a cor anda de um estado ao outro. Entre rosa e escuro, em HSV (regra
   * do app). Do contorno branco ao ciano, em RGB: o branco não tem matiz, e
   * em HSV a borda passaria por outras cores no caminho.
   */
  colorSpace: 'HSV' | 'RGB';
}

const GOING: Tone = {
  background: withAlpha(colors.events, tints.soft.fill),
  border: withAlpha(colors.events, tints.soft.border),
  label: colors.events,
};

// Medidas da `Pill` `sm` (6 x 11 no protótipo, com a borda de 1).
const CHIP_MIN_HEIGHT = typography.chipSmall.lineHeight + spacing.xs * 2 + borderWidths.default * 2;

const LOOKS: Record<RsvpLook, LookStyle> = {
  chip: {
    // Superfície com borda ciano, como a pílula de shows (`Pill` events).
    rest: { background: colors.surfaceRaised, border: colors.events, label: colors.events },
    labelVariant: 'chipSmall',
    maxFontScale: maxFontScaleOf('chipSmall'),
    minHeight: CHIP_MIN_HEIGHT,
    paddingHorizontal: spacing.gridGap,
    radius: radii.pill,
    checkSize: 12,
    checkStroke: 2.6,
    colorSpace: 'HSV',
  },
  hero: {
    // O `Button` primário `sm`, com 14 dos lados (9 x 14 no protótipo):
    // accentStrong (branco sobre o rosa do protótipo reprova).
    rest: { background: colors.accentStrong, border: colors.accentStrong, label: colors.onAccent },
    labelVariant: 'chip',
    maxFontScale: MAX_FONT_SCALE,
    minHeight: layout.buttonHeight.sm,
    paddingHorizontal: spacing.cardPadding,
    radius: radii.xs,
    checkSize: 14,
    checkStroke: 2.2,
    colorSpace: 'HSV',
  },
  row: {
    // O `Button` `outline` `xs`. O fundo é o ciano a 0, para o tingido nascer dele.
    rest: {
      background: withAlpha(colors.events, 0),
      border: colors.borderOutline,
      label: colors.text,
    },
    labelVariant: 'buttonXs',
    maxFontScale: MAX_FONT_SCALE,
    minHeight: layout.buttonHeight.xs,
    paddingHorizontal: spacing.md,
    radius: radii.xxs,
    checkSize: 14,
    checkStroke: 2.2,
    colorSpace: 'RGB',
  },
};

const TIMING = { duration: motion.duration.base, easing: motion.easing.out };
// Nenhum rótulo chega perto disso, nem com a fonte grande.
const RULER_WIDTH = 1000;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/** Largura de um rótulo medida fora do botão, sem nada apertando o texto. */
function widthOf(event: LayoutChangeEvent): number {
  return Math.ceil(event.nativeEvent.layout.width);
}

function RestLabel({ look }: { look: LookStyle }) {
  return (
    <Text
      variant={look.labelVariant}
      color={look.rest.label}
      maxFontSizeMultiplier={look.maxFontScale}
    >
      {t('agenda.rsvp.go')}
    </Text>
  );
}

function GoingLabel({ look }: { look: LookStyle }) {
  return (
    <>
      <Icon icon={Check} size={look.checkSize} color={GOING.label} strokeWidth={look.checkStroke} />
      <Text
        variant={look.labelVariant}
        color={GOING.label}
        maxFontSizeMultiplier={look.maxFontScale}
      >
        {t('agenda.rsvp.going')}
      </Text>
    </>
  );
}

/**
 * "Eu vou" de um show. A presença é uma só para o post de show da home (1b)
 * e para a agenda (1m): todos leem `useIsGoing` e mudam por
 * `useRsvpMutation`, e o mesmo show nunca aparece confirmado num lugar e não
 * no outro.
 *
 * Tocar confirma ou desfaz na hora (otimista); a cor anda para o ciano
 * tingido, o botão acompanha a largura de "Confirmado" e os rótulos trocam em
 * fade, recortados por ele, tudo no mesmo tempo e pelo mesmo valor animado. A
 * primeira presença rende pontos, e a pílula lima "+N" sobe do botão. Com
 * reduzir movimento, troca na hora.
 *
 * Os dois rótulos ficam sempre montados, um sobre o outro, e a largura sai
 * das larguras deles, medidas fora do botão. Montar o rótulo novo (entrada e
 * saída do Reanimated) ou animar o layout (`LinearTransition`) fazia o botão
 * dar um tranco no primeiro quadro, para o lado contrário.
 *
 * Na lista, a FlashList reaproveita a célula de um show para outro: quando o
 * show muda, cor, largura e rótulo vão direto para o estado dele, sem animar.
 * A presença que chega do servidor na primeira carga também não anima: só o
 * toque anima.
 */
export function RsvpButton({
  eventId,
  eventTitle,
  look: lookName,
  style,
  testID,
}: RsvpButtonProps) {
  const look = LOOKS[lookName];
  const known = useIsGoing(eventId);
  const going = known ?? false;
  const rsvp = useRsvpMutation(eventId);
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(going ? 1 : 0);
  const shown = useRef({ eventId, loaded: known !== undefined });
  const [restWidth, setRestWidth] = useState<number | null>(null);
  const [goingWidth, setGoingWidth] = useState<number | null>(null);
  const widths =
    restWidth !== null && goingWidth !== null ? { rest: restWidth, going: goingWidth } : null;

  useEffect(() => {
    const target = going ? 1 : 0;
    // Show trocado (célula reaproveitada) ou presença que acabou de carregar: sem animar.
    const jump = reducedMotion || shown.current.eventId !== eventId || !shown.current.loaded;
    shown.current = { eventId, loaded: known !== undefined };
    progress.set(jump ? target : withTiming(target, TIMING));
  }, [going, known, eventId, reducedMotion, progress]);

  const chrome = look.paddingHorizontal * 2 + borderWidths.default * 2;
  const { rest, colorSpace } = look;
  const restLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const goingLabelStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.get(),
      [0, 1],
      [rest.background, GOING.background],
      colorSpace,
    ),
    borderColor: interpolateColor(progress.get(), [0, 1], [rest.border, GOING.border], colorSpace),
    // Antes de medir, o botão fica com a largura do rótulo do estado atual.
    ...(widths && {
      width: chrome + interpolate(progress.get(), [0, 1], [widths.rest, widths.going]),
    }),
  }));

  const status = t(going ? 'agenda.rsvp.going' : 'agenda.rsvp.go');
  const awarded = rsvp.data?.eventId === eventId ? rsvp.data.pointsAwarded : 0;
  // Com a largura medida, cada rótulo fica com a dele: o botão mais estreito
  // recorta o texto em vez de quebrá-lo em duas linhas no meio da troca.
  const restFixed = widths && { width: widths.rest };
  const goingFixed = widths && { width: widths.going };
  const frame = {
    minHeight: look.minHeight,
    paddingHorizontal: look.paddingHorizontal,
    borderRadius: look.radius,
  };
  const overlay = [styles.overlay, { left: look.paddingHorizontal }];
  // O botão fica no meio do alvo de 44: o "+N" nasce no topo dele, não no do alvo.
  const toastBottom = layout.minTouchTarget - (layout.minTouchTarget - look.minHeight) / 2;

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
        <Animated.View style={[styles.surface, frame, surfaceStyle]}>
          {/* O rótulo do estado atual dá a altura; o outro fica por cima, sumindo. */}
          <Animated.View style={[styles.content, restFixed, going && overlay, restLabelStyle]}>
            <RestLabel look={look} />
          </Animated.View>
          <Animated.View style={[styles.content, goingFixed, !going && overlay, goingLabelStyle]}>
            <GoingLabel look={look} />
          </Animated.View>
        </Animated.View>
      </PressableScale>
      {/* Réguas invisíveis: a largura natural de cada rótulo, com a fonte do aparelho. */}
      <View pointerEvents="none" {...hiddenFromReader} style={styles.rulers}>
        <View style={styles.content} onLayout={(event) => setRestWidth(widthOf(event))}>
          <RestLabel look={look} />
        </View>
        <View style={styles.content} onLayout={(event) => setGoingWidth(widthOf(event))}>
          <GoingLabel look={look} />
        </View>
      </View>
      <PointsToast
        points={awarded}
        trigger={rsvp.isSuccess ? rsvp.submittedAt : null}
        style={{ bottom: toastBottom }}
      />
    </View>
  );
}

/** "Eu vou" do post de show da home (1b), na pílula. */
export function RsvpChip(props: RsvpChipProps) {
  return <RsvpButton {...props} look="chip" />;
}

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
  surface: {
    justifyContent: 'center',
    // Os rótulos ficam com a própria largura, sem esticar com o botão.
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    borderWidth: borderWidths.default,
    // Recorta o rótulo novo enquanto o botão ainda cresce até a largura dele.
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Sobre o rótulo do estado atual, preso à esquerda do padding do botão.
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  rulers: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RULER_WIDTH,
    alignItems: 'flex-start',
    opacity: 0,
  },
});
