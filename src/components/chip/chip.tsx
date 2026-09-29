import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { maxFontScaleOf, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { borderWidths, colors, layout, motion, radii, spacing } from '@/theme';
import { selectionAccessibility, type SelectionMode } from '@/utils/selection-accessibility';

/**
 * - `single`: um escolhido por vez (escopo do ranking 1f, mês da agenda 1m).
 * - `multiple`: cada chip liga e desliga sozinho.
 */
export type ChipSelectionMode = SelectionMode;

export interface ChipProps {
  /** Texto visível, que também é o nome lido (o chamador traz de `t()` ou do dado). */
  label: string;
  selected: boolean;
  onPress: () => void;
  mode?: ChipSelectionMode;
  /** Troca o nome lido quando o texto visível não basta. */
  accessibilityLabel?: string;
  /** "Mostra os shows de junho" (1m), via `t()`. */
  accessibilityHint?: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

const TIMING = { duration: motion.duration.base, easing: motion.easing.out };

// O limite da variante `chip` vale para os dois rótulos sobrepostos: crescendo
// juntos, o de baixo (Manrope, sem limite próprio) não vaza do desenho.
const LABEL_MAX_FONT_SCALE = maxFontScaleOf('chip');

function useFade(visible: boolean, reducedMotion: boolean) {
  return useAnimatedStyle(() => {
    const target = visible ? 1 : 0;
    return { opacity: reducedMotion ? target : withTiming(target, TIMING) };
  });
}

/**
 * Chip de filtro (1f, 1m): branco com texto escuro quando escolhido, escuro com
 * borda quando não. O desenho tem 28 e fica no meio de um pressável de 44.
 *
 * Os dois estados ficam montados um sobre o outro e trocam por opacidade: a
 * família muda (Sora 800 no escolhido, Manrope 600 no outro) e, trocando o
 * texto, a largura pularia a cada toque. O chip mede pelo rótulo mais largo.
 */
export function Chip({
  label,
  selected,
  onPress,
  mode = 'single',
  accessibilityLabel,
  accessibilityHint,
  onLayout,
  testID,
}: ChipProps) {
  const reducedMotion = usePrefersReducedMotion();
  const fillStyle = useFade(selected, reducedMotion);
  const selectedLabelStyle = useFade(selected, reducedMotion);
  const restLabelStyle = useFade(!selected, reducedMotion);
  // iOS: botão com "selecionado"; Android: aba na seleção única, caixa de marcar na múltipla.
  const { role, state } = selectionAccessibility(mode, selected);

  return (
    <PressableScale
      onPress={onPress}
      onLayout={onLayout}
      // Tocar no que já está escolhido, na seleção única, não muda nada.
      haptic={mode === 'single' && selected ? null : 'selection'}
      accessibilityRole={role}
      accessibilityState={state}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={styles.target}
    >
      <View style={styles.pill}>
        <View style={[StyleSheet.absoluteFill, styles.rest]} />
        <Animated.View
          testID={testID ? `${testID}-fill` : undefined}
          style={[StyleSheet.absoluteFill, styles.fill, fillStyle]}
        />
        <Animated.View style={selectedLabelStyle}>
          <Text
            variant="chip"
            color={colors.onInverse}
            numberOfLines={1}
            maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
          >
            {label}
          </Text>
        </Animated.View>
        <Animated.View
          testID={testID ? `${testID}-rest-label` : undefined}
          style={[StyleSheet.absoluteFill, styles.restLabel, restLabelStyle]}
        >
          <Text
            variant="labelSmall"
            color={colors.textSubtle}
            numberOfLines={1}
            maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
          >
            {label}
          </Text>
        </Animated.View>
      </View>
    </PressableScale>
  );
}

// Borda só na camada de baixo: no iOS a borda de uma View é desenhada por cima
// dos filhos, e o branco do escolhido ficaria com um aro escuro.
const styles = StyleSheet.create({
  target: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 28 de desenho: texto de 14 com 7 em cima e embaixo (6 + 1 de borda no protótipo).
  pill: {
    paddingVertical: spacing.chipGap,
    paddingHorizontal: spacing.cardPadding,
    borderRadius: radii.pill,
  },
  rest: {
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  fill: {
    borderRadius: radii.pill,
    backgroundColor: colors.inverse,
  },
  restLabel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
