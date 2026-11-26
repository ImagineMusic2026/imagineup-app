import { useEffect, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

const TIMING = { duration: motion.duration.base, easing: motion.easing.out };

// Os tempos do `RevealExpandable` (`motion.reveal`).
const REVEAL_OPEN = { duration: motion.reveal.open, easing: motion.easing.standard };
const REVEAL_CLOSE = { duration: motion.reveal.close, easing: motion.easing.inOut };
const CONTENT_IN = { duration: motion.reveal.contentIn, easing: motion.easing.out };
const CONTENT_OUT = { duration: motion.reveal.contentOut, easing: motion.easing.inOut };
const RESIZE = { duration: motion.reveal.resize, easing: motion.easing.inOut };
const CONTENT_DELAY = motion.reveal.contentDelay;
const RISE = motion.reveal.rise;

/**
 * O quanto o bloco está aberto, de 0 a 1, por valor animado: o painel e quem
 * acompanha ele (a seta do gênero) andam juntos. Com reduzir movimento, troca
 * na hora.
 */
export function useExpandProgress(open: boolean): SharedValue<number> {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    const target = open ? 1 : 0;
    progress.set(reducedMotion ? target : withTiming(target, TIMING));
  }, [open, reducedMotion, progress]);

  return progress;
}

/** Fechado, o bloco sai do toque e do leitor de tela. */
function hiddenWhenClosed(open: boolean) {
  return {
    pointerEvents: open ? 'auto' : 'none',
    accessibilityElementsHidden: !open,
    importantForAccessibility: open ? 'auto' : 'no-hide-descendants',
  } as const;
}

export interface ExpandableProps {
  open: boolean;
  /** O valor do `useExpandProgress`, quando outra peça anda junto. */
  progress?: SharedValue<number>;
  /**
   * No Android, compõe o bloco fora da tela enquanto ele apaga: com camadas
   * umas sobre as outras (o card do check-in, com fundo, borda e botão), cada
   * uma apagaria sozinha. Quem não pede segue como era.
   */
  needsOffscreenAlphaCompositing?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Bloco que abre embaixo de quem o controla (as opções da foto e as do gênero
 * na tela "Editar perfil"). O conteúdo fica sempre montado e medido, e a altura
 * anda por valor animado: montar com `entering` ou animar com
 * `LinearTransition` já apagou a tela no Android. Fechado, sai do leitor de
 * tela e do toque. Para um bloco grande, que empurra a tela, use o
 * `RevealExpandable`.
 */
export function Expandable({
  open,
  progress,
  needsOffscreenAlphaCompositing,
  children,
  style,
  testID,
}: ExpandableProps) {
  const own = useExpandProgress(open);
  const value = progress ?? own;
  const height = useSharedValue(0);

  const clipStyle = useAnimatedStyle(() => ({
    height: value.get() * height.get(),
    opacity: value.get(),
  }));

  return (
    <Animated.View
      needsOffscreenAlphaCompositing={needsOffscreenAlphaCompositing}
      {...hiddenWhenClosed(open)}
      style={[styles.clip, clipStyle]}
      testID={testID}
    >
      <View
        onLayout={(event) => height.set(event.nativeEvent.layout.height)}
        style={[styles.content, style]}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * Os dois valores do `RevealExpandable`, de 0 a 1: a altura do recorte
 * (`progress`) e o conteúdo (`shown`, a opacidade e a descida). Cada um parte
 * de onde está, então abrir no meio do fechar, ou o contrário, segue sem
 * pulo. Com reduzir movimento, trocam na hora.
 */
function useReveal(open: boolean, reducedMotion: boolean) {
  const progress = useSharedValue(open ? 1 : 0);
  const shown = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    const target = open ? 1 : 0;
    if (reducedMotion) {
      progress.set(target);
      shown.set(target);
      return;
    }
    progress.set(withTiming(target, open ? REVEAL_OPEN : REVEAL_CLOSE));
    shown.set(
      open ? withDelay(CONTENT_DELAY, withTiming(1, CONTENT_IN)) : withTiming(0, CONTENT_OUT),
    );
  }, [open, reducedMotion, progress, shown]);

  return { progress, shown };
}

export type RevealExpandableProps = Omit<ExpandableProps, 'progress'>;

/**
 * O `Expandable` de um bloco grande, que empurra a tela para baixo (o card do
 * check-in da Início, que o ícone do calendário abre), nos tempos de
 * `motion.reveal`. Abrindo, o recorte desce devagar o bastante para se ver a
 * gaveta abrir, e o conteúdo entra em fade, descendo um pouco, logo depois de
 * ela começar. Fechando, o conteúdo apaga e sobe antes de o recorte fechar. A
 * altura e o conteúdo andam em valores separados (`useReveal`).
 *
 * O conteúdo precisa estar medido antes de abrir: o `onLayout` dele dá a
 * altura do caminho, e um conteúdo que só monta na abertura começa o caminho
 * com a altura 0 e pula quando a medida chega. Aberto, uma troca de altura do
 * conteúdo (o botão que vira o pé do "feito") anda, e não pula. Como no
 * `Expandable`, nada de `entering` nem `LinearTransition`, e, fechado, o bloco
 * sai do leitor de tela e do toque.
 */
export function RevealExpandable({
  open,
  needsOffscreenAlphaCompositing,
  children,
  style,
  testID,
}: RevealExpandableProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { progress, shown } = useReveal(open, reducedMotion);
  const height = useSharedValue(0);
  const [measured, setMeasured] = useState(false);

  const clipStyle = useAnimatedStyle(() => ({
    height: progress.get() * height.get(),
    opacity: shown.get(),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (shown.get() - 1) * RISE }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    // A primeira medida, e qualquer uma com o bloco fechado, valem na hora.
    height.set(measured && open && !reducedMotion ? withTiming(next, RESIZE) : next);
    if (!measured) setMeasured(true);
  };

  return (
    <Animated.View
      needsOffscreenAlphaCompositing={needsOffscreenAlphaCompositing}
      {...hiddenWhenClosed(open)}
      style={[styles.clip, clipStyle]}
      testID={testID}
    >
      <Animated.View
        onLayout={onLayout}
        style={[styles.content, style, contentStyle]}
        testID={testID ? `${testID}-content` : undefined}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Na largura do pai: o conteúdo, fora do fluxo, não dá largura ao bloco.
  clip: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  // Fora do fluxo do pai: a medida é a do conteúdo inteiro, não a da altura animada.
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
