import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  AccessibilityInfo,
  Alert,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '@/components/button';
import { BackHeader, goBack } from '@/components/header';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import {
  SUPPORT_TEXT_MAX,
  supportKindOf,
  useSendSupportMessageMutation,
  type SupportKind,
} from '@/domains/support';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { readSupportDevice } from '../support-device';

/** A caixa do texto: oito linhas, como o campo grande do print de referência do dono. */
const FIELD_LINES = 8;

const SENT_ICON_SIZE = 40;

/** Os textos de cada tipo: o título da tela, o rótulo do campo para o leitor e o texto de dentro. */
const TEXTS: Record<
  SupportKind,
  { title: TranslationKey; label: TranslationKey; placeholder: TranslationKey }
> = {
  problem: {
    title: 'support.problem.title',
    label: 'support.problem.label',
    placeholder: 'support.problem.placeholder',
  },
  idea: {
    title: 'support.idea.title',
    label: 'support.idea.label',
    placeholder: 'support.idea.placeholder',
  },
  feedback: {
    title: 'support.feedback.title',
    label: 'support.feedback.label',
    placeholder: 'support.feedback.placeholder',
  },
};

const supportSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, { error: t('support.required') })
    .max(SUPPORT_TEXT_MAX),
});

type SupportForm = z.infer<typeof supportSchema>;

/**
 * O teclado já aberto: no Android, o `autoFocus` de um campo que monta durante
 * a animação da pilha foca antes de a janela estar pronta, e o teclado não
 * sobe (conferido no emulador em 04/11/2026). O foco vai de novo ao campo
 * quando a entrada da tela termina; no iOS, e com o reduzir movimento, o
 * `autoFocus` já resolveu, e focar de novo não muda nada.
 */
function useFocusAfterTransition(input: { current: NativeTextInput | null }): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  useEffect(
    () =>
      navigation.addListener('transitionEnd', (event) => {
        if (!event.data.closing) input.current?.focus();
      }),
    [navigation, input],
  );
}

interface SupportFormProps {
  kind: SupportKind;
}

/**
 * O formulário de um tipo: o campo grande com o teclado já aberto, o contador,
 * o aviso de que a equipe não responde por aqui (e, no problema, o que vai
 * junto) e o "Enviar". Sem rede, nada sai. Enquanto o envio vai, a tela fica
 * presa; com texto escrito, sair pergunta antes ("Descartar a mensagem?").
 * Deu certo, o formulário vira o "Mensagem enviada", com o "Fechar".
 */
function SupportMessageForm({ kind }: SupportFormProps) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const message = useSendSupportMessageMutation();
  const texts = TEXTS[kind];
  const input = useRef<NativeTextInput | null>(null);
  useFocusAfterTransition(input);

  const { control, handleSubmit } = useForm<SupportForm>({
    resolver: zodResolver(supportSchema),
    defaultValues: { text: '' },
  });
  const text = useWatch({ control, name: 'text' });
  const written = text.trim() !== '';
  const sent = message.isSuccess;
  const busy = message.isPending;

  const askLeave = (): void => {
    if (busy) return;
    if (!written || sent) {
      goBack();
      return;
    }
    Alert.alert(t('support.discard.title'), t('support.discard.message'), [
      { text: t('support.discard.keep'), style: 'cancel' },
      { text: t('support.discard.confirm'), style: 'destructive', onPress: goBack },
    ]);
  };
  useStayOnScreen(busy ? 'locked' : written && !sent ? 'confirm' : 'free', askLeave);

  // Enviada: a vibração de sucesso e o anúncio, uma vez.
  useEffect(() => {
    if (!sent) return;
    haptics.trigger('success');
    AccessibilityInfo.announceForAccessibility(t('support.sent.announce'));
  }, [sent]);

  const failure = message.error ? t(actionRefusal(message.error, 'support').key) : null;
  useEffect(() => {
    if (failure) AccessibilityInfo.announceForAccessibility(failure);
  }, [failure]);

  const submit = (): void => {
    if (busy || !online) return;
    void handleSubmit(
      (values) => message.send(kind, values.text, kind === 'problem' ? readSupportDevice() : null),
      (errors) => announceFirstError(errors, ['text']),
    )();
  };

  const header = (
    <BackHeader leading="close" title={t(texts.title)} onBack={askLeave} backDisabled={busy} />
  );

  if (sent) {
    return (
      <Screen scroll header={header} bottomInset={insets.bottom}>
        <View style={styles.sent} testID="support-sent">
          <Icon icon={CircleCheck} size={SENT_ICON_SIZE} color={colors.accent} />
          <Text variant="headingSection" accessibilityRole="header" style={styles.center}>
            {t('support.sent.title')}
          </Text>
          <Text variant="body" color={colors.textBody} style={styles.center}>
            {t('support.sent.body')}
          </Text>
          <Button
            label={t('support.sent.close')}
            variant="secondary"
            onPress={goBack}
            style={styles.sentButton}
            testID="support-sent-close"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll header={header} bottomInset={insets.bottom}>
      <View style={styles.form}>
        <Controller
          control={control}
          name="text"
          render={({ field: { ref, value, onChange, onBlur }, fieldState }) => (
            <TextInput
              ref={(node) => {
                ref(node);
                input.current = node;
              }}
              label={t(texts.label)}
              labelHidden
              value={value}
              onChangeText={(next) => {
                onChange(next);
                if (message.error) message.reset();
              }}
              onBlur={onBlur}
              placeholder={t(texts.placeholder)}
              error={fieldState.error?.message}
              multiline
              minLines={FIELD_LINES}
              maxLength={SUPPORT_TEXT_MAX}
              autoFocus
              editable={!busy}
              accessibilityStatus={t('support.counterLabel', {
                count: value.length,
                max: SUPPORT_TEXT_MAX,
              })}
              footer={
                <Text
                  variant="caption"
                  color={value.length >= SUPPORT_TEXT_MAX ? colors.danger : colors.textMuted}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={styles.counter}
                >
                  {t('support.counter', { count: value.length, max: SUPPORT_TEXT_MAX })}
                </Text>
              }
              testID="support-text"
            />
          )}
        />
        <Text variant="caption" color={colors.textSecondary} testID="support-note">
          {kind === 'problem'
            ? `${t('support.problem.device')} ${t('support.note')}`
            : t('support.note')}
        </Text>
        {failure ? (
          <Text variant="caption" color={colors.danger} testID="support-error">
            {failure}
          </Text>
        ) : null}
        {online ? null : (
          <Text variant="caption" color={colors.textSecondary} testID="support-offline">
            {t('support.offline')}
          </Text>
        )}
        <Button
          label={t('support.send')}
          accessibilityLabel={t('support.sendLabel')}
          onPress={submit}
          loading={busy}
          disabled={!online}
          haptic="confirm"
          testID="support-send"
        />
      </View>
    </Screen>
  );
}

/**
 * Reportar problema, Sugerir funcionalidade e Feedback geral (seção 38 de
 * docs/arquitetura-api.md; pedido do dono de 03/11/2026, no modelo do print
 * de referência dele, com o visual e os componentes do app). Abertas pela
 * seção Suporte dos Ajustes, na pilha raiz e sem a tab bar, como o "Editar
 * perfil": o X à esquerda e o título no meio. O tipo vem do endereço
 * (`/suporte/problema`, `/suporte/sugestao` e `/suporte/feedback`); outro
 * endereço mostra a página não encontrada, com o X.
 */
export function SupportMessageScreen() {
  const insets = useSafeAreaInsets();
  const { tipo } = useLocalSearchParams<{ tipo?: string }>();
  const kind = supportKindOf(tipo);
  if (kind) return <SupportMessageForm key={kind} kind={kind} />;
  return (
    <Screen scroll header={<BackHeader leading="close" />} bottomInset={insets.bottom}>
      <EmptyState
        message={t('notFound.title')}
        actionLabel={t('common.back')}
        onAction={goBack}
        style={styles.notFound}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  counter: {
    alignSelf: 'flex-end',
  },
  sent: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sectionTop,
  },
  center: {
    textAlign: 'center',
  },
  sentButton: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  notFound: {
    paddingTop: spacing.lg,
  },
});
