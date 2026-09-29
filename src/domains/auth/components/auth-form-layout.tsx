import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BACK_BUTTON_SLACK } from '@/components/header';
import { Scrim } from '@/components/scrim';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { colors, spacing } from '@/theme';

import { FormHeader, type FormHeaderProps } from './form-header';

export interface AuthFormLayoutProps extends FormHeaderProps {
  title: string;
  lead: string;
  children: ReactNode;
  /** Troca entre entrar e criar conta, preso ao pé da tela. */
  footer: ReactNode;
}

/**
 * Casca dos formulários de conta (entrar com e-mail, cadastro), no visual da
 * 1k: o véu do formulário por cima do fundo compartilhado, que deixa a foto só
 * atrás do topo; voltar, título e texto de apoio; os campos; e o rodapé preso
 * embaixo. Rola com o teclado e com o texto a 200%.
 *
 * O aviso de offline fica no fluxo, embaixo da barra de status, e empurra o
 * formulário: flutuando, ele cobriria o voltar (e, com o texto grande, as
 * etapas e o título) justo quando o envio falha por falta de rede. Ele cobre
 * só o logo do fundo, que é decorativo.
 */
export function AuthFormLayout({
  step,
  locked,
  title,
  lead,
  children,
  footer,
}: AuthFormLayoutProps) {
  const insets = useSafeAreaInsets();
  return (
    <Screen
      transparent
      scroll
      padded={false}
      backdrop={<Scrim preset="authForm" />}
      contentStyle={[
        styles.content,
        {
          // O rodapé é um alvo de 44 com o texto no meio: a proposta põe o pé
          // do texto a 12 da área segura, e o alvo terminaria 2 abaixo dela. O
          // alvo fica inteiro na área segura, e o texto, a 14 dela.
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <FormHeader step={step} locked={locked} />
      <Text variant="titleOnboarding" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" color={colors.textMuted} style={styles.lead}>
        {lead}
      </Text>
      {children}
      <View style={styles.spacer} />
      <View style={styles.footer}>{footer}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.gutterOnboarding,
    // O círculo do voltar fica a 12 da área segura, alinhado ao logo.
    paddingTop: spacing.md - BACK_BUTTON_SLACK,
  },
  lead: {
    marginTop: spacing.md,
    marginBottom: spacing.authLeadGap,
  },
  // Empurra o rodapé para o pé da tela quando sobra altura.
  spacer: {
    flexGrow: 1,
  },
  footer: {
    marginTop: spacing.xl,
  },
});
