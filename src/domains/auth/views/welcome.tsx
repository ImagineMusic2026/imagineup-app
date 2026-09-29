import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandBars, brandBarsWidth } from '@/components/brand-bars';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { isFirebaseConfigured } from '@/firebase';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { AUTH_LOGO_BOTTOM } from '../components/auth-backdrop';
import { TermsNotice } from '../components/terms-notice';

// Espaço reservado em cima para o logo do fundo, para o texto a 200% rolar
// sem começar por baixo dele.
const LOGO_CLEARANCE = AUTH_LOGO_BOTTOM + spacing.xl;

// A Sora com a entrelinha do token (46) sobra 6 abaixo da linha de base, e as
// barras sobem junto para ficar alinhadas ao pé das letras (7 no protótipo).
const BARS_LIFT = 10;

// "ImagineUP" em `displayXl` mede 221 de largura com o texto a 100% (no
// protótipo e no Android), e a largura cresce junto com a fonte. A folga cobre
// a diferença de desenho da fonte entre os sistemas.
const TITLE_WIDTH = 221;
const TITLE_FIT_MARGIN = 0.94;

/**
 * 1k, abertura. Na fase de e-mail e senha: "Criar minha conta" (rosa, aprovado
 * em 2026-09-29) e "Já tenho conta" (vidro). Apple e Google entram numa etapa
 * seguinte. A foto, o véu, as listras e o logo são do fundo compartilhado do
 * grupo `(auth)`, que fica parado quando o fã vai para os formulários.
 */
export function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const disabled = !isFirebaseConfigured;
  // A marca é uma palavra só: com o texto grande, ela cresce até onde cabe na
  // linha, ao lado das barras, em vez de quebrar no meio ("ImagineU" / "P").
  const titleRoom =
    windowWidth -
    insets.left -
    insets.right -
    2 * spacing.gutterAuth -
    spacing.tileGap -
    brandBarsWidth('hero');
  const titleMaxScale = Math.min(
    MAX_FONT_SCALE,
    Math.max(1, (titleRoom * TITLE_FIT_MARGIN) / TITLE_WIDTH),
  );

  return (
    <Screen
      transparent
      scroll
      safeTop={false}
      padded={false}
      contentStyle={[
        styles.content,
        {
          paddingTop: insets.top + LOGO_CLEARANCE,
          paddingBottom: insets.bottom + spacing.md,
        },
      ]}
    >
      <View style={styles.titleRow}>
        <Text variant="displayXl" accessibilityRole="header" maxFontSizeMultiplier={titleMaxScale}>
          {t('auth.welcome.title')}
        </Text>
        <BrandBars size="hero" style={styles.bars} />
      </View>
      <Text variant="bodyLead" color={colors.textSecondary} style={styles.lead}>
        {t('auth.welcome.lead')}
      </Text>

      {disabled ? (
        <Text variant="caption" color={colors.danger} style={styles.missingConfig}>
          {t('auth.missingConfig')}
        </Text>
      ) : null}

      <Button
        label={t('auth.welcome.createAccount')}
        icon={Mail}
        onPress={() => router.push('/cadastro')}
        disabled={disabled}
        style={styles.primary}
      />
      <Button
        label={t('auth.welcome.haveAccount')}
        variant="glass"
        onPress={() => router.push('/entrar-com-email')}
        disabled={disabled}
        style={styles.secondary}
      />
      <TermsNotice variant="continue" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Com o texto a 200%, o bloco passa da altura da tela e rola; no tamanho
  // normal, fica preso embaixo.
  content: {
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.gutterAuth,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    columnGap: spacing.tileGap,
  },
  bars: {
    marginBottom: BARS_LIFT,
  },
  lead: {
    marginTop: spacing.lg,
    marginBottom: spacing.authLeadGap,
  },
  missingConfig: {
    marginBottom: spacing.md,
  },
  primary: {
    marginBottom: spacing.listGap,
  },
  secondary: {
    marginBottom: spacing.blockGap,
  },
});
