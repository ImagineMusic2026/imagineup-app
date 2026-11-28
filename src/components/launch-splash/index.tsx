import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, motion } from '@/theme';

// A imagem e a caixa da splash nativa (o `expo-splash-screen` do
// `app.config.ts`, com `imageWidth: 96`): o plugin desenha o PNG contido num
// quadrado de 96 x 96 no centro da tela, no Android e no iPhone, sobre o
// `#0B0B10`. A abertura repete os três para a troca não aparecer; se a splash
// mudar lá, muda aqui também.
const SPLASH_IMAGE = require('@/assets/images/splash-icon.png');
const LOGO_BOX = 96;

// A batida da prévia de 24/11/2026, feita para o símbolo de 76 de altura da
// 1k: as poses nos milissegundos da prévia, aqui como fração da batida, e o
// pulo na proporção do símbolo da splash.
const PREVIEW_MS = [0, 70, 260, 520, 790, 1150];
const PREVIEW_SYMBOL_HEIGHT = 76;
const STOPS = PREVIEW_MS.map((ms) => ms / 1150);
const RISE = [0, 0, 4, -10, 1, 0].map((y) => (y * LOGO_BOX) / PREVIEW_SYMBOL_HEIGHT);
const TILT = [0, 0, -7, 8, -2, 0];
const STRETCH_X = [1, 1, 1.02, 1.065, 0.994, 1];
const STRETCH_Y = [1, 1, 0.93, 1.075, 0.987, 1];

/**
 * Sem a imagem na tela até aqui (ou com erro), a splash nativa sai como
 * antes, direto para a primeira tela, e a abertura não aparece.
 */
export const LAUNCH_IMAGE_TIMEOUT_MS = 1000;

// Uma vez por execução do JS: o `_layout` raiz que monta de novo (o "Tentar
// de novo" do ErrorBoundary) não repete a abertura.
let played = false;

/** A abertura já apareceu nesta execução do app. */
export function launchSplashPlayed(): boolean {
  return played;
}

/** A curva suave entre as poses (a da prévia), sobre um relógio linear. */
function easeBetweenStops(progress: number): number {
  'worklet';
  for (let index = 1; index < STOPS.length; index += 1) {
    const start = STOPS[index - 1]!;
    const end = STOPS[index]!;
    if (progress <= end) {
      const local = (progress - start) / (end - start);
      return start + (end - start) * local * local * (3 - 2 * local);
    }
  }
  return progress;
}

/**
 * `waiting`: a imagem ainda não está na tela, e a splash nativa cobre tudo.
 * `shown`: a splash nativa sai, e a batida começa depois do fade dela.
 * `leaving`: a abertura sai em fade, e a primeira tela entra por baixo.
 * `skipped`: sem a imagem, a splash nativa sai direto para a primeira tela.
 */
type Stage = 'waiting' | 'shown' | 'leaving' | 'skipped';

export interface LaunchSplashProps {
  /** A abertura começou a sair: a primeira tela entra por baixo, junto. */
  onLeave: () => void;
  /** A abertura sumiu: pode desmontar. */
  onDone: () => void;
}

/**
 * A abertura do app: a cópia da splash nativa, por cima da primeira tela, em
 * que o símbolo da marca dá uma batida (agacha, pula girando e assenta) e sai
 * em fade. Ela tira a splash nativa quando o símbolo dela já está na tela, no
 * mesmo lugar, espera o fade dela, bate e sai; a tela de baixo só entra
 * (`onLeave`) quando ela começa a sair.
 *
 * É decorativa: o leitor de tela não para nela. Segura o toque até começar a
 * sair. Quem decide se ela aparece (uma vez por execução, sem reduzir
 * movimento) é o `_layout` raiz.
 */
export function LaunchSplash({ onLeave, onDone }: LaunchSplashProps) {
  const beat = useSharedValue(0);
  const opacity = useSharedValue(1);
  const [stage, setStage] = useState<Stage>('waiting');
  // Lidos por ref, para os timers não recomeçarem quando o pai renderiza.
  const handlers = useRef({ onLeave, onDone });

  useEffect(() => {
    handlers.current = { onLeave, onDone };
  }, [onLeave, onDone]);

  useEffect(() => {
    played = true;
  }, []);

  useEffect(() => {
    if (stage === 'waiting') {
      const timeout = setTimeout(() => setStage('skipped'), LAUNCH_IMAGE_TIMEOUT_MS);
      return () => clearTimeout(timeout);
    }
    if (stage === 'skipped') {
      SplashScreen.hideAsync().catch(() => undefined);
      handlers.current.onLeave();
      handlers.current.onDone();
      return undefined;
    }
    if (stage === 'shown') {
      // A batida só começa com a splash nativa já apagada: antes, o símbolo
      // parado dela aparecia por cima do que se mexe.
      const start = setTimeout(() => {
        beat.set(withTiming(1, { duration: motion.launch.beat, easing: Easing.linear }));
      }, motion.launch.handoff);
      const end = setTimeout(() => setStage('leaving'), motion.launch.handoff + motion.launch.beat);
      return () => {
        clearTimeout(start);
        clearTimeout(end);
      };
    }
    handlers.current.onLeave();
    opacity.set(withTiming(0, { duration: motion.launch.fade, easing: motion.easing.inOut }));
    const done = setTimeout(() => handlers.current.onDone(), motion.launch.fade);
    return () => clearTimeout(done);
  }, [beat, opacity, stage]);

  useEffect(
    () => () => {
      cancelAnimation(beat);
      cancelAnimation(opacity);
    },
    [beat, opacity],
  );

  // O símbolo já está na tela, no lugar do da splash nativa: ela pode sair.
  const onDisplay = (): void => {
    if (stage !== 'waiting') return;
    SplashScreen.hideAsync().catch(() => undefined);
    setStage('shown');
  };

  const onError = (): void => {
    if (stage === 'waiting') setStage('skipped');
  };

  const coverStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const beatStyle = useAnimatedStyle(() => {
    const time = easeBetweenStops(beat.get());
    return {
      transform: [
        { translateY: interpolate(time, STOPS, RISE) },
        { rotate: `${interpolate(time, STOPS, TILT)}deg` as const },
        { scaleX: interpolate(time, STOPS, STRETCH_X) },
        { scaleY: interpolate(time, STOPS, STRETCH_Y) },
      ],
    };
  });

  if (stage === 'skipped') return null;

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents={stage === 'leaving' ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.cover, coverStyle]}
    >
      <Animated.View style={[styles.box, beatStyle]}>
        <Image
          source={SPLASH_IMAGE}
          contentFit="contain"
          onDisplay={onDisplay}
          onError={onError}
          style={styles.box}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  box: {
    width: LOGO_BOX,
    height: LOGO_BOX,
  },
});
