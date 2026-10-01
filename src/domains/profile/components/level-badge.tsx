import { useEffect, useRef, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BrandBars } from '@/components/brand-bars';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { borderWidths, colors, motion, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import { levelBadgeText } from '../describe-profile';
import type { Level } from '../types';

// Na subida de nível, o selo sai do rosa tingido e volta ao lima, em HSV.
const FILL = {
  from: withAlpha(colors.accent, tints.soft.fill),
  to: withAlpha(colors.points, tints.soft.fill),
};
const BORDER = {
  from: withAlpha(colors.accent, tints.soft.border),
  to: withAlpha(colors.points, tints.soft.border),
};
// O quanto o selo cresce no pulso da subida de nível.
const PULSE_SCALE = 1.08;

export interface LevelBadgeProps {
  level: Level;
  /**
   * Muda a cada subida de nível vista pelo fã (`useLevelUp`): o selo pulsa, a
   * cor volta do rosa ao lima e as barras acendem uma depois da outra. Com
   * reduzir movimento, só o texto troca.
   */
  celebration?: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Selo lima "NÍVEL 7 · PURAINHA" do hero da 1e, com as barras da marca. Não é
 * tocável, e o hero em volta diz o nível para o leitor de tela.
 */
export function LevelBadge({ level, celebration = null, style, testID }: LevelBadgeProps) {
  const reducedMotion = usePrefersReducedMotion();
  const lit = useSharedValue(1);
  const scale = useSharedValue(1);
  // A festa que já tocou: a que chega com o selo montado não se repete.
  const played = useRef(celebration);
  const [atMount] = useState(celebration);
  // Na subida de nível, as barras acendem de novo junto com a volta ao lima.
  const celebrating = celebration !== null && celebration !== atMount;

  useEffect(() => {
    if (celebration === null || celebration === played.current) return;
    played.current = celebration;
    if (reducedMotion) return;
    lit.set(
      withSequence(
        withTiming(0, { duration: 0 }),
        withTiming(1, { duration: motion.duration.counter, easing: motion.easing.out }),
      ),
    );
    scale.set(
      withSequence(
        withTiming(PULSE_SCALE, { duration: motion.duration.base, easing: motion.easing.out }),
        withSpring(1, motion.spring.gentle),
      ),
    );
  }, [celebration, reducedMotion, lit, scale]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = lit.get();
    return {
      backgroundColor: p >= 1 ? FILL.to : interpolateColor(p, [0, 1], [FILL.from, FILL.to], 'HSV'),
      borderColor:
        p >= 1 ? BORDER.to : interpolateColor(p, [0, 1], [BORDER.from, BORDER.to], 'HSV'),
      transform: [{ scale: scale.get() }],
    };
  });

  return (
    <Animated.View testID={testID} style={[styles.badge, animatedStyle, style]}>
      <BrandBars
        key={celebrating ? celebration : 'quieta'}
        color={colors.points}
        size="badge"
        lightUp={celebrating}
      />
      <Text variant="badge" color={colors.points}>
        {levelBadgeText(level)}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Padding do protótipo (5 12) menos a sobra da entrelinha do `badge` no RN.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.chipGap,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
  },
});
