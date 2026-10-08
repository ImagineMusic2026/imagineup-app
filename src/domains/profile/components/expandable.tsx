import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

const TIMING = { duration: motion.duration.base, easing: motion.easing.out };

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

export interface ExpandableProps {
  open: boolean;
  /** O valor do `useExpandProgress`, quando outra peça anda junto. */
  progress?: SharedValue<number>;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Bloco que abre embaixo de quem o controla (as opções da foto e as do gênero
 * na tela "Editar perfil"). O conteúdo fica sempre montado e medido, e a
 * altura anda por valor animado: montar com `entering` ou animar com
 * `LinearTransition` já apagou a tela no Android. Fechado, sai do leitor de
 * tela e do toque.
 */
export function Expandable({ open, progress, children, style, testID }: ExpandableProps) {
  const own = useExpandProgress(open);
  const value = progress ?? own;
  const height = useSharedValue(0);

  const clipStyle = useAnimatedStyle(() => ({
    height: value.get() * height.get(),
    opacity: value.get(),
  }));

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
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
