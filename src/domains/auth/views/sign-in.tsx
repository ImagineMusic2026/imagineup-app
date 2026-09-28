import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { t } from '@/i18n';
import { isFirebaseConfigured } from '@/firebase';
import { colors, spacing } from '@/theme';

import { authErrorMessageKey } from '../api';
import { useSignIn } from '../hooks/use-sign-in';
import { signInSchema, type SignInForm } from '../schemas';

/** 1k. Por enquanto, e-mail e senha; o visual final segue o protótipo. */
export function SignInScreen() {
  const signIn = useSignIn();
  const { control, handleSubmit, formState, setFocus } = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit((values) => signIn.mutate(values));

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.hero}>
        <Text variant="displayXl" accessibilityRole="header">
          {t('auth.title')}
        </Text>
        <Text variant="bodyLead" color={colors.textSecondary}>
          {t('auth.lead')}
        </Text>
      </View>

      {!isFirebaseConfigured ? (
        <Text variant="caption" color={colors.danger}>
          {t('auth.missingConfig')}
        </Text>
      ) : null}

      <View style={styles.form}>
        <Controller
          control={control}
          name="email"
          render={({ field: { ref, onChange, onBlur, value } }) => (
            <TextInput
              // O ref deixa o envio inválido levar o foco ao campo com erro.
              ref={ref}
              label={t('auth.email')}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={formState.errors.email?.message}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
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
            <TextInput
              ref={ref}
              label={t('auth.password')}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={formState.errors.password?.message}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          )}
        />
        {signIn.isError ? (
          <Text variant="caption" color={colors.danger}>
            {t(authErrorMessageKey(signIn.error))}
          </Text>
        ) : null}
        <Button
          label={t('auth.submit')}
          onPress={submit}
          loading={signIn.isPending}
          disabled={!isFirebaseConfigured}
          haptic={null}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.gutterAuth,
  },
  hero: {
    gap: spacing.md,
  },
  form: {
    gap: spacing.lg,
  },
});
