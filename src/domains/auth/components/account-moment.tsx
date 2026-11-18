import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BrandBars } from '@/components/brand-bars';
import { Scrim } from '@/components/scrim';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { borderWidths, colors, motion, radii, shadows, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import { AuthLogo } from './auth-backdrop';
import { useContentEntrance } from './question-layout';

/** `creating` enquanto a conta e o perfil nascem; `created` quando deu certo. */
export type AccountMomentPhase = 'creating' | 'created';

export interface AccountMomentProps {
  phase: AccountMomentPhase;
}

// O anel fica a 286 do topo no desenho (frame de 844, com a área segura de
// cima em 44): 242 a partir da área segura.
const RING_TOP = 242;
const RING_SIZE = 112;
// O anel não muda de fase: entra uma vez, com o momento.
const RING_KEY = 'ring';

// Pulso lento das barras enquanto a conta nasce: de 1 a .6 e de volta em
// 1,2 s, o mesmo do `Skeleton`.
const PULSE_MIN_OPACITY = 0.6;
const PULSE_HALF_CYCLE = 600;

/** As barras pulsam enquanto `active`; com reduzir movimento, ficam paradas. */
function usePulse(active: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(1);
  const pulsing = active && !reducedMotion;

  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(opacity);
      opacity.set(1);
      return undefined;
    }
    opacity.set(
      withRepeat(
        withTiming(PULSE_MIN_OPACITY, {
          duration: PULSE_HALF_CYCLE,
          easing: motion.easing.inOut,
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [pulsing, opacity]);

  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

/**
 * O momento do cadastro, em tela cheia, no lugar da pergunta da senha: o anel
 * com as barras da marca e uma frase. Enquanto a conta e o perfil nascem
 * ("Criando sua conta"), as barras pulsam devagar e um indicador gira embaixo
 * do título; deu certo ("Conta criada!" e "Agora escolha seus artistas."),
 * elas acendem uma depois da outra, uma vez, e o texto de apoio fica no lugar
 * do indicador. Sem botão: quem leva o fã adiante é o cadastro, que apaga as
 * telas de conta logo depois.
 *
 * O bloco entra em fade, subindo, como uma pergunta, para a troca com ela não
 * ser seca, e o texto entra de novo quando a fase muda; com reduzir movimento,
 * nada disso se mexe, e sobra o indicador da espera, que é do sistema. O
 * "Conta criada" é dito ao leitor de tela aqui, uma vez; o "Criando sua
 * conta" quem diz é o `useSignUp`, quando o envio começa.
 */
export function AccountMoment({ phase }: AccountMomentProps) {
  const created = phase === 'created';
  const ringStyle = useContentEntrance(RING_KEY, { onMount: true });
  const textStyle = useContentEntrance(phase, { onMount: true });
  const pulseStyle = usePulse(!created);

  useEffect(() => {
    if (!created) return;
    AccessibilityInfo.announceForAccessibility(
      `${t('auth.signUp.created.title')} ${t('auth.signUp.created.lead')}`,
    );
  }, [created]);

  return (
    <Screen
      transparent
      padded={false}
      backdrop={
        <>
          <Scrim preset="authQuestion" />
          {/* O véu cobriria o logo do fundo: ele vem de novo, por cima. */}
          <AuthLogo />
        </>
      }
      contentStyle={styles.content}
    >
      {/* O anel a 242 da área segura, como no desenho. Sem altura para tudo (um
          aparelho pequeno com a fonte grande), o vão encolhe e o bloco sobe, em
          vez de o texto passar para baixo da barra do sistema. */}
      <View testID="account-moment-top" style={styles.top} />
      <Animated.View style={[styles.ring, ringStyle]}>
        <Animated.View style={pulseStyle}>
          {/* Com `lightUp`, as barras remontam apagadas e acendem em sequência. */}
          <BrandBars size="moment" lightUp={created} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.texts, textStyle]}>
        <Text variant="titleOnboarding" accessibilityRole="header" style={styles.text}>
          {created ? t('auth.signUp.created.title') : t('auth.signUp.creating')}
        </Text>
        {created ? (
          <Text variant="bodyLead" color={colors.textSecondary} style={styles.text}>
            {t('auth.signUp.created.lead')}
          </Text>
        ) : (
          // A espera pode passar de 20 s (o perfil e o convite), e com reduzir
          // movimento as barras ficam paradas: sem um sinal de andamento, a
          // tela pareceria travada. O indicador é o do sistema e não passa
          // pelo `usePrefersReducedMotion`: com reduzir movimento ele segue
          // na tela, e quem o gira é o aparelho. Fora do leitor de tela, que
          // já ouviu o "Criando sua conta" e tem o título em cima.
          <ActivityIndicator
            color={colors.accent}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        )}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    paddingHorizontal: spacing.gutterOnboarding,
  },
  top: {
    height: RING_TOP,
    minHeight: spacing.xl,
    flexShrink: 1,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    borderColor: withAlpha(colors.accent, tints.soft.border),
    backgroundColor: withAlpha(colors.accent, tints.soft.fill),
    ...shadows.glowAccentLarge,
  },
  // O título a 30 do anel e o texto a 12 do título.
  texts: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.blockGap + spacing.md,
  },
  text: {
    textAlign: 'center',
  },
});
