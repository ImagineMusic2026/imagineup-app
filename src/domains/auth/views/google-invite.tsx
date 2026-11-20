import { router } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, type TextInput as NativeTextInput } from 'react-native';

import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { readPendingInvite, subscribePendingInvite } from '@/domains/invites';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { authErrorMessageKey, type InviteRejection } from '../api';
import { QuestionLayout } from '../components/question-layout';
import { StepFooter } from '../components/step-footer';
import { ENTRY_STEP_COUNT } from '../consts';
import {
  hasPendingGoogleInvite,
  releaseHeldGoogleInvite,
  useFinishSignUp,
} from '../hooks/use-sign-up';
import { inviteCodeField } from '../schemas';

const REJECTION_MESSAGES: Record<InviteRejection, TranslationKey> = {
  notFound: 'auth.signUp.inviteRejected.notFound',
  notAllowed: 'auth.signUp.inviteRejected.notAllowed',
};

/** A conta criada pelo Google pode aplicar um convite antes da escolha de artistas. */
export function GoogleInviteScreen() {
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  const [inviteOwner] = useState(() => (hasPendingGoogleInvite() ? uid : null));
  const active = inviteOwner !== null && inviteOwner === uid;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<NativeTextInput>(null);
  const finish = useFinishSignUp();
  const pending = finish.isPending;

  useStayOnScreen(active);

  useEffect(() => {
    if (active) return () => releaseHeldGoogleInvite(inviteOwner);
    router.replace('/entrar');
  }, [active, inviteOwner]);

  // O convite que chega por link nesta pergunta substitui o rascunho do campo.
  const fillDraft = useEffectEvent((code: string) => {
    if (pending) return;
    setDraft(code);
    setError(null);
  });

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const fillFromLink = (): void => {
      void readPendingInvite()
        .then((invite) => {
          if (mounted && invite) fillDraft(invite.code);
        })
        .catch(() => undefined);
    };
    fillFromLink();
    const unsubscribe = subscribePendingInvite(fillFromLink);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [active]);

  const showError = (message: string): void => {
    setError(message);
    input.current?.focus();
    AccessibilityInfo.announceForAccessibility(message);
  };

  const confirm = (code: string): void => {
    if (pending) return;
    const parsed = inviteCodeField.safeParse(code);
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? t('validation.inviteCodeInvalid'));
      return;
    }
    setError(null);
    finish.mutate(
      { inviteCode: parsed.data },
      {
        onSuccess: (outcome) => {
          if (outcome.status === 'inviteRejected') {
            haptics.trigger('error');
            showError(t(REJECTION_MESSAGES[outcome.reason]));
          }
        },
        onError: (cause) => showError(t(authErrorMessageKey(cause, 'signUp'))),
      },
    );
  };

  if (!active) return null;

  const hasCode = draft.trim() !== '';
  const skipLabel = t('auth.signUp.skipInvite');
  return (
    <QuestionLayout
      progress={{ current: 1, total: ENTRY_STEP_COUNT, fill: 1 }}
      stepKey="google-invite"
      title={t('auth.signUp.inviteStepTitle')}
      lead={t('auth.signUp.inviteCodeHint')}
      secondary={
        hasCode ? (
          <TextLink
            label={skipLabel}
            onPress={() => confirm('')}
            disabled={pending}
            style={styles.skip}
          />
        ) : undefined
      }
      footer={
        <StepFooter
          label={hasCode ? t('common.continue') : skipLabel}
          onPress={() => confirm(draft)}
          loading={pending}
        />
      }
    >
      <TextInput
        ref={input}
        variant="hero"
        label={t('auth.signUp.inviteCode')}
        labelHidden
        placeholder={t('auth.signUp.inviteCode')}
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        editable={!pending}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        returnKeyType="go"
        submitBehavior="submit"
        onSubmitEditing={() => confirm(draft)}
      />
    </QuestionLayout>
  );
}

const styles = StyleSheet.create({
  skip: { alignSelf: 'center' },
});
