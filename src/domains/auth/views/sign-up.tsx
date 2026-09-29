import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { isFirebaseConfigured } from '@/firebase';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { authErrorMessageKey } from '../api';
import { AuthFormLayout } from '../components/auth-form-layout';
import { FormFooter } from '../components/form-footer';
import { PasswordField } from '../components/password-field';
import { TermsNotice } from '../components/terms-notice';
import { ENTRY_STEP_COUNT } from '../consts';
import { handOffEmail } from '../email-handoff';
import { useSignUp } from '../hooks/use-sign-up';
import { useStayOnScreen } from '../hooks/use-stay-on-screen';
import { PASSWORD_MIN_LENGTH, signUpSchema, type SignUpFormInput } from '../schemas';

const FIELD_ORDER = ['name', 'email', 'password'] as const;

const goToSignIn = () => router.replace('/entrar-com-email');

/**
 * Cadastro (sem desenho no protótipo), no visual da 1k: etapa 1 de 2, antes da
 * escolha de artistas. Enquanto a conta e o perfil nascem, o fã fica seguro
 * nesta tela (`holdAuth`), sem voltar nem trocar de tela; quando o perfil
 * existe, o guard troca para a 1l.
 */
export function SignUpScreen() {
  const signUp = useSignUp();
  const { control, handleSubmit, formState, setFocus } = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' } satisfies SignUpFormInput,
  });
  const disabled = !isFirebaseConfigured;
  const errorKey = signUp.isError ? authErrorMessageKey(signUp.error, 'signUp') : null;
  const emailInUse = errorKey === 'auth.errors.emailInUse';
  const pending = signUp.isPending;

  useStayOnScreen(pending);

  const submit = handleSubmit(
    (values) => {
      // O "ir" do teclado não passa pelo botão desativado: um cadastro por vez.
      if (signUp.isPending) return;
      signUp.mutate(values);
    },
    (errors) => announceFirstError(errors, FIELD_ORDER),
  );

  // Voltou a digitar depois de um erro de envio: a mensagem e a borda saem.
  const clearSubmitError = (): void => {
    if (signUp.isError) signUp.reset();
  };

  // O e-mail que já tem conta vai junto, já normalizado, para o entrar.
  const signInWithThisEmail = (): void => {
    if (signUp.variables) handOffEmail(signUp.variables.email);
    goToSignIn();
  };

  return (
    <AuthFormLayout
      step={{ current: 1, total: ENTRY_STEP_COUNT }}
      locked={pending}
      title={t('auth.signUp.title')}
      lead={t('auth.signUp.lead')}
      footer={
        <FormFooter
          question={t('auth.signUp.haveAccount')}
          actionLabel={t('auth.signUp.signIn')}
          onAction={goToSignIn}
          disabled={pending}
        />
      }
    >
      <View style={styles.fields}>
        <Controller
          control={control}
          name="name"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              variant="glass"
              label={t('auth.signUp.name')}
              hint={t('auth.signUp.nameHint')}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
              }}
              onBlur={onBlur}
              error={formState.errors.name?.message}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => setFocus('email')}
            />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              variant="glass"
              label={t('auth.email')}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
              }}
              onBlur={onBlur}
              error={formState.errors.email?.message}
              invalid={emailInUse}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              // "username" pareia e-mail e senha nova no preenchimento automático do iOS.
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
              // A regra fica embaixo do campo, e não no placeholder, que some ao
              // digitar e é cortado com o texto grande; o leitor a ouve com o erro.
              hint={t('auth.signUp.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
              }}
              onBlur={onBlur}
              error={formState.errors.password?.message}
              autoComplete="new-password"
              // O iOS sugere uma senha forte.
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          )}
        />
      </View>

      <Button
        label={t('auth.signUp.submit')}
        onPress={submit}
        loading={pending}
        disabled={disabled}
        haptic={null}
        style={styles.submit}
      />

      {disabled ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t('auth.missingConfig')}
        </Text>
      ) : null}
      {errorKey ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t(errorKey)}
        </Text>
      ) : null}
      {/* E-mail que já tem conta: o atalho para entrar fica logo abaixo do erro. */}
      {emailInUse ? (
        <TextLink
          label={t('auth.signUp.signIn')}
          accessibilityLabel={t('auth.signUp.signInWithEmail')}
          onPress={signInWithThisEmail}
          style={styles.errorAction}
        />
      ) : null}

      <TermsNotice variant="signUp" style={styles.terms} />
    </AuthFormLayout>
  );
}

const styles = StyleSheet.create({
  fields: {
    gap: spacing.lg,
  },
  submit: {
    marginTop: spacing.authLeadGap,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  errorAction: {
    alignSelf: 'center',
  },
  terms: {
    marginTop: spacing.cardPadding,
  },
});
