import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { gradients, type ScrimPreset } from '@/theme';

export interface ScrimProps {
  preset: ScrimPreset;
  /** Por padrão cobre o pai inteiro; o rodapé fixo da 1l passa a própria caixa. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Véu escuro sobre foto, de cima para baixo, com as paradas do protótipo. O texto
 * por cima fica na faixa quase opaca. Não recebe toque nem foco.
 */
export function Scrim({ preset, style }: ScrimProps) {
  const { colors, locations } = gradients.scrims[preset];
  return (
    <LinearGradient
      colors={colors}
      locations={locations}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}
