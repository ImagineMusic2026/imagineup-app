import { useFonts } from 'expo-font';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, opacities, radii, spacing } from '@/theme';

import { TermsNotice } from './terms-notice';

// https://developers.google.com/identity/branding-guidelines
const googleLogo = require('../../../../assets/branding/google/g-logo.png');
const googleFonts = {
  GoogleSansMedium: require('../../../../assets/branding/google/GoogleSans-Medium.ttf'),
};
const LOGO_SIZE = 20;
const MIN_TOUCH_TARGET = 48;
const BUTTON_TEXT = '#E3E3E3';

export interface GoogleButtonProps {
  onPress: () => void;
  loading: boolean;
  disabled?: boolean;
  /**
   * Mostra embaixo do botão o aviso de que criar a conta aceita os Termos e a
   * Política. Vale sempre no cadastro. No entrar, só quando a tela abriu sem a
   * abertura embaixo (por um link do app): pela abertura, o aviso dela ("Ao
   * continuar, você aceita...") já cobre quem cria a conta pelo Google ali, e
   * a tela fica mais limpa (pedido do dono de 24/11/2026).
   */
  showTerms: boolean;
}

/** Alternativa ao e-mail na primeira pergunta das telas de conta. */
export function GoogleButton({ onPress, loading, disabled = false, showTerms }: GoogleButtonProps) {
  const [fontLoaded] = useFonts(googleFonts);
  const label = t('auth.google.continue');
  const inactive = loading || disabled;

  return (
    <View style={styles.group}>
      <PressableScale
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityState={{ busy: loading }}
        disabled={inactive}
        style={[styles.touchTarget, inactive && styles.inactive]}
      >
        <View style={styles.button}>
          <Image
            source={googleLogo}
            accessible={false}
            importantForAccessibility="no"
            resizeMode="contain"
            style={[styles.logo, loading && styles.hidden]}
          />
          <Text
            variant="buttonAlt"
            color={BUTTON_TEXT}
            style={[styles.label, fontLoaded && styles.googleFont, loading && styles.hidden]}
          >
            {label}
          </Text>
          {loading ? (
            <View style={styles.spinner}>
              <ActivityIndicator color={BUTTON_TEXT} />
            </View>
          ) : null}
        </View>
      </PressableScale>
      {showTerms ? (
        <View
          pointerEvents={inactive ? 'none' : 'auto'}
          importantForAccessibility={inactive ? 'no-hide-descendants' : 'auto'}
        >
          <TermsNotice variant="signUp" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.xs },
  touchTarget: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', maxWidth: '100%' },
  button: {
    minHeight: 40,
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    borderColor: '#8E918F',
    backgroundColor: '#131314',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.listGap,
  },
  inactive: { opacity: opacities.disabled },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  label: { lineHeight: 20, flexShrink: 1, textAlign: 'center' },
  googleFont: { fontFamily: 'GoogleSansMedium' },
  hidden: { opacity: 0 },
  spinner: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
