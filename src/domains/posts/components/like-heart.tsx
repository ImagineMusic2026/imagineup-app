import { Heart } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { colors, motion } from '@/theme';
import { withAlpha } from '@/utils/color';

/** O ícone das pílulas de ação (curtir e comentar, da 1a), e o das reações do fã-clube. */
export const ACTION_ICON_SIZE = 16;
// Contorno e número do curtir e do comentar, como no card completo da 1a:
// ícone a .75 e número a .8 (a `Pill` neutra usa .7, o do chip da home).
export const ACTION_ICON_COLOR = withAlpha(colors.text, 0.75);
export const ACTION_COUNT_COLOR = withAlpha(colors.text, 0.8);

const HEART_POP_SCALE = 1.2;

/**
 * Coração do curtir: o contorno dá lugar ao cheio rosa e ele dá um pulo de
 * mola (1 a 1,2 e de volta) quando o fã curte. A cor sai do branco para o
 * rosa em fade, que dá a mistura do RGB: em HSV, o matiz do branco (zero)
 * passaria por todas as cores até o rosa. Com reduzir movimento, sem pulo.
 * Na montagem e quando a curtida chega do servidor, fica parado. Sai pelo
 * index dos posts desde a Fase 2 do fã-clube (seção 37, 37.9): o coração da
 * reação é o mesmo.
 */
export function LikeHeart({ liked }: { liked: boolean }) {
  const reducedMotion = usePrefersReducedMotion();
  const fill = useSharedValue(liked ? 1 : 0);
  const scale = useSharedValue(1);
  const shown = useRef(liked);

  useEffect(() => {
    if (shown.current === liked) return;
    shown.current = liked;
    const target = liked ? 1 : 0;
    fill.set(
      reducedMotion
        ? target
        : withTiming(target, { duration: motion.duration.fast, easing: motion.easing.out }),
    );
    if (liked && !reducedMotion) {
      scale.set(
        withSequence(
          withTiming(HEART_POP_SCALE, {
            duration: motion.duration.fast,
            easing: motion.easing.out,
          }),
          withSpring(1, motion.spring.snappy),
        ),
      );
    }
  }, [liked, reducedMotion, fill, scale]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.get() }));
  const filledStyle = useAnimatedStyle(() => ({ opacity: fill.get() }));

  return (
    <Animated.View style={[styles.heart, popStyle]}>
      <Animated.View style={[styles.heartLayer, outlineStyle]}>
        <Icon icon={Heart} size={ACTION_ICON_SIZE} color={ACTION_ICON_COLOR} />
      </Animated.View>
      <Animated.View style={[styles.heartLayer, filledStyle]}>
        <Icon icon={Heart} size={ACTION_ICON_SIZE} color={colors.accent} filled />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heart: {
    width: ACTION_ICON_SIZE,
    height: ACTION_ICON_SIZE,
  },
  heartLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
