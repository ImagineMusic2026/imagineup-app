import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  renderRouter,
  screen,
  waitFor,
} from 'expo-router/testing-library';
import { FirebaseError } from 'firebase/app';
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type UserCredential,
} from 'firebase/auth';
import { AccessibilityInfo, BackHandler, TextInput } from 'react-native';

import AuthLayout from '@/app/(auth)/_layout';
import SignUpRoute from '@/app/(auth)/cadastro';
import WelcomeRoute from '@/app/(auth)/entrar';
import SignInRoute from '@/app/(auth)/entrar-com-email';
import {
  clearHandedOffEmail,
  handOffEmail,
  readHandedOffEmail,
} from '@/domains/auth/email-handoff';
import type { GoogleEntryOutcome } from '@/domains/auth/hooks/use-google-entry';
import * as focusAfterTransition from '@/hooks/use-focus-after-transition';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

// O entrar com e-mail (`/entrar-com-email`) dentro do grupo `(auth)`, em duas
// perguntas na mesma tela: o e-mail da conta e, depois, a senha. Aqui ficam a
// troca entre as duas (o botão, o teclado, a pílula e os voltares), os campos
// que seguem montados fora da pergunta deles (o foco e o gerenciador de
// senhas), o envio, a credencial recusada, o "Esqueci minha senha" e o e-mail
// que chega pronto. A abertura e o que é comum às telas de conta ficam em
// `auth.test.tsx`; o cadastro, em `auth-cadastro.test.tsx`.

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
const mockGoogleSignIn = jest.fn<Promise<GoogleEntryOutcome | undefined>, []>();
jest.mock('@/domains/auth/hooks/use-google-entry', () => ({
  useGoogleEntry: () => ({
    available: mockGoogleAvailable,
    isPending: false,
    error: null,
    signIn: mockGoogleSignIn,
  }),
}));

// Configurado, como no app; um teste desliga para ver o aviso de quem roda sem o `.env`.
let mockFirebaseConfigured = true;
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  get isFirebaseConfigured() {
    return mockFirebaseConfigured;
  },
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
 * tela (`/entrar` é a abertura) também fica travada.
 */
const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': AuthLayout,
  '(auth)/entrar': WelcomeRoute,
  '(auth)/entrar-com-email': SignInRoute,
  '(auth)/cadastro': SignUpRoute,
};

const EMAIL = 'camila@x.com';
const PASSWORD = 'senha-123';

const EMAIL_TITLE = t('auth.signIn.title');
const PASSWORD_TITLE = t('auth.signIn.passwordTitle');
const EMPTY_HINT = t('auth.emptyHint');
const IN_USE = t('auth.errors.emailInUse');
const RESET_SENT = t('auth.signIn.resetSentShort');

// O campo da pergunta à vista. O da outra pergunta segue montado, guardado
// fora do leitor de tela: as buscas comuns não o acham.
const emailField = () => screen.getByLabelText(t('auth.email'));
const passwordField = () => screen.getByLabelText(t('auth.password'));
/** O campo de uma pergunta, à vista ou guardado. */
const storedField = (label: string) =>
  screen.getByLabelText(label, { includeHiddenElements: true });
const button = (name: string) => screen.getByRole('button', { name });
const next = () => button(t('common.continue'));
const signInButton = () => button(t('auth.signIn.submit'));
const back = () => button(t('common.back'));
const forgot = () => button(t('auth.signIn.forgot'));
const pill = (email = EMAIL) => button(t('auth.emailPill', { email }));
const title = (name: string) => screen.getByRole('header', { name });

const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);

// O mock do TextInput do React Native põe os métodos no protótipo: o `focus` é
// um só para todos os campos, e guarda em qual deles foi chamado.
const focus = (TextInput.prototype as unknown as { focus: jest.Mock }).focus;

/** O rótulo do campo que recebeu o foco por último. */
function lastFocused(): string | undefined {
  const field = focus.mock.contexts.at(-1) as
    { props: { accessibilityLabel?: string } } | undefined;
  return field?.props.accessibilityLabel;
}

const openSignIn = () => renderRouter(appTree, { initialUrl: '/entrar-com-email' });

/** Responde a pergunta do e-mail pelo botão; a tela passa à pergunta da senha. */
async function answerEmail(email = EMAIL): Promise<void> {
  fireEvent.changeText(emailField(), email);
  await act(async () => {
    fireEvent.press(next());
  });
  await screen.findByRole('header', { name: PASSWORD_TITLE });
}

/** Abre a tela e vai até a pergunta da senha. */
async function openPasswordStep(email = EMAIL) {
  const view = openSignIn();
  await answerEmail(email);
  return view;
}

/** Digita a senha e manda pelo botão. */
async function submitPassword(password = PASSWORD): Promise<void> {
  fireEvent.changeText(passwordField(), password);
  await act(async () => {
    fireEvent.press(signInButton());
  });
}

/**
 * A caixa que guarda o campo de uma pergunta: a mais próxima acima dele que
 * decide o toque (`pointerEvents`).
 */
function stepBox(field: ReturnType<typeof storedField>) {
  let box = field.parent;
  while (box && (typeof box.type !== 'string' || box.props.pointerEvents === undefined)) {
    box = box.parent;
  }
  if (!box) throw new Error('campo fora da caixa da pergunta');
  return box;
}

type BackListener = () => boolean | null | undefined;

/**
 * Vigia quem escuta o voltar do Android: `press` chama a escuta registrada por
 * último que ainda está de pé, e `removed` guarda as que já foram desfeitas. A
 * que a tela desfaz sai da lista: o voltar passa à escuta de baixo, a da
 * navegação.
 */
function watchAndroidBack() {
  const add = BackHandler.addEventListener.bind(BackHandler);
  const listeners: BackListener[] = [];
  const removed: BackListener[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
    const subscription = add(event, handler);
    if (event !== 'hardwareBackPress') return subscription;
    // A escuta da tela não lê o evento: o teste a chama sem ele.
    const listener = handler as BackListener;
    listeners.push(listener);
    return {
      remove: () => {
        removed.push(listener);
        const index = listeners.lastIndexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
        subscription.remove();
      },
    };
  });
  return {
    last: () => listeners.at(-1),
    removed,
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
  mockGoogleSignIn.mockReset();
  // Cada teste diz o que o Firebase responde; sem dizer, dá certo.
  jest
    .mocked(signInWithEmailAndPassword)
    .mockReset()
    .mockResolvedValue({} as UserCredential);
  jest.mocked(sendPasswordResetEmail).mockReset().mockResolvedValue(undefined);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('entrar com e-mail: a pergunta do e-mail', () => {
  it('oferece o Google no e-mail e abre a senha quando a conta precisa ser vinculada', async () => {
    mockGoogleAvailable = true;
    mockGoogleSignIn.mockResolvedValue({ status: 'link', email: EMAIL });
    openSignIn();

    const googleLabel = t('auth.google.continue');
    await act(async () => {
      fireEvent.press(button(googleLabel));
    });
    expect(mockGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('header', { name: PASSWORD_TITLE })).toBeTruthy();
    expect(pill()).toBeTruthy();
    expect(screen.getByText(t('auth.google.linkPassword'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: googleLabel })).toBeNull();
  });

  it('abre na pergunta do e-mail, com o foco no campo, sem pílula nem senha', () => {
    openSignIn();

    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(screen.getByText(t('auth.signIn.emailQuestion'))).toBeTruthy();
    expect(emailField().props).toMatchObject({
      value: '',
      placeholder: t('auth.emailPlaceholder'),
      autoFocus: true,
      autoComplete: 'email',
      // "username" pareia e-mail e senha no preenchimento automático do iOS.
      textContentType: 'username',
      keyboardType: 'email-address',
    });
    // A pergunta da senha ainda não apareceu: nem o campo, nem o olho, nem o link, nem o botão.
    expect(screen.queryByLabelText(t('auth.password'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.showPassword') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.signIn.forgot') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.signIn.submit') })).toBeNull();
  });

  it('o campo da outra pergunta fica montado e guardado: sem desenho, sem toque e fora do leitor de tela', async () => {
    openSignIn();

    // Montado desde a primeira pergunta, o campo da senha recebe o foco direto
    // do e-mail, sem o teclado fechar, e já está na tela com as marcas do
    // preenchimento automático.
    const password = storedField(t('auth.password'));
    expect(password.props).toMatchObject({ secureTextEntry: true, autoFocus: false });
    expect(isHiddenFromAccessibility(password)).toBe(true);
    const storedPassword = stepBox(password);
    expect(storedPassword).toHaveStyle({ position: 'absolute', opacity: 0 });
    expect(storedPassword).toHaveProp('pointerEvents', 'none');
    // Opacidade zero, e não `display: 'none'`, que tiraria o foco do campo
    // antes de o outro recebê-lo.
    expect(storedPassword).not.toHaveStyle({ display: 'none' });
    expect(stepBox(emailField())).toHaveProp('pointerEvents', 'auto');

    await answerEmail();

    // Na senha, os papéis trocam: quem fica guardado é o e-mail, com o valor dele.
    const email = storedField(t('auth.email'));
    expect(email).toHaveProp('value', EMAIL);
    expect(isHiddenFromAccessibility(email)).toBe(true);
    expect(stepBox(email)).toHaveStyle({ position: 'absolute', opacity: 0 });
    expect(stepBox(email)).toHaveProp('pointerEvents', 'none');
    expect(stepBox(passwordField())).toHaveProp('pointerEvents', 'auto');
    expect(stepBox(passwordField())).not.toHaveStyle({ opacity: 0 });
  });

  it('a caixa de cada campo existe de verdade à vista e guardada: achatada num estado e não no outro, o campo com o foco trocaria de pai e fecharia o teclado', async () => {
    openSignIn();

    // À vista, a caixa não tem estilo nenhum, e o React Native a achataria.
    const shown = stepBox(emailField());
    expect(shown.props.style).toBeUndefined();
    expect(shown).toHaveProp('collapsable', false);
    expect(stepBox(storedField(t('auth.password')))).toHaveProp('collapsable', false);

    await answerEmail();

    expect(stepBox(storedField(t('auth.email')))).toHaveProp('collapsable', false);
    expect(stepBox(passwordField())).toHaveProp('collapsable', false);
  });

  it('o "Continuar" fica apagado só com o campo vazio, e diz por quê', () => {
    openSignIn();

    expect(next()).toBeDisabled();
    expect(next()).toHaveProp('accessibilityHint', EMPTY_HINT);

    // Só espaços ainda é vazio.
    fireEvent.changeText(emailField(), '   ');
    expect(next()).toBeDisabled();

    // Com texto, acende mesmo fora do formato: quem confere é o toque.
    fireEvent.changeText(emailField(), 'c');
    expect(next()).toBeEnabled();
    expect(next().props.accessibilityHint).toBeUndefined();
  });

  it('e-mail fora do formato: o erro fica no campo, é anunciado, e a pergunta não muda', async () => {
    openSignIn();
    const message = t('validation.emailInvalid');

    fireEvent.changeText(emailField(), 'camila');
    await act(async () => {
      fireEvent.press(next());
    });

    await waitFor(() => expect(emailField()).toHaveProp('accessibilityHint', message));
    expect(screen.getByText(message, { includeHiddenElements: true })).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(message);
    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(screen.queryByLabelText(t('auth.password'))).toBeNull();

    // O foco fica no campo recusado.
    expect(lastFocused()).toBe(t('auth.email'));

    // Voltou a digitar: o erro sai, e não volta a cada letra.
    fireEvent.changeText(emailField(), 'camila@');
    expect(emailField().props.accessibilityHint).toBeUndefined();
    expect(screen.queryByText(message, { includeHiddenElements: true })).toBeNull();

    // Só a conferência seguinte o traz de volta.
    await act(async () => {
      fireEvent.press(next());
    });
    await waitFor(() => expect(emailField()).toHaveProp('accessibilityHint', message));
    expect(title(EMAIL_TITLE)).toBeTruthy();
  });

  it('o "Continuar" leva à pergunta da senha, com o e-mail normalizado na pílula e o foco no campo dela', async () => {
    const view = openSignIn();
    // Na abertura, quem foca é o `autoFocus` do e-mail: ninguém pediu o foco ainda.
    expect(focus).not.toHaveBeenCalled();

    await answerEmail(' Camila@X.com ');

    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(pill('camila@x.com')).toBeTruthy();
    expect(passwordField().props).toMatchObject({
      value: '',
      placeholder: t('auth.passwordPlaceholder'),
      secureTextEntry: true,
      autoComplete: 'current-password',
      textContentType: 'password',
    });
    // O foco vai direto do e-mail para a senha: o teclado não fecha no caminho.
    expect(lastFocused()).toBe(t('auth.password'));
    // A pergunta do e-mail saiu, com o link do cadastro; a rota é a mesma.
    expect(screen.queryByLabelText(t('auth.email'))).toBeNull();
    expect(screen.queryByText(t('auth.signIn.emailQuestion'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.signIn.createAccount') })).toBeNull();
    expect(view.getPathname()).toBe('/entrar-com-email');
    // Sem e-mail vindo do cadastro, a pergunta da senha não tem texto de apoio.
    expect(screen.queryByText(IN_USE)).toBeNull();
  });

  it('o "próximo" do teclado faz o mesmo que o botão, sem fechar o teclado', async () => {
    openSignIn();
    expect(emailField()).toHaveProp('submitBehavior', 'submit');

    // Vazio, o teclado não passa pelo botão apagado: o erro é anunciado.
    await act(async () => {
      fireEvent(emailField(), 'submitEditing');
    });
    await waitFor(() => expect(announce()).toHaveBeenCalledWith(t('validation.emailInvalid')));
    expect(title(EMAIL_TITLE)).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(emailField(), EMAIL);
    });
    await act(async () => {
      fireEvent(emailField(), 'submitEditing');
    });

    expect(await screen.findByRole('header', { name: PASSWORD_TITLE })).toBeTruthy();
    expect(pill()).toBeTruthy();
  });

  it('o campo da pergunta à vista é o que recebe o foco de novo quando a tela termina de entrar', async () => {
    const hook = jest.spyOn(focusAfterTransition, 'useFocusAfterTransition');
    openSignIn();

    // O ref que a tela entrega ao hook: no Android, é por ele que o teclado
    // sobe depois da animação da pilha. O ref é um só, e o campo dentro dele
    // troca com a pergunta.
    const input = hook.mock.calls.at(-1)?.[0];
    expect(input?.current?.props.accessibilityLabel).toBe(t('auth.email'));

    await answerEmail();
    expect(input?.current?.props.accessibilityLabel).toBe(t('auth.password'));
  });

  it('e-mail e senha ficam na mesma tela nas duas perguntas, com as marcas do preenchimento automático', async () => {
    // Se o gerenciador de senhas do aparelho enxerga o campo guardado, só o
    // aparelho responde: aqui fica travado o que a tela entrega a ele.
    openSignIn();

    // Na pergunta do e-mail, a senha já está lá, guardada.
    expect(storedField(t('auth.password')).props).toMatchObject({
      autoComplete: 'current-password',
      textContentType: 'password',
    });

    await answerEmail();

    // Na pergunta da senha, o e-mail segue no campo guardado e aparece na
    // pílula, que leva um campo só de leitura marcado como o nome de usuário.
    expect(storedField(t('auth.email')).props).toMatchObject({
      value: EMAIL,
      autoComplete: 'email',
      textContentType: 'username',
    });
    const inPill = screen
      .getAllByDisplayValue(EMAIL, { includeHiddenElements: true })
      .filter((field) => field.props.editable === false);
    expect(inPill).toHaveLength(1);
    expect(inPill[0]?.props).toMatchObject({
      autoComplete: 'username',
      textContentType: 'username',
    });
    expect(passwordField()).toHaveProp('autoComplete', 'current-password');
  });

  it('"Criar conta" troca para o cadastro no lugar: o voltar de lá leva à abertura, e não ao entrar', async () => {
    const view = renderRouter(appTree, { initialUrl: '/entrar' });
    fireEvent.press(button(t('auth.welcome.haveAccount')));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));

    fireEvent.press(button(t('auth.signIn.createAccount')));
    await waitFor(() => expect(view.getPathname()).toBe('/cadastro'));

    act(() => router.back());
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
  });
});

describe('entrar com e-mail: voltar da pergunta da senha', () => {
  it('o voltar redondo volta ao e-mail, com o que foi digitado; de lá, sai para a abertura', async () => {
    const view = await openPasswordStep();
    fireEvent.changeText(passwordField(), PASSWORD);

    fireEvent.press(back());

    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField()).toHaveProp('value', EMAIL);
    // O foco volta com a pergunta.
    expect(lastFocused()).toBe(t('auth.email'));
    expect(view.getPathname()).toBe('/entrar-com-email');

    // A senha digitada espera na pergunta dela.
    await answerEmail();
    expect(passwordField()).toHaveProp('value', PASSWORD);

    fireEvent.press(back());
    fireEvent.press(back());
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(title(t('auth.welcome.title'))).toBeTruthy();
  });

  it('a pílula volta ao e-mail para trocá-lo, e a senha passa a valer para o e-mail novo', async () => {
    await openPasswordStep();

    fireEvent.press(pill());
    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField()).toHaveProp('value', EMAIL);

    await answerEmail('bia@x.com');
    expect(pill('bia@x.com')).toBeTruthy();
    await submitPassword();

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, 'bia@x.com', PASSWORD);
  });

  it('o voltar do Android volta ao e-mail sem sair da tela; na pergunta do e-mail, a tela não o segura', async () => {
    const androidBack = watchAndroidBack();
    const view = await openPasswordStep();
    const held = androidBack.last();

    // `true` diz ao Android que o voltar já foi tratado: a tela fica.
    expect(androidBack.press()).toBe(true);

    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField()).toHaveProp('value', EMAIL);
    expect(view.getPathname()).toBe('/entrar-com-email');
    // De volta ao e-mail, a escuta da tela é desfeita: o voltar sai dela, como em qualquer tela.
    expect(held).toBeDefined();
    expect(androidBack.removed).toContain(held);
    // E nenhuma outra a segura: o voltar é da navegação, que, com a tela
    // aberta a frio e nada embaixo, o devolve ao sistema.
    expect(androidBack.press()).toBe(false);
  });
});

describe('entrar com e-mail: a senha', () => {
  it('manda o e-mail normalizado e segura o fã até as telas de conta saírem', async () => {
    let heldWhileSigningIn = false;
    jest.mocked(signInWithEmailAndPassword).mockImplementation(async () => {
      heldWhileSigningIn = useSessionStore.getState().authHolds > 0;
      return {} as UserCredential;
    });
    await openPasswordStep(' Camila@X.com ');

    await submitPassword();

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, 'camila@x.com', PASSWORD);
    expect(heldWhileSigningIn).toBe(true);
    // Depois da saída em fade, o guard fica livre para trocar a pilha.
    await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('o "Entrar" fica apagado só com a senha vazia, e diz por quê', async () => {
    await openPasswordStep();

    expect(signInButton()).toBeDisabled();
    expect(signInButton()).toHaveProp('accessibilityHint', EMPTY_HINT);

    // Com texto, acende mesmo curta demais: quem confere é o toque.
    fireEvent.changeText(passwordField(), '1');
    expect(signInButton()).toBeEnabled();
    expect(signInButton().props.accessibilityHint).toBeUndefined();
  });

  it('o "ir" do teclado faz o mesmo que o botão, sem fechar o teclado', async () => {
    await openPasswordStep();
    expect(passwordField()).toHaveProp('submitBehavior', 'submit');

    fireEvent.changeText(passwordField(), PASSWORD);
    await act(async () => {
      fireEvent(passwordField(), 'submitEditing');
    });

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, EMAIL, PASSWORD);
    await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
  });

  it('a senha curta enviada pelo "ir" do teclado fica no campo, é anunciada, e nada vai ao Firebase', async () => {
    await openPasswordStep();
    const message = t('validation.passwordMin', { min: 6 });

    fireEvent.changeText(passwordField(), '123');
    await act(async () => {
      fireEvent(passwordField(), 'submitEditing');
    });

    await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
    expect(passwordField()).toHaveProp('accessibilityHint', message);
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
    // A pergunta é a mesma: o erro é da senha, e o foco fica nela.
    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(lastFocused()).toBe(t('auth.password'));

    // Voltou a digitar: o erro sai, e só a conferência seguinte o traz de volta.
    fireEvent.changeText(passwordField(), '1234');
    expect(passwordField().props.accessibilityHint).toBeUndefined();
  });

  it('credencial recusada: o erro vai no campo da senha, é anunciado e sai quando o fã volta a digitar', async () => {
    jest
      .mocked(signInWithEmailAndPassword)
      .mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'recusada'));
    await openPasswordStep();
    const message = t('auth.errors.invalidCredentials');

    await submitPassword('senha-errada');

    // No campo: embaixo dele, e na dica que o leitor de tela ouve com o rótulo.
    await waitFor(() => expect(passwordField()).toHaveProp('accessibilityHint', message));
    expect(screen.getByText(message, { includeHiddenElements: true })).toBeTruthy();
    // E só nele: acima do pé, a mesma frase seria lida duas vezes.
    expect(screen.queryByText(message)).toBeNull();
    expect(announce()).toHaveBeenCalledWith(message);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(useSessionStore.getState().authHolds).toBe(0);
    // A pergunta e o e-mail seguem os mesmos, para corrigir a senha ou trocar o e-mail.
    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(pill()).toBeTruthy();

    fireEvent.changeText(passwordField(), 'senha-certa');
    await waitFor(() => expect(passwordField().props.accessibilityHint).toBeUndefined());
    expect(screen.queryByText(message, { includeHiddenElements: true })).not.toBeOnTheScreen();
  });

  it('a credencial recusada não acompanha o fã que volta para trocar o e-mail', async () => {
    jest
      .mocked(signInWithEmailAndPassword)
      .mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'recusada'));
    await openPasswordStep();
    const message = t('auth.errors.invalidCredentials');
    await submitPassword('senha-errada');
    await waitFor(() => expect(passwordField()).toHaveProp('accessibilityHint', message));

    fireEvent.press(pill());
    await answerEmail('bia@x.com');

    // A senha digitada continua lá, sem o erro da tentativa com o outro e-mail.
    expect(passwordField()).toHaveProp('value', 'senha-errada');
    expect(passwordField().props.accessibilityHint).toBeUndefined();
  });

  it.each([
    ['auth/network-request-failed', 'auth.errors.network'],
    ['auth/too-many-requests', 'auth.errors.tooManyRequests'],
    ['auth/internal-error', 'auth.errors.unknown'],
  ] as const)(
    '%s: a mensagem fica acima do pé, anunciada, sem pintar o campo',
    async (code, key) => {
      jest.mocked(signInWithEmailAndPassword).mockRejectedValueOnce(new FirebaseError(code, code));
      await openPasswordStep();

      await submitPassword();

      expect(await screen.findByText(t(key))).toBeTruthy();
      expect(announce()).toHaveBeenCalledWith(t(key));
      expect(passwordField().props.accessibilityHint).toBeUndefined();

      // Voltou a digitar: a mensagem sai.
      fireEvent.changeText(passwordField(), 'outra-senha');
      await waitFor(() => expect(screen.queryByText(t(key))).not.toBeOnTheScreen());
    },
  );

  it('enquanto entra, o botão fica ocupado e manda uma vez só; a tela não fica presa', async () => {
    jest
      .mocked(signInWithEmailAndPassword)
      .mockReturnValueOnce(new Promise<UserCredential>(() => undefined));
    await openPasswordStep();

    await submitPassword();
    await waitFor(() => expect(signInButton()).toBeBusy());

    // O "ir" do teclado não passa pelo botão ocupado: um envio por vez.
    await act(async () => {
      fireEvent(passwordField(), 'submitEditing');
    });
    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);

    // Pedir o link da senha também não solta o botão: o envio ainda anda.
    await act(async () => {
      fireEvent.press(forgot());
    });
    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
    expect(signInButton()).toBeBusy();

    // Entrar não prende a tela: o voltar ainda leva ao e-mail, e o envio segue
    // à vista no botão quando o fã volta à senha.
    expect(back()).toBeEnabled();
    expect(pill()).toBeEnabled();
    fireEvent.press(back());
    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(next()).toBeEnabled();
    await answerEmail();
    expect(signInButton()).toBeBusy();
  });

  it('sem o Firebase configurado: o aviso fica acima do pé nas duas perguntas, e nada vai ao Firebase', async () => {
    mockFirebaseConfigured = false;
    openSignIn();
    const warning = t('auth.missingConfig');
    expect(screen.getByText(warning)).toBeTruthy();

    // A pergunta do e-mail não depende do Firebase.
    await answerEmail();

    expect(screen.getByText(warning)).toBeTruthy();
    fireEvent.changeText(passwordField(), PASSWORD);
    expect(signInButton()).toBeDisabled();
    expect(forgot()).toBeDisabled();
    await act(async () => {
      fireEvent(passwordField(), 'submitEditing');
    });
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });
});

describe('esqueci minha senha', () => {
  it('manda o link para o e-mail da pergunta anterior, mostra e anuncia a frase curta, e fica no lugar', async () => {
    await openPasswordStep(' Camila@X.com ');

    await act(async () => {
      fireEvent.press(forgot());
    });

    expect(sendPasswordResetEmail).toHaveBeenCalledWith({}, 'camila@x.com');
    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(RESET_SENT);
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    // A frase longa ficou só na tela "Trocar senha".
    expect(announce()).not.toHaveBeenCalledWith(t('auth.signIn.resetSent'));
    expect(screen.queryByText(t('auth.signIn.resetSent'))).toBeNull();

    // O link segue no lugar, e dá para pedir de novo.
    expect(forgot()).toBeEnabled();
    await act(async () => {
      fireEvent.press(forgot());
    });
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
  });

  it('enquanto o pedido anda, o link fica desligado, sem sair do lugar', async () => {
    let finish: () => void = () => undefined;
    jest.mocked(sendPasswordResetEmail).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await openPasswordStep();

    fireEvent.press(forgot());
    await waitFor(() => expect(forgot()).toBeDisabled());
    expect(screen.queryByText(RESET_SENT)).toBeNull();

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(forgot()).toBeEnabled());
    expect(screen.getByText(RESET_SENT)).toBeTruthy();
  });

  it('o pedido que ainda anda não se perde na ida e volta pela pílula: o link segue desligado e a confirmação aparece quando ele termina', async () => {
    let finish: () => void = () => undefined;
    jest.mocked(sendPasswordResetEmail).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    await openPasswordStep();
    fireEvent.press(forgot());
    await waitFor(() => expect(forgot()).toBeDisabled());

    fireEvent.press(pill());
    expect(title(EMAIL_TITLE)).toBeTruthy();
    await answerEmail();
    // Ainda andando: o link segue desligado, e nenhum segundo e-mail sai.
    expect(forgot()).toBeDisabled();
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
    expect(forgot()).toBeEnabled();
  });

  it('conta que não existe responde igual à que existe', async () => {
    jest
      .mocked(sendPasswordResetEmail)
      .mockRejectedValueOnce(new FirebaseError('auth/user-not-found', 'não existe'));
    await openPasswordStep();

    await act(async () => {
      fireEvent.press(forgot());
    });

    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(RESET_SENT);
  });

  it('a falha do pedido aparece acima do pé, anunciada, e o link continua valendo', async () => {
    jest
      .mocked(sendPasswordResetEmail)
      .mockRejectedValueOnce(new FirebaseError('auth/internal-error', 'falhou'));
    await openPasswordStep();
    const message = t('auth.errors.resetUnknown');

    await act(async () => {
      fireEvent.press(forgot());
    });

    expect(await screen.findByText(message)).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(message);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(screen.queryByText(RESET_SENT)).toBeNull();
    expect(forgot()).toBeEnabled();
  });

  it('o pedido tira da tela o erro da tentativa de entrar', async () => {
    jest
      .mocked(signInWithEmailAndPassword)
      .mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'recusada'));
    await openPasswordStep();
    const rejected = t('auth.errors.invalidCredentials');
    await submitPassword('senha-errada');
    await waitFor(() => expect(passwordField()).toHaveProp('accessibilityHint', rejected));

    await act(async () => {
      fireEvent.press(forgot());
    });

    expect(await screen.findByText(RESET_SENT)).toBeTruthy();
    expect(passwordField().props.accessibilityHint).toBeUndefined();
  });

  it('a confirmação sai quando o fã tenta entrar', async () => {
    await openPasswordStep();
    await act(async () => {
      fireEvent.press(forgot());
    });
    expect(await screen.findByText(RESET_SENT)).toBeTruthy();

    await submitPassword();

    expect(screen.queryByText(RESET_SENT)).toBeNull();
    await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
  });

  it.each(['pela pílula', 'pelo voltar redondo', 'pelo voltar do Android'] as const)(
    'a confirmação sai quando o fã deixa a pergunta da senha %s',
    async (way) => {
      const androidBack = watchAndroidBack();
      await openPasswordStep();
      await act(async () => {
        fireEvent.press(forgot());
      });
      expect(await screen.findByText(RESET_SENT)).toBeTruthy();

      if (way === 'pela pílula') fireEvent.press(pill());
      else if (way === 'pelo voltar redondo') fireEvent.press(back());
      else androidBack.press();

      expect(title(EMAIL_TITLE)).toBeTruthy();
      expect(screen.queryByText(RESET_SENT)).toBeNull();
      // E não volta com a pergunta da senha.
      await answerEmail();
      expect(screen.queryByText(RESET_SENT)).toBeNull();
    },
  );
});

// O campo guardado não aparece nem recebe toque, mas segue montado, com as
// marcas do preenchimento automático. Se o gerenciador de senhas do aparelho
// escrever nele (só o aparelho diz se ele o enxerga), a tela se comporta assim.
describe('entrar com e-mail: o preenchimento automático nos campos guardados', () => {
  it('na pergunta do e-mail, a senha que o gerenciador preenche já espera na pergunta dela', async () => {
    openSignIn();
    fireEvent.changeText(emailField(), EMAIL);
    fireEvent.changeText(storedField(t('auth.password')), PASSWORD);

    await act(async () => {
      fireEvent.press(next());
    });
    await screen.findByRole('header', { name: PASSWORD_TITLE });

    expect(passwordField()).toHaveProp('value', PASSWORD);
    expect(signInButton()).toBeEnabled();
    await act(async () => {
      fireEvent.press(signInButton());
    });
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, EMAIL, PASSWORD);
  });

  it('na pergunta da senha, o e-mail trocado no campo guardado aparece na pílula, tira o erro da outra tentativa e é com ele que o fã entra', async () => {
    jest
      .mocked(signInWithEmailAndPassword)
      .mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'recusada'));
    await openPasswordStep();
    const rejected = t('auth.errors.invalidCredentials');
    await submitPassword();
    await waitFor(() => expect(passwordField()).toHaveProp('accessibilityHint', rejected));

    fireEvent.changeText(storedField(t('auth.email')), ' Bia@X.com ');

    // A pílula é a conferência do e-mail: mostra o que vai ser enviado.
    expect(pill('bia@x.com')).toBeTruthy();
    await waitFor(() => expect(passwordField().props.accessibilityHint).toBeUndefined());

    await act(async () => {
      fireEvent.press(signInButton());
    });
    expect(signInWithEmailAndPassword).toHaveBeenLastCalledWith({}, 'bia@x.com', PASSWORD);
  });

  it('rede de segurança: o e-mail guardado que deixou de valer leva a tela de volta à pergunta dele, com o erro no campo', async () => {
    await openPasswordStep();
    fireEvent.changeText(storedField(t('auth.email')), 'camila');
    const message = t('validation.emailInvalid');

    await submitPassword();

    expect(await screen.findByRole('header', { name: EMAIL_TITLE })).toBeTruthy();
    expect(emailField()).toHaveProp('accessibilityHint', message);
    expect(announce()).toHaveBeenCalledWith(message);
    expect(lastFocused()).toBe(t('auth.email'));
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });
});

describe('entrar com e-mail: o e-mail que chega pronto', () => {
  it('da troca de e-mail: abre direto na senha, com o e-mail na pílula e o foco no campo, sem dizer por quê', () => {
    handOffEmail(EMAIL);
    openSignIn();

    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(pill()).toBeTruthy();
    // A tela que abre na senha já nasce com o foco nela, e não no e-mail guardado.
    expect(passwordField()).toHaveProp('autoFocus', true);
    expect(storedField(t('auth.email'))).toHaveProp('autoFocus', false);
    expect(screen.queryByLabelText(t('auth.email'))).toBeNull();
    expect(screen.queryByText(IN_USE)).toBeNull();
    // Lido uma vez: a próxima entrada na tela começa pelo e-mail.
    expect(readHandedOffEmail()).toBeNull();
  });

  it('do cadastro, com o e-mail que já tem conta: abre na senha, diz por quê e entra com ele', async () => {
    handOffEmail(EMAIL, 'emailInUse');
    openSignIn();

    expect(title(PASSWORD_TITLE)).toBeTruthy();
    expect(pill()).toBeTruthy();
    expect(screen.getByText(IN_USE)).toBeTruthy();
    expect(readHandedOffEmail()).toBeNull();

    await submitPassword();

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, EMAIL, PASSWORD);
    await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
  });

  it('o voltar leva à pergunta do e-mail, com ele preenchido; trocado o e-mail, o aviso do cadastro sai', async () => {
    handOffEmail(EMAIL, 'emailInUse');
    const view = openSignIn();

    fireEvent.press(back());

    expect(title(EMAIL_TITLE)).toBeTruthy();
    expect(emailField()).toHaveProp('value', EMAIL);
    expect(view.getPathname()).toBe('/entrar-com-email');

    // O mesmo e-mail de volta: o aviso ainda vale.
    await answerEmail();
    expect(screen.getByText(IN_USE)).toBeTruthy();

    // Outro e-mail: o cadastro não disse nada sobre ele.
    fireEvent.press(pill());
    await answerEmail('bia@x.com');
    expect(pill('bia@x.com')).toBeTruthy();
    expect(screen.queryByText(IN_USE)).toBeNull();
  });
});
