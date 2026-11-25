import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { CircleUser, Gift, Trash2, Trophy, Users, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { LargeTitleHeader } from '@/components/header';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { isFirebaseConfigured } from '@/firebase';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { colors, motion, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { deleteAccountFailure } from '../api';
import { PasswordField } from '../components/password-field';
import { useAppleDeletionMode } from '../hooks/use-apple-deletion-mode';
import { DELETE_ACCOUNT_ERRORS, useDeleteAccount } from '../hooks/use-delete-account';
import { reauthSchema, type ReauthForm } from '../schemas';

const LOSS_ICON_SIZE = 18;

/** O que vai embora com a conta, na ordem em que o fã vê no app. */
const LOSSES: readonly { key: TranslationKey; icon: LucideIcon }[] = [
  { key: 'deleteAccount.losses.profile', icon: CircleUser },
  { key: 'deleteAccount.losses.points', icon: Trophy },
  { key: 'deleteAccount.losses.ranking', icon: Users },
  { key: 'deleteAccount.losses.rewards', icon: Gift },
];

const FIELD_ORDER = ['password'] as const;

function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/perfil');
}

/**
 * Excluir conta (sem desenho, no visual das outras telas), aberta pela última
 * linha do "Editar perfil", na pilha raiz, por cima dele e sem a tab bar
 * (desde 26/10/2026; antes, pela zona de perigo dos Ajustes, na pilha do
 * Perfil). A própria tela é a confirmação: diz o que se perde e só então
 * oferece o botão. Se o Firebase pedir o login recente, aparece o campo de
 * senha ou a confirmação do Google para reautenticar a conta antes de excluir.
 * No iPhone, a sessão da Apple confirma pela folha da Apple ("Confirmar com a
 * Apple e excluir"), e a conta de senha com a Apple ligada avisa que a Apple
 * pode pedir uma confirmação depois da senha (39.4). Sem rede, o botão fica
 * desligado; erro de rede deixa a conta como estava. Deu certo, quem troca a
 * tela é o guard (a sessão termina), e o perfil e o @ somem no servidor.
 */
export function DeleteAccountScreen() {
  // Fora das abas, a tela soma a área segura de baixo (a tab bar não está).
  const bottomInset = useSafeAreaInsets().bottom;
  const online = useIsOnline();
  const deletion = useDeleteAccount();
  const appleMode = useAppleDeletionMode();
  const needsApple = appleMode === 'apple';
  const failure = deletion.isError ? deleteAccountFailure(deletion.error) : null;
  const [confirmation, setConfirmation] = useState<'password' | 'google' | null>(null);
  const requested =
    failure === 'needsPassword' ? 'password' : failure === 'needsGoogle' ? 'google' : null;
  if (requested && confirmation !== requested) setConfirmation(requested);
  const needsPassword = confirmation === 'password';
  const needsGoogle = confirmation === 'google';
  // Depois de dar certo, o botão segue ocupado até o guard trocar a tela.
  const busy = deletion.isPending || deletion.data === 'deleted';
  useStayOnScreen(busy);
  // Sem rede, nada sai: nem pelo botão, nem pelo "ir" do teclado.
  const disabled = !online || !isFirebaseConfigured;

  const { control, handleSubmit, formState } = useForm<ReauthForm>({
    resolver: zodResolver(reauthSchema),
    defaultValues: { password: '' },
  });

  const submit = (): void => {
    // O "ir" do teclado não passa pelo botão ocupado ou desligado: um pedido
    // por vez, e só com rede.
    if (busy || disabled) return;
    if (needsGoogle) {
      deletion.mutate({ confirmGoogle: true });
      return;
    }
    if (!needsPassword) {
      deletion.mutate({});
      return;
    }
    void handleSubmit(
      ({ password }) => deletion.mutate({ password }),
      (errors) => announceFirstError(errors, FIELD_ORDER),
    )();
  };

  const wrongPassword = failure === 'wrongPassword';
  const message =
    failure &&
    failure !== 'needsPassword' &&
    failure !== 'needsGoogle' &&
    failure !== 'wrongPassword'
      ? t(DELETE_ACCOUNT_ERRORS[failure])
      : null;

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader
        title={t('deleteAccount.title')}
        showBack
        onBack={goBack}
        backDisabled={busy}
      />
      <Text variant="bodyLead" color={colors.textBody}>
        {t('deleteAccount.lead')}
      </Text>
      <Card style={styles.losses}>
        {LOSSES.map(({ key, icon }) => (
          <View key={key} style={styles.loss}>
            <Icon icon={icon} size={LOSS_ICON_SIZE} color={colors.textSecondary} />
            <Text variant="body" color={colors.textBody} style={styles.lossText}>
              {t(key)}
            </Text>
          </View>
        ))}
      </Card>
      <Text variant="bodySmall" color={colors.textMuted} style={styles.fresh}>
        {t('deleteAccount.fresh')}
      </Text>
      {/* Mais peso que a linha apagada de cima: é o único aviso de que cancelar
          a etapa da Apple exclui a conta do mesmo jeito. */}
      {appleMode === 'appleLinked' ? (
        <Text variant="body" color={colors.textBody} style={styles.notice}>
          {t('deleteAccount.appleLinkedNotice')}
        </Text>
      ) : null}

      {needsPassword ? (
        <Animated.View
          entering={FadeIn.duration(motion.duration.base)}
          style={styles.password}
          testID="delete-account-password"
        >
          <Text variant="body" color={colors.textBody}>
            {t('deleteAccount.passwordLead')}
          </Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { ref, onChange, onBlur, value } }) => (
              <PasswordField
                ref={ref}
                label={t('deleteAccount.password')}
                value={value}
                onChangeText={(text) => {
                  onChange(text);
                  // Voltou a digitar depois da senha errada: a borda e a mensagem saem.
                  if (wrongPassword) deletion.reset();
                }}
                onBlur={onBlur}
                error={
                  formState.errors.password?.message ??
                  (wrongPassword ? t('deleteAccount.errors.wrongPassword') : undefined)
                }
                autoComplete="current-password"
                textContentType="password"
                autoFocus
                editable={!busy}
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            )}
          />
        </Animated.View>
      ) : null}
      {needsGoogle ? (
        <Text variant="body" color={colors.textBody} style={styles.password}>
          {t('deleteAccount.errors.needsGoogle')}
        </Text>
      ) : null}
      {needsApple ? (
        <Text variant="body" color={colors.textBody} style={styles.password}>
          {t('deleteAccount.appleLead')}
        </Text>
      ) : null}

      <Button
        label={t(
          needsGoogle
            ? 'deleteAccount.confirmGoogle'
            : needsApple
              ? 'deleteAccount.confirmApple'
              : needsPassword
                ? 'deleteAccount.confirm'
                : 'deleteAccount.submit',
        )}
        icon={Trash2}
        onPress={submit}
        loading={busy}
        disabled={disabled}
        haptic="confirm"
        // Desligado sem rede: o leitor ouve o motivo no próprio botão, antes do aviso embaixo.
        accessibilityHint={t(online ? 'deleteAccount.submitHint' : 'deleteAccount.offline')}
        testID="delete-account-submit"
        style={styles.submit}
      />
      {!online ? (
        <Text variant="caption" color={colors.textMuted} style={styles.message}>
          {t('deleteAccount.offline')}
        </Text>
      ) : null}
      {message ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {message}
        </Text>
      ) : null}
      <Button
        label={t('deleteAccount.keep')}
        variant="ghost"
        size="md"
        onPress={goBack}
        disabled={busy}
        style={styles.keep}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  losses: {
    marginTop: spacing.blockGap,
    gap: spacing.md,
  },
  loss: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  lossText: {
    flex: 1,
  },
  fresh: {
    marginTop: spacing.md,
  },
  notice: {
    marginTop: spacing.xl,
  },
  password: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  submit: {
    marginTop: spacing.xl,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  keep: {
    marginTop: spacing.md,
  },
});
