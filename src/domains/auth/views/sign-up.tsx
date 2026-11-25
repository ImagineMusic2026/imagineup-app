import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Ticket } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  AccessibilityInfo,
  Keyboard,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';

import { TextInput } from '@/components/text-input';
import { TextLink } from '@/components/text-link';
import { readPendingInvite, subscribePendingInvite } from '@/domains/invites';
import { isFirebaseConfigured } from '@/firebase';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { spacing } from '@/theme';
import { announceFirstError, firstErrorMessage } from '@/utils/form-errors';

import { authErrorMessageKey, type InviteRejection } from '../api';
import { AccountMoment, type AccountMomentPhase } from '../components/account-moment';
import { EmailPill } from '../components/email-pill';
import { FormFooter } from '../components/form-footer';
import { PasswordField } from '../components/password-field';
import { PasswordMeter, passwordMeterStatus } from '../components/password-meter';
import { QuestionLayout, type QuestionLayoutProps } from '../components/question-layout';
import { SocialEntryButtons } from '../components/social-entry-buttons';
import { offstage, StepField } from '../components/step-field';
import { StepFooter } from '../components/step-footer';
import { TermsNotice } from '../components/terms-notice';
import { ACCOUNT_CREATED_HOLD_MS, ENTRY_STEP_COUNT } from '../consts';
import { handOffEmail } from '../email-handoff';
import { backToWelcome, normalizedEmail } from '../entry-questions';
import { useAppleEntry } from '../hooks/use-apple-entry';
import { useGoogleEntry } from '../hooks/use-google-entry';
import type { SocialEntry } from '../hooks/use-social-entry';
import {
  releaseHeldEmailSignUp,
  useFinishSignUp,
  useSignUp,
  type SignUpOutcome,
} from '../hooks/use-sign-up';
import { passwordStrength } from '../password-strength';
import { inviteCodeField, signUpSchema, type SignUpFormInput } from '../schemas';

/**
 * As perguntas do cadastro, uma por vez: o e-mail, o nome e a senha. `invite`
 * é o desvio do código de convite, que sai da pergunta do nome e volta a ela.
 */
type SignUpStep = 'email' | 'name' | 'password' | 'invite';

// Os campos do formulário na ordem das perguntas: é nela que o envio recusado
// procura o primeiro erro.
const FIELD_ORDER = ['email', 'name', 'password', 'inviteCode'] as const;

/** A pergunta em que cada campo do formulário é respondido. */
const FIELD_STEP: Record<(typeof FIELD_ORDER)[number], SignUpStep> = {
  email: 'email',
  name: 'name',
  password: 'password',
  inviteCode: 'invite',
};

const TITLES: Record<SignUpStep, TranslationKey> = {
  email: 'auth.signUp.emailTitle',
  name: 'auth.signUp.nameTitle',
  password: 'auth.signUp.passwordTitle',
  invite: 'auth.signUp.inviteStepTitle',
};

// Até onde a etapa 1 da barra enche em cada pergunta: um terço por pergunta
// respondida. O desvio do convite não anda a barra, porque sai do nome e
// volta a ele. Números fixos: a barra só anda quando o valor muda.
const STEP_FILL: Record<SignUpStep, number> = {
  email: 1 / 3,
  name: 2 / 3,
  invite: 2 / 3,
  password: 1,
};

const REJECTION_MESSAGES: Record<InviteRejection, TranslationKey> = {
  notFound: 'auth.signUp.inviteRejected.notFound',
  notAllowed: 'auth.signUp.inviteRejected.notAllowed',
};

// De qual pergunta é cada erro do envio. Os do e-mail voltam à pergunta dele,
// com o erro no campo; o da senha fica no campo dela; o resto (rede,
// tentativas, cadastro indisponível) vai acima do pé, sem pintar campo nenhum.
const EMAIL_REFUSALS: ReadonlySet<TranslationKey> = new Set<TranslationKey>([
  'auth.errors.emailInUse',
  'validation.emailInvalid',
]);
const PASSWORD_REFUSAL: TranslationKey = 'auth.errors.weakPassword';

// Com o leitor de tela ligado, o "Conta criada" fica 3 s na tela: o tempo de a
// frase ("Conta criada! Agora escolha seus artistas.") terminar de ser falada
// antes de as telas de conta apagarem.
const ACCOUNT_CREATED_SCREEN_READER_HOLD_MS = 3000;

/** O tempo do "Conta criada" na tela, antes de as telas de conta apagarem. */
async function holdAccountCreated(): Promise<void> {
  // Sem resposta do sistema, vale o tempo de quem lê com os olhos.
  const reading = await AccessibilityInfo.isScreenReaderEnabled().catch(() => false);
  const hold = reading ? ACCOUNT_CREATED_SCREEN_READER_HOLD_MS : ACCOUNT_CREATED_HOLD_MS;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, hold);
  });
}

const goToSignIn = () => router.replace('/entrar-com-email');

/**
 * Cadastro, no molde das perguntas da entrada: o e-mail, o nome e a senha, uma
 * pergunta por vez, com a etapa 1 de 2 enchendo a cada uma. As perguntas são
 * passos desta tela, e não rotas: o formulário é um só, a casca, o véu e o pé
 * ficam no lugar, e só a pergunta troca. Os campos de todas as perguntas ficam
 * montados, e só o da pergunta à vista aparece (`StepField`): o foco vai
 * direto de um campo ao outro, e o teclado não fecha entre elas.
 *
 * "Código de convite (opcional)" é o plano B do iOS, que não divide o
 * armazenamento do navegador com o app. Fica num desvio da pergunta do nome
 * ("Tenho um código de convite"), mas vai no envio mesmo sem o desvio: o
 * código do link guardado entra no formulário sozinho, e enviado vazio o
 * convite do link se perderia. O código digitado é conferido no servidor antes
 * de o fã sair. Recusado (não existe ou não vale), a conta já existe: a tela
 * entra no estágio "código recusado", só com o campo do convite, para o fã
 * corrigir o código ou continuar sem ele.
 *
 * Enquanto a conta e o perfil nascem, o fã fica seguro nesta tela (`holdAuth`),
 * sem voltar nem trocar de tela, vendo o "Criando sua conta" e, quando deu
 * certo, o "Conta criada"; só então as telas de conta apagam e o guard troca
 * para a 1l. A pergunta segue montada embaixo do momento, sem desenho. Se o
 * envio falha, ela volta de onde estava (os campos não nascem de novo, e a
 * barra de etapas não enche do zero) e entra subindo, como uma pergunta nova.
 * Desmontada, ela teria de entrar em fade com o véu da casca junto, e a
 * parede de fotos do fundo apareceria por um instante.
 */
export function SignUpScreen() {
  const googleEntry = useGoogleEntry();
  const appleEntry = useAppleEntry();
  // A conta deste envio já nasceu: o momento passa a dizer "Conta criada".
  const [created, setCreated] = useState(false);
  const signUp = useSignUp({
    // A conta existe e o convite passou: o "Conta criada" fica o tempo de ser
    // lido, e só depois as telas de conta apagam.
    beforeExit: () => {
      setCreated(true);
      return holdAccountCreated();
    },
  });
  const finish = useFinishSignUp();
  const [step, setStep] = useState<SignUpStep>('email');
  // Quantas vezes o envio falhou: a pergunta que volta no lugar do "Criando
  // sua conta" entra de novo, subindo, como uma pergunta nova.
  const [failures, setFailures] = useState(0);
  // Quantas vezes o próprio fã trocou de pergunta (`goTo`): só aí o foco do
  // leitor vai ao título. A pergunta que volta por causa de um erro (o envio
  // que falhou, o e-mail recusado, o código recusado) não leva o foco, para o
  // anúncio do erro ser ouvido inteiro.
  const [moves, setMoves] = useState(0);
  // Uma recusa nova a cada vez (o número muda): a mesma recusa duas vezes avisa de novo.
  const [rejection, setRejection] = useState<{ reason: InviteRejection; seq: number } | null>(null);
  // O campo do convite edita um rascunho, e não o formulário: o código só vale
  // depois de conferido, e sair do desvio pelo voltar deixa tudo como estava.
  const [inviteDraft, setInviteDraft] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  // O fã já decidiu o convite no desvio (um código, ou nenhum): o link que
  // chegar depois não troca a decisão dele.
  const inviteDecided = useRef(false);
  const {
    control,
    handleSubmit,
    formState,
    trigger,
    clearErrors,
    setValue,
    getValues,
    getFieldState,
  } = useForm({
    resolver: zodResolver(signUpSchema),
    // O erro de um campo sai quando o fã volta a digitar nele e só volta na
    // conferência seguinte (o botão ou o "ir" do teclado), nunca a cada letra:
    // depois do primeiro envio, a conferência automática mostraria erro numa
    // pergunta que o fã ainda está respondendo.
    reValidateMode: 'onSubmit',
    defaultValues: {
      name: '',
      email: '',
      password: '',
      inviteCode: '',
    } satisfies SignUpFormInput,
  });
  const [email, name, password, inviteCode] = useWatch({
    control,
    name: ['email', 'name', 'password', 'inviteCode'],
  });

  const notConfigured = !isFirebaseConfigured;
  const stage = rejection !== null;
  const pending = signUp.isPending || finish.isPending;
  // A entrada por um provedor em curso: o Google (Android) ou a Apple (iPhone).
  const socialPending = googleEntry.isPending || appleEntry.isPending;
  const socialError = googleEntry.error ?? appleEntry.error;
  // Sem volta: um envio em andamento (a conta nascendo, o convite sendo
  // conferido, a entrada por um provedor) ou a conta que já existe (o estágio).
  const locked = pending || socialPending || stage;
  // O momento dura o envio, que só termina depois de as telas de conta
  // apagarem. Quem tira a tela em seguida é o guard; se ele não trocar a pilha
  // (a sessão caiu no meio do caminho), a pergunta volta, e o fã não fica
  // preso no "Conta criada", sem botão nenhum.
  const moment: AccountMomentPhase | null = !signUp.isPending
    ? null
    : created
      ? 'created'
      : 'creating';
  // A pergunta cujo campo está à vista; no estágio, só o do convite.
  const visible: SignUpStep = stage ? 'invite' : step;

  const submitErrorKey = signUp.isError ? authErrorMessageKey(signUp.error, 'signUp') : null;
  const emailInUse = submitErrorKey === 'auth.errors.emailInUse';
  const emailRefusal =
    submitErrorKey && EMAIL_REFUSALS.has(submitErrorKey) ? t(submitErrorKey) : undefined;
  const passwordRefusal = submitErrorKey === PASSWORD_REFUSAL ? t(submitErrorKey) : undefined;
  const strength = passwordStrength(password);
  const appliedInvite = inviteCode ?? '';
  const inviteEmpty = inviteDraft.trim() === '';
  // O botão do pé fica apagado só com o campo da pergunta vazio. O do convite
  // nunca apaga: vazio, ele segue sem código.
  const empty =
    visible === 'email'
      ? email.trim() === ''
      : visible === 'name'
        ? name.trim() === ''
        : visible === 'password' && password === '';

  // O campo de cada pergunta, para o foco ir a ele quando ela entra.
  const inputs = useRef<Record<SignUpStep, NativeTextInput | null>>({
    email: null,
    name: null,
    password: null,
    invite: null,
  });
  // O campo que tem de estar com o foco agora: o da pergunta à vista. Nenhum
  // embaixo do momento, nem com a conta criada e a tela de saída: o envio
  // termina um instante antes de o guard tirar a tela, e o teclado subiria por
  // cima da 1l. No Android, o `autoFocus` durante a animação da pilha não sobe
  // o teclado: o foco vai de novo ao campo quando a tela termina de entrar,
  // também na volta do link de convite aberto por cima do estágio.
  const focused = useRef<NativeTextInput | null>(null);
  useFocusAfterTransition(focused);
  const leaving = signUp.isSuccess && signUp.data.status === 'done';
  const target = moment || leaving ? null : visible;
  const lastTarget = useRef(target);
  useEffect(() => {
    const input = target ? inputs.current[target] : null;
    focused.current = input;
    // Na primeira montagem, quem foca é o `autoFocus` do e-mail.
    if (lastTarget.current === target) return;
    lastTarget.current = target;
    input?.focus();
  }, [target]);

  // A tela que some no estágio "código recusado" sem passar pelos botões (um
  // link aberto por fora, por exemplo) solta o fã: a trava não fica sem tela.
  useEffect(() => releaseHeldEmailSignUp, []);

  // O código do link guardado vai para o formulário se o fã ainda não decidiu
  // o convite, mesmo que o desvio nunca apareça. No estágio "código recusado",
  // o link que chega agora (o fã pediu o código certo a quem o convidou) entra
  // no lugar do código recusado.
  const fillFromLink = useEffectEvent((code: string) => {
    if (stage) {
      setInviteDraft(code);
      setInviteError(null);
    } else if (!inviteDecided.current) {
      setValue('inviteCode', code);
    }
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
    fill();
    const unsubscribe = subscribePendingInvite(fill);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // O código recusado: o foco no campo dele e o aviso para o leitor de tela (o
  // erro no campo vem junto com a recusa).
  useEffect(() => {
    if (!rejection) return;
    inputs.current.invite?.focus();
    AccessibilityInfo.announceForAccessibility(t(REJECTION_MESSAGES[rejection.reason]));
  }, [rejection]);

  /**
   * Troca de pergunta. O que sobrou do último envio (o erro, que é da
   * pergunta em que apareceu) não passa para a seguinte.
   */
  /** O erro da última entrada por um provedor sai, só do provedor que tem um. */
  const clearSocialErrors = (): void => {
    if (googleEntry.error) googleEntry.reset();
    if (appleEntry.error) appleEntry.reset();
  };

  const goTo = (next: SignUpStep): void => {
    if (signUp.isError || signUp.isSuccess) signUp.reset();
    clearSocialErrors();
    setMoves((count) => count + 1);
    setStep(next);
  };

  // O voltar do pé e o do Android: uma pergunta para trás e, na primeira, para
  // fora da tela. Do convite, só descarta o rascunho.
  const back = (): void => {
    if (locked) return;
    if (step === 'email') backToWelcome();
    else goTo(step === 'name' ? 'email' : 'name');
  };

  // Da segunda pergunta em diante, o voltar do Android volta uma pergunta, e o
  // gesto do iOS fica desligado (ele sairia da tela, e não da pergunta).
  useStayOnScreen(locked ? 'locked' : step === 'email' ? 'free' : 'confirm', back);

  // Voltou a digitar: o erro do campo sai, e com ele o que sobrou do envio.
  const edited = (changed: 'email' | 'name' | 'password'): void => {
    if (formState.errors[changed]) clearErrors(changed);
    if (signUp.isError) signUp.reset();
    clearSocialErrors();
  };

  // Entra pelo provedor tocado. O modo "ligar" só vem do Google (a Apple é
  // confiável e nunca esbarra numa conta de senha).
  const enterWith = async (entry: SocialEntry): Promise<void> => {
    if (locked) return;
    Keyboard.dismiss();
    const outcome = await entry.signIn();
    if (outcome?.status === 'askInvite') {
      router.replace('/codigo-de-convite');
    } else if (outcome?.status === 'link') {
      handOffEmail(outcome.email, 'googleLink');
      goToSignIn();
    }
  };

  // O e-mail e o nome: confere só o campo da pergunta e segue para a próxima.
  const advance = async (): Promise<void> => {
    if (locked || (step !== 'email' && step !== 'name')) return;
    if (await trigger(step, { shouldFocus: true })) {
      goTo(step === 'email' ? 'name' : 'password');
      return;
    }
    // O foco já estava no campo, e focar de novo não faz o leitor de tela falar.
    const errors = { email: getFieldState('email').error, name: getFieldState('name').error };
    announceFirstError(errors, [step]);
  };

  const afterOutcome = (outcome: SignUpOutcome): void => {
    if (outcome.status !== 'inviteRejected') return;
    haptics.trigger('error');
    setInviteError(t(REJECTION_MESSAGES[outcome.reason]));
    setRejection((current) => ({ reason: outcome.reason, seq: (current?.seq ?? 0) + 1 }));
  };

  const submit = handleSubmit(
    (values) => {
      // O "ir" do teclado não passa pelo botão desativado: um envio por vez.
      if (locked || notConfigured) return;
      // O momento não tem campo: o teclado sai com a pergunta.
      Keyboard.dismiss();
      // Todo envio começa pelo "Criando sua conta".
      setCreated(false);
      signUp.mutate(values, {
        onSuccess: (outcome) => {
          // O código recusado é o que foi enviado: é ele que o estágio mostra.
          if (outcome.status === 'inviteRejected') setInviteDraft(values.inviteCode);
          afterOutcome(outcome);
        },
        onError: (error) => {
          setFailures((count) => count + 1);
          // O e-mail recusado (já tem conta, ou o Firebase não o aceita) volta
          // à pergunta dele. A tela não troca sozinha para o entrar: quem só
          // errou uma letra corrige e segue, com o resto ainda no formulário.
          if (EMAIL_REFUSALS.has(authErrorMessageKey(error, 'signUp'))) setStep('email');
        },
      });
    },
    (errors) => {
      // Rede de segurança: cada pergunta já conferiu o campo dela, mas o valor
      // pode ter mudado fora da vista (o preenchimento automático do aparelho
      // pode escrever num campo guardado). A tela vai à pergunta do primeiro
      // erro, com ele no campo, antes do foco e do anúncio.
      const refused = FIELD_ORDER.find((candidate) => errors[candidate]);
      if (refused === 'inviteCode') {
        setInviteDraft(getValues('inviteCode') ?? '');
        setInviteError(firstErrorMessage(errors, ['inviteCode']));
      }
      if (refused) setStep(FIELD_STEP[refused]);
      announceFirstError(errors, FIELD_ORDER);
    },
  );

  // O e-mail que já tem conta vai junto, já normalizado, para o entrar, que
  // abre na senha e diz por quê. Só por este toque.
  const signInWithThisEmail = (): void => {
    if (signUp.variables) handOffEmail(signUp.variables.email, 'emailInUse');
    goToSignIn();
  };

  // O desvio do convite abre com o código que já está no formulário (o do link).
  const openInvite = (): void => {
    setInviteDraft(getValues('inviteCode') ?? '');
    setInviteError(null);
    goTo('invite');
  };

  /**
   * O código do rascunho, já normalizado e pronto para valer (vazio é "sem
   * código"), ou `null` quando ele não tem o formato: aí o erro vai para o
   * campo, com o foco nele e o aviso para o leitor de tela. Quem confere se o
   * código existe é o servidor.
   */
  const checkedInvite = (): string | null => {
    const parsed = inviteCodeField.safeParse(inviteDraft);
    if (parsed.success) return parsed.data;
    const message = parsed.error.issues[0]?.message ?? t('validation.inviteCodeInvalid');
    setInviteError(message);
    inputs.current.invite?.focus();
    AccessibilityInfo.announceForAccessibility(message);
    return null;
  };

  // O botão do desvio: o código conferido vai para o formulário e a tela volta
  // ao nome. Vazio ("Continuar sem código"), tira o convite, também o do link.
  const confirmInvite = (): void => {
    const code = checkedInvite();
    if (code === null) return;
    inviteDecided.current = true;
    setValue('inviteCode', code);
    goTo('name');
  };

  // O "Continuar" do estágio: o código corrigido vai de novo ao servidor.
  const retryInvite = (): void => {
    if (pending) return;
    const code = checkedInvite();
    if (code === null) return;
    finish.mutate({ inviteCode: code }, { onSuccess: afterOutcome });
  };

  const skipInvite = (): void => {
    if (pending) return;
    finish.mutate({ inviteCode: '' }, { onSuccess: afterOutcome });
  };

  // O que o botão do pé faz em cada pergunta. O "próximo" e o "ir" do teclado
  // fazem o mesmo, sem fechar o teclado.
  const action = stage
    ? { label: t('auth.signUp.continue'), run: retryInvite }
    : step === 'invite'
      ? {
          label: inviteEmpty ? t('auth.signUp.skipInvite') : t('common.continue'),
          run: confirmInvite,
        }
      : step === 'password'
        ? { label: t('auth.signUp.submit'), run: () => void submit() }
        : { label: t('common.continue'), run: () => void advance() };

  // Uma mensagem por vez acima do pé. A do envio que não é de um campo (rede,
  // tentativas, cadastro indisponível) aparece na pergunta da senha, de onde o
  // envio saiu, e não segue o fã: trocar de pergunta a apaga (`goTo`).
  let notice: QuestionLayoutProps['notice'];
  if (notConfigured) {
    notice = { text: t('auth.missingConfig'), tone: 'danger' };
  } else if (visible === 'email' && socialError) {
    notice = { text: t(socialError), tone: 'danger' };
  } else if (submitErrorKey && !emailRefusal && !passwordRefusal) {
    notice = { text: t(submitErrorKey), tone: 'danger' };
  }

  let secondary: ReactNode;
  if (stage) {
    // Irmão do botão, nunca dentro dele: segue para a 1l sem o convite.
    secondary = (
      <TextLink
        label={t('auth.signUp.skipInvite')}
        onPress={skipInvite}
        disabled={pending}
        style={styles.link}
      />
    );
  } else if (step === 'email') {
    secondary = (
      <FormFooter
        question={t('auth.signUp.haveAccount')}
        actionLabel={t('auth.signUp.signIn')}
        onAction={goToSignIn}
        disabled={socialPending}
      />
    );
  } else if (step === 'name') {
    // Com código no formulário (o do link, ou o digitado), a linha o mostra.
    secondary = (
      <TextLink
        label={
          appliedInvite
            ? t('auth.signUp.inviteApplied', { code: appliedInvite })
            : t('auth.signUp.haveInvite')
        }
        accessibilityLabel={
          appliedInvite ? t('auth.signUp.inviteAppliedLabel', { code: appliedInvite }) : undefined
        }
        icon={Ticket}
        onPress={openInvite}
        style={styles.link}
      />
    );
  }

  return (
    <View style={styles.fill}>
      {/* A caixa da pergunta existe nos dois estados, como a de cada campo
          (`StepField`): achatada quando à vista, ela tiraria a pergunta de um
          pai e a poria no outro na volta do momento, e o campo que acabou de
          receber o foco o perderia. */}
      <View
        collapsable={false}
        {...offstage(moment !== null)}
        style={[styles.fill, moment ? styles.covered : null]}
      >
        <QuestionLayout
          progress={{ current: 1, total: ENTRY_STEP_COUNT, fill: stage ? 1 : STEP_FILL[step] }}
          stepKey={stage ? 'rejected' : `${step}:${failures}`}
          focusKey={String(moves)}
          above={
            !stage && step === 'password' ? (
              <EmailPill email={normalizedEmail(email)} onPress={() => goTo('email')} />
            ) : undefined
          }
          title={stage ? t('auth.signUp.inviteRejected.title') : t(TITLES[step])}
          lead={
            stage
              ? t('auth.signUp.inviteRejected.lead')
              : step === 'invite'
                ? t('auth.signUp.inviteCodeHint')
                : undefined
          }
          notice={notice}
          secondary={secondary}
          footer={
            <StepFooter
              // No estágio a conta já existe: não há pergunta para onde voltar.
              onBack={stage ? undefined : back}
              backDisabled={socialPending}
              label={action.label}
              onPress={action.run}
              loading={stage && finish.isPending}
              disabled={empty || socialPending || (visible === 'password' && notConfigured)}
              accessibilityHint={empty ? t('auth.emptyHint') : undefined}
            />
          }
        >
          <View>
            <StepField shown={visible === 'email'}>
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
                    error={formState.errors.email?.message ?? emailRefusal}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    // "username" pareia e-mail e senha nova no preenchimento automático do iOS.
                    textContentType="username"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => void advance()}
                  />
                )}
              />
              {/* E-mail que já tem conta: o atalho para entrar fica logo abaixo do erro. */}
              {emailInUse ? (
                <TextLink
                  label={t('auth.signUp.signIn')}
                  accessibilityLabel={t('auth.signUp.signInWithEmail')}
                  onPress={signInWithThisEmail}
                  disabled={socialPending}
                  style={styles.link}
                />
              ) : null}
              {visible === 'email' ? (
                <SocialEntryButtons
                  google={
                    googleEntry.available
                      ? {
                          onPress: () => void enterWith(googleEntry),
                          loading: googleEntry.isPending,
                        }
                      : null
                  }
                  apple={
                    appleEntry.available
                      ? {
                          onPress: () => void enterWith(appleEntry),
                          loading: appleEntry.isPending,
                        }
                      : null
                  }
                  disabled={pending}
                  showTerms
                />
              ) : null}
            </StepField>
            <StepField shown={visible === 'name'}>
              <Controller
                control={control}
                name="name"
                render={({ field: { ref, onChange, onBlur, value } }) => (
                  <TextInput
                    ref={(node) => {
                      ref(node);
                      inputs.current.name = node;
                    }}
                    variant="hero"
                    label={t('auth.signUp.name')}
                    labelHidden
                    placeholder={t('auth.signUp.name')}
                    // A frase saiu da tela a pedido do dono: fica só para o leitor de tela.
                    accessibilityStatus={t('auth.signUp.nameHint')}
                    value={value}
                    onChangeText={(text) => {
                      onChange(text);
                      edited('name');
                    }}
                    onBlur={onBlur}
                    error={formState.errors.name?.message}
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => void advance()}
                  />
                )}
              />
            </StepField>
            <StepField shown={visible === 'password'}>
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
                    // O medidor embaixo do campo não fala: a regra e a força
                    // chegam ao leitor de tela por aqui, junto com o erro.
                    accessibilityStatus={passwordMeterStatus(strength)}
                    value={value}
                    onChangeText={(text) => {
                      onChange(text);
                      edited('password');
                    }}
                    onBlur={onBlur}
                    error={formState.errors.password?.message ?? passwordRefusal}
                    autoComplete="new-password"
                    // O iOS sugere uma senha forte.
                    textContentType="newPassword"
                    returnKeyType="go"
                    submitBehavior="submit"
                    onSubmitEditing={() => void submit()}
                  />
                )}
              />
              <PasswordMeter strength={strength} style={styles.meter} />
              <TermsNotice variant="signUp" style={styles.terms} />
            </StepField>
            <StepField shown={visible === 'invite'}>
              <TextInput
                ref={(node) => {
                  inputs.current.invite = node;
                }}
                variant="hero"
                // O nome do campo fica à vista, no exemplo: os Termos e o FAQ
                // do site citam o campo "Código de convite (opcional)".
                label={t('auth.signUp.inviteCode')}
                labelHidden
                placeholder={t('auth.signUp.inviteCode')}
                // A dica é o texto de apoio da pergunta; o leitor a ouve também no campo.
                accessibilityStatus={t('auth.signUp.inviteCodeHint')}
                value={inviteDraft}
                onChangeText={(text) => {
                  setInviteDraft(text);
                  // Voltou a digitar: o erro sai, o do formato e o da recusa.
                  if (inviteError) setInviteError(null);
                }}
                error={inviteError ?? undefined}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                returnKeyType={stage ? 'go' : 'done'}
                submitBehavior="submit"
                onSubmitEditing={stage ? retryInvite : confirmInvite}
                testID="sign-up-invite-code"
              />
            </StepField>
          </View>
        </QuestionLayout>
      </View>
      {moment ? (
        <View style={StyleSheet.absoluteFill}>
          <AccountMoment phase={moment} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  // A pergunta embaixo do momento: montada, sem desenho.
  covered: {
    opacity: 0,
  },
  // No centro, como a pergunta, com o alvo de 44 do tamanho do texto.
  link: {
    alignSelf: 'center',
  },
  // A 12 da linha do campo, como no desenho.
  meter: {
    marginTop: spacing.md,
  },
  // O aviso dos termos a 22 da regra da senha.
  terms: {
    marginTop: spacing.gutterOnboarding,
  },
});
