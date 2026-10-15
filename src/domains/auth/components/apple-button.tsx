import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useInactiveFade } from '@/components/button';
import { colors, layout, radii } from '@/theme';

export interface AppleButtonProps {
  onPress: () => void;
  /** A entrada pela Apple está indo: o indicador cobre o botão. */
  loading?: boolean;
  /** Outra entrada está indo, ou o Firebase não foi configurado. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Continuar com a Apple" da 1k (seção 33 de docs/arquitetura-api.md, decisões
 * 2 e 15): o botão nativo, branco, com o texto do sistema (em português pelo
 * `CFBundleDevelopmentRegion` do app), na altura e no raio dos outros botões
 * da 1k. Quem decide se ele aparece é a tela (só no iOS, com o módulo).
 *
 * O botão nativo não desliga, não mostra "carregando" e não aceita
 * `backgroundColor` nem `borderRadius` no `style` (a doc proíbe; o raio vai no
 * `cornerRadius`). Por isso o invólucro: desligado ou carregando, ele não
 * deixa o toque passar (`pointerEvents`) e apaga como o `Button`; carregando,
 * uma camada branca com o indicador cobre o texto, como o rótulo do `Button`
 * dá lugar ao indicador. O toque que chega mesmo assim (o leitor de tela) não
 * faz nada.
 */
export function AppleButton({
  onPress,
  loading = false,
  disabled = false,
  style,
}: AppleButtonProps) {
  const inactive = disabled || loading;
  const { inactiveStyle } = useInactiveFade(inactive);

  return (
    <Animated.View
      pointerEvents={inactive ? 'none' : 'auto'}
      needsOffscreenAlphaCompositing
      style={[styles.wrapper, inactiveStyle, style]}
      testID="welcome-apple"
    >
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={radii.cta}
        style={styles.button}
        onPress={() => {
          if (!inactive) onPress();
        }}
      />
      {loading ? (
        <View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[StyleSheet.absoluteFill, styles.loading]}
          testID="welcome-apple-loading"
        >
          <ActivityIndicator color={colors.onInverse} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: layout.buttonHeight.lg,
  },
  // O nativo some sem largura e altura: as duas vão no `style`.
  button: {
    width: '100%',
    height: layout.buttonHeight.lg,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.cta,
    backgroundColor: colors.inverse,
  },
});
