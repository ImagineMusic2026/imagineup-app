import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { z } from 'zod';

import { Button } from '@/components/button';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { readPendingInvite, subscribePendingInvite } from '@/domains/invites';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import type { InviteRejection } from '../api';
import { AuthFormLayout } from '../components/auth-form-layout';
import { ENTRY_STEP_COUNT } from '../consts';
import {
  hasHeldSignUp,
  releaseHeldSignUp,
  useFinishSignUp,
  type SignUpOutcome,
} from '../hooks/use-sign-up';
import { inviteCodeField } from '../schemas';

const socialInviteSchema = z.object({ inviteCode: inviteCodeField });

const FIELD_ORDER = ['inviteCode'] as const;

const REJECTION_MESSAGES: Record<InviteRejection, TranslationKey> = {
  notFound: 'auth.signUp.inviteRejected.notFound',
  notAllowed: 'auth.signUp.inviteRejected.notAllowed',
};

/**
 * "Tem um código de convite?" (seção 33 de docs/arquitetura-api.md, decisão 7
 * e pergunta 9): só para a conta nova pela Apple ou pelo Google, sem convite
 * de link. A conta já existe e está logada, e o fã segue seguro nas telas de
 * conta (a trava que a entrada estacionou, `parkSignUpHold`) até "Continuar"
 * ou "Pular". O campo e as frases são os do cadastro: "Continuar" com o código
 * manda o claim (até 8 s, `useFinishSignUp`), e o código recusado (não existe
 * ou não vale) fica no campo, com o erro, o foco e o anúncio, para o fã
 * corrigir ou pular; sem código, "Continuar" é o mesmo que "Pular". Um link de
 * convite aberto por fora volta para cá e põe o código no campo. A tela não
 * deixa voltar: a conta já existe. Se ela sumir sem passar pelos botões, solta
 * o fã (`releaseHeldSignUp`); aberta a frio, sem fã seguro, volta à abertura.
 */
export function SocialInviteScreen() {
  const finish = useFinishSignUp();
  // Uma recusa nova a cada vez (o número muda): a mesma recusa duas vezes avisa de novo.
  const [rejection, setRejection] = useState<{ reason: InviteRejection; seq: number } | null>(null);
  const { control, handleSubmit, formState, setFocus, setError, clearErrors, setValue } = useForm({
    resolver: zodResolver(socialInviteSchema),
    defaultValues: { inviteCode: '' } satisfies z.input<typeof socialInviteSchema>,
  });
  const pending = finish.isPending;

  useStayOnScreen(true);

  useEffect(() => {
    if (!hasHeldSignUp()) router.replace('/entrar');
    return releaseHeldSignUp;
  }, []);

  // O link de convite que chega com a tela aberta (o fã pediu o código a quem
  // o convidou) entra no campo, no lugar do que estiver nele.
  const fillFromLink = useEffectEvent((code: string) => {
    setValue('inviteCode', code, { shouldDirty: true });
    clearErrors('inviteCode');
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
      finish.mutate({ inviteCode: values.inviteCode }, { onSuccess: afterOutcome });
    },
    (errors) => announceFirstError(errors, FIELD_ORDER),
  );

  const skip = (): void => {
    if (pending) return;
    finish.mutate({ inviteCode: '' }, { onSuccess: afterOutcome });
  };

  return (
    <AuthFormLayout
      step={{ current: 1, total: ENTRY_STEP_COUNT }}
      locked
      title={t('auth.socialInvite.title')}
      lead={t('auth.socialInvite.lead')}
      footer={null}
    >
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
            onChangeText={onChange}
            onBlur={onBlur}
            error={formState.errors.inviteCode?.message}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="social-invite-code"
          />
        )}
      />

      <Button
        label={t('auth.signUp.continue')}
        onPress={submit}
        loading={pending}
        disabled={pending}
        haptic={null}
        style={styles.submit}
      />
      {/* Irmão do botão, nunca dentro dele: segue para a 1l sem o convite. */}
      <TextLink
        label={t('auth.socialInvite.skip')}
        onPress={skip}
        disabled={pending}
        style={styles.skip}
      />
    </AuthFormLayout>
  );
}

const styles = StyleSheet.create({
  submit: {
    marginTop: spacing.authLeadGap,
  },
  skip: {
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
});
