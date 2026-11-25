import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Keyboard, StyleSheet, View, type TextInput as NativeTextInput } from 'react-native';

import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { isFirebaseConfigured } from '@/firebase';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';
import { announceFirstError } from '@/utils/form-errors';

import { authErrorMessageKey } from '../api';
import { EmailPill } from '../components/email-pill';
import { FormFooter } from '../components/form-footer';
import { PasswordField } from '../components/password-field';
import { QuestionLayout, type QuestionLayoutProps } from '../components/question-layout';
import { SocialEntryButtons } from '../components/social-entry-buttons';
import { StepField } from '../components/step-field';
import { StepFooter } from '../components/step-footer';
import { clearHandedOffEmail, readEmailHandoffReason, readHandedOffEmail } from '../email-handoff';
import { backToWelcome, normalizedEmail } from '../entry-questions';
import { forgetPendingGoogleLink } from '../google-entry';
import { useAppleEntry } from '../hooks/use-apple-entry';
import { useGoogleEntry } from '../hooks/use-google-entry';
import { usePasswordReset } from '../hooks/use-password-reset';
import { googleOnlyHint, useSignIn } from '../hooks/use-sign-in';
import type { SocialEntry } from '../hooks/use-social-entry';
import { signInSchema, type SignInForm } from '../schemas';

/** As duas perguntas do entrar: o e-mail da conta e, depois, a senha dela. */
type SignInStep = 'email' | 'password';

/** Os campos do formulário, na ordem das perguntas. */
const FIELD_ORDER = ['email', 'password'] as const;
type SignInField = (typeof FIELD_ORDER)[number];

/**
 * Entrar com e-mail, no molde das perguntas da entrada: o e-mail da conta e,
 * depois, a senha, uma pergunta por vez. As duas são passos desta tela, e não
 * rotas: o formulário é um só, a casca, o véu e o pé ficam no lugar, e só a
 * pergunta troca. Os campos das duas ficam montados, e só o da pergunta à
 * vista aparece (`StepField`), como no cadastro: o foco vai direto de um ao
 * outro, e o teclado não fecha entre elas. Quem entra não navega: o guard
 * troca a pilha quando a sessão muda.
 *
 * Na senha, o e-mail fica à vista na pílula de cima, que volta para trocá-lo.
 * Com o e-mail já pronto (o cadastro descobriu que ele tem conta, ou o fã
 * acabou de trocá-lo), a tela abre direto na senha.
 *
 * A tela não fica presa enquanto entra, como antes. O voltar do Android e o
 * redondo do pé fazem o mesmo: na senha, voltam ao e-mail; no e-mail, saem.
 */
export function SignInScreen() {
  const googleEntry = useGoogleEntry();
  const appleEntry = useAppleEntry();
  // O anúncio do pedido é a frase curta, a mesma que aparece acima do pé.
  const passwordReset = usePasswordReset('auth.signIn.resetSentShort');
  // O e-mail que chega pronto, com o motivo. Lido uma vez, na montagem.
  const [handoff] = useState(() => ({
    email: readHandedOffEmail(),
    reason: readEmailHandoffReason(),
  }));
  const startsAtPassword = handoff.email !== null;
  const [step, setStep] = useState<SignInStep>(startsAtPassword ? 'password' : 'email');
  const onEmail = step === 'email';
  // Sem o botão do Google aqui (o iPhone), a senha recusada traz embaixo do
  // "Esqueci minha senha" o caminho da conta que só entra com o Google. Só na
  // pergunta da senha e sem pedido do link em curso ou respondido: aí vale a
  // resposta do pedido. A mesma conta decide o anúncio (`googleOnlyHint`).
  const googleOnlyHintShown = !googleEntry.available && !onEmail && passwordReset.isIdle;
  const signIn = useSignIn({ googleOnlyHintShown });
  const [linkingGoogle, setLinkingGoogle] = useState(handoff.reason === 'googleLink');
  const ownsGoogleLink = useRef(handoff.reason === 'googleLink');
  // Quantas vezes o próprio fã trocou de pergunta (`goTo`): só aí o foco do
  // leitor vai ao título. A volta ao e-mail pela rede de segurança do envio
  // não o leva, para o anúncio do erro ser ouvido inteiro.
  const [moves, setMoves] = useState(0);
  // O aviso dos Termos embaixo dos botões de provedor: pela abertura (ou pelo
  // cadastro que ela abriu), o fã já viu o "Ao continuar, você aceita..." dela,
  // e o entrar fica sem o aviso, mais limpo (pedido do dono de 24/11/2026).
  // Aberto a frio por um link do app, sem a abertura embaixo, o aviso volta,
  // porque o Google ou a Apple podem criar uma conta nova ali. Lido uma vez, na
  // montagem.
  const [showProviderTerms] = useState(() => !router.canGoBack());
  const { control, handleSubmit, formState, trigger, clearErrors, getFieldState, setValue } =
    useForm<SignInForm>({
      resolver: zodResolver(signInSchema),
      // O erro de um campo sai quando o fã volta a digitar nele e só volta na
      // conferência seguinte (o botão ou o "ir" do teclado), nunca a cada
      // letra, como no cadastro.
      reValidateMode: 'onSubmit',
      defaultValues: { email: handoff.email ?? '', password: '' },
    });
  const [typedEmail, typedPassword] = useWatch({ control, name: FIELD_ORDER });

  const disabled = !isFirebaseConfigured;
  // A entrada por um provedor em curso: o Google (Android) ou a Apple (iPhone).
  const socialPending = googleEntry.isPending || appleEntry.isPending;
  const socialError = googleEntry.error ?? appleEntry.error;
  const email = normalizedEmail(typedEmail);
  // O botão do pé fica apagado só com o campo da pergunta vazio.
  const empty = onEmail ? typedEmail.trim() === '' : typedPassword === '';
  const errorKey = signIn.isError ? authErrorMessageKey(signIn.error) : null;
  // Credencial recusada: o erro é do campo da senha. O resto vai acima do pé.
  const rejected = errorKey === 'auth.errors.invalidCredentials';
  const rejectionHint = googleOnlyHint(errorKey, googleOnlyHintShown);
  // O aviso do cadastro ("Esse e-mail já tem conta") só vale para o e-mail que
  // ele mandou: trocado na pílula, a frase sai.
  const inUse = handoff.reason === 'emailInUse' && email === handoff.email;

  useEffect(() => clearHandedOffEmail(), []);
  useEffect(
    () => () => {
      if (ownsGoogleLink.current) forgetPendingGoogleLink();
    },
    [],
  );

  // O campo de cada pergunta, para o foco ir a ele quando ela entra.
  const inputs = useRef<Record<SignInStep, NativeTextInput | null>>({
    email: null,
    password: null,
  });
  // O campo que tem de estar com o foco agora: o da pergunta à vista. No
  // Android, o `autoFocus` durante a animação da pilha não sobe o teclado: o
  // foco vai de novo a ele quando a tela termina de entrar.
  const focused = useRef<NativeTextInput | null>(null);
  useFocusAfterTransition(focused);
  const lastStep = useRef(step);
  useEffect(() => {
    const input = inputs.current[step];
    focused.current = input;
    // Na primeira montagem, quem foca é o `autoFocus` do campo da pergunta que abre.
    if (lastStep.current === step) return;
    lastStep.current = step;
    input?.focus();
  }, [step]);

  /**
   * Tira da tela o erro do último envio: o fã voltou a digitar, trocou de
   * pergunta ou pediu o link da senha. Só o erro sai: o envio que ainda anda
   * segue à vista, no botão ocupado, e continua sendo um por vez.
   */
  const clearSubmitError = (): void => {
    if (signIn.isError) signIn.reset();
  };

  /**
   * O pedido do link da senha que já terminou sai junto com a pergunta. O que
   * ainda anda fica: zerado no meio, ele soltaria o link (um segundo toque
   * mandaria outro e-mail) e a confirmação que chegasse depois não apareceria.
   */
  const clearFinishedReset = (): void => {
    if (!passwordReset.isPending) passwordReset.reset();
  };

  /** O erro da última entrada por um provedor sai, só do provedor que tem um. */
  const clearSocialErrors = (): void => {
    if (googleEntry.error) googleEntry.reset();
    if (appleEntry.error) appleEntry.reset();
  };

  /**
   * Troca de pergunta. O que sobrou de uma tentativa (o erro do envio, o
   * pedido do link da senha que já terminou) não passa para a outra.
   */
  const goTo = (next: SignInStep): void => {
    clearFinishedReset();
    clearSubmitError();
    clearSocialErrors();
    setMoves((count) => count + 1);
    setStep(next);
  };

  const backToEmail = (): void => {
    if (ownsGoogleLink.current) {
      ownsGoogleLink.current = false;
      forgetPendingGoogleLink();
      setLinkingGoogle(false);
    }
    goTo('email');
  };

  // Na senha, o voltar do Android volta ao e-mail, e o gesto do iOS fica
  // desligado (ele sairia da tela, e não da pergunta).
  useStayOnScreen(socialPending ? 'locked' : onEmail ? 'free' : 'confirm', backToEmail);

  // Voltou a digitar: o erro do campo sai, e com ele o do último envio.
  const edited = (changed: SignInField): void => {
    if (formState.errors[changed]) clearErrors(changed);
    clearSubmitError();
    clearSocialErrors();
  };

  // Entra pelo provedor tocado. O modo "ligar" só vem do Google (a Apple é
  // confiável e nunca esbarra numa conta de senha).
  const enterWith = async (entry: SocialEntry): Promise<void> => {
    if (socialPending || signIn.isPending) return;
    Keyboard.dismiss();
    const outcome = await entry.signIn();
    if (outcome?.status === 'askInvite') {
      router.replace('/codigo-de-convite');
    } else if (outcome?.status === 'link') {
      setValue('email', outcome.email);
      setValue('password', '');
      clearErrors();
      ownsGoogleLink.current = true;
      setLinkingGoogle(true);
      goTo('password');
    }
  };

  const continueToPassword = async (): Promise<void> => {
    if (socialPending) return;
    // Só o e-mail é conferido aqui: a senha é a pergunta seguinte.
    if (await trigger('email', { shouldFocus: true })) {
      goTo('password');
      return;
    }
    // O foco já estava no campo, e focar de novo não faz o leitor de tela falar.
    announceFirstError({ email: getFieldState('email').error }, FIELD_ORDER);
  };

  const submit = handleSubmit(
    (values) => {
      // O "ir" do teclado não passa pelo botão desativado: um envio por vez.
      if (signIn.isPending || socialPending || disabled) return;
      clearFinishedReset();
      signIn.mutate(values);
    },
    (errors) => {
      // Rede de segurança: o e-mail já passou pela pergunta dele, mas pode
      // ter mudado fora da vista (o preenchimento automático escreve no campo
      // guardado). Recusado, a tela volta à pergunta dele, com o erro no campo.
      if (errors.email) setStep('email');
      announceFirstError(errors, FIELD_ORDER);
    },
  );

  // "Esqueci minha senha" manda o link para o e-mail da pergunta anterior.
  const requestPasswordReset = (): void => {
    clearSubmitError();
    passwordReset.mutate(email);
  };

  // Acima do pé, uma mensagem por vez. Sem o Firebase configurado, o aviso
  // vale nas duas perguntas. As do envio são da pergunta da senha: o envio
  // zera o pedido do link, e o pedido do link tira o erro do envio. Se um
  // envio que já andava falhar depois do pedido, vale o erro, que é o mais novo.
  let notice: QuestionLayoutProps['notice'];
  if (disabled) {
    notice = { text: t('auth.missingConfig'), tone: 'danger' };
  } else if (onEmail && socialError) {
    notice = { text: t(socialError), tone: 'danger' };
  } else if (!onEmail) {
    if (errorKey && !rejected) {
      notice = { text: t(errorKey), tone: 'danger' };
    } else if (passwordReset.isError) {
      notice = {
        text: t(authErrorMessageKey(passwordReset.error, 'passwordReset')),
        tone: 'danger',
      };
    } else if (passwordReset.isSuccess) {
      notice = { text: t('auth.signIn.resetSentShort'), tone: 'neutral' };
    }
  }

  const passwordLead = linkingGoogle
    ? t('auth.google.linkPassword')
    : inUse
      ? t('auth.errors.emailInUse')
      : undefined;

  return (
    <QuestionLayout
      stepKey={step}
      focusKey={String(moves)}
      above={onEmail ? undefined : <EmailPill email={email} onPress={backToEmail} />}
      title={t(onEmail ? 'auth.signIn.title' : 'auth.signIn.passwordTitle')}
      lead={onEmail ? t('auth.signIn.emailQuestion') : passwordLead}
      notice={notice}
      secondary={
        onEmail ? (
          <FormFooter
            question={t('auth.signIn.noAccount')}
            actionLabel={t('auth.signIn.createAccount')}
            onAction={() => router.replace('/cadastro')}
            disabled={socialPending}
          />
        ) : undefined
      }
      footer={
        // O "próximo" e o "ir" do teclado fazem o mesmo que o botão, sem fechar o teclado.
        <StepFooter
          onBack={onEmail ? backToWelcome : backToEmail}
          backDisabled={socialPending}
          label={t(onEmail ? 'common.continue' : 'auth.signIn.submit')}
          onPress={() => void (onEmail ? continueToPassword() : submit())}
          loading={!onEmail && signIn.isPending}
          disabled={empty || socialPending || (!onEmail && disabled)}
          accessibilityHint={empty ? t('auth.emptyHint') : undefined}
        />
      }
    >
      {/* Os dois campos na mesma caixa: o guardado fica por cima do lugar do
          que está à vista, com a largura dele. */}
      <View>
        <StepField shown={onEmail}>
          <Controller
            control={control}
            name="email"
            render={({ field: { ref, onChange, onBlur, value } }) => (
              <TextInput
                // O ref do formulário leva o foco ao campo com erro; o da
                // tela, ao campo da pergunta que entra.
                ref={(node) => {
                  ref(node);
                  inputs.current.email = node;
                }}
                variant="hero"
                label={t('auth.email')}
                labelHidden
                placeholder={t('auth.emailPlaceholder')}
                value={value}
                editable={!socialPending}
                onChangeText={(text) => {
                  onChange(text);
                  edited('email');
                }}
                onBlur={onBlur}
                error={formState.errors.email?.message}
                autoFocus={!startsAtPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                // "username" pareia e-mail e senha no preenchimento automático do iOS.
                textContentType="username"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => void continueToPassword()}
              />
            )}
          />
          {onEmail ? (
            <SocialEntryButtons
              google={
                googleEntry.available
                  ? { onPress: () => void enterWith(googleEntry), loading: googleEntry.isPending }
                  : null
              }
              apple={
                appleEntry.available
                  ? { onPress: () => void enterWith(appleEntry), loading: appleEntry.isPending }
                  : null
              }
              disabled={signIn.isPending}
              showTerms={showProviderTerms}
            />
          ) : null}
        </StepField>
        <StepField shown={!onEmail}>
          <Controller
            control={control}
            name="password"
            render={({ field: { ref, onChange, onBlur, value } }) => (
              <PasswordField
                ref={(node) => {
                  ref(node);
                  inputs.current.password = node;
                }}
                variant="hero"
                label={t('auth.password')}
                labelHidden
                placeholder={t('auth.passwordPlaceholder')}
                value={value}
                onChangeText={(text) => {
                  onChange(text);
                  edited('password');
                }}
                onBlur={onBlur}
                error={
                  formState.errors.password?.message ??
                  (rejected ? t('auth.errors.invalidCredentials') : undefined)
                }
                // Com o e-mail já pronto, a tela abre na senha.
                autoFocus={startsAtPassword}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                submitBehavior="submit"
                onSubmitEditing={() => void submit()}
              />
            )}
          />
          {/* O link fica no lugar depois do pedido, desligado só enquanto ele
              anda: dá para pedir de novo, e o foco do leitor de tela não some.
              A confirmação sai acima do pé. */}
          <TextLink
            label={t('auth.signIn.forgot')}
            onPress={requestPasswordReset}
            disabled={disabled || passwordReset.isPending}
            haptic={null}
            style={styles.forgot}
          />
          {/* Embaixo do link, e não acima do pé: o pé fica fora da rolagem, e
              uma frase longa nele, com a fonte grande e o teclado aberto num
              aparelho baixo, tirava da vista o próprio link. Depois dele, o
              link não sai do lugar quando o aviso entra. */}
          {rejectionHint ? (
            <Text variant="caption" color={colors.textSecondary} style={styles.hint}>
              {rejectionHint}
            </Text>
          ) : null}
        </StepField>
      </View>
    </QuestionLayout>
  );
}

const styles = StyleSheet.create({
  // No centro, como a pergunta, com o alvo de 44 a 14 da linha do campo e 12
  // de cada lado do texto, como no desenho.
  forgot: {
    alignSelf: 'center',
    marginTop: spacing.cardPadding,
    paddingHorizontal: spacing.md,
  },
  // Centrado como o link, com o mesmo recuo do texto dele.
  hint: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
});
