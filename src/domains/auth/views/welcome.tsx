import { router, useIsFocused } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandBars, brandBarsWidth } from '@/components/brand-bars';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { isFirebaseConfigured } from '@/firebase';
import { t } from '@/i18n';
import { colors, motion, spacing } from '@/theme';

import { AUTH_LOGO_BOTTOM } from '../components/auth-backdrop';
import { RiseIn } from '../components/rise-in';
import { Tagline } from '../components/tagline';
import { TermsNotice } from '../components/terms-notice';
import { useAuthEntrance } from '../hooks/use-auth-entrance';

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

// As barras acendem enquanto o título sobe.
const BARS_LIGHT_UP_DELAY = motion.duration.fast;

// Lugar de cada bloco na entrada (`RiseIn`, 60 ms por lugar). O nome, o botão,
// o link e os termos seguem a cascata de sempre, um lugar depois do outro. A
// primeira parte da frase entra entre o nome e o botão, e as outras vêm depois
// (`Tagline`), sem segurar o botão até a frase terminar.
const ORDER = {
  title: 0,
  missingConfig: 1,
  taglineFirst: 2,
  createAccount: 3,
  haveAccount: 4,
  terms: 5,
} as const;

// O espaço que sobra na tela, dividido como no desenho: três partes em cima do
// nome, sobre a parede, e uma entre a frase e o botão.
const TOP_SPACE_SHARE = 3;
const MIDDLE_SPACE_SHARE = 1;

/**
 * 1k, abertura: tudo no centro, sobre a parede de fotos. O nome com as barras
 * da marca, a frase uma parte por vez ("Siga", "Comente", "Ganhe pontos") e,
 * no pé, "Criar minha conta" (botão rosa), "Já tenho conta" (link rosa) e o
 * aviso dos termos. Os botões de provedor não ficam aqui: o Google (no
 * Android) e a Apple (no iPhone) moram na pergunta do e-mail de entrar e de
 * criar conta (seção 39 de docs/arquitetura-api.md). A parede, o véu, as
 * listras e o logo são do fundo compartilhado do grupo `(auth)`, que fica
 * parado quando o fã vai para as perguntas.
 *
 * Na entrada, o nome, o botão, o link e os termos sobem 12 pt e aparecem um
 * depois do outro (60 ms entre eles, `RiseIn`), as barras da marca acendem uma
 * depois da outra e a frase começa a trocar de parte, em laço, com o botão de
 * pausa ao lado (`Tagline`), tudo a partir do fade da pilha `(auth)`
 * (`useAuthEntrance`), junto com a parede assentando no fundo. Com reduzir
 * movimento, nada se mexe.
 */
export function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const entrance = useAuthEntrance();
  // Coberta por uma pergunta, a abertura segue montada embaixo: a frase para.
  const focused = useIsFocused();
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
      <View style={styles.topSpace} />
      <View style={styles.brand}>
        <RiseIn order={ORDER.title} entrance={entrance} style={styles.titleRow}>
          <Text
            variant="displayXl"
            accessibilityRole="header"
            maxFontSizeMultiplier={titleMaxScale}
          >
            {t('auth.welcome.title')}
          </Text>
          <BrandBars
            size="hero"
            lightUp
            lightUpDelay={BARS_LIGHT_UP_DELAY}
            entrance={entrance}
            style={styles.bars}
          />
        </RiseIn>
        <Tagline entrance={entrance} firstOrder={ORDER.taglineFirst} active={focused} />
      </View>
      <View style={styles.middleSpace} />

      {disabled ? (
        <RiseIn order={ORDER.missingConfig} entrance={entrance} style={styles.missingConfig}>
          <Text variant="caption" color={colors.danger} style={styles.centered}>
            {t('auth.missingConfig')}
          </Text>
        </RiseIn>
      ) : null}

      <RiseIn order={ORDER.createAccount} entrance={entrance} style={styles.primary}>
        <Button
          label={t('auth.welcome.createAccount')}
          icon={Mail}
          onPress={() => router.push('/cadastro')}
          disabled={disabled}
        />
      </RiseIn>
      <RiseIn order={ORDER.haveAccount} entrance={entrance} style={styles.secondary}>
        <TextLink
          label={t('auth.welcome.haveAccount')}
          textVariant="buttonAlt"
          onPress={() => router.push('/entrar-com-email')}
          disabled={disabled}
          style={styles.link}
        />
      </RiseIn>
      <RiseIn order={ORDER.terms} entrance={entrance}>
        <TermsNotice variant="continue" />
      </RiseIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O bloco ocupa a altura da tela, com os espaços dividindo a sobra; com o
  // texto a 200%, passa dela e rola, e os espaços fecham.
  content: {
    paddingHorizontal: spacing.gutterAuth,
  },
  topSpace: {
    flexGrow: TOP_SPACE_SHARE,
  },
  // A frase nunca encosta no botão.
  middleSpace: {
    flexGrow: MIDDLE_SPACE_SHARE,
    minHeight: spacing.xxl,
  },
  // O nome e, a 20 dele, a frase.
  brand: {
    gap: spacing.sectionTopTight,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    columnGap: spacing.tileGap,
  },
  bars: {
    marginBottom: BARS_LIFT,
  },
  missingConfig: {
    marginBottom: spacing.md,
  },
  centered: {
    textAlign: 'center',
  },
  primary: {
    marginBottom: spacing.metaGap,
  },
  secondary: {
    marginBottom: spacing.md,
  },
  // O alvo do link é o texto com a folga dos lados, e não a largura da tela.
  link: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
  },
});
