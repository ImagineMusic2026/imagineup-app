import { CircleAlert, CircleCheck, Ticket } from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { goBack, LargeTitleHeader } from '@/components/header';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { useApplyInviteCode, type ApplyInviteOutcome } from '@/domains/auth';
import { normalizeInviteCode } from '@/domains/invites';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

const RESULT_ICON_SIZE = 40;

type FinalOutcome = Extract<
  ApplyInviteOutcome,
  { status: 'claimed' | 'alreadyClaimed' | 'tooOld' }
>;

/** Os resultados que terminam a tela: o formulário dá lugar à resposta, como no Suporte. */
function finalOutcome(outcome: ApplyInviteOutcome | undefined): FinalOutcome | null {
  if (!outcome) return null;
  return outcome.status === 'claimed' ||
    outcome.status === 'alreadyClaimed' ||
    outcome.status === 'tooOld'
    ? outcome
    : null;
}

const RESULT_TEXTS: Record<
  FinalOutcome['status'],
  { title: TranslationKey; body: TranslationKey }
> = {
  claimed: { title: 'inviteCode.done.title', body: 'inviteCode.done.body' },
  alreadyClaimed: { title: 'inviteCode.already.title', body: 'inviteCode.already.body' },
  tooOld: { title: 'inviteCode.tooOld.title', body: 'inviteCode.tooOld.body' },
};

/**
 * "Código de convite" (20.18 da nota), aberta pela linha "Tenho um código de
 * convite" dos Ajustes nos 7 primeiros dias da conta: para quem pulou a
 * pergunta do cadastro ou só recebeu o código depois. Na pilha raiz, sem tab
 * bar, como o "Trocar senha": é um formulário com teclado. O código passa
 * pelo `normalizeInviteCode` antes de sair, e o servidor decide:
 * - aceito, a conta já com convite ou fora dos 7 dias: o formulário dá lugar
 *   à resposta, com "Fechar", como o Suporte;
 * - código que não existe, ou o próprio: o erro fica no campo, para corrigir;
 * - sem resposta certa: o código fica amarrado à conta, e o app manda sozinho
 *   quando a conexão voltar (a sincronização de 20.11).
 * Enquanto o envio vai, a tela fica presa. Sem internet, o botão desliga e
 * diz por quê, como no "Trocar senha".
 */
export function InviteCodeScreen() {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const apply = useApplyInviteCode();
  const busy = apply.isPending;
  useStayOnScreen(busy);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const input = useRef<NativeTextInput>(null);

  const showFieldError = (message: string): void => {
    setFieldError(message);
    input.current?.focus();
    AccessibilityInfo.announceForAccessibility(message);
  };

  const handle = (outcome: ApplyInviteOutcome): void => {
    switch (outcome.status) {
      case 'claimed':
        haptics.trigger('success');
        AccessibilityInfo.announceForAccessibility(t('inviteCode.done.announce'));
        return;
      case 'alreadyClaimed':
        AccessibilityInfo.announceForAccessibility(t('inviteCode.already.announce'));
        return;
      case 'tooOld':
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(t('inviteCode.tooOld.announce'));
        return;
      case 'rejected':
        haptics.trigger('error');
        showFieldError(
          t(
            outcome.reason === 'notFound'
              ? 'auth.signUp.inviteRejected.notFound'
              : 'inviteCode.self',
          ),
        );
        return;
      case 'failed':
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(t('inviteCode.failed'));
        return;
      case 'pending':
        AccessibilityInfo.announceForAccessibility(t('inviteCode.pending'));
        return;
    }
  };

  const submit = (): void => {
    if (busy || !online) return;
    if (!draft.trim()) {
      showFieldError(t('inviteCode.empty'));
      return;
    }
    const code = normalizeInviteCode(draft);
    if (!code) {
      showFieldError(t('validation.inviteCodeInvalid'));
      return;
    }
    setFieldError(null);
    apply.mutate(
      { code },
      {
        onSuccess: handle,
        onError: () => {
          haptics.trigger('error');
          AccessibilityInfo.announceForAccessibility(t('inviteCode.failed'));
        },
      },
    );
  };

  const result = finalOutcome(apply.data);
  if (result) {
    const texts = RESULT_TEXTS[result.status];
    const done = result.status !== 'tooOld';
    return (
      <Screen scroll bottomInset={insets.bottom}>
        <LargeTitleHeader title={t('inviteCode.title')} showBack />
        <View style={styles.result} testID="invite-code-result">
          <Icon
            icon={done ? CircleCheck : CircleAlert}
            size={RESULT_ICON_SIZE}
            color={done ? colors.accent : colors.textSecondary}
          />
          <Text variant="headingSection" accessibilityRole="header" style={styles.center}>
            {t(texts.title)}
          </Text>
          <Text variant="body" color={colors.textBody} style={styles.center}>
            {result.status === 'claimed' ? t(texts.body, { code: result.code }) : t(texts.body)}
          </Text>
          <Button
            label={t('inviteCode.close')}
            variant="secondary"
            onPress={goBack}
            style={styles.resultButton}
            testID="invite-code-close"
          />
        </View>
      </Screen>
    );
  }

  const failed = apply.isError || apply.data?.status === 'failed';
  const pending = apply.data?.status === 'pending';
  return (
    <Screen scroll bottomInset={insets.bottom}>
      <LargeTitleHeader title={t('inviteCode.title')} showBack backDisabled={busy} />
      <Text variant="bodyLead" color={colors.textBody}>
        {t('inviteCode.lead')}
      </Text>
      <View style={styles.field}>
        <TextInput
          ref={input}
          label={t('inviteCode.field')}
          hint={t('inviteCode.fieldHint')}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (fieldError) setFieldError(null);
            if (apply.data || apply.isError) apply.reset();
          }}
          error={fieldError ?? undefined}
          editable={!busy}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="invite-code-field"
        />
      </View>
      <Button
        label={t('inviteCode.submit')}
        icon={Ticket}
        onPress={submit}
        loading={busy}
        disabled={!online}
        haptic="confirm"
        // Desligado sem rede: o leitor ouve o motivo no próprio botão, antes do aviso embaixo.
        accessibilityHint={t(online ? 'inviteCode.submitHint' : 'inviteCode.offline')}
        testID="invite-code-submit"
        style={styles.submit}
      />
      {!online ? (
        <Text variant="caption" color={colors.textMuted} style={styles.message}>
          {t('inviteCode.offline')}
        </Text>
      ) : null}
      {pending ? (
        <Text variant="caption" color={colors.textSecondary} style={styles.message}>
          {t('inviteCode.pending')}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t('inviteCode.failed')}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: spacing.xl,
  },
  submit: {
    marginTop: spacing.xl,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  result: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sectionTop,
  },
  center: {
    textAlign: 'center',
  },
  resultButton: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
});
