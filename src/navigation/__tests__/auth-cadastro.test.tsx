import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { FirebaseError } from 'firebase/app';
import { createUserWithEmailAndPassword, updateProfile, type UserCredential } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  StyleSheet,
  Text,
  TextInput as NativeTextInput,
} from 'react-native';

import AuthLayout from '@/app/(auth)/_layout';
import SignUpRoute from '@/app/(auth)/cadastro';
import SocialInviteRoute from '@/app/(auth)/codigo-de-convite';
import WelcomeRoute from '@/app/(auth)/entrar';
import SignInRoute from '@/app/(auth)/entrar-com-email';
import InviteRoute from '@/app/convite/[codigo]';
import { StepProgress } from '@/components/step-progress';
import { sendInviteClaim } from '@/domains/auth/api';
import { QuestionLayout } from '@/domains/auth/components/question-layout';
import { clearHandedOffEmail } from '@/domains/auth/email-handoff';
import * as authExit from '@/domains/auth/hooks/use-auth-exit';
import { holdSocialInvite } from '@/domains/auth/hooks/use-sign-up';
import type { SocialEntryOutcome } from '@/domains/auth/hooks/use-social-entry';
import { readBoundInvite, readPendingInvite, savePendingInvite } from '@/domains/invites';
import * as focusAfterTransition from '@/hooks/use-focus-after-transition';
import { useSessionGate } from '@/hooks/use-session-gate';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// O cadastro (`/cadastro`) dentro do grupo `(auth)`, uma pergunta por vez na
// mesma tela: o e-mail, o nome e a senha, com o desvio do código de convite.
// Aqui ficam a troca entre as perguntas (o botão, o teclado, a pílula e os
// voltares), as regras de cada campo, o envio com a trava e os dois momentos
// ("Criando sua conta" e "Conta criada"), os erros do envio, o e-mail que já
// tem conta e o estágio "código recusado". A abertura e o que é comum às telas
// de conta ficam em `auth.test.tsx`; o entrar com e-mail, em
// `auth-entrar.test.tsx`.

// O build do Firebase que o Jest resolve é ESM; as telas só precisam destas peças.
jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(() => () => undefined),
}));

// Sem .env no Jest: a API fica de fora (fixtures) e o aviso de configuração não polui a saída.
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

let mockGoogleAvailable = false;
let mockGooglePending = false;
let mockGoogleError: TranslationKey | null = null;
const mockGoogleSignIn = jest.fn<Promise<SocialEntryOutcome | undefined>, []>();
const mockGoogleReset = jest.fn(() => {
  mockGoogleError = null;
});
jest.mock('@/domains/auth/hooks/use-google-entry', () => ({
  useGoogleEntry: () => ({
    available: mockGoogleAvailable,
    isPending: mockGooglePending,
    error: mockGoogleError,
    signIn: mockGoogleSignIn,
    reset: mockGoogleReset,
  }),
}));

// A Apple (seção 39), no lugar do núcleo da entrada: a tela só decide o que
// fazer com o resultado. O botão é o falso do `jest.setup.js`.
let mockAppleAvailable = false;
let mockApplePending = false;
let mockAppleError: TranslationKey | null = null;
const mockAppleSignIn = jest.fn<Promise<SocialEntryOutcome | undefined>, []>();
const mockAppleReset = jest.fn(() => {
  mockAppleError = null;
});
jest.mock('@/domains/auth/hooks/use-apple-entry', () => ({
  useAppleEntry: () => ({
    available: mockAppleAvailable,
    isPending: mockApplePending,
    error: mockAppleError,
    signIn: mockAppleSignIn,
    reset: mockAppleReset,
  }),
}));

// Um teste desliga o Firebase para ver a tela sem configuração.
let mockFirebaseConfigured = true;
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  get isFirebaseConfigured() {
    return mockFirebaseConfigured;
  },
}));

// O claim do convite é o do app de verdade, menos a ida ao servidor.
jest.mock('@/domains/auth/api', () => ({
  ...jest.requireActual('@/domains/auth/api'),
  sendInviteClaim: jest.fn(async () => ({ status: 'claimed' })),
}));

// O "Conta criada" fica 1,1 s na tela antes de as telas de conta apagarem:
// aqui, tempo nenhum. O tempo do leitor de tela tem teste próprio.
jest.mock('@/domains/auth/consts', () => ({
  ...jest.requireActual('@/domains/auth/consts'),
  ACCOUNT_CREATED_HOLD_MS: 0,
}));

function RootLayout() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  });
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

/**
 * O grupo `(auth)` de verdade, pelos próprios arquivos de rota: a pilha com o
 * fundo da 1k e as três telas de conta. Assim a rota fina que aponta para cada
 * tela (`/entrar` é a abertura) também fica travada. A rota do convite, fora
 * dos guards, recebe o link aberto por fora no meio do cadastro.
 */
const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': AuthLayout,
  '(auth)/entrar': WelcomeRoute,
  '(auth)/entrar-com-email': SignInRoute,
  '(auth)/cadastro': SignUpRoute,
  '(auth)/codigo-de-convite': SocialInviteRoute,
  'convite/[codigo]': InviteRoute,
};

/** A pilha raiz com os guards do app: quem troca o cadastro pela 1l é o guard. */
function GuardedRootLayout() {
  const { signedIn, onboarded } = useSessionGate();
  // O guard renderiza o layout de novo: o cliente é um só.
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}

const guardedTree = {
  _layout: GuardedRootLayout,
  '(auth)/_layout': AuthLayout,
  '(auth)/entrar': WelcomeRoute,
  '(auth)/cadastro': SignUpRoute,
  '(onboarding)/_layout': () => <Stack />,
  '(onboarding)/artistas': () => <Text>escolha de artistas</Text>,
};

const EMAIL = 'camila@x.com';
const NAME = 'Camila Ribeiro';
const PASSWORD = 'senha-123';

// Os dois nomes abaixo levam caracteres invisíveis de propósito. Copie as
// linhas, não redigite: sem eles, o primeiro teste deixa de provar a limpeza
// do nome e o segundo passa a mandar um nome válido.
// Com os isolantes bidi (U+2066 e U+2069) e espaços nas pontas: sai limpo.
const NAME_WITH_ISOLATES = ' ⁦Camila Ribeiro⁩ ';
// Com um espaço de largura zero (U+200B) no fim: a regra recusa.
const NAME_WITH_ZERO_WIDTH = 'Camila​';

const EMAIL_TITLE = t('auth.signUp.emailTitle');
const NAME_TITLE = t('auth.signUp.nameTitle');
const PASSWORD_TITLE = t('auth.signUp.passwordTitle');
const INVITE_TITLE = t('auth.signUp.inviteStepTitle');
const REJECTED_TITLE = t('auth.signUp.inviteRejected.title');
const CREATING = t('auth.signUp.creating');
const CREATED = t('auth.signUp.created.title');
const EMPTY_HINT = t('auth.emptyHint');
const NAME_HINT = t('auth.signUp.nameHint');
const INVITE_HINT = t('auth.signUp.inviteCodeHint');
const PASSWORD_RULE = t('auth.signUp.passwordHint', { min: 6 });
const HAVE_INVITE = t('auth.signUp.haveInvite');
const SKIP_INVITE = t('auth.signUp.skipInvite');
const SIGN_IN_WITH_EMAIL = t('auth.signUp.signInWithEmail');

const user = { uid: 'nova', email: EMAIL, displayName: null, photoURL: null };

const createUser = jest.mocked(createUserWithEmailAndPassword);
const claim = jest.mocked(sendInviteClaim);
const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);
const holds = () => useSessionStore.getState().authHolds;

const emailField = () => screen.getByLabelText(t('auth.email'));
const nameField = () => screen.getByLabelText(t('auth.signUp.name'));
const passwordField = () => screen.getByLabelText(t('auth.password'));
const inviteField = () => screen.getByLabelText(t('auth.signUp.inviteCode'));
const button = (name: string) => screen.getByRole('button', { name });
const next = () => button(t('common.continue'));
const createButton = () => button(t('auth.signUp.submit'));
const back = () => button(t('common.back'));
const pill = (email = EMAIL) => button(t('auth.emailPill', { email }));
const title = (name: string) => screen.getByRole('header', { name });
/** A linha do convite na pergunta do nome, com o código que está no formulário. */
const appliedInvite = (code: string) => button(t('auth.signUp.inviteAppliedLabel', { code }));
/** A força da senha na frase que o campo dá ao leitor de tela. */
const strengthStatus = (level: 'short' | 'good' | 'strong') =>
  `${PASSWORD_RULE} ${t('auth.signUp.strength.status', { level: t(`auth.signUp.strength.${level}`) })}`;

/** Até onde a etapa 1 da barra enche. */
const barFill = () => screen.UNSAFE_getByType(StepProgress).props.currentFill as number;
/** A chave que a casca recebe: quando muda, a pergunta entra subindo e o leitor vai ao título. */
const questionKey = () => screen.UNSAFE_getByType(QuestionLayout).props.stepKey;
/** A chave do foco do leitor de tela: só muda quando o fã troca de pergunta. */
const focusKey = () => screen.UNSAFE_getByType(QuestionLayout).props.focusKey;

// O mock do React Native põe o `focus` dos campos no protótipo: um só para todos.
const focus = jest.mocked(NativeTextInput.prototype.focus);
/** O campo que recebeu o foco por último, pelo rótulo dele. */
const lastFocused = (): string | undefined =>
  (focus.mock.contexts.at(-1) as NativeTextInput | undefined)?.props.accessibilityLabel;

/**
 * As caixas (em host) em volta do nó que a tela tira e põe na vista, de dentro
 * para fora: a do campo da pergunta e a da pergunta inteira.
 */
function keptBoxes(node: ReturnType<typeof screen.getByLabelText>) {
  const boxes: (typeof node)[] = [];
  for (let current = node.parent; current; current = current.parent) {
    const kept = current.props.accessibilityElementsHidden !== undefined;
    if (typeof current.type === 'string' && kept) boxes.push(current);
  }
  return boxes;
}

const openSignUp = () => renderRouter(appTree, { initialUrl: '/cadastro' });

/** Responde a pergunta do e-mail pelo botão; a tela passa à do nome. */
async function answerEmail(email = EMAIL): Promise<void> {
  fireEvent.changeText(emailField(), email);
  await act(async () => {
    fireEvent.press(next());
  });
  await screen.findByRole('header', { name: NAME_TITLE });
}

/** Responde a pergunta do nome pelo botão; a tela passa à da senha. */
async function answerName(name = NAME): Promise<void> {
  fireEvent.changeText(nameField(), name);
  await act(async () => {
    fireEvent.press(next());
  });
  await screen.findByRole('header', { name: PASSWORD_TITLE });
}

/** Abre o cadastro e responde o e-mail e o nome: a tela fica na pergunta da senha. */
async function openPasswordStep(email = EMAIL, name = NAME) {
  const view = openSignUp();
  await answerEmail(email);
  await answerName(name);
  return view;
}

/** Digita a senha e manda pelo "Criar conta". */
async function createAccount(password = PASSWORD): Promise<void> {
  fireEvent.changeText(passwordField(), password);
  await act(async () => {
    fireEvent.press(createButton());
  });
}

/** Na pergunta do nome, abre o desvio do convite, digita o código e confirma: a tela volta ao nome. */
function addInvite(code: string): void {
  fireEvent.press(button(HAVE_INVITE));
  fireEvent.changeText(inviteField(), code);
  fireEvent.press(next());
}

/** O cadastro inteiro com um código de convite digitado no desvio. */
async function signUpWithInvite(code: string) {
  const view = openSignUp();
  await answerEmail();
  addInvite(code);
  await answerName();
  await createAccount();
  return view;
}

type ProfileListener = (snapshot: {
  exists: () => boolean;
  data: () => { displayName: string };
}) => void;

/** O perfil como a função de cadastro o cria, com o nome que leu da conta. */
const newProfile = { exists: () => true, data: () => ({ displayName: NAME }) };

/** O perfil nasce na hora em que o cadastro passa a esperar por ele: o padrão destes testes. */
function profileArrivesAtOnce(): void {
  jest.mocked(onSnapshot).mockImplementation(((_ref: unknown, listener: ProfileListener) => {
    listener(newProfile);
    return () => undefined;
  }) as unknown as typeof onSnapshot);
}

/**
 * O perfil só nasce quando o teste manda: até lá, a conta está nascendo e o fã
 * segue seguro. Quem segura o perfil o solta antes de terminar, senão a espera
 * de 20 s do cadastro vence no meio de outro teste.
 */
function holdProfile(): { arrive: () => void } {
  let waiting: ProfileListener | null = null;
  jest.mocked(onSnapshot).mockImplementation(((_ref: unknown, listener: ProfileListener) => {
    waiting = listener;
    return () => undefined;
  }) as unknown as typeof onSnapshot);
  return { arrive: () => act(() => waiting?.(newProfile)) };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type BackListener = () => boolean | null | undefined;

/**
 * Vigia quem escuta o voltar do Android: `press` chama a escuta registrada por
 * último que ainda está de pé. A que a tela tira (ao soltar o fã) sai da lista:
 * o voltar passa à escuta de baixo, a da navegação, que tira a tela.
 */
function watchAndroidBack() {
  const add = BackHandler.addEventListener.bind(BackHandler);
  const listeners: BackListener[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
    const subscription = add(event, handler);
    if (event !== 'hardwareBackPress') return subscription;
    // A escuta da tela não lê o evento: o teste a chama sem ele.
    const listener = handler as BackListener;
    listeners.push(listener);
    return {
      remove: () => {
        const index = listeners.lastIndexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
        subscription.remove();
      },
    };
  });
  return {
    press: (): boolean | null | undefined => {
      let handled: boolean | null | undefined;
      act(() => {
        handled = listeners.at(-1)?.();
      });
      return handled;
    },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  clearHandedOffEmail();
  mockFirebaseConfigured = true;
  mockGoogleAvailable = false;
  mockGooglePending = false;
  mockGoogleError = null;
  mockGoogleSignIn.mockReset();
  mockAppleAvailable = false;
  mockApplePending = false;
  mockAppleError = null;
  mockAppleSignIn.mockReset();
  // Cada teste diz o que o Firebase e o servidor respondem; sem dizer, dá certo.
  createUser.mockReset().mockResolvedValue({ user } as unknown as UserCredential);
  claim.mockReset().mockImplementation(async () => ({ status: 'claimed' }));
  jest.mocked(onSnapshot).mockReset();
  profileArrivesAtOnce();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  // O `AccessibilityInfo` do Jest já é um mock, e o `restoreAllMocks` não o
  // devolve ao que era: o leitor de tela desligado é dito de novo a cada teste.
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('entrada no app', () => {
  it('o cadastro mostra a etapa 1 de 2', () => {
    renderRouter(appTree, { initialUrl: '/cadastro' });
    expect(
      screen.getByRole('progressbar', {
        name: t('components.stepProgress.label', { current: 1, total: 2 }),
      }),
    ).toBeTruthy();
  });

  it('a etapa 1 enche um terço a cada pergunta, e o desvio do convite não a anda', async () => {
    openSignUp();
    expect(barFill()).toBe(1 / 3);

    await answerEmail();
    expect(barFill()).toBe(2 / 3);

    fireEvent.press(button(HAVE_INVITE));
    expect(barFill()).toBe(2 / 3);
    fireEvent.press(back());

    await answerName();
    expect(barFill()).toBe(1);
    // Em toda pergunta, o leitor de tela ouve a mesma etapa.
    expect(
      screen.getByRole('progressbar', {
        name: t('components.stepProgress.label', { current: 1, total: 2 }),
      }),
    ).toBeTruthy();
  });
});

describe('cadastro: uma pergunta por vez', () => {
  it('mostra a entrada com Google só na pergunta do e-mail', async () => {
    mockGoogleAvailable = true;
    openSignUp();

    const googleButton = { name: t('auth.google.continue') };
    expect(screen.getByRole('button', googleButton)).toBeTruthy();
    expect(screen.getByRole('link', { name: t('auth.terms.termsLink') })).toBeTruthy();

    await answerEmail();

    expect(screen.queryByRole('button', googleButton)).toBeNull();
  });

  it('os dois nomes de teste continuam com os caracteres invisíveis', () => {
    expect(NAME_WITH_ISOLATES.startsWith(' \u2066')).toBe(true);
    expect(NAME_WITH_ISOLATES.endsWith('\u2069 ')).toBe(true);
    expect(NAME_WITH_ZERO_WIDTH).toBe('Camila\u200B');
  });

  it('abre na pergunta do e-mail, só com o campo dela e o link para quem já tem conta', () => {
    openSignUp();

    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField().props).toMatchObject({
      value: '',
      placeholder: t('auth.emailPlaceholder'),
      autoFocus: true,
      autoCapitalize: 'none',
      autoCorrect: false,
      autoComplete: 'email',
      keyboardType: 'email-address',
      // "username" pareia e-mail e senha nova no preenchimento automático do iOS.
      textContentType: 'username',
    });
    // Os campos das outras perguntas não aparecem, nem para o leitor de tela.
    expect(screen.queryByLabelText(t('auth.signUp.name'))).toBeNull();
    expect(screen.queryByLabelText(t('auth.password'))).toBeNull();
    expect(screen.queryByLabelText(t('auth.signUp.inviteCode'))).toBeNull();
    expect(screen.queryByRole('link', { name: t('auth.terms.termsLink') })).toBeNull();
    expect(screen.getByText(t('auth.signUp.haveAccount'))).toBeTruthy();
    expect(button(t('auth.signUp.signIn'))).toBeTruthy();
  });

  it('a pergunta do nome: o campo dela, a frase só para o leitor de tela e o desvio do convite', async () => {
    openSignUp();
    await answerEmail();

    expect(title(NAME_TITLE)).toBeTruthy();
    expect(nameField().props).toMatchObject({
      value: '',
      placeholder: t('auth.signUp.name'),
      // A frase saiu da tela a pedido do dono e ficou só para o leitor.
      accessibilityHint: NAME_HINT,
      autoCapitalize: 'words',
      autoComplete: 'name',
      textContentType: 'name',
    });
    expect(screen.queryByText(NAME_HINT, { includeHiddenElements: true })).toBeNull();
    expect(button(HAVE_INVITE)).toBeTruthy();
    expect(screen.queryByLabelText(t('auth.email'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.signUp.signIn') })).toBeNull();
  });

  it('a pergunta da senha: o e-mail na pílula, a regra lida com o campo, o medidor e os termos', async () => {
    await openPasswordStep(' Camila@X.com ');

    expect(title(PASSWORD_TITLE)).toBeTruthy();
    // A pílula mostra o e-mail como ele vai para a conta.
    expect(pill()).toBeTruthy();
    expect(passwordField().props).toMatchObject({
      value: '',
      placeholder: t('auth.passwordPlaceholder'),
      secureTextEntry: true,
      autoComplete: 'new-password',
      // O iOS sugere uma senha forte.
      textContentType: 'newPassword',
      // Sem senha, o leitor ouve só a regra.
      accessibilityHint: PASSWORD_RULE,
    });
    // A regra fica escrita embaixo do campo, e não no exemplo, que some ao digitar.
    expect(screen.getByText(PASSWORD_RULE, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('auth.terms.termsLink') })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('auth.terms.privacyLink') })).toBeTruthy();
    expect(createButton()).toBeTruthy();

    // A força aparece em texto no medidor e chega ao leitor pelo campo.
    fireEvent.changeText(passwordField(), '123');
    expect(passwordField()).toHaveProp('accessibilityHint', strengthStatus('short'));
    expect(
      screen.getByText(t('auth.signUp.strength.short'), { includeHiddenElements: true }),
    ).toBeTruthy();
    fireEvent.changeText(passwordField(), PASSWORD);
    expect(passwordField()).toHaveProp('accessibilityHint', strengthStatus('good'));
    fireEvent.changeText(passwordField(), 'Senha-forte-123');
    expect(passwordField()).toHaveProp('accessibilityHint', strengthStatus('strong'));
  });

  it('o botão do pé fica apagado só com o campo vazio, e diz por quê', async () => {
    openSignUp();

    expect(next()).toBeDisabled();
    expect(next()).toHaveProp('accessibilityHint', EMPTY_HINT);
    // Só espaços ainda é vazio.
    fireEvent.changeText(emailField(), '   ');
    expect(next()).toBeDisabled();
    // Com texto, acende mesmo fora do formato: quem confere é o toque.
    fireEvent.changeText(emailField(), 'c');
    expect(next()).toBeEnabled();
    expect(next().props.accessibilityHint).toBeUndefined();

    await answerEmail();
    expect(next()).toBeDisabled();
    expect(next()).toHaveProp('accessibilityHint', EMPTY_HINT);
    fireEvent.changeText(nameField(), 'C');
    expect(next()).toBeEnabled();

    await answerName();
    expect(createButton()).toBeDisabled();
    expect(createButton()).toHaveProp('accessibilityHint', EMPTY_HINT);
    // Na senha, espaço é caractere: o botão acende.
    fireEvent.changeText(passwordField(), ' ');
    expect(createButton()).toBeEnabled();
    expect(createButton().props.accessibilityHint).toBeUndefined();
  });

  it('o "próximo" do teclado faz o mesmo que o botão, sem fechar o teclado', async () => {
    openSignUp();
    expect(emailField()).toHaveProp('submitBehavior', 'submit');

    // Vazio, o teclado não passa pelo botão apagado: o erro aparece e é anunciado.
    await act(async () => {
      fireEvent(emailField(), 'submitEditing');
    });
    await waitFor(() =>
      expect(emailField()).toHaveProp('accessibilityHint', t('validation.emailInvalid')),
    );
    expect(announce()).toHaveBeenCalledWith(t('validation.emailInvalid'));
    expect(title(EMAIL_TITLE)).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(emailField(), EMAIL);
    });
    await act(async () => {
      fireEvent(emailField(), 'submitEditing');
    });
    expect(await screen.findByRole('header', { name: NAME_TITLE })).toBeTruthy();

    expect(nameField()).toHaveProp('submitBehavior', 'submit');
    fireEvent.changeText(nameField(), NAME);
    await act(async () => {
      fireEvent(nameField(), 'submitEditing');
    });
    expect(await screen.findByRole('header', { name: PASSWORD_TITLE })).toBeTruthy();
    expect(passwordField()).toHaveProp('submitBehavior', 'submit');
  });

  it('a pergunta que entra recebe o foco no campo dela, e o campo que sai continua montado, com o que foi digitado', async () => {
    openSignUp();
    const email = emailField();

    await answerEmail();
    expect(lastFocused()).toBe(t('auth.signUp.name'));
    // O campo do e-mail não sai da árvore (sairia com o foco, e o teclado
    // fecharia entre as perguntas): fica guardado, fora da vista e do leitor.
    const stored = screen.getByLabelText(t('auth.email'), { includeHiddenElements: true });
    expect(stored).toBe(email);
    expect(stored).toHaveProp('value', EMAIL);

    await answerName();
    expect(lastFocused()).toBe(t('auth.password'));

    fireEvent.press(back());
    expect(lastFocused()).toBe(t('auth.signUp.name'));
    fireEvent.press(button(HAVE_INVITE));
    expect(lastFocused()).toBe(t('auth.signUp.inviteCode'));
  });

  it('as caixas que guardam o campo e a pergunta existem de verdade nos dois estados, sem desenho quando fora da vista', async () => {
    const held = holdProfile();
    openSignUp();
    const [fieldBox, questionBox, ...others] = keptBoxes(emailField());
    expect(others).toHaveLength(0);

    // Achatada pelo React Native quando à vista, a caixa tiraria o campo de um
    // pai e o poria no outro a cada troca: o campo com o foco o perderia ali,
    // e o teclado fecharia entre as perguntas.
    expect(fieldBox).toHaveProp('collapsable', false);
    expect(questionBox).toHaveProp('collapsable', false);
    expect(fieldBox?.props).toMatchObject({
      pointerEvents: 'auto',
      accessibilityElementsHidden: false,
      importantForAccessibility: 'auto',
    });
    expect(fieldBox?.props.style).toBeUndefined();

    // Fora da pergunta dele, o campo fica guardado: fora do fluxo, sem desenho,
    // sem toque e fora do leitor. Opacidade zero, e não `display: 'none'`, que
    // tiraria o foco dele antes de o seguinte recebê-lo.
    await answerEmail();
    expect(fieldBox).toHaveStyle({ position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 });
    expect(StyleSheet.flatten(fieldBox?.props.style).display).toBeUndefined();
    expect(fieldBox?.props).toMatchObject({
      collapsable: false,
      pointerEvents: 'none',
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    expect(questionBox?.props).toMatchObject({
      pointerEvents: 'auto',
      accessibilityElementsHidden: false,
    });
    expect(StyleSheet.flatten(questionBox?.props.style).opacity).toBeUndefined();

    // Embaixo do "Criando sua conta", a pergunta inteira fica do mesmo jeito.
    await answerName();
    await createAccount();
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    expect(questionBox).toHaveStyle({ flex: 1, opacity: 0 });
    expect(questionBox?.props).toMatchObject({
      collapsable: false,
      pointerEvents: 'none',
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });

    held.arrive();
    await waitFor(() => expect(holds()).toBe(0));
  });

  it('o campo da pergunta à vista é o que recebe o foco de novo quando a tela termina de entrar', async () => {
    const hook = jest.spyOn(focusAfterTransition, 'useFocusAfterTransition');
    openSignUp();

    // O ref que a tela entrega ao hook: no Android, é por ele que o teclado
    // sobe depois da animação da pilha. O ref é um só, e o campo dentro dele
    // troca com a pergunta.
    const input = hook.mock.calls.at(-1)?.[0];
    expect(input?.current?.props.accessibilityLabel).toBe(t('auth.email'));

    await answerEmail();
    expect(input?.current?.props.accessibilityLabel).toBe(t('auth.signUp.name'));
    await answerName();
    expect(input?.current?.props.accessibilityLabel).toBe(t('auth.password'));
  });
});

describe('cadastro: as regras de cada campo', () => {
  it('e-mail fora do formato: o erro fica no campo, é anunciado, e a pergunta não muda', async () => {
    openSignUp();
    const message = t('validation.emailInvalid');

    fireEvent.changeText(emailField(), 'camila');
    await act(async () => {
      fireEvent.press(next());
    });

    await waitFor(() => expect(emailField()).toHaveProp('accessibilityHint', message));
    expect(screen.getByText(message, { includeHiddenElements: true })).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(message);
    expect(lastFocused()).toBe(t('auth.email'));
    expect(title(EMAIL_TITLE)).toBeTruthy();

    // Voltou a digitar: o erro sai, mesmo com o e-mail ainda fora do formato.
    // Ele só é conferido de novo no botão ou no "próximo" do teclado.
    fireEvent.changeText(emailField(), 'camila@');
    expect(emailField().props.accessibilityHint).toBeUndefined();
    expect(screen.queryByText(message, { includeHiddenElements: true })).toBeNull();

    await act(async () => {
      fireEvent.press(next());
    });
    await waitFor(() => expect(emailField()).toHaveProp('accessibilityHint', message));
  });

  it('nome que a regra recusaria não passa da pergunta dele, e o erro é anunciado', async () => {
    openSignUp();
    await answerEmail();

    fireEvent.changeText(nameField(), NAME_WITH_ZERO_WIDTH);
    await act(async () => {
      fireEvent.press(next());
    });

    // O erro chega ao leitor de tela pelo próprio campo e pelo anúncio.
    await waitFor(() =>
      expect(nameField()).toHaveProp(
        'accessibilityHint',
        `${t('validation.nameInvalid')} ${NAME_HINT}`,
      ),
    );
    expect(announce()).toHaveBeenCalledWith(t('validation.nameInvalid'));
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('a senha curta enviada pelo "ir" do teclado é anunciada, e nada vai ao Firebase', async () => {
    await openPasswordStep();
    const message = t('validation.passwordMin', { min: 6 });

    fireEvent.changeText(passwordField(), '123');
    await act(async () => {
      fireEvent(passwordField(), 'submitEditing');
    });

    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    // O erro vem antes da regra e da força, na mesma dica do campo.
    expect(passwordField()).toHaveProp(
      'accessibilityHint',
      `${message} ${strengthStatus('short')}`,
    );
    expect(lastFocused()).toBe(t('auth.password'));
    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();

    // Voltou a digitar: o erro sai, mesmo com a senha ainda curta, e ficam a
    // regra e a força. Ela só é conferida de novo no botão ou no "ir".
    await act(async () => {
      fireEvent.changeText(passwordField(), '1234');
    });
    expect(passwordField()).toHaveProp('accessibilityHint', strengthStatus('short'));
  });

  it('campo mudado fora da vista (o preenchimento automático): o "Criar conta" volta à pergunta do primeiro erro', async () => {
    await openPasswordStep();

    // O gerenciador de senhas escreve no campo guardado do e-mail.
    fireEvent.changeText(
      screen.getByLabelText(t('auth.email'), { includeHiddenElements: true }),
      'camila',
    );
    await createAccount();

    expect(await screen.findByRole('header', { name: EMAIL_TITLE })).toBeTruthy();
    expect(emailField()).toHaveProp('accessibilityHint', t('validation.emailInvalid'));
    expect(announce()).toHaveBeenCalledWith(t('validation.emailInvalid'));
    expect(lastFocused()).toBe(t('auth.email'));
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });
});

describe('cadastro: os voltares', () => {
  it('o voltar do pé volta uma pergunta por vez, com o que foi digitado, e da primeira sai para a abertura', async () => {
    const view = await openPasswordStep();
    fireEvent.changeText(passwordField(), PASSWORD);

    fireEvent.press(back());
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(nameField()).toHaveProp('value', NAME);

    fireEvent.press(back());
    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField()).toHaveProp('value', EMAIL);

    // De novo para a frente, a senha digitada continua no campo.
    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: NAME_TITLE });
    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: PASSWORD_TITLE });
    expect(passwordField()).toHaveProp('value', PASSWORD);

    fireEvent.press(back());
    fireEvent.press(back());
    // Aberto a frio, sem tela embaixo: o voltar da primeira pergunta leva à abertura.
    fireEvent.press(back());
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
  });

  it('o voltar do Android faz o mesmo que o do pé', async () => {
    const android = watchAndroidBack();
    const view = await openPasswordStep();

    // `true` diz ao Android que o voltar já foi tratado: a tela fica, uma pergunta atrás.
    expect(android.press()).toBe(true);
    expect(title(NAME_TITLE)).toBeTruthy();

    fireEvent.press(button(HAVE_INVITE));
    expect(title(INVITE_TITLE)).toBeTruthy();
    expect(android.press()).toBe(true);
    expect(title(NAME_TITLE)).toBeTruthy();

    expect(android.press()).toBe(true);
    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(view.getPathname()).toBe('/cadastro');
    // Na primeira pergunta a tela não segura o voltar: ele é da navegação,
    // que, com o cadastro aberto a frio e nada embaixo, o devolve ao sistema.
    expect(android.press()).toBe(false);
  });

  it('a pílula do e-mail volta à pergunta dele, com o e-mail no campo', async () => {
    await openPasswordStep();

    fireEvent.press(pill());

    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField()).toHaveProp('value', EMAIL);
    expect(lastFocused()).toBe(t('auth.email'));
    expect(
      screen.queryByRole('button', { name: t('auth.emailPill', { email: EMAIL }) }),
    ).toBeNull();
  });

  it('"Já tem conta? Entrar" troca o cadastro pelo entrar', async () => {
    const view = openSignUp();

    fireEvent.press(button(t('auth.signUp.signIn')));

    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));
  });
});

describe('cadastro: o envio', () => {
  it('manda o nome limpo para a conta e o e-mail normalizado', async () => {
    const profile = holdProfile();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await openPasswordStep(' Camila@X.com ', NAME_WITH_ISOLATES);

    await createAccount();

    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({}, 'camila@x.com', PASSWORD);
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: NAME });
    expect(holds()).toBe(1);
    // O momento não tem campo: o teclado sai com a pergunta.
    expect(dismiss).toHaveBeenCalledTimes(1);

    profile.arrive();
    await waitFor(() => expect(holds()).toBe(0));
  });

  it('apertar "ir" duas vezes cria uma conta só, e o fã não sai da tela enquanto ela nasce', async () => {
    const profile = holdProfile();
    const android = watchAndroidBack();
    const view = await openPasswordStep();

    const password = passwordField();
    fireEvent.changeText(password, PASSWORD);
    await act(async () => {
      fireEvent(password, 'submitEditing');
    });
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    await act(async () => {
      fireEvent(password, 'submitEditing');
    });

    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(holds()).toBe(1);
    // No lugar da pergunta, o "Criando sua conta": sem voltar, sem campo e sem
    // "Entrar" até o perfil nascer.
    expect(title(CREATING)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByLabelText(t('auth.password'))).toBeNull();
    expect(screen.queryByRole('header', { name: PASSWORD_TITLE })).toBeNull();
    // O voltar do Android fica preso.
    expect(android.press()).toBe(true);
    expect(view.getPathname()).toBe('/cadastro');
    expect(title(CREATING)).toBeTruthy();

    profile.arrive();
    await waitFor(() => expect(holds()).toBe(0));
  });

  it('o "Criando sua conta" fica no lugar da pergunta, e o "Conta criada" aparece antes de as telas de conta apagarem', async () => {
    const profile = holdProfile();
    // A tela pergunta pelo leitor de tela para saber quanto segura o momento:
    // enquanto a resposta não vem, o "Conta criada" está na tela.
    const reading = deferred<boolean>();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(reading.promise);
    const exit = jest.spyOn(authExit, 'playAuthExit');
    await openPasswordStep();

    await createAccount();
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    expect(title(CREATING)).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(CREATING);
    expect(screen.queryByText(CREATED)).toBeNull();
    // A pergunta segue montada embaixo do momento, fora da vista.
    expect(screen.queryByText(PASSWORD_TITLE)).toBeNull();
    expect(screen.getByText(PASSWORD_TITLE, { includeHiddenElements: true })).toBeTruthy();

    profile.arrive();
    expect(await screen.findByRole('header', { name: CREATED })).toBeTruthy();
    expect(screen.getByText(t('auth.signUp.created.lead'))).toBeTruthy();
    expect(screen.queryByText(CREATING)).toBeNull();
    expect(announce()).toHaveBeenCalledWith(`${CREATED} ${t('auth.signUp.created.lead')}`);
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    // A saída espera o momento: o fã segue seguro, com as telas de conta à vista.
    expect(exit).not.toHaveBeenCalled();
    expect(holds()).toBe(1);

    await act(async () => {
      reading.resolve(false);
    });
    await waitFor(() => expect(holds()).toBe(0));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('se o guard não tirar a tela depois do "Conta criada", o fã não fica preso no momento: a pergunta volta, sem puxar o teclado', async () => {
    await openPasswordStep();

    await createAccount();
    focus.mockClear();
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    await waitFor(() => expect(holds()).toBe(0));

    // Quem tira a tela agora é o guard, que este teste não tem. Se ele não
    // trocar a pilha (a sessão caiu no meio do caminho), o momento, que não
    // tem botão nenhum, não fica na tela: a pergunta volta, e dá para sair.
    expect(await screen.findByRole('header', { name: PASSWORD_TITLE })).toBeTruthy();
    expect(screen.queryByText(CREATED)).toBeNull();
    expect(back()).toBeEnabled();
    // Com a conta criada, nenhum campo puxa o foco: no caminho de sempre, o
    // envio termina um instante antes de o guard tirar a tela, e o teclado
    // subiria por cima da 1l.
    expect(focus).not.toHaveBeenCalled();

    // A trava saiu com o envio: o voltar volta uma pergunta, e dali em diante
    // a tela é a de sempre, com o foco no campo da pergunta que entra.
    fireEvent.press(back());
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(lastFocused()).toBe(t('auth.signUp.name'));
    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: PASSWORD_TITLE });

    // A nova tentativa começa pelo "Criando sua conta" e, como a conta já
    // existe, termina no atalho para entrar com o e-mail.
    const again = deferred<UserCredential>();
    createUser.mockReturnValueOnce(again.promise);
    await act(async () => {
      fireEvent.press(createButton());
    });
    expect(title(CREATING)).toBeTruthy();
    expect(screen.queryByText(CREATED)).toBeNull();

    await act(async () => {
      again.reject(new FirebaseError('auth/email-already-in-use', 'em uso'));
    });
    expect(await screen.findByRole('header', { name: EMAIL_TITLE })).toBeTruthy();
    expect(button(SIGN_IN_WITH_EMAIL)).toBeTruthy();
    expect(holds()).toBe(0);
  });

  it('com o leitor de tela ligado, o "Conta criada" fica 3 s na tela, para a frase terminar de ser falada', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const reading = deferred<boolean>();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(reading.promise);
    const exit = jest.spyOn(authExit, 'playAuthExit');
    await openPasswordStep();

    await createAccount();
    expect(await screen.findByRole('header', { name: CREATED })).toBeTruthy();

    await act(async () => {
      reading.resolve(true);
    });
    await act(async () => {
      jest.advanceTimersByTime(2999);
    });
    expect(exit).not.toHaveBeenCalled();
    expect(holds()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(exit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(holds()).toBe(0));
  });

  it('com os guards do app: o fã fica no cadastro enquanto a conta nasce e só vai para a escolha de artistas depois do "Conta criada"', async () => {
    usePreferencesStore.setState({
      hydrated: true,
      hasCompletedOnboarding: false,
      lastSessionUid: null,
    });
    const profile = holdProfile();
    // O "Conta criada" fica na tela enquanto a pergunta pelo leitor de tela não volta.
    const reading = deferred<boolean>();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(reading.promise);
    const view = renderRouter(guardedTree, { initialUrl: '/cadastro' });
    await answerEmail();
    await answerName();

    await createAccount();
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    // A conta já nasceu logada, mas a trava segura o guard: o fã não sai do cadastro.
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      user: { uid: 'nova' },
      authHolds: 1,
    });
    expect(view.getPathname()).toBe('/cadastro');
    expect(title(CREATING)).toBeTruthy();

    profile.arrive();
    expect(await screen.findByRole('header', { name: CREATED })).toBeTruthy();
    expect(view.getPathname()).toBe('/cadastro');
    expect(holds()).toBe(1);

    // O momento termina: as telas de conta apagam, a trava solta e o guard abre a 1l.
    await act(async () => {
      reading.resolve(false);
    });
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
    expect(screen.getByText('escolha de artistas')).toBeTruthy();
    expect(holds()).toBe(0);
  });

  it('sem o Firebase configurado, o "Criar conta" fica apagado e a tela avisa', async () => {
    mockFirebaseConfigured = false;
    await openPasswordStep();
    fireEvent.changeText(passwordField(), PASSWORD);

    expect(screen.getByText(t('auth.missingConfig'))).toBeTruthy();
    expect(createButton()).toBeDisabled();
    // O "ir" do teclado não passa pelo botão apagado.
    await act(async () => {
      fireEvent(passwordField(), 'submitEditing');
    });
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(title(PASSWORD_TITLE)).toBeTruthy();
  });
});

describe('cadastro: os erros do envio', () => {
  it('e-mail que já tem conta: a tela volta à pergunta do e-mail com o erro e o atalho, sem trocar de tela sozinha', async () => {
    createUser.mockRejectedValueOnce(new FirebaseError('auth/email-already-in-use', 'em uso'));
    const view = await openPasswordStep(' Camila@X.com ');
    const email = screen.getByLabelText(t('auth.email'), { includeHiddenElements: true });
    const message = t('auth.errors.emailInUse');
    const focusBefore = focusKey();

    await createAccount();

    expect(await screen.findByRole('header', { name: EMAIL_TITLE })).toBeTruthy();
    // A volta é do erro, e não do fã: o foco do leitor não vai ao título, e o
    // anúncio do erro é ouvido inteiro.
    expect(focusKey()).toBe(focusBefore);
    // O erro fica embaixo do campo, com o foco nele, e o leitor de tela ouve.
    expect(emailField()).toHaveProp('accessibilityHint', message);
    expect(screen.getByText(message, { includeHiddenElements: true })).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(message);
    expect(lastFocused()).toBe(t('auth.email'));
    expect(button(SIGN_IN_WITH_EMAIL)).toBeTruthy();
    // O "Criando sua conta" saiu, a trava soltou e a rota é a mesma.
    expect(screen.queryByText(CREATING)).toBeNull();
    expect(holds()).toBe(0);
    expect(view.getPathname()).toBe('/cadastro');
    // A pergunta não saiu da árvore embaixo do momento: é o mesmo campo, e a
    // barra recua de onde estava em vez de encher do zero.
    expect(emailField()).toBe(email);
    expect(barFill()).toBe(1 / 3);

    // Quem só errou a digitação corrige o e-mail e segue: o aviso sai, e nome e
    // senha continuam no formulário.
    fireEvent.changeText(emailField(), 'camila.ribeiro@x.com');
    expect(emailField().props.accessibilityHint).toBeUndefined();
    expect(screen.queryByRole('button', { name: SIGN_IN_WITH_EMAIL })).toBeNull();
    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: NAME_TITLE });
    expect(nameField()).toHaveProp('value', NAME);
    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: PASSWORD_TITLE });
    expect(passwordField()).toHaveProp('value', PASSWORD);
    await act(async () => {
      fireEvent.press(createButton());
    });

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(user, { displayName: NAME }));
    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(2);
    expect(createUserWithEmailAndPassword).toHaveBeenLastCalledWith(
      {},
      'camila.ribeiro@x.com',
      PASSWORD,
    );
    await waitFor(() => expect(holds()).toBe(0));
  });

  it('o atalho do e-mail que já tem conta leva ao entrar, na pergunta da senha, com o e-mail e o aviso', async () => {
    createUser.mockRejectedValueOnce(new FirebaseError('auth/email-already-in-use', 'em uso'));
    const view = await openPasswordStep(' Camila@X.com ');
    await createAccount();
    await screen.findByRole('header', { name: EMAIL_TITLE });

    fireEvent.press(button(SIGN_IN_WITH_EMAIL));

    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));
    // O entrar abre na senha, com o e-mail (já normalizado) na pílula e o porquê.
    expect(title(t('auth.signIn.passwordTitle'))).toBeTruthy();
    expect(pill('camila@x.com')).toBeTruthy();
    expect(screen.getByText(t('auth.errors.emailInUse'))).toBeTruthy();
  });

  it('e-mail que o Firebase não aceita: volta à pergunta do e-mail, com o erro no campo e sem o atalho', async () => {
    createUser.mockRejectedValueOnce(new FirebaseError('auth/invalid-email', 'inválido'));
    await openPasswordStep();

    await createAccount();

    expect(await screen.findByRole('header', { name: EMAIL_TITLE })).toBeTruthy();
    expect(emailField()).toHaveProp('accessibilityHint', t('validation.emailInvalid'));
    expect(announce()).toHaveBeenCalledWith(t('validation.emailInvalid'));
    expect(screen.queryByRole('button', { name: SIGN_IN_WITH_EMAIL })).toBeNull();
    expect(holds()).toBe(0);
  });

  it.each([['auth/weak-password'], ['auth/password-does-not-meet-requirements']])(
    'senha que o Firebase recusa (%s): o erro fica no campo da senha, e não acima do pé',
    async (code) => {
      createUser.mockRejectedValueOnce(new FirebaseError(code, 'fraca'));
      await openPasswordStep();
      const message = t('auth.errors.weakPassword');

      await createAccount();

      await waitFor(() =>
        expect(passwordField()).toHaveProp(
          'accessibilityHint',
          `${message} ${strengthStatus('good')}`,
        ),
      );
      expect(title(PASSWORD_TITLE)).toBeTruthy();
      expect(announce()).toHaveBeenCalledWith(message);
      expect(lastFocused()).toBe(t('auth.password'));
      // Embaixo do campo, a frase fica fora do leitor (ele a ouve pelo campo):
      // acima do pé, ela seria um texto à parte.
      expect(screen.queryByText(message)).toBeNull();
      expect(screen.getByText(message, { includeHiddenElements: true })).toBeTruthy();

      // Voltou a digitar: o erro sai.
      fireEvent.changeText(passwordField(), 'Senha-forte-123');
      expect(passwordField()).toHaveProp('accessibilityHint', strengthStatus('strong'));
    },
  );

  it('rede fora: a pergunta da senha volta com o aviso acima do pé, sem pintar o campo, e com tudo o que foi digitado', async () => {
    // O Firebase segura a resposta: o "Criando sua conta" chega a aparecer, e
    // a pergunta que volta no lugar dele devolve o foco ao campo da senha.
    const creating = deferred<UserCredential>();
    createUser.mockReturnValueOnce(creating.promise);
    await openPasswordStep();
    const message = t('auth.errors.network');
    expect(questionKey()).toBe('password:0');
    const focusBefore = focusKey();

    await createAccount();
    expect(title(CREATING)).toBeTruthy();
    focus.mockClear();
    await act(async () => {
      creating.reject(new FirebaseError('auth/network-request-failed', 'rede'));
    });

    expect(await screen.findByText(message)).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(message);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(screen.queryByText(CREATING)).toBeNull();
    expect(holds()).toBe(0);
    // O campo não ganha o erro: a falha não é da senha.
    expect(passwordField().props).toMatchObject({
      value: PASSWORD,
      accessibilityHint: strengthStatus('good'),
    });
    expect(lastFocused()).toBe(t('auth.password'));
    // A pergunta que volta no lugar do momento entra de novo, subindo, como uma
    // nova, mas sem levar o foco do leitor ao título: ele fica com o anúncio.
    expect(questionKey()).toBe('password:1');
    expect(focusKey()).toBe(focusBefore);

    // Voltou a digitar: a mensagem sai.
    fireEvent.changeText(passwordField(), `${PASSWORD}4`);
    expect(screen.queryByText(message)).toBeNull();

    // O nome e o e-mail continuam no formulário: tentar de novo cria a conta.
    await act(async () => {
      fireEvent.press(createButton());
    });
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(user, { displayName: NAME }));
    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(2);
    expect(createUserWithEmailAndPassword).toHaveBeenLastCalledWith({}, EMAIL, `${PASSWORD}4`);
    await waitFor(() => expect(holds()).toBe(0));
  });

  it('a mensagem do envio é da pergunta da senha: não segue o fã para a pergunta anterior', async () => {
    createUser.mockRejectedValueOnce(new FirebaseError('auth/too-many-requests', 'muitas'));
    await openPasswordStep();
    const message = t('auth.errors.tooManyRequests');

    await createAccount();
    expect(await screen.findByText(message)).toBeTruthy();

    fireEvent.press(back());
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(screen.queryByText(message)).toBeNull();
    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: PASSWORD_TITLE });
    expect(screen.queryByText(message)).toBeNull();
  });
});

describe('cadastro: código de convite', () => {
  it('sai do convite do Google se a conta perde a sessão', async () => {
    const session = useSessionStore.getState();
    session.setSignedIn(user);
    holdSocialInvite(user.uid, session.holdAuth());
    renderRouter(appTree, { initialUrl: '/codigo-de-convite' });

    expect(title(t('auth.signUp.inviteStepTitle'))).toBeTruthy();
    act(() => session.setSignedOut());

    expect(await screen.findByText(t('auth.welcome.createAccount'))).toBeTruthy();
    expect(useSessionStore.getState().authHolds).toBe(0);
  });

  it('o código do link guardado aparece na pergunta do nome e vai no envio sem abrir o desvio: quem manda é a sincronização', async () => {
    await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
    openSignUp();
    await answerEmail();

    await waitFor(() => expect(appliedInvite('K7P3M9QX')).toBeTruthy());
    expect(screen.getByText(t('auth.signUp.inviteApplied', { code: 'K7P3M9QX' }))).toBeTruthy();
    expect(screen.queryByRole('button', { name: HAVE_INVITE })).toBeNull();

    await answerName();
    await createAccount();

    await waitFor(() => expect(holds()).toBe(0));
    // O do link não é esperado no cadastro: fica amarrado à conta nova.
    expect(claim).not.toHaveBeenCalled();
    expect(await readBoundInvite('nova')).toMatchObject({ code: 'K7P3M9QX', via: 'link' });
  });

  it('o desvio abre com o código do link no campo, com o nome do campo à vista e a dica lida com ele', async () => {
    await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
    openSignUp();
    await answerEmail();
    await waitFor(() => expect(appliedInvite('K7P3M9QX')).toBeTruthy());

    fireEvent.press(appliedInvite('K7P3M9QX'));

    expect(title(INVITE_TITLE)).toBeTruthy();
    // A dica é o texto de apoio da pergunta.
    expect(screen.getByText(INVITE_HINT)).toBeTruthy();
    expect(inviteField().props).toMatchObject({
      value: 'K7P3M9QX',
      // "Código de convite (opcional)" fica à vista: os Termos e o FAQ citam o campo.
      placeholder: t('auth.signUp.inviteCode'),
      accessibilityHint: INVITE_HINT,
      autoCapitalize: 'characters',
      autoCorrect: false,
      submitBehavior: 'submit',
    });
    expect(screen.queryByLabelText(t('auth.signUp.name'))).toBeNull();
  });

  it('código digitado no desvio: volta ao nome com o código na linha, e vai ao servidor no envio', async () => {
    openSignUp();
    await answerEmail();
    fireEvent.changeText(nameField(), NAME);

    fireEvent.press(button(HAVE_INVITE));
    expect(title(INVITE_TITLE)).toBeTruthy();
    // Vazio, o botão não apaga: ele segue sem código.
    expect(button(SKIP_INVITE)).toBeEnabled();
    fireEvent.changeText(inviteField(), 'camila-12');
    expect(next()).toBeEnabled();
    fireEvent.press(next());

    // De volta ao nome, com o que já estava digitado e o código normalizado na linha.
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(nameField()).toHaveProp('value', NAME);
    expect(appliedInvite('CAMILA12')).toBeTruthy();
    expect(lastFocused()).toBe(t('auth.signUp.name'));

    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: PASSWORD_TITLE });
    await createAccount();

    await waitFor(() => expect(holds()).toBe(0));
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'nova', code: 'CAMILA12', via: 'code' }),
    );
  });

  it('o "próximo" do teclado confirma o código, como o botão', async () => {
    openSignUp();
    await answerEmail();
    fireEvent.press(button(HAVE_INVITE));

    fireEvent.changeText(inviteField(), 'CAMILA12');
    fireEvent(inviteField(), 'submitEditing');

    expect(title(NAME_TITLE)).toBeTruthy();
    expect(appliedInvite('CAMILA12')).toBeTruthy();
  });

  it('formato inválido: o erro no campo, anunciado, e o desvio não fecha', async () => {
    openSignUp();
    await answerEmail();
    fireEvent.press(button(HAVE_INVITE));
    const message = t('validation.inviteCodeInvalid');

    fireEvent.changeText(inviteField(), 'ab!');
    fireEvent.press(next());

    expect(inviteField()).toHaveProp('accessibilityHint', `${message} ${INVITE_HINT}`);
    expect(announce()).toHaveBeenCalledWith(message);
    expect(lastFocused()).toBe(t('auth.signUp.inviteCode'));
    expect(title(INVITE_TITLE)).toBeTruthy();

    // Voltou a digitar: o erro sai, e o código é conferido de novo no botão.
    fireEvent.changeText(inviteField(), 'abc');
    expect(inviteField()).toHaveProp('accessibilityHint', INVITE_HINT);
    fireEvent.press(next());
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(appliedInvite('ABC')).toBeTruthy();
  });

  it('"Continuar sem código" tira o convite, também o do link: no envio ele é descartado', async () => {
    await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
    openSignUp();
    await answerEmail();
    await waitFor(() => expect(appliedInvite('K7P3M9QX')).toBeTruthy());

    fireEvent.press(appliedInvite('K7P3M9QX'));
    fireEvent.changeText(inviteField(), '');
    // Vazio, o botão diz o que o toque faz.
    expect(screen.queryByRole('button', { name: t('common.continue') })).toBeNull();
    fireEvent.press(button(SKIP_INVITE));

    expect(title(NAME_TITLE)).toBeTruthy();
    expect(button(HAVE_INVITE)).toBeTruthy();

    await answerName();
    await createAccount();
    await waitFor(() => expect(holds()).toBe(0));
    expect(claim).not.toHaveBeenCalled();
    expect(await readBoundInvite('nova')).toBeNull();
    expect(await readPendingInvite()).toBeNull();
  });

  it('o voltar do desvio só descarta o que foi digitado nele: o convite do formulário fica', async () => {
    await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
    const android = watchAndroidBack();
    openSignUp();
    await answerEmail();
    await waitFor(() => expect(appliedInvite('K7P3M9QX')).toBeTruthy());

    fireEvent.press(appliedInvite('K7P3M9QX'));
    fireEvent.changeText(inviteField(), 'OUTRO999');
    fireEvent.press(back());
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(appliedInvite('K7P3M9QX')).toBeTruthy();

    // Aberto de novo, o desvio mostra o código do formulário, e não o rascunho descartado.
    fireEvent.press(appliedInvite('K7P3M9QX'));
    expect(inviteField()).toHaveProp('value', 'K7P3M9QX');
    fireEvent.changeText(inviteField(), '');
    expect(android.press()).toBe(true);
    expect(title(NAME_TITLE)).toBeTruthy();
    expect(appliedInvite('K7P3M9QX')).toBeTruthy();
  });

  it('o link de convite que chega com o cadastro aberto entra no formulário, se o fã ainda não decidiu o convite', async () => {
    openSignUp();
    await answerEmail();
    expect(button(HAVE_INVITE)).toBeTruthy();

    await act(async () => {
      await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
    });

    await waitFor(() => expect(appliedInvite('K7P3M9QX')).toBeTruthy());
  });

  it.each([
    ['um código digitado', 'camila-12', t('auth.signUp.inviteAppliedLabel', { code: 'CAMILA12' })],
    ['seguir sem código', '', HAVE_INVITE],
  ])(
    'o link que chega depois de o fã decidir o convite no desvio (%s) não troca a decisão dele',
    async (_, typed, line) => {
      openSignUp();
      await answerEmail();
      fireEvent.press(button(HAVE_INVITE));
      fireEvent.changeText(inviteField(), typed);
      fireEvent.press(button(typed ? t('common.continue') : SKIP_INVITE));
      expect(button(line)).toBeTruthy();

      await act(async () => {
        await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
        // A tela lê o convite guardado quando ele chega; a leitura dela, que
        // começou antes, termina antes destas.
        await readPendingInvite();
        await readPendingInvite();
      });

      expect(button(line)).toBeTruthy();
      expect(
        screen.queryByRole('button', {
          name: t('auth.signUp.inviteAppliedLabel', { code: 'K7P3M9QX' }),
        }),
      ).toBeNull();
    },
  );

  it('código digitado recusado: a tela fica no estágio, só com o campo do convite, e "Continuar sem código" solta o fã', async () => {
    claim.mockRejectedValueOnce(
      new ApiError('notFound', 'Convite não encontrado.', 404, 'invite_not_found'),
    );
    const android = watchAndroidBack();
    const view = await signUpWithInvite('errado12');

    const message = t('auth.signUp.inviteRejected.notFound');
    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    // A conta já existe: a pergunta deixa de pedir para criar.
    expect(title(REJECTED_TITLE)).toBeTruthy();
    expect(screen.getByText(t('auth.signUp.inviteRejected.lead'))).toBeTruthy();
    expect(inviteField().props).toMatchObject({
      value: 'ERRADO12',
      accessibilityHint: `${message} ${INVITE_HINT}`,
    });
    expect(lastFocused()).toBe(t('auth.signUp.inviteCode'));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    // Nome, e-mail e senha saem da vista: não há o que mexer neles.
    for (const label of [t('auth.signUp.name'), t('auth.email'), t('auth.password')]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    // A conta já existe: sem o "Já tem conta?", sem voltar, e o fã segue seguro.
    expect(screen.queryByRole('button', { name: t('auth.signUp.signIn') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('common.back') })).toBeNull();
    // Por mais vezes que o fã aperte o voltar do Android, a tela fica no
    // estágio: ele não volta de pergunta em pergunta até a primeira e sai.
    for (let press = 0; press < 3; press += 1) {
      expect(android.press()).toBe(true);
    }
    expect(view.getPathname()).toBe('/cadastro');
    expect(title(REJECTED_TITLE)).toBeTruthy();
    expect(holds()).toBe(1);
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ code: 'ERRADO12', via: 'code' }));
    // O "Conta criada" é só do cadastro que segue direto.
    expect(screen.queryByText(CREATED)).toBeNull();

    await act(async () => {
      fireEvent.press(button(SKIP_INVITE));
    });
    await waitFor(() => expect(holds()).toBe(0));
    expect(claim).toHaveBeenCalledTimes(1);
    expect(view.getPathname()).toBe('/cadastro');
    expect(screen.queryByText(CREATED)).toBeNull();
  });

  it('no estágio, "Continuar" com o código corrigido manda de novo e solta o fã', async () => {
    claim.mockRejectedValueOnce(new ApiError('validation', 'Não vale.', 409, 'invite_not_allowed'));
    await signUpWithInvite('CAMILA12');
    const message = t('auth.signUp.inviteRejected.notAllowed');
    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    expect(inviteField()).toHaveProp('accessibilityHint', `${message} ${INVITE_HINT}`);

    // Voltou a digitar: a recusa do código anterior sai do campo.
    fireEvent.changeText(inviteField(), 'certo-123');
    expect(inviteField()).toHaveProp('accessibilityHint', INVITE_HINT);
    await act(async () => {
      fireEvent.press(button(t('auth.signUp.continue')));
    });

    await waitFor(() => expect(holds()).toBe(0));
    expect(claim).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'CERTO123', via: 'code' }),
    );
    expect(screen.queryByText(CREATED)).toBeNull();
  });

  it('no estágio, o código recusado de novo avisa de novo, e o fora do formato nem vai ao servidor', async () => {
    const notFound = () =>
      new ApiError('notFound', 'Convite não encontrado.', 404, 'invite_not_found');
    claim.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound());
    await signUpWithInvite('errado12');
    const message = t('auth.signUp.inviteRejected.notFound');
    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    announce().mockClear();

    // Fora do formato: o erro é o do campo, e nada é mandado.
    fireEvent.changeText(inviteField(), 'ab!');
    fireEvent.press(button(t('auth.signUp.continue')));
    expect(inviteField()).toHaveProp(
      'accessibilityHint',
      `${t('validation.inviteCodeInvalid')} ${INVITE_HINT}`,
    );
    expect(announce()).toHaveBeenCalledWith(t('validation.inviteCodeInvalid'));
    expect(claim).toHaveBeenCalledTimes(1);

    // Outro código que o servidor também recusa: a mesma recusa avisa de novo e
    // leva o foco de volta ao campo do convite, para o fã corrigir o código.
    announce().mockClear();
    focus.mockClear();
    fireEvent.changeText(inviteField(), 'errado34');
    await act(async () => {
      fireEvent.press(button(t('auth.signUp.continue')));
    });
    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    expect(lastFocused()).toBe(t('auth.signUp.inviteCode'));
    expect(inviteField()).toHaveProp('accessibilityHint', `${message} ${INVITE_HINT}`);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(holds()).toBe(1);

    await act(async () => {
      fireEvent.press(button(SKIP_INVITE));
    });
    await waitFor(() => expect(holds()).toBe(0));
  });

  /** Cadastro com um código digitado que o servidor recusa: a tela para no estágio. */
  async function reachRejectedStage(): Promise<ReturnType<typeof renderRouter>> {
    claim.mockRejectedValueOnce(
      new ApiError('notFound', 'Convite não encontrado.', 404, 'invite_not_found'),
    );
    const view = await signUpWithInvite('errado12');
    await waitFor(() =>
      expect(announce()).toHaveBeenCalledWith(t('auth.signUp.inviteRejected.notFound')),
    );
    expect(holds()).toBe(1);
    return view;
  }

  it('no estágio, o "ir" do teclado manda o código corrigido, um envio por vez', async () => {
    await reachRejectedStage();
    const answer = deferred<Awaited<ReturnType<typeof sendInviteClaim>>>();
    claim.mockReturnValueOnce(answer.promise);

    fireEvent.changeText(inviteField(), 'certo-123');
    await act(async () => {
      fireEvent(inviteField(), 'submitEditing');
    });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    // O servidor ainda não respondeu: o botão fica ocupado, o "Continuar sem
    // código" espera, e o "ir" do teclado, que não passa pelo botão, não manda de novo.
    await waitFor(() => expect(button(t('auth.signUp.continue'))).toBeDisabled());
    expect(button(SKIP_INVITE)).toBeDisabled();
    await act(async () => {
      fireEvent(inviteField(), 'submitEditing');
    });
    expect(claim).toHaveBeenCalledTimes(2);

    await act(async () => {
      answer.resolve({ status: 'claimed' });
    });
    await waitFor(() => expect(holds()).toBe(0));
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'CERTO123', via: 'code' }),
    );
  });

  it('no estágio, o link de convite aberto por fora volta ao cadastro, com o fã seguro e o código novo no campo', async () => {
    const hook = jest.spyOn(focusAfterTransition, 'useFocusAfterTransition');
    const view = await reachRejectedStage();

    await act(async () => {
      router.navigate('/convite/outro-123?destino=%2Fpost%2Fp-clipe');
    });
    await waitFor(() => expect(inviteField()).toHaveProp('value', 'OUTRO123'));
    expect(view.getPathname()).toBe('/cadastro');
    expect(screen.getByText(t('auth.signUp.inviteRejected.lead'))).toBeTruthy();
    expect(holds()).toBe(1);
    // O erro do código recusado sai com o código novo.
    expect(inviteField()).toHaveProp('accessibilityHint', INVITE_HINT);
    // Na volta da tela do link, o foco é do campo do convite, e não de um campo guardado.
    expect(hook.mock.calls.at(-1)?.[0].current?.props.accessibilityLabel).toBe(
      t('auth.signUp.inviteCode'),
    );

    await act(async () => {
      fireEvent.press(button(t('auth.signUp.continue')));
    });
    await waitFor(() => expect(holds()).toBe(0));
    // O código do link vai como link, com a página de onde veio.
    expect(claim).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uid: 'nova',
        code: 'OUTRO123',
        via: 'link',
        origin: { path: '/post/p-clipe', utm: {} },
      }),
    );
  });

  it('a tela de cadastro que sai no estágio sem passar pelos botões solta o fã', async () => {
    const view = await reachRejectedStage();

    await act(async () => {
      router.replace('/entrar');
    });
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(holds()).toBe(0);
  });
});

describe('cadastro: a Apple e o Google na pergunta do e-mail (seção 39)', () => {
  const APPLE_LABEL = 'Continuar com a Apple';
  const GOOGLE_LABEL = t('auth.google.continue');
  const termsBox = () => screen.getByTestId('social-entry-terms', { includeHiddenElements: true });

  /** A entrada do provedor que cria a conta e para na pergunta do código, como o núcleo faz. */
  async function asksInvite(): Promise<SocialEntryOutcome> {
    const session = useSessionStore.getState();
    session.setSignedIn(user);
    holdSocialInvite(user.uid, session.holdAuth());
    return { status: 'askInvite' };
  }

  it('no iPhone, a Apple aparece só na pergunta do e-mail, dentro dela, sempre com o aviso dos Termos', async () => {
    mockAppleAvailable = true;
    openSignUp();

    const question = within(screen.getByTestId('question-field'));
    expect(question.getByRole('button', { name: APPLE_LABEL })).toBeTruthy();
    expect(question.queryByRole('button', { name: GOOGLE_LABEL })).toBeNull();
    expect(question.getByTestId('social-entry-terms')).toBeTruthy();
    expect(question.getByRole('link', { name: t('auth.terms.termsLink') })).toBeTruthy();

    await answerEmail();
    expect(screen.queryByRole('button', { name: APPLE_LABEL })).toBeNull();
  });

  it.each([
    ['pela Apple', () => (mockAppleAvailable = true), APPLE_LABEL],
    ['pelo Google', () => (mockGoogleAvailable = true), GOOGLE_LABEL],
  ])('a conta nova %s vai à pergunta do código de convite', async (_, show, label) => {
    show();
    mockAppleSignIn.mockImplementation(asksInvite);
    mockGoogleSignIn.mockImplementation(asksInvite);
    const view = openSignUp();

    await act(async () => {
      fireEvent.press(button(label));
    });

    await waitFor(() => expect(view.getPathname()).toBe('/codigo-de-convite'));
    expect(await screen.findByRole('header', { name: INVITE_TITLE })).toBeTruthy();
  });

  it('o Google numa conta de senha do mesmo e-mail leva ao entrar, na senha, para vincular', async () => {
    mockGoogleAvailable = true;
    mockGoogleSignIn.mockResolvedValue({ status: 'link', email: EMAIL });
    const view = openSignUp();

    await act(async () => {
      fireEvent.press(button(GOOGLE_LABEL));
    });

    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));
    expect(await screen.findByText(t('auth.google.linkPassword'))).toBeTruthy();
    expect(screen.getByRole('header', { name: t('auth.signIn.passwordTitle') })).toBeTruthy();
  });

  it('com a Apple em curso: o campo não edita, o pé, o voltar e o "Entrar" desligam, os Termos saem do leitor e o voltar do Android fica preso', async () => {
    mockAppleAvailable = true;
    const android = watchAndroidBack();
    openSignUp();
    mockApplePending = true;
    // Digitar desenha a tela de novo, agora com a Apple em curso.
    fireEvent.changeText(emailField(), EMAIL);

    expect(emailField().props.editable).toBe(false);
    expect(next()).toBeDisabled();
    expect(back()).toBeDisabled();
    expect(button(t('auth.signUp.signIn'))).toBeDisabled();
    expect(termsBox().props).toMatchObject({
      pointerEvents: 'none',
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    expect(android.press()).toBe(true);
    expect(title(EMAIL_TITLE)).toBeTruthy();
  });

  it('com o cadastro por e-mail em curso, a Apple não recebe toque: o botão nem está à vista', async () => {
    mockAppleAvailable = true;
    holdProfile();
    await openPasswordStep();
    await createAccount();

    expect(screen.queryByRole('button', { name: APPLE_LABEL })).toBeNull();
    expect(screen.queryByTestId('apple-button', { includeHiddenElements: true })).toBeNull();
    expect(mockAppleSignIn).not.toHaveBeenCalled();
  });

  it('o erro da Apple aparece acima do pé e sai quando o fã volta a digitar', async () => {
    mockAppleAvailable = true;
    mockAppleError = 'auth.apple.errors.unknown';
    openSignUp();

    expect(screen.getByText(t('auth.apple.errors.unknown'))).toBeTruthy();

    fireEvent.changeText(emailField(), 'c');
    expect(mockAppleReset).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(t('auth.apple.errors.unknown'))).toBeNull());
  });
});

describe('cadastro: a pergunta do código da conta nova pelo provedor', () => {
  /** A conta nova do provedor, parada na pergunta do código, como o núcleo a deixa. */
  function heldAtInvite() {
    const session = useSessionStore.getState();
    session.setSignedIn(user);
    holdSocialInvite(user.uid, session.holdAuth());
    return renderRouter(appTree, { initialUrl: '/codigo-de-convite' });
  }

  it('"Continuar sem código" tira o convite amarrado e o do link, e solta o fã', async () => {
    await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
    heldAtInvite();
    // O código do link chega no campo.
    await waitFor(() => expect(inviteField().props.value).toBe('K7P3M9QX'));

    await act(async () => {
      fireEvent.press(button(SKIP_INVITE));
    });

    await waitFor(() => expect(holds()).toBe(0));
    expect(await readPendingInvite()).toBeNull();
    expect(await readBoundInvite(user.uid)).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });

  it('"Continuar" com o código aceito manda o convite e solta o fã', async () => {
    heldAtInvite();
    fireEvent.changeText(inviteField(), 'K7P3M9QX');

    await act(async () => {
      fireEvent.press(button(t('common.continue')));
    });

    await waitFor(() => expect(holds()).toBe(0));
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'K7P3M9QX', uid: user.uid }),
    );
  });

  it('o código recusado: o erro no campo, o toque de erro e o anúncio, e o fã segue seguro', async () => {
    claim.mockRejectedValueOnce(
      new ApiError('notFound', 'Convite não encontrado.', 404, 'invite_not_found'),
    );
    heldAtInvite();
    fireEvent.changeText(inviteField(), 'ERRADO12');

    await act(async () => {
      fireEvent.press(button(t('common.continue')));
    });

    const message = t('auth.signUp.inviteRejected.notFound');
    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(inviteField().props.accessibilityHint).toContain(message);
    expect(holds()).toBe(1);
  });
});
