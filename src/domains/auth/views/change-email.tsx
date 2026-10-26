import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react-native';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { goBack, LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { isFirebaseConfigured } from '@/firebase';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { changeEmailFailure, type ChangeEmailFailure } from '../api';
import { PasswordField } from '../components/password-field';
import { CHANGE_EMAIL_ERRORS, useChangeEmail } from '../hooks/use-change-email';
import { changeEmailSchema, type ChangeEmailForm } from '../schemas';

const FIELD_ORDER = ['email', 'password'] as const;

/** As falhas que aparecem no campo do e-mail novo; a da senha, no dela; o resto, embaixo do botão. */
const EMAIL_FIELD_FAILURES: readonly ChangeEmailFailure[] = ['emailInUse', 'invalidEmail'];

/**
 * "Trocar e-mail" (seção 29, frente D), no molde do "Trocar senha": o e-mail
 * novo e a senha atual, para reautenticar. Nada muda até o fã abrir o link no
 * e-mail novo; então o Firebase revoga as sessões, e este aparelho sai quando
 * o SDK renova o token, em até 1 hora. Até lá, a sessão segue com o e-mail
 * de agora. Mandado o link, a tela troca o formulário pelo aviso de
 * "enviado", com "Voltar aos ajustes".
 */
export function ChangeEmailScreen() {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const currentEmail = useSessionStore((state) => state.user?.email ?? null);
  const change = useChangeEmail();
  const busy = change.isPending;
  useStayOnScreen(busy);
  const disabled = !online || !isFirebaseConfigured;
  const failure = change.isError ? changeEmailFailure(change.error) : null;
  const schema = useMemo(() => changeEmailSchema(currentEmail), [currentEmail]);

  const { control, handleSubmit, formState, setFocus } = useForm<ChangeEmailForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const submit = (): void => {
    if (busy || disabled) return;
    void handleSubmit(
      (values) => change.mutate(values),
      (errors) => announceFirstError(errors, FIELD_ORDER),
    )();
  };

  const clearSubmitError = (): void => {
    if (change.isError) change.reset();
  };

  const emailFailure = failure && EMAIL_FIELD_FAILURES.includes(failure) ? failure : null;
  const message =
    failure && failure !== 'wrongPassword' && !emailFailure
      ? t(CHANGE_EMAIL_ERRORS[failure])
      : null;
  const sentTo = change.isSuccess ? change.variables.email : null;

  return (
    <Screen scroll bottomInset={insets.bottom}>
      <LargeTitleHeader title={t('changeEmail.title')} showBack backDisabled={busy} />
      {sentTo ? (
        <View style={styles.sent} testID="change-email-sent">
          <Text variant="bodyLead" color={colors.text}>
            {t('changeEmail.sent', { email: sentTo })}
          </Text>
          <Text variant="body" color={colors.textBody}>
            {t('changeEmail.sentNotice')}
          </Text>
          <Button
            label={t('changeEmail.backToSettings')}
            variant="secondary"
            onPress={goBack}
            style={styles.submit}
          />
        </View>
      ) : (
        <>
          <Text variant="bodyLead" color={colors.textBody}>
            {currentEmail
              ? `${t('changeEmail.current', { email: currentEmail })} ${t('changeEmail.lead')}`
              : t('changeEmail.lead')}
          </Text>
          <View style={styles.fields}>
            <Controller
              control={control}
              name="email"
              render={({ field: { ref, onChange, onBlur, value } }) => (
                <TextInput
                  ref={ref}
                  variant="glass"
                  label={t('changeEmail.email')}
                  value={value}
                  onChangeText={(text) => {
                    onChange(text);
                    clearSubmitError();
                  }}
                  onBlur={onBlur}
                  error={
                    formState.errors.email?.message ??
                    (emailFailure ? t(CHANGE_EMAIL_ERRORS[emailFailure]) : undefined)
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!busy}
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
                  label={t('changePassword.current')}
                  value={value}
                  onChangeText={(text) => {
                    onChange(text);
                    clearSubmitError();
                  }}
                  onBlur={onBlur}
                  error={
                    formState.errors.password?.message ??
                    (failure === 'wrongPassword' ? t(CHANGE_EMAIL_ERRORS.wrongPassword) : undefined)
                  }
                  autoComplete="current-password"
                  textContentType="password"
                  editable={!busy}
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
              )}
            />
          </View>
          <Button
            label={t('changeEmail.submit')}
            icon={Mail}
            onPress={submit}
            loading={busy}
            disabled={disabled}
            haptic="confirm"
            accessibilityHint={t(online ? 'changeEmail.submitHint' : 'changeEmail.offline')}
            testID="change-email-submit"
            style={styles.submit}
          />
          {!online ? (
            <Text variant="caption" color={colors.textMuted} style={styles.message}>
              {t('changeEmail.offline')}
            </Text>
          ) : null}
          {message ? (
            <Text variant="caption" color={colors.danger} style={styles.message}>
              {message}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: {
    marginTop: spacing.xl,
    gap: spacing.lg,
  },
  sent: {
    gap: spacing.md,
  },
  submit: {
    marginTop: spacing.xl,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
