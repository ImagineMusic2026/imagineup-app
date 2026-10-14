import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react-native';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { goBack, LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { isFirebaseConfigured } from '@/firebase';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/session';
import { colors, layout, spacing, typography } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { authErrorMessageKey, changePasswordFailure } from '../api';
import { PasswordField } from '../components/password-field';
import { CHANGE_PASSWORD_ERRORS, useChangePassword } from '../hooks/use-change-password';
import { usePasswordReset } from '../hooks/use-password-reset';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, type ChangePasswordForm } from '../schemas';

const FIELD_ORDER = ['current', 'next'] as const;

/**
 * "Trocar senha" (seção 29, frente D, sem desenho, no visual das outras telas
 * de conta), aberta pelos Ajustes. Na pilha raiz, sem tab bar: é um
 * formulário com teclado, como o "Editar perfil". Reautentica com a senha
 * atual antes de trocar; o erro da senha atual e o da nova aparecem no campo
 * de cada uma, e o resto embaixo do botão. Enquanto a troca vai, a tela fica
 * presa. Deu certo, anuncia e volta. O "Esqueci minha senha" manda o link
 * para o e-mail da sessão, como no login.
 */
export function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const email = useSessionStore((state) => state.user?.email ?? null);
  const change = useChangePassword();
  const passwordReset = usePasswordReset();
  const busy = change.isPending;
  useStayOnScreen(busy);
  // Sem rede, nada sai: nem pelo botão, nem pelo "ir" do teclado.
  const disabled = !online || !isFirebaseConfigured;
  const failure = change.isError ? changePasswordFailure(change.error) : null;

  const { control, handleSubmit, formState, setFocus } = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current: '', next: '' },
  });

  const submit = (): void => {
    if (busy || disabled) return;
    passwordReset.reset();
    void handleSubmit(
      (values) => change.mutate(values, { onSuccess: goBack }),
      (errors) => announceFirstError(errors, FIELD_ORDER),
    )();
  };

  // Voltou a digitar depois de um erro de envio: a mensagem e a borda saem.
  const clearSubmitError = (): void => {
    if (change.isError) change.reset();
  };

  const requestPasswordReset = (): void => {
    if (!email) return;
    change.reset();
    passwordReset.mutate(email);
  };

  const fieldError = failure === 'wrongPassword' || failure === 'weakPassword';
  const message = failure && !fieldError ? t(CHANGE_PASSWORD_ERRORS[failure]) : null;

  return (
    <Screen scroll bottomInset={insets.bottom}>
      <LargeTitleHeader title={t('changePassword.title')} showBack backDisabled={busy} />
      <Text variant="bodyLead" color={colors.textBody}>
        {t('changePassword.lead')}
      </Text>
      <View style={styles.fields}>
        <Controller
          control={control}
          name="current"
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
                formState.errors.current?.message ??
                (failure === 'wrongPassword' ? t(CHANGE_PASSWORD_ERRORS.wrongPassword) : undefined)
              }
              autoComplete="current-password"
              textContentType="password"
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => setFocus('next')}
              testID="change-password-current"
            />
          )}
        />
        <Controller
          control={control}
          name="next"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <PasswordField
              ref={ref}
              label={t('changePassword.next')}
              // A regra fica embaixo do campo, como no cadastro: o placeholder
              // some ao digitar e é cortado com o texto grande.
              hint={t('auth.signUp.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              value={value}
              onChangeText={(text) => {
                onChange(text);
                clearSubmitError();
              }}
              onBlur={onBlur}
              error={
                formState.errors.next?.message ??
                (failure === 'weakPassword' ? t(CHANGE_PASSWORD_ERRORS.weakPassword) : undefined)
              }
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={submit}
              testID="change-password-next"
            />
          )}
        />
      </View>

      {email ? (
        <TextLink
          label={t('auth.signIn.forgot')}
          onPress={requestPasswordReset}
          disabled={!isFirebaseConfigured || busy || passwordReset.isPending}
          haptic={null}
          style={styles.forgot}
        />
      ) : null}

      <Button
        label={t('changePassword.submit')}
        icon={KeyRound}
        onPress={submit}
        loading={busy}
        disabled={disabled}
        haptic="confirm"
        // Desligado sem rede: o leitor ouve o motivo no próprio botão, antes do aviso embaixo.
        accessibilityHint={t(online ? 'changePassword.submitHint' : 'changePassword.offline')}
        testID="change-password-submit"
        style={styles.submit}
      />
      {!online ? (
        <Text variant="caption" color={colors.textMuted} style={styles.message}>
          {t('changePassword.offline')}
        </Text>
      ) : null}
      {message ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {message}
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
    </Screen>
  );
}

// O link tem alvo de 44 e o texto no meio: as margens descontam a sobra, como no login.
const LINK_SLACK = (layout.minTouchTarget - typography.label.lineHeight) / 2;

const styles = StyleSheet.create({
  fields: {
    marginTop: spacing.xl,
    gap: spacing.lg,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: spacing.md - LINK_SLACK,
  },
  submit: {
    marginTop: spacing.xl,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
