import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { readPendingInvite, subscribePendingInvite } from '@/domains/invites';
import { isFirebaseConfigured } from '@/firebase';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { authErrorMessageKey, type InviteRejection } from '../api';
import { AuthFormLayout } from '../components/auth-form-layout';
import { FormFooter } from '../components/form-footer';
import { PasswordField } from '../components/password-field';
import { TermsNotice } from '../components/terms-notice';
import { ENTRY_STEP_COUNT } from '../consts';
import { handOffEmail } from '../email-handoff';
import {
  releaseHeldSignUp,
  useFinishSignUp,
  useSignUp,
  type SignUpOutcome,
} from '../hooks/use-sign-up';
import { PASSWORD_MIN_LENGTH, signUpSchema, type SignUpFormInput } from '../schemas';

const FIELD_ORDER = ['name', 'email', 'password', 'inviteCode'] as const;

const REJECTION_MESSAGES: Record<InviteRejection, TranslationKey> = {
  notFound: 'auth.signUp.inviteRejected.notFound',
  notAllowed: 'auth.signUp.inviteRejected.notAllowed',
};

const goToSignIn = () => router.replace('/entrar-com-email');

/**
 * Cadastro (sem desenho no protótipo), no visual da 1k: etapa 1 de 2, antes da
 * escolha de artistas. Enquanto a conta e o perfil nascem, o fã fica seguro
 * nesta tela (`holdAuth`), sem voltar nem trocar de tela; quando o perfil
 * existe, o guard troca para a 1l.
 *
 * "Código de convite (opcional)" é o plano B do iOS, que não divide o
 * armazenamento do navegador com o app: vem preenchido com o código do link
 * guardado, e o código digitado é conferido no servidor antes de o fã sair.
 * Recusado (não existe ou não vale), a conta já existe: a tela entra no
 * estágio "código recusado", com nome, e-mail e senha travados, para o fã
 * corrigir o código ou continuar sem ele.
 */
export function SignUpScreen() {
  const signUp = useSignUp();
  const finish = useFinishSignUp();
  // Uma recusa nova a cada vez (o número muda): a mesma recusa duas vezes avisa de novo.
  const [rejection, setRejection] = useState<{ reason: InviteRejection; seq: number } | null>(null);
  const {
    control,
    handleSubmit,
    formState,
    setFocus,
    setError,
    clearErrors,
    setValue,
    getFieldState,
  } = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      inviteCode: '',
    } satisfies SignUpFormInput,
  });
  const disabled = !isFirebaseConfigured;
  const errorKey = signUp.isError ? authErrorMessageKey(signUp.error, 'signUp') : null;
  const emailInUse = errorKey === 'auth.errors.emailInUse';
  const stage = rejection !== null;
  const pending = signUp.isPending || finish.isPending;

  useStayOnScreen(pending || stage);

  // A tela que some no estágio "código recusado" sem passar pelos botões (um
  // link aberto por fora, por exemplo) solta o fã: a trava não fica sem tela.
  useEffect(() => releaseHeldSignUp, []);

  // O código do link guardado vai para o campo se o fã ainda não mexeu nele.
  // No estágio "código recusado", o link que chega agora (o fã pediu o código
  // certo a quem o convidou) entra no lugar do código recusado.
  const fillFromLink = useEffectEvent((code: string) => {
    if (stage) {
      setValue('inviteCode', code, { shouldDirty: true });
      clearErrors('inviteCode');
    } else if (!getFieldState('inviteCode').isDirty) {
      setValue('inviteCode', code);
    }
  });

  useEffect(() => {
    let active = true;
    const fill = () => {
      readPendingInvite()
        .then((invite) => {
          if (active && invite) fillFromLink(invite.code);
        })
        .catch(() => undefined);
    };
    fill();
    const unsubscribe = subscribePendingInvite(fill);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // O código recusado: o erro no campo, o foco nele e o aviso para o leitor de tela.
  useEffect(() => {
    if (!rejection) return;
    const message = t(REJECTION_MESSAGES[rejection.reason]);
    setError('inviteCode', { type: 'server', message });
    setFocus('inviteCode');
    AccessibilityInfo.announceForAccessibility(message);
  }, [rejection, setError, setFocus]);

  const afterOutcome = (outcome: SignUpOutcome): void => {
    if (outcome.status !== 'inviteRejected') return;
    haptics.trigger('error');
    setRejection((current) => ({ reason: outcome.reason, seq: (current?.seq ?? 0) + 1 }));
  };

  const submit = handleSubmit(
    (values) => {
      // O "ir" do teclado não passa pelo botão desativado: um envio por vez.
      if (pending) return;
      if (stage) finish.mutate({ inviteCode: values.inviteCode }, { onSuccess: afterOutcome });
      else signUp.mutate(values, { onSuccess: afterOutcome });
    },
    (errors) => announceFirstError(errors, FIELD_ORDER),
  );

  const skipInvite = (): void => {
    if (pending) return;
    finish.mutate({ inviteCode: '' }, { onSuccess: afterOutcome });
  };

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
      locked={pending || stage}
      title={t('auth.signUp.title')}
      lead={stage ? t('auth.signUp.inviteRejected.lead') : t('auth.signUp.lead')}
      footer={
        stage ? null : (
          <FormFooter
            question={t('auth.signUp.haveAccount')}
            actionLabel={t('auth.signUp.signIn')}
            onAction={goToSignIn}
            disabled={pending}
          />
        )
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
              editable={!stage}
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
              editable={!stage}
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
              editable={!stage}
              autoComplete="new-password"
              // O iOS sugere uma senha forte.
              textContentType="newPassword"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => setFocus('inviteCode')}
            />
          )}
        />
        <Controller
          control={control}
          name="inviteCode"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              ref={ref}
              variant="glass"
              label={t('auth.signUp.inviteCode')}
              hint={t('auth.signUp.inviteCodeHint')}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
              }}
              onBlur={onBlur}
              error={formState.errors.inviteCode?.message}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              returnKeyType="go"
              onSubmitEditing={submit}
              testID="sign-up-invite-code"
            />
          )}
        />
      </View>

      <Button
        label={stage ? t('auth.signUp.continue') : t('auth.signUp.submit')}
        onPress={submit}
        loading={stage ? finish.isPending : signUp.isPending}
        disabled={disabled}
        haptic={null}
        style={styles.submit}
      />
      {/* Irmão do botão, nunca dentro dele: segue para a 1l sem o convite. */}
      {stage ? (
        <TextLink
          label={t('auth.signUp.skipInvite')}
          onPress={skipInvite}
          disabled={pending}
          style={styles.skip}
        />
      ) : null}

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
  skip: {
    alignSelf: 'center',
    marginTop: spacing.sm,
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
