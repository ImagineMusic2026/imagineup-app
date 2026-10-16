import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import {
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import { router } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { Polygon } from 'react-native-svg';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { isExpoGo } from '@/config/runtime';
import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { layout, motion, radii } from '@/theme';

import { RiseIn } from '../components/rise-in';
import { AuthEntranceContext } from '../hooks/use-auth-entrance';
import { signInWithApple, signInWithGoogle, type SocialSignInResult } from '../social';
import { WelcomeScreen } from '../views/welcome';

/**
 * A abertura (1k) com os botões de marca (seção 33 de docs/arquitetura-api.md,
 * decisões 9, 15 e 16). O jest-expo roda como iOS, e a Apple do jest.setup.js
 * está disponível; o Google só aparece com o `googleWebClientId` (o
 * `@/config/env` daqui, lido a cada uso) e, no iOS, com o
 * `extra.googleIosClientId`. A folha do provedor e o Firebase ficam no
 * `social.ts`, falso aqui (o hook e o núcleo têm os testes próprios).
 */

jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

// O Google ligado ou não, por teste: o getter lê o valor a cada uso.
const mockEnv: { googleWebClientId: string | undefined } = { googleWebClientId: undefined };
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
  get googleWebClientId() {
    return mockEnv.googleWebClientId;
  },
}));

// O `extra.googleIosClientId` do app.config.ts, que só existe com o ID do cliente iOS.
const mockExtra: { googleIosClientId?: string } = {};
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: Object.create(actual.default, {
      expoConfig: { get: () => ({ extra: mockExtra }) },
    }),
  };
});

jest.mock('../social', () => ({
  ...jest.requireActual('../social'),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
}));

const apple = jest.mocked(signInWithApple);
const google = jest.mocked(signInWithGoogle);
const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

const APPLE_LABEL = 'Continuar com a Apple';

let entrance: StackEntranceTrigger;
let client: QueryClient;

/** O Google ligado: a variável e, no iOS, o ID do cliente iOS. */
function enableGoogle(): void {
  mockEnv.googleWebClientId = '1234-web.apps.googleusercontent.com';
  mockExtra.googleIosClientId = '1234-ios.apps.googleusercontent.com';
}

/** Promessa que o teste resolve quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  entrance = createStackEntrance();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  mockEnv.googleWebClientId = undefined;
  delete mockExtra.googleIosClientId;
  jest.mocked(isExpoGo).mockReturnValue(false);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  usePreferencesStore.setState({ lastSignInMethod: null });
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
  apple.mockReset();
  google.mockReset();
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

function welcome() {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>
        <AuthEntranceContext value={entrance}>
          <WelcomeScreen />
        </AuthEntranceContext>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** Abre a 1k e espera o sistema responder se a Apple está disponível. */
async function renderWelcome(): Promise<void> {
  render(welcome());
  await act(async () => undefined);
}

/** Opacidade de cada barra da marca ao lado do título, no primeiro quadro. */
function barsOpacity(): number[] {
  return screen.root
    .findAll((node) => node.type === Polygon)
    .map((node) => {
      const animated = node.props.animatedProps as { fillOpacity: number } | undefined;
      return animated ? animated.fillOpacity : (node.props.fillOpacity as number);
    });
}

const button = (name: string) => screen.getByRole('button', { name });
const hidden = { includeHiddenElements: true } as const;
const googleButton = () => button(t('auth.welcome.google'));

describe('abertura (1k)', () => {
  it('no iPhone com o Google ligado: título, texto, Apple, Google, criar conta, entrar e termos, nesta ordem', async () => {
    enableGoogle();
    await renderWelcome();
    const blocks = screen.UNSAFE_getAllByType(RiseIn);
    expect(blocks.map((block) => block.props.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const [title, lead, appleBlock, googleBlock, create, signIn] = blocks;
    expect(within(title!).getByRole('header', { name: t('auth.welcome.title') })).toBeTruthy();
    expect(within(lead!).getByText(t('auth.welcome.lead'))).toBeTruthy();
    expect(within(appleBlock!).getByRole('button', { name: APPLE_LABEL })).toBeTruthy();
    expect(
      within(googleBlock!).getByRole('button', { name: t('auth.welcome.google') }),
    ).toBeTruthy();
    expect(
      within(create!).getByRole('button', { name: t('auth.welcome.createAccount') }),
    ).toBeTruthy();
    expect(
      within(signIn!).getByRole('button', { name: t('auth.welcome.haveAccount') }),
    ).toBeTruthy();
    // Os textos novos: os de e-mail dizem que são por e-mail.
    expect(t('auth.welcome.createAccount')).toBe('Criar conta com e-mail');
    expect(t('auth.welcome.haveAccount')).toBe('Entrar com e-mail');
  });

  it('o botão da Apple é o nativo, branco, "Continuar", no raio e na altura dos outros', async () => {
    await renderWelcome();
    const native = button(APPLE_LABEL);
    expect(native).toHaveProp('buttonType', AppleAuthenticationButtonType.CONTINUE);
    expect(native).toHaveProp('buttonStyle', AppleAuthenticationButtonStyle.WHITE);
    expect(native).toHaveProp('cornerRadius', radii.cta);
    // A doc proíbe o fundo e o raio no `style`: só a largura e a altura vão nele.
    expect(StyleSheet.flatten(native.props.style)).toEqual({
      width: '100%',
      height: layout.buttonHeight.lg,
    });
  });

  it('sem a variável do Google, o botão dele não aparece', async () => {
    await renderWelcome();
    expect(screen.queryByRole('button', { name: t('auth.welcome.google') })).toBeNull();
    expect(button(APPLE_LABEL)).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(RiseIn).map((block) => block.props.order)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('no iPhone, com a variável e sem o ID do cliente iOS, o Google também não aparece', async () => {
    mockEnv.googleWebClientId = '1234-web.apps.googleusercontent.com';
    await renderWelcome();
    expect(screen.queryByRole('button', { name: t('auth.welcome.google') })).toBeNull();
  });

  it('no Android: o Google com a variável, e nunca a Apple', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockEnv.googleWebClientId = '1234-web.apps.googleusercontent.com';
    await renderWelcome();
    expect(googleButton()).toBeTruthy();
    expect(screen.queryByRole('button', { name: APPLE_LABEL })).toBeNull();
    expect(screen.queryByTestId('welcome-apple')).toBeNull();
  });

  it('no Android sem a variável, só os dois de e-mail', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderWelcome();
    expect(screen.queryByTestId('welcome-google')).toBeNull();
    expect(screen.queryByTestId('welcome-apple')).toBeNull();
    expect(button(t('auth.welcome.createAccount'))).toBeTruthy();
    expect(button(t('auth.welcome.haveAccount'))).toBeTruthy();
  });

  it('no Expo Go (sem os emuladores), nem a Apple nem o Google', async () => {
    enableGoogle();
    jest.mocked(isExpoGo).mockReturnValue(true);
    await renderWelcome();
    expect(screen.queryByTestId('welcome-google')).toBeNull();
    expect(screen.queryByTestId('welcome-apple')).toBeNull();
  });

  it('tudo espera o fade da pilha: antes dele, nada começa, e as barras nascem apagadas', async () => {
    const delay = jest.spyOn(Reanimated, 'withDelay');
    await renderWelcome();
    expect(delay).not.toHaveBeenCalled();
    expect(barsOpacity()).toEqual([0, 0, 0]);
  });

  it('no fade da pilha, os blocos sobem em sequência e as barras acendem enquanto o título sobe', async () => {
    enableGoogle();
    await renderWelcome();
    const delay = jest.spyOn(Reanimated, 'withDelay');
    act(() => entrance.enter());

    // 60 ms entre os blocos; as barras, 80 ms entre elas, a partir de 150 ms.
    const bars = motion.duration.fast;
    const byTime = (a: number, b: number) => a - b;
    expect(delay.mock.calls.map(([wait]) => wait).sort(byTime)).toEqual(
      [0, 60, 120, 180, 240, 300, 360, bars, bars + 80, bars + 160].sort(byTime),
    );
  });
});

describe('a linha da última entrada', () => {
  it.each([
    ['o Google', 'google', 'auth.welcome.lastMethod.google'],
    ['a Apple', 'apple', 'auth.welcome.lastMethod.apple'],
    ['e-mail e senha', 'password', 'auth.welcome.lastMethod.password'],
  ] as const)('com %s, fica antes dos botões, na vez dela', async (_, method, key) => {
    enableGoogle();
    usePreferencesStore.setState({ lastSignInMethod: method });
    await renderWelcome();

    const blocks = screen.UNSAFE_getAllByType(RiseIn);
    expect(blocks.map((block) => block.props.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(within(blocks[2]!).getByText(t(key))).toBeTruthy();
    expect(within(blocks[3]!).getByRole('button', { name: APPLE_LABEL })).toBeTruthy();
  });

  it('sem nenhuma entrada no aparelho, não aparece', async () => {
    await renderWelcome();
    for (const method of ['apple', 'google', 'password'] as const) {
      expect(screen.queryByText(t(`auth.welcome.lastMethod.${method}`))).toBeNull();
    }
  });

  it('não aponta para um botão que não está na tela (o Google desligado)', async () => {
    usePreferencesStore.setState({ lastSignInMethod: 'google' });
    await renderWelcome();
    expect(screen.queryByText(t('auth.welcome.lastMethod.google'))).toBeNull();
  });
});

describe('entrar pelo provedor', () => {
  it('o Google tocado carrega, e os outros botões ficam desligados até a folha fechar', async () => {
    enableGoogle();
    const sheet = deferred<SocialSignInResult | null>();
    google.mockReturnValueOnce(sheet.promise);
    await renderWelcome();

    fireEvent.press(googleButton());

    await waitFor(() => expect(googleButton()).toBeBusy());
    expect(announce()).toHaveBeenCalledWith(t('auth.social.signingInGoogle'));
    expect(button(t('auth.welcome.createAccount'))).toBeDisabled();
    expect(button(t('auth.welcome.haveAccount'))).toBeDisabled();
    // O nativo da Apple não desliga: o invólucro não deixa o toque passar.
    expect(screen.getByTestId('welcome-apple')).toHaveProp('pointerEvents', 'none');
    fireEvent.press(button(APPLE_LABEL));
    expect(apple).not.toHaveBeenCalled();

    // Cancelada: tudo volta, sem erro nem toque.
    await act(async () => sheet.resolve(null));
    await waitFor(() => expect(googleButton()).not.toBeBusy());
    expect(button(t('auth.welcome.createAccount'))).toBeEnabled();
    expect(screen.getByTestId('welcome-apple')).toHaveProp('pointerEvents', 'auto');
    expect(haptics.trigger).not.toHaveBeenCalledWith('error');
    expect(useSessionStore.getState().authHolds).toBe(0);
  });

  it('a Apple tocada mostra o indicador por cima do botão nativo', async () => {
    enableGoogle();
    const sheet = deferred<SocialSignInResult | null>();
    apple.mockReturnValueOnce(sheet.promise);
    await renderWelcome();

    fireEvent.press(button(APPLE_LABEL));

    // O indicador fica fora do leitor de tela: quem fala é o anúncio.
    await waitFor(() => expect(screen.getByTestId('welcome-apple-loading', hidden)).toBeTruthy());
    expect(announce()).toHaveBeenCalledWith(t('auth.social.signingInApple'));
    expect(googleButton()).toBeDisabled();

    await act(async () => sheet.resolve(null));
    await waitFor(() =>
      expect(screen.queryByTestId('welcome-apple-loading', hidden)).not.toBeOnTheScreen(),
    );
  });

  it('o erro aparece embaixo dos botões e é anunciado, com o toque de erro', async () => {
    enableGoogle();
    google.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'sem rede'));
    await renderWelcome();

    fireEvent.press(googleButton());

    expect(await screen.findByText(t('auth.errors.network'))).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(t('auth.errors.network'));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    // Embaixo de "Entrar com e-mail" e antes dos termos.
    const texts = screen.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string);
    const error = texts.indexOf(t('auth.errors.network'));
    expect(error).toBeGreaterThan(texts.indexOf(t('auth.welcome.haveAccount')));

    // Ir para o e-mail tira o erro.
    const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);
    await act(async () => {
      fireEvent.press(button(t('auth.welcome.haveAccount')));
    });
    expect(push).toHaveBeenCalledWith('/entrar-com-email');
    await waitFor(() => expect(screen.queryByText(t('auth.errors.network'))).not.toBeOnTheScreen());
  });

  it('o Google que esbarra numa conta de senha abre o entrar com e-mail (o modo "ligar")', async () => {
    enableGoogle();
    google.mockResolvedValueOnce({ kind: 'link', email: 'bia@empresa.com' });
    const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);
    await renderWelcome();

    fireEvent.press(googleButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith('/entrar-com-email'));
    expect(useSessionStore.getState().authHolds).toBe(0);
  });
});
