import { StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { MAX_FONT_SCALE, Text } from '@/components/text';
import { borderWidths, colors, radii, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

// O lima some para ele mesmo transparente, não para "transparent" (preto): em
// HSV, o preto faria o matiz passar por outras cores no caminho.
const CLEAR_POINTS = withAlpha(colors.points, 0);
// O bloco não tem altura fixa (o card cresce com a linha): os rótulos crescem
// até 200%, como o resto do card, e quebram linha em vez de cortar o número.
const LABEL_SCALE = MAX_FONT_SCALE;

// A camada que está apagada sai do leitor de tela (e das buscas dos testes).
const offScreenReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

export interface RewardPriceProps {
  /** 0: bloco lima com o custo. 1: contorno com `outlineLabel`. */
  progress: SharedValue<number>;
  /** O estado de agora é o contorno (o `progress` anda até ele). */
  outlined: boolean;
  /** "6.000 pts". */
  priceLabel: string;
  /** "faltam 2.520", "Esgotado" ou o próprio custo, quando o saldo não chegou. */
  outlineLabel: string;
  /** Contorno com o custo em branco (saldo desconhecido), e não apagado. */
  outlineTone?: 'muted' | 'neutral';
}

/**
 * Preço do card da 1h. É só visual: o card inteiro é o botão (nada de botão
 * dentro dele com a mesma ação). No alcance, bloco lima com o custo; fora
 * dele, contorno com o que falta. A troca anda com o `progress` do card: o
 * fundo e a borda em HSV, os rótulos em fade.
 *
 * As duas camadas ficam uma sobre a outra dentro do fluxo (lado a lado, a de
 * cima puxada para trás com margem de -100%): o bloco tem a altura da mais
 * alta, e nenhuma vaza quando a fonte grande quebra o rótulo em duas linhas.
 */
export function RewardPrice({
  progress,
  outlined,
  priceLabel,
  outlineLabel,
  outlineTone = 'muted',
}: RewardPriceProps) {
  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [colors.points, CLEAR_POINTS], 'HSV'),
    borderColor: interpolateColor(
      progress.get(),
      [0, 1],
      [colors.points, colors.borderGlass],
      'HSV',
    ),
  }));
  const priceStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const outlineStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  return (
    <Animated.View style={[styles.block, surfaceStyle]}>
      <Animated.View style={[styles.layer, priceStyle]} {...(outlined ? offScreenReader : null)}>
        <Text
          variant="chip"
          color={colors.onPoints}
          maxFontSizeMultiplier={LABEL_SCALE}
          style={styles.label}
        >
          {priceLabel}
        </Text>
      </Animated.View>
      <Animated.View
        style={[styles.layer, styles.stacked, outlineStyle]}
        {...(outlined ? null : offScreenReader)}
      >
        <Text
          variant="labelSmall"
          color={outlineTone === 'neutral' ? colors.textSecondary : colors.textMuted}
          maxFontSizeMultiplier={LABEL_SCALE}
          style={styles.label}
        >
          {outlineLabel}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

// Padding do protótipo (8 no lima, 7 + borda no contorno) menos a sobra da
// entrelinha do RN: a borda de 1 fica sempre, da cor do fundo no lima, e os
// dois estados têm a mesma altura.
const styles = StyleSheet.create({
  block: {
    flexDirection: 'row',
    borderRadius: radii.xxs,
    borderWidth: borderWidths.default,
    paddingVertical: spacing.metaGap,
    paddingHorizontal: spacing.sm,
  },
  // Cada camada ocupa a largura toda e centraliza o rótulo na altura do bloco.
  layer: {
    width: '100%',
    justifyContent: 'center',
  },
  stacked: {
    marginLeft: '-100%',
  },
  label: {
    textAlign: 'center',
  },
});
