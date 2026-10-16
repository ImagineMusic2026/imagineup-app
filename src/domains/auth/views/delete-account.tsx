import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { CircleUser, Gift, Trash2, Trophy, Users, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { LargeTitleHeader } from '@/components/header';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { isFirebaseConfigured } from '@/firebase';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t, type TranslationKey } from '@/i18n';
import { useSessionStore } from '@/stores/session';
import { colors, motion, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { deleteAccountFailure } from '../api';
import { PasswordField } from '../components/password-field';
import { DELETE_ACCOUNT_ERRORS, useDeleteAccount } from '../hooks/use-delete-account';
import { useSessionMethod } from '../hooks/use-session-method';
import { reauthSchema, type ReauthForm } from '../schemas';
import { deletionKindOf, triesLinkedApple, type DeleteAccountRequest } from '../social';

const LOSS_ICON_SIZE = 18;

/** O que vai embora com a conta, na ordem em que o fã vê no app. */
const LOSSES: readonly { key: TranslationKey; icon: LucideIcon }[] = [
  { key: 'deleteAccount.losses.profile', icon: CircleUser },
  { key: 'deleteAccount.losses.points', icon: Trophy },
  { key: 'deleteAccount.losses.ranking', icon: Users },
  { key: 'deleteAccount.losses.rewards', icon: Gift },
];

const FIELD_ORDER = ['password'] as const;

/**
 * Em que passo a confirmação está: o primeiro toque, o campo de senha ou o
 * "Confirmar com o Google", depois que o Firebase pediu o login recente (ou,
 * com a Apple ligada, antes da tentativa de revogação).
 */
type Stage = 'start' | 'password' | 'google';

const SUBMIT_LABEL: Record<Stage, TranslationKey> = {
  start: 'deleteAccount.submit',
  password: 'deleteAccount.confirm',
  google: 'deleteAccount.confirmGoogle',
};

function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/perfil');
}

/**
 * Excluir conta (sem desenho, no visual das outras telas), aberta pelos
 * Ajustes. A própria tela é a confirmação: diz o que se perde e só então
 * oferece o botão. Pelo provedor da sessão (seção 33 de
 * docs/arquitetura-api.md, decisão 12):
 * - a senha: se o Firebase pedir o login recente, aparece o campo de senha, e
 *   a exclusão sai depois de reautenticar com a credencial de e-mail;
 * - o Google: o login recente vira o estágio "Confirmar com o Google", no
 *   lugar do campo de senha, e o botão abre a folha do Google;
 * - a Apple, no iPhone: a frase da Apple embaixo da lista, e o botão abre
 *   sempre a folha da Apple (fechar a folha volta sem erro);
 * - a Apple ligada a uma sessão de outro provedor, no iPhone: a frase da Apple
 *   ligada, a confirmação da sessão pedida já no primeiro toque e, depois
 *   dela, a folha da Apple como tentativa de revogação (cancelar exclui do
 *   mesmo jeito).
 *
 * Sem rede, o botão fica desligado; erro de rede deixa a conta como estava.
 * Deu certo, quem troca a tela é o guard (a sessão termina), e o perfil e o
 * @ somem no servidor.
 */
export function DeleteAccountScreen() {
  const bottomInset = useTabBarInset();
  const online = useIsOnline();
  const deletion = useDeleteAccount();
  const kind = deletionKindOf(useSessionMethod());
  const hasApple = useSessionStore((state) => state.user?.providers?.includes('apple') === true);
  const linkedApple = triesLinkedApple(kind, hasApple);
  const failure = deletion.isError
    ? deleteAccountFailure(deletion.error, deletion.variables?.kind)
    : null;
  // A senha ou o Google ficam depois do primeiro "login recente": as próximas
  // tentativas vão com a confirmação.
  const [stage, setStage] = useState<Stage>('start');
  if (failure === 'needsPassword' && stage !== 'password') setStage('password');
  if (failure === 'needsGoogle' && stage !== 'google') setStage('google');
  // Depois de dar certo, o botão segue ocupado até o guard trocar a tela. A
  // folha fechada pelo fã (`canceled`) volta ao botão livre.
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
    if (stage === 'password') {
      void handleSubmit(
        ({ password }) => deletion.mutate({ kind: 'password', password }),
        (errors) => announceFirstError(errors, FIELD_ORDER),
      )();
      return;
    }
    const request: DeleteAccountRequest =
      stage === 'google' ? { kind: 'google', confirm: true } : { kind };
    deletion.mutate(request);
  };

  const wrongPassword = failure === 'wrongPassword';
  const message =
    failure &&
    failure !== 'needsPassword' &&
    failure !== 'needsGoogle' &&
    failure !== 'wrongPassword'
      ? t(DELETE_ACCOUNT_ERRORS[failure])
      : null;
  const appleNotice: TranslationKey | null =
    kind === 'apple'
      ? 'deleteAccount.appleNotice'
      : linkedApple
        ? 'deleteAccount.appleLinkedNotice'
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
      {appleNotice ? (
        <Text
          variant="body"
          color={colors.textBody}
          style={styles.notice}
          testID="delete-account-apple-notice"
        >
          {t(appleNotice)}
        </Text>
      ) : null}

      {stage === 'google' ? (
        <Animated.View
          entering={FadeIn.duration(motion.duration.base)}
          style={styles.password}
          testID="delete-account-google"
        >
          <Text variant="body" color={colors.textBody}>
            {t('deleteAccount.googleLead')}
          </Text>
        </Animated.View>
      ) : null}

      {stage === 'password' ? (
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

      <Button
        label={t(SUBMIT_LABEL[stage])}
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
