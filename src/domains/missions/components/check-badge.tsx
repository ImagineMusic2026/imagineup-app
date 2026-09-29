import { Check } from 'lucide-react-native';
import { StyleSheet } from 'react-native';
import Animated, {
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { colors, layout, motion } from '@/theme';

// Check de 14 com traço 3 no círculo de 26 do protótipo.
const CHECK_SIZE = 14;
const CHECK_STROKE = 3;

// O selo entra crescendo de .6 com a mola suave; o worklet leva só números.
const POP_FROM = 0.6;
const POP_SPRING = motion.spring.gentle;
const POP_FADE_MS = motion.duration.fast;

const popIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: POP_FROM }] },
    animations: {
      opacity: withTiming(1, { duration: POP_FADE_MS }),
      transform: [{ scale: withSpring(1, POP_SPRING) }],
    },
  };
};

/**
 * - `points`: círculo lima com check escuro (linha concluída);
 * - `onPoints`: círculo escuro com check lima (sobre o card lima).
 */
export type CheckBadgeTone = 'points' | 'onPoints';

export interface CheckBadgeProps {
  tone?: CheckBadgeTone;
  /**
   * Muda quando a missão acabou de ser concluída diante do fã: o selo entra
   * crescendo. Com reduzir movimento, o Reanimated leva direto ao fim.
   */
  celebration?: number;
}

/** Selo de concluída no lugar dos pontos. Decorativo: "Concluída" está no rótulo. */
export function CheckBadge({ tone = 'points', celebration }: CheckBadgeProps) {
  const onPoints = tone === 'onPoints';
  return (
    <Animated.View
      key={celebration ?? 'still'}
      entering={celebration === undefined ? undefined : popIn}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.badge, onPoints ? styles.onPoints : styles.points]}
    >
      <Icon
        icon={Check}
        size={CHECK_SIZE}
        color={onPoints ? colors.points : colors.onPoints}
        strokeWidth={CHECK_STROKE}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: layout.checkBadge,
    height: layout.checkBadge,
    borderRadius: layout.checkBadge / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  points: {
    backgroundColor: colors.points,
  },
  onPoints: {
    backgroundColor: colors.onPoints,
  },
});
