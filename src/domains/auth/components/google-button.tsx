import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useContentFade, useInactiveFade } from '@/components/button';
import { PressableScale } from '@/components/pressable-scale';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, googleBrand, layout, radii, spacing } from '@/theme';

// O G do Google como vem no pacote das diretrizes (20 no botão de 40), sem
// mudar o tamanho nem as cores.
const LOGO_SIZE = 20;

// Os espaços das diretrizes: antes do G, entre o G e o texto, e depois do
// texto (16, 12 e 16 no iOS; 12, 10 e 12 no Android).
const SPACING = Platform.select({
  ios: { edge: spacing.lg, gap: spacing.md },
  default: { edge: spacing.md, gap: spacing.listGap },
});

/** O G de quatro cores, decorativo: quem fala é o rótulo do botão. */
function GoogleLogo() {
  return (
    <Svg
      width={LOGO_SIZE}
      height={LOGO_SIZE}
      viewBox="0 0 48 48"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Path
        fill={googleBrand.red}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill={googleBrand.blue}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill={googleBrand.yellow}
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill={googleBrand.green}
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

export interface GoogleButtonProps {
  onPress: () => void;
  /** A entrada pelo Google está indo: o G e o texto dão lugar ao indicador. */
  loading?: boolean;
  /** Outra entrada está indo, ou o Firebase não foi configurado. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Continuar com o Google" da 1k (seção 33 de docs/arquitetura-api.md, decisão
 * 15), no tema claro das diretrizes de marca do Google: fundo branco, borda de
 * 1, o G de quatro cores à esquerda do texto e os espaços delas. Com a altura
 * e o raio dos outros botões da 1k. O texto sai na fonte do app (a Google Sans
 * das diretrizes não vem no app). Desligado ou carregando, apaga como o
 * `Button`, e o rótulo troca pelo indicador em fade.
 */
export function GoogleButton({
  onPress,
  loading = false,
  disabled = false,
  style,
}: GoogleButtonProps) {
  const inactive = disabled || loading;
  const { inactiveStyle } = useInactiveFade(inactive);
  const contentStyle = useContentFade(loading ? 'loading' : 'label');
  const label = t('auth.welcome.google');

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: inactive }}
      testID="welcome-google"
      style={style}
    >
      {/* Um grupo só: no Android, sem a composição fora da tela, fundo, borda
          e rótulo apagariam cada um sozinho. */}
      <Animated.View needsOffscreenAlphaCompositing style={[styles.surface, inactiveStyle]}>
        <Animated.View style={[styles.content, contentStyle]}>
          {loading ? (
            <ActivityIndicator color={googleBrand.buttonText} />
          ) : (
            <>
              <GoogleLogo />
              <Text
                variant="buttonAlt"
                color={googleBrand.buttonText}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={styles.label}
              >
                {label}
              </Text>
            </>
          )}
        </Animated.View>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  surface: {
    minHeight: layout.buttonHeight.lg,
    paddingHorizontal: SPACING.edge,
    borderRadius: radii.cta,
    borderWidth: borderWidths.default,
    borderColor: googleBrand.buttonStroke,
    backgroundColor: googleBrand.buttonFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.gap,
  },
  // Com a fonte a 200%, o rótulo quebra em linhas centralizadas, como no `Button`.
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
});
