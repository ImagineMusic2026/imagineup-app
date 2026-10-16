import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { isFirebaseConfigured } from '@/firebase';
import { t } from '@/i18n';
import { colors, layout, spacing, typography } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { authErrorMessageKey } from '../api';
import { AuthFormLayout } from '../components/auth-form-layout';
import { FormFooter } from '../components/form-footer';
import { PasswordField } from '../components/password-field';
import { clearHandedOffEmail, readHandedOffEmail } from '../email-handoff';
import { usePasswordReset } from '../hooks/use-password-reset';
import { useSignIn } from '../hooks/use-sign-in';
import { resetEmailSchema, signInSchema, type SignInForm } from '../schemas';
import { forgetPendingGoogleLink, pendingGoogleLinkEmail } from '../social';

const FIELD_ORDER = ['email', 'password'] as const;

/**
 * Entrar com e-mail (sem desenho no protótipo), no visual da 1k. Quem entra não
 * navega: o guard troca a pilha quando a sessão muda.
 *
 * No modo "ligar" (seção 33, decisão 8), o Google da 1k esbarrou numa conta de
 * senha com o mesmo e-mail: o e-mail vem preenchido, o texto de apoio diz que
 * o Google passa a entrar nesta conta depois da senha (e que a conta sem senha
 * passa pelo "Esqueci minha senha"), e a entrada liga o Google
 * (`useSignIn`). Sair da tela sem entrar esquece a credencial do Google.
 */
export function SignInScreen() {
  const signIn = useSignIn();
  const passwordReset = usePasswordReset();
  // O e-mail da conta Google do modo "ligar", lido uma vez, na abertura.
  const [linkEmail] = useState(pendingGoogleLinkEmail);
  // Vindo do cadastro com um e-mail que já tem conta, ele chega preenchido.
  const [handedOffEmail] = useState(readHandedOffEmail);
  const presetEmail = linkEmail ?? handedOffEmail;
  const { control, handleSubmit, formState, setFocus, setError, clearErrors, getValues } =
    useForm<SignInForm>({
      resolver: zodResolver(signInSchema),
      defaultValues: { email: presetEmail ?? '', password: '' },
    });
  const disabled = !isFirebaseConfigured;
  // Credencial recusada: a senha ganha a borda de erro, como na proposta C.
  const rejected =
    signIn.isError && authErrorMessageKey(signIn.error) === 'auth.errors.invalidCredentials';

  useEffect(() => clearHandedOffEmail(), []);

  // A ligação do Google só vale nesta tela: entrou, o `useSignIn` já a usou
  // (e esquecer não faz nada); saiu sem entrar, ela vai embora.
  useEffect(() => forgetPendingGoogleLink, []);

  const submit = handleSubmit(
    (values) => {
      // O "ir" do teclado não passa pelo botão desativado: um envio por vez.
      if (signIn.isPending) return;
      passwordReset.reset();
      signIn.mutate(values);
    },
    (errors) => announceFirstError(errors, FIELD_ORDER),
  );

  // Voltou a digitar depois de um erro de envio: a mensagem e a borda saem.
  const clearSubmitError = (): void => {
    if (signIn.isError) signIn.reset();
  };

  // "Esqueci minha senha" usa o e-mail digitado; sem ele, o foco volta ao campo.
  const requestPasswordReset = (): void => {
    signIn.reset();
    const email = resetEmailSchema.safeParse(getValues('email'));
    if (!email.success) {
      setError(
        'email',
        { type: 'manual', message: t('auth.signIn.forgotNeedsEmail') },
        { shouldFocus: true },
      );
      AccessibilityInfo.announceForAccessibility(t('auth.signIn.forgotNeedsEmail'));
      return;
    }
    clearErrors('email');
    passwordReset.mutate(email.data);
  };

  return (
    <AuthFormLayout
      title={t('auth.signIn.title')}
      lead={
        linkEmail ? `${t('auth.link.lead')} ${t('auth.link.noPassword')}` : t('auth.signIn.lead')
      }
      footer={
        <FormFooter
          question={t('auth.signIn.noAccount')}
          actionLabel={t('auth.signIn.createAccount')}
          onAction={() => router.replace('/cadastro')}
        />
      }
    >
      <View style={styles.fields}>
        <Controller
          control={control}
          name="email"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              // O ref deixa o envio inválido levar o foco ao campo com erro.
              ref={ref}
              variant="glass"
              label={t('auth.email')}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
                // O aviso do "Esqueci minha senha" some quando o fã volta a digitar.
                if (formState.errors.email?.type === 'manual') clearErrors('email');
              }}
              onBlur={onBlur}
              error={formState.errors.email?.message}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              // "username" pareia e-mail e senha no preenchimento automático do iOS.
              textContentType="username"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => setFocus('password')}
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <PasswordField
              ref={ref}
              label={t('auth.password')}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
              }}
              onBlur={onBlur}
              error={formState.errors.password?.message}
              invalid={rejected}
              autoComplete="current-password"
              textContentType="password"
              // Com o e-mail já preenchido, o próximo passo é a senha.
              autoFocus={!!presetEmail}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          )}
        />
      </View>

      <TextLink
        label={t('auth.signIn.forgot')}
        onPress={requestPasswordReset}
        disabled={disabled || passwordReset.isPending}
        haptic={null}
        style={styles.forgot}
      />

      <Button
        label={t('auth.signIn.submit')}
        onPress={submit}
        loading={signIn.isPending}
        disabled={disabled}
        haptic={null}
        style={styles.submit}
      />

      {disabled ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t('auth.missingConfig')}
        </Text>
      ) : null}
      {signIn.isError ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t(authErrorMessageKey(signIn.error))}
        </Text>
      ) : null}
      {passwordReset.isError ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t(authErrorMessageKey(passwordReset.error, 'passwordReset'))}
        </Text>
      ) : null}
      {passwordReset.isSuccess ? (
        <Text variant="caption" color={colors.textSecondary} style={styles.message}>
          {t('auth.signIn.resetSent')}
        </Text>
      ) : null}
    </AuthFormLayout>
  );
}

// O link tem alvo de 44 e o texto no meio: as margens descontam a sobra, para
// o desenho ficar a 12 do campo e o botão a 22 do link, como na proposta.
const LINK_SLACK = (layout.minTouchTarget - typography.label.lineHeight) / 2;

const styles = StyleSheet.create({
  fields: {
    gap: spacing.lg,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: spacing.md - LINK_SLACK,
  },
  submit: {
    marginTop: spacing.gutterOnboarding - LINK_SLACK,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
