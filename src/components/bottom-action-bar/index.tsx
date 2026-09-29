import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Scrim } from '@/components/scrim';
import { spacing } from '@/theme';

export interface BottomActionBarProps {
  /** O botão da tela e, se houver, o aviso de erro logo acima dele. */
  children: ReactNode;
  /**
   * Altura medida da barra. A lista rola por baixo dela, então usa este valor
   * no `paddingBottom` para o último item não ficar escondido.
   */
  onHeightChange?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Rodapé fixo com a ação principal da tela (1l). Fica preso ao pé do pai, por
 * cima do conteúdo, com um véu que vai do transparente ao fundo para a lista
 * sumir por baixo sem corte. A barra toda segura o toque: o que passa por baixo
 * do véu não é tocado sem querer.
 */
export function BottomActionBar({ children, onHeightChange, style, testID }: BottomActionBarProps) {
  const insets = useSafeAreaInsets();

  const handleLayout = (event: LayoutChangeEvent): void => {
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View
      testID={testID}
      onLayout={handleLayout}
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, style]}
    >
      <Scrim preset="bottomBar" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.sm,
    paddingTop: spacing.blockGap,
    paddingHorizontal: spacing.gutterOnboarding,
  },
});
