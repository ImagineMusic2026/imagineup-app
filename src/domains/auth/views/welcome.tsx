import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandBars, brandBarsWidth } from '@/components/brand-bars';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { isFirebaseConfigured } from '@/firebase';
import { t, type TranslationKey } from '@/i18n';
import { usePreferencesStore } from '@/stores/preferences';
import type { SignInMethod } from '@/stores/session';
import { colors, motion, spacing } from '@/theme';

import { AppleButton } from '../components/apple-button';
import { AUTH_LOGO_BOTTOM } from '../components/auth-backdrop';
import { GoogleButton } from '../components/google-button';
import { RiseIn } from '../components/rise-in';
import { TermsNotice } from '../components/terms-notice';
import { useAuthEntrance } from '../hooks/use-auth-entrance';
import {
  useSocialProviders,
  useSocialSignIn,
  type SocialSignInOutcome,
} from '../hooks/use-social-sign-in';
import { socialErrorMessageKey, type SocialMethod } from '../social';

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

/** Os blocos da 1k que entram depois do título e do texto, na ordem da tela. */
type EntryBlock = 'lastMethod' | 'apple' | 'google' | 'createAccount' | 'haveAccount' | 'terms';

const LAST_METHOD: Record<SignInMethod, TranslationKey> = {
  apple: 'auth.welcome.lastMethod.apple',
  google: 'auth.welcome.lastMethod.google',
  password: 'auth.welcome.lastMethod.password',
};

/** Depois da folha do provedor: o passo do convite ou o modo "ligar" (o resto, o guard troca). */
function afterSocialSignIn(outcome: SocialSignInOutcome): void {
  if (outcome.status === 'askInvite') router.push('/codigo-de-convite');
  else if (outcome.status === 'link') router.push('/entrar-com-email');
}

/**
 * 1k, abertura (seção 33 de docs/arquitetura-api.md, decisões 9 e 15). Os
 * botões, de cima para baixo: "Continuar com a Apple" (o nativo, branco, só
 * no iOS com o módulo), "Continuar com o Google" (o tema claro do Google, só
 * com o Google ligado), "Criar conta com e-mail" (rosa, aprovado em
 * 2026-09-29) e "Entrar com e-mail" (vidro). Acima deles, o jeito da última
 * entrada neste aparelho, só quando o botão dele aparece. Enquanto uma entrada
 * pelo provedor vai, o botão tocado fica carregando e os outros, desligados; o
 * erro fica embaixo dos botões (o hook anuncia, com o toque de erro). A conta
 * nova sem convite de link segue para o passo "Tem um código de convite?", e
 * o Google que esbarra numa conta de senha, para entrar com e-mail no modo
 * "ligar". A foto, o véu, as listras e o logo são do fundo compartilhado do
 * grupo `(auth)`, que fica parado quando o fã vai para os formulários.
 *
 * Na entrada, título, texto, a linha da última entrada, botões e termos sobem
 * 12 pt e aparecem um depois do outro (60 ms entre eles, `RiseIn`), e as
 * barras da marca acendem uma depois da outra, tudo a partir do fade da pilha
 * `(auth)` (`useAuthEntrance`), junto com a foto assentando no fundo. A Apple
 * aparece quando o sistema responde, na vez dela. Com reduzir movimento, nada
 * se mexe.
 */
export function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const entrance = useAuthEntrance();
  const { width: windowWidth } = useWindowDimensions();
  const providers = useSocialProviders();
  const social = useSocialSignIn();
  const lastMethod = usePreferencesStore((state) => state.lastSignInMethod);
  const disabled = !isFirebaseConfigured;
  const busy = social.isPending;
  const loadingMethod: SocialMethod | null = busy ? (social.variables ?? null) : null;
  // A linha da última entrada só aponta para um botão que está na tela.
  const lastMethodShown =
    lastMethod === 'password' ||
    (lastMethod === 'apple' && providers.apple) ||
    (lastMethod === 'google' && providers.google);
  // A ordem de cada bloco na entrada, depois do título e do texto, contando só
  // os que aparecem.
  const blocks: EntryBlock[] = [
    ...(lastMethod && lastMethodShown ? (['lastMethod'] as const) : []),
    ...(providers.apple ? (['apple'] as const) : []),
    ...(providers.google ? (['google'] as const) : []),
    'createAccount',
    'haveAccount',
    'terms',
  ];
  const orderOf = (block: EntryBlock): number => 2 + blocks.indexOf(block);

  const signInWith = (method: SocialMethod): void => {
    if (busy) return;
    social.mutate(method, { onSuccess: afterSocialSignIn });
  };

  const openForm = (href: '/cadastro' | '/entrar-com-email'): void => {
    // O erro da entrada pelo provedor não fica esperando a volta.
    social.reset();
    router.push(href);
  };

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
      <RiseIn order={0} entrance={entrance} style={styles.titleRow}>
        <Text variant="displayXl" accessibilityRole="header" maxFontSizeMultiplier={titleMaxScale}>
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
      <RiseIn order={1} entrance={entrance} style={styles.lead}>
        <Text variant="bodyLead" color={colors.textSecondary}>
          {t('auth.welcome.lead')}
        </Text>
      </RiseIn>

      {disabled ? (
        <RiseIn order={1} entrance={entrance} style={styles.missingConfig}>
          <Text variant="caption" color={colors.danger}>
            {t('auth.missingConfig')}
          </Text>
        </RiseIn>
      ) : null}

      {lastMethod && lastMethodShown ? (
        <RiseIn order={orderOf('lastMethod')} entrance={entrance} style={styles.lastMethod}>
          <Text variant="body" color={colors.textSecondary}>
            {t(LAST_METHOD[lastMethod])}
          </Text>
        </RiseIn>
      ) : null}

      {providers.apple ? (
        <RiseIn order={orderOf('apple')} entrance={entrance} style={styles.button}>
          <AppleButton
            onPress={() => signInWith('apple')}
            loading={loadingMethod === 'apple'}
            disabled={disabled || (busy && loadingMethod !== 'apple')}
          />
        </RiseIn>
      ) : null}
      {providers.google ? (
        <RiseIn order={orderOf('google')} entrance={entrance} style={styles.button}>
          <GoogleButton
            onPress={() => signInWith('google')}
            loading={loadingMethod === 'google'}
            disabled={disabled || (busy && loadingMethod !== 'google')}
          />
        </RiseIn>
      ) : null}
      <RiseIn order={orderOf('createAccount')} entrance={entrance} style={styles.button}>
        <Button
          label={t('auth.welcome.createAccount')}
          icon={Mail}
          onPress={() => openForm('/cadastro')}
          disabled={disabled || busy}
        />
      </RiseIn>
      <RiseIn order={orderOf('haveAccount')} entrance={entrance} style={styles.lastButton}>
        <Button
          label={t('auth.welcome.haveAccount')}
          variant="glass"
          onPress={() => openForm('/entrar-com-email')}
          disabled={disabled || busy}
        />
      </RiseIn>
      {social.isError ? (
        <Text variant="caption" color={colors.danger} style={styles.error}>
          {t(socialErrorMessageKey(social.error))}
        </Text>
      ) : null}
      <RiseIn order={orderOf('terms')} entrance={entrance}>
        <TermsNotice variant="continue" />
      </RiseIn>
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
  // A linha da última entrada fica mais perto dos botões que do texto de apoio.
  lastMethod: {
    marginBottom: spacing.md,
  },
  button: {
    marginBottom: spacing.listGap,
  },
  lastButton: {
    marginBottom: spacing.blockGap,
  },
  // Embaixo dos botões, antes dos termos.
  error: {
    marginTop: spacing.md - spacing.blockGap,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
});
