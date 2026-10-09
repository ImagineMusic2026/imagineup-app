import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { colors, layout, motion } from '@/theme';

export interface SwitchProps {
  /** Ligado: o trilho rosa e o polegar na direita. */
  value: boolean;
  testID?: string;
}

const { width: TRACK_WIDTH, height: TRACK_HEIGHT, thumb: THUMB } = layout.switch;
const INSET = (TRACK_HEIGHT - THUMB) / 2;
const TRAVEL = TRACK_WIDTH - THUMB - INSET * 2;
const TIMING = { duration: motion.duration.base, easing: motion.easing.out };

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/**
 * Chave de liga e desliga, só o desenho: quem toca e fala é a linha em volta
 * (o `ListRow` com o papel `switch` e o `checked`), como o `Avatar` dentro de
 * um botão. Um switch tocável dentro da linha daria dois focos para a mesma
 * ação. O trilho troca de cor por duas camadas (o desligado embaixo e o rosa
 * por cima, pela opacidade) e o polegar anda pelo mesmo valor animado; com
 * reduzir movimento, troca na hora.
 */
export function Switch({ value, testID }: SwitchProps) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    const target = value ? 1 : 0;
    progress.set(reducedMotion ? target : withTiming(target, TIMING));
  }, [value, reducedMotion, progress]);

  const onStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * TRAVEL }],
  }));

  return (
    <View {...hiddenFromReader} pointerEvents="none" style={styles.track} testID={testID}>
      <Animated.View style={[styles.layer, styles.on, onStyle]} testID={testID && `${testID}-on`} />
      <Animated.View style={[styles.thumb, thumbStyle]} testID={testID && `${testID}-thumb`} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.trackStrong,
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  on: {
    backgroundColor: colors.accentStrong,
  },
  thumb: {
    position: 'absolute',
    top: INSET,
    left: INSET,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
  },
});
