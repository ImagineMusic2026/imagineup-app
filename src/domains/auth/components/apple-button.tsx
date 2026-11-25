import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, layout, opacities, radii, spacing } from '@/theme';

export interface AppleButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled?: boolean;
}

/**
 * O botão nativo da Apple, "Continuar com a Apple", só no iPhone (seção 39 de
 * docs/arquitetura-api.md). Fora do iOS, o pacote não desenha nada.
 *
 * - O título e o rótulo do VoiceOver vêm do sistema, no idioma da interface do
 *   sistema dentro do app: é a exceção documentada à regra do `t()`, porque a
 *   Apple só aceita o título dela no botão dela.
 * - A caixa de fora não leva papel nem rótulo: com eles, o leitor de tela acharia
 *   um segundo foco para a mesma ação (regra dos pressáveis aninhados).
 * - O botão nativo não tem estado desligado nem ocupado. Inativo, a caixa tira o
 *   toque e apaga o botão; o toque que chega mesmo assim (pelo VoiceOver) não faz
 *   nada. O início da entrada é anunciado pelo núcleo da entrada.
 * - HIG: nunca menor que o `Button` `lg` do pé (50 de altura, com o `radii.cta`),
 *   pelo menos 140 por 30, e uma margem de 1/10 da altura em volta.
 */
export function AppleButton({ onPress, loading, disabled = false }: AppleButtonProps) {
  const inactive = loading || disabled;

  return (
    <View
      pointerEvents={inactive ? 'none' : 'auto'}
      style={[styles.wrapper, inactive && styles.inactive]}
      testID="apple-button"
    >
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={radii.cta}
        style={styles.native}
        onPress={() => {
          if (!inactive) onPress();
        }}
      />
      {loading ? (
        <View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.loading}
          testID="apple-button-loading"
        >
          <ActivityIndicator color={colors.onInverse} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A margem de baixo soma 8 com o `gap` do grupo: 1/10 dos 50 do botão.
  wrapper: { alignSelf: 'stretch', height: layout.buttonHeight.lg, marginBottom: spacing.xs },
  inactive: { opacity: opacities.disabled },
  native: { width: '100%', height: layout.buttonHeight.lg },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.cta,
    backgroundColor: colors.inverse,
  },
});
