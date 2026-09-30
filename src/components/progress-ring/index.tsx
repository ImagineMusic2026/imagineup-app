import { Canvas, Path, Skia, SweepGradient, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { colors, motion } from '@/theme';
import { withAlpha } from '@/utils/color';

export interface ProgressRingProps {
  /** De 0 a 1. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Uma cor sólida ou um gradiente em volta do anel. */
  colors?: readonly string[];
  trackColor?: string;
  /**
   * Quando muda, o anel volta a 0 e sobe de novo até o valor (a subida de
   * nível da 1e), sem remontar o Canvas: o Skia leva alguns quadros até o
   * primeiro desenho, e o anel remontado sumia nesse tempo, trilho incluído.
   */
  restartKey?: string | number | null;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * Anel de progresso em Skia (meta da temporada, nível do avatar). Os padrões
 * são os do anel da 1g: espessura 7, trilho branco a .1 e ponta reta (ponta
 * redonda faria 12/20 parecer mais que 60%). O React Native
 * não desenha gradiente cônico; o Skia sim, e anima direto do shared value do
 * Reanimated, sem passar pelo JS a cada quadro.
 */
export function ProgressRing({
  progress,
  size = 62,
  strokeWidth = 7,
  colors: ringColors = [colors.points],
  trackColor = withAlpha(colors.text, 0.1),
  restartKey = null,
  accessibilityLabel,
  style,
  children,
}: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const end = useSharedValue(0);
  // A chave que já está desenhada: a que chega com o anel montado não reinicia.
  const drawnKey = useRef(restartKey);

  useEffect(() => {
    const restart = drawnKey.current !== restartKey;
    drawnKey.current = restartKey;
    const grow = withTiming(clamped, {
      duration: motion.duration.counter,
      easing: motion.easing.out,
    });
    end.set(restart ? withSequence(withTiming(0, { duration: 0 }), grow) : grow);
  }, [clamped, restartKey, end]);

  // `Path.Circle` no lugar do `addCircle` num path vazio, que o Skia 2.6 marca
  // como obsoleto (e avisa no console a cada abertura). Mesmo sentido e início.
  const path = useMemo(
    () => Skia.Path.Circle(size / 2, size / 2, (size - strokeWidth) / 2),
    [size, strokeWidth],
  );

  const center = vec(size / 2, size / 2);
  const gradient = ringColors.length > 1 ? [...ringColors, ringColors[0] as string] : null;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={!!accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={path} style="stroke" strokeWidth={strokeWidth} color={trackColor} />
        <Path
          path={path}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="butt"
          start={0}
          end={end}
          color={ringColors[0]}
          transform={[{ rotate: -Math.PI / 2 }]}
          origin={center}
        >
          {gradient ? <SweepGradient c={center} colors={gradient} /> : null}
        </Path>
      </Canvas>
      {children ? <View style={styles.center}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
