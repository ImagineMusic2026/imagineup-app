import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Linking, Text } from 'react-native';

import DeleteAccountRoute from '@/app/(tabs)/(perfil)/excluir-conta';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config/links';
import { useAuthListener } from '@/domains/auth';
import { handOffEmail, readHandedOffEmail } from '@/domains/auth/email-handoff';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { signOutGoogle } from '@/services/google-sign-in';
import { queryClient, queryPersister } from '@/services/query';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore, type SignInMethod } from '@/stores/session';

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
  deleteUser: jest.fn(),
  EmailAuthProvider: {
    credential: jest.fn((email: string, password: string) => ({ email, password })),
  },
  onAuthStateChanged: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  updateProfile: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));

// O usuário do Firebase que a tela exclui; a sessão já confirmada.
const mockUser = { uid: 'uid-descarte', email: 'descarte@teste.imagineup' };
const mockAuth = {
  authStateReady: jest.fn(() => Promise.resolve()),
  currentUser: mockUser as typeof mockUser | null,
};
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
// Sair também sai do Google no aparelho (seção 33, decisão 10).
jest.mock('@/services/google-sign-in', () => ({
  ...jest.requireActual('@/services/google-sign-in'),
  signOutGoogle: jest.fn(() => Promise.resolve()),
}));
// A config do app que está rodando. O `expoConfig` do jest-expo é um getter
// que não se troca (null sem manifesto); o resto das constantes segue o real.
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: Object.create(actual.default, {
      expoConfig: { get: () => ({ name: 'ImagineUP', slug: 'imagineup', version: '0.1.0' }) },
    }),
  };
});
// O update que está rodando: o binário embutido por padrão; os casos da versão trocam.
const mockUpdate = {
  isEmbeddedLaunch: true,
  createdAt: null as Date | null,
  updateId: null as string | null,
};
jest.mock('expo-updates', () => ({
  __esModule: true,
  get isEmbeddedLaunch() {
    return mockUpdate.isEmbeddedLaunch;
  },
  get createdAt() {
    return mockUpdate.createdAt;
  },
  get updateId() {
    return mockUpdate.updateId;
  },
}));
// Nas fixtures por padrão; os casos da meta com a API trocam.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

/** Os guards do app, o listener do Auth de verdade e o cache do app (que ele limpa). */
function RootLayout() {
  useAuthListener();
  const { signedIn, onboarded } = useSessionGate();
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="editar-perfil" />
          <Stack.Screen name="trocar-senha" />
          <Stack.Screen name="trocar-email" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}

const label = (text: string) =>
  function Label(): ReactNode {
    return <Text>{text}</Text>;
  };

const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/entrar': label('entrada'),
  '(onboarding)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(onboarding)/artistas': label('onboarding'),
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack screenOptions={{ headerShown: false }} />,
    unstable_settings: {
      inicio: { anchor: 'index' },
      explorar: { anchor: 'explorar' },
      ranking: { anchor: 'ranking' },
      perfil: { anchor: 'perfil' },
    },
  },
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(perfil)/excluir-conta': DeleteAccountRoute,
  '(tabs)/(perfil)/fas-bloqueados': label('fas bloqueados'),
  'editar-perfil': label('editar perfil'),
  'trocar-senha': label('trocar senha'),
  'trocar-email': label('trocar email'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

type AuthCallback = (user: { uid: string; email: string | null } | null) => void;

/** O Firebase avisa que a sessão acabou (sair, conta excluída). */
function authSaysSignedOut(): void {
  const call = jest.mocked(onAuthStateChanged).mock.calls.at(-1);
  if (!call) throw new Error('listener não registrado');
  act(() => (call[1] as AuthCallback)(null));
}

const firebaseError = (code: string) => new FirebaseError(code, code);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

const DELETE = 'Excluir minha conta';

/** O botão da aba Perfil na barra de abas padrão do Jest. */
const profileTab = () => screen.getByRole('button', { name: /perfil/ });
const hidden = { includeHiddenElements: true } as const;
const CONFIRM = 'Confirmar e excluir';

let removeClient: jest.SpyInstance;

/** A sessão de antes, com ou sem o provedor de senha (`undefined`: sem o campo). */
function setSessionPassword(hasPassword: boolean | undefined): void {
  useSessionStore.setState({
    user: {
      uid: 'uid-descarte',
      email: 'descarte@teste.imagineup',
      displayName: null,
      photoURL: null,
      ...(hasPassword === undefined ? {} : { hasPassword }),
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  mockAuth.currentUser = mockUser;
  Object.assign(mockUpdate, { isEmbeddedLaunch: true, createdAt: null, updateId: null });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(firebaseSignOut).mockResolvedValue(undefined);
  removeClient = jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: 'uid-descarte',
      email: 'descarte@teste.imagineup',
      displayName: null,
      photoURL: null,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: 'uid-descarte',
    lastSignInMethod: null,
  });
  queryClient.setQueryData(['profile', 'me', 'uid-descarte'], { username: 'fa711224' });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
  jest.restoreAllMocks();
});

describe('Ajustes', () => {
  it('mostra a conta com quem o fã entrou, Sair e Excluir conta', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByRole('header', { name: 'Ajustes' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Sair da conta. Entrou como descarte@teste.imagineup' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Excluir conta. Apaga seu perfil, seus pontos e seu @' }),
    ).toBeTruthy();
    // Só o que abre outra tela leva a seta: Sair sai na hora.
    expect(screen.queryByTestId('settings-sign-out-trailing', hidden)).toBeNull();
    expect(screen.getByTestId('settings-delete-account-trailing', hidden)).toBeTruthy();
  });

  it('as seções na ordem: Perfil, Segurança, Conta e Sobre (seção 29)', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getAllByRole('header').map((node) => node.props.children)).toEqual([
      'Ajustes',
      'Perfil',
      'Segurança',
      'Conta',
      'Sobre',
    ]);
    // Sem a suspensão, nada de aviso no topo.
    expect(screen.queryByTestId('suspended-notice')).toBeNull();
  });

  it('a seção Segurança traz "Fãs bloqueados", que abre a lista na pilha do Perfil', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = screen.getByRole('button', { name: 'Fãs bloqueados. Veja e desbloqueie' });
    expect(row).toHaveProp('accessibilityHint', 'Abre a lista de fãs bloqueados');
    expect(screen.getByTestId('settings-blocked-fans-trailing', hidden)).toBeTruthy();

    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/fas-bloqueados'));
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'fas-bloqueados']);
    expect(screen.getByText('fas bloqueados')).toBeTruthy();
  });

  it('a conta suspensa: o aviso fixo no topo, com o motivo e "Escrever para a equipe" (seção 29)', () => {
    queryClient.setQueryData(['profile', 'me', 'uid-descarte'], {
      username: 'fa711224',
      suspendedAt: '2026-10-10T12:00:00.000Z',
      suspensionReason: 'spam',
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByTestId('suspended-notice')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Sua conta está suspensa' })).toBeTruthy();
    expect(screen.getByText('Motivo: envio de spam.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Escrever para a equipe' })).toBeTruthy();
    // O aviso vem antes da primeira seção.
    const headers = screen.getAllByRole('header').map((node) => node.props.children);
    expect(headers.indexOf('Sua conta está suspensa')).toBeLessThan(headers.indexOf('Perfil'));
  });

  it('a seção Perfil traz "Editar perfil", que abre a tela fora das abas; nas fixtures, a meta de só leitura', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByRole('header', { name: 'Perfil' })).toBeTruthy();
    const row = screen.getByRole('button', {
      name: 'Editar perfil. Só leitura nesta versão do app',
    });
    expect(screen.getByText('Só leitura nesta versão do app')).toBeTruthy();
    expect(row).toHaveProp('accessibilityHint', 'Abre a edição do perfil');
    expect(screen.getByTestId('settings-edit-profile-trailing', hidden)).toBeTruthy();

    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    expect(view.getSegments()).toEqual(['editar-perfil']);
    expect(screen.getByText('editar perfil')).toBeTruthy();
  });

  it('com a API, a meta diz o que a tela edita; com o @ automático, avisa dele', async () => {
    mockDataSource = 'api';
    renderRouter(appTree, { initialUrl: '/ajustes' });
    // O perfil semeado tem o @ automático (fa711224).
    expect(
      await screen.findByRole('button', { name: 'Editar perfil. Seu @ ainda é automático' }),
    ).toBeTruthy();
    expect(screen.queryByText('Só leitura nesta versão do app')).toBeNull();
  });

  it('com a API e o @ automático travado pelo prazo (seção 32), a meta não convida a trocar o @', async () => {
    mockDataSource = 'api';
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    // O @ trocado pela equipe: o automático novo, com o prazo de 30 dias correndo.
    queryClient.setQueryData(['profile', 'me', 'uid-descarte'], {
      username: 'fa711224',
      usernameChangeableAt: inTenDays,
      usernameLockReason: 'moderation',
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });
    expect(
      await screen.findByRole('button', { name: 'Editar perfil. Foto, nome, @, bio e redes' }),
    ).toBeTruthy();
    expect(screen.queryByText('Seu @ ainda é automático')).toBeNull();
  });

  it('com a API e o prazo do @ vencido, o @ automático volta a ser avisado', async () => {
    mockDataSource = 'api';
    queryClient.setQueryData(['profile', 'me', 'uid-descarte'], {
      username: 'fa711224',
      usernameChangeableAt: '2026-01-01T12:00:00.000Z',
      usernameLockReason: 'moderation',
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });
    expect(
      await screen.findByRole('button', { name: 'Editar perfil. Seu @ ainda é automático' }),
    ).toBeTruthy();
  });

  it('com a API e o @ escolhido, a meta é "Foto, nome, @, bio e redes"', async () => {
    mockDataSource = 'api';
    queryClient.setQueryData(['profile', 'me', 'uid-descarte'], { username: 'camilarib' });
    renderRouter(appTree, { initialUrl: '/ajustes' });
    expect(
      await screen.findByRole('button', { name: 'Editar perfil. Foto, nome, @, bio e redes' }),
    ).toBeTruthy();
  });

  it('"Trocar e-mail" e "Trocar senha" só aparecem na conta com senha (seção 29, frente D)', () => {
    setSessionPassword(true);
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const email = screen.getByRole('button', {
      name: 'Trocar e-mail. Manda um link para o e-mail novo',
    });
    expect(email).toHaveProp('accessibilityHint', 'Abre a troca de e-mail');
    const password = screen.getByRole('button', { name: 'Trocar senha. Pede a senha atual' });
    expect(password).toHaveProp('accessibilityHint', 'Abre a troca de senha');
    // Na conta: as duas trocas antes de Sair e Excluir conta.
    const rows = screen
      .getAllByTestId(/^settings-(change-email|change-password|sign-out|delete-account)$/)
      .map((node) => node.props.testID);
    expect(rows).toEqual([
      'settings-change-email',
      'settings-change-password',
      'settings-sign-out',
      'settings-delete-account',
    ]);
  });

  it.each([
    ['sem o provedor de senha', false],
    ['sem o campo na sessão', undefined],
  ])('%s, as duas linhas não aparecem', (_, hasPassword) => {
    setSessionPassword(hasPassword);
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.queryByTestId('settings-change-email')).toBeNull();
    expect(screen.queryByTestId('settings-change-password')).toBeNull();
    expect(screen.getByTestId('settings-sign-out')).toBeTruthy();
  });

  it('"Trocar senha" e "Trocar e-mail" abrem fora das abas, na pilha raiz', async () => {
    setSessionPassword(true);
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-change-password'));
    await waitFor(() => expect(view.getPathname()).toBe('/trocar-senha'));
    expect(view.getSegments()).toEqual(['trocar-senha']);
    expect(screen.getByText('trocar senha')).toBeTruthy();

    act(() => router.back());
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    fireEvent.press(screen.getByTestId('settings-change-email'));
    await waitFor(() => expect(view.getPathname()).toBe('/trocar-email'));
    expect(view.getSegments()).toEqual(['trocar-email']);
  });

  it('Sair esquece o e-mail guardado para o login (o da troca de e-mail ainda não entra)', async () => {
    handOffEmail('descarte.novo@teste.imagineup');
    renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-sign-out'));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(readHandedOffEmail()).toBeNull();
  });

  it('Sair: sai no Firebase, o cache do aparelho vai embora e o guard leva à entrada', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-sign-out'));
    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    // A linha fica ocupada até a sessão cair, e o leitor ouve isso.
    await waitFor(() => expect(screen.getByTestId('settings-sign-out')).toBeBusy());
    expect(queryClient.getQueryData(['profile', 'me', 'uid-descarte'])).toBeDefined();

    authSaysSignedOut();

    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(queryClient.getQueryData(['profile', 'me', 'uid-descarte'])).toBeUndefined();
    expect(removeClient).toHaveBeenCalled();
    expect(usePreferencesStore.getState().lastSessionUid).toBeNull();
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('Excluir conta abre a confirmação, que diz o que se perde, sem excluir nada ainda', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-delete-account'));

    await waitFor(() => expect(view.getPathname()).toBe('/excluir-conta'));
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'excluir-conta']);
    expect(screen.getByRole('header', { name: 'Excluir conta' })).toBeTruthy();
    expect(screen.getByText(/A exclusão é definitiva/)).toBeTruthy();
    expect(screen.getByText(/bio, cidade e redes\. O @ fica livre para outra pessoa/)).toBeTruthy();
    expect(screen.getByText(/o saldo, o nível e as conquistas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: DELETE })).toBeTruthy();
    expect(deleteUser).not.toHaveBeenCalled();

    // "Manter minha conta" volta aos Ajustes.
    fireEvent.press(screen.getByRole('button', { name: 'Manter minha conta' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe('a linha "Sair" pelo jeito como a sessão entrou (seção 33, decisão 14)', () => {
  const EMAIL = 'descarte@teste.imagineup';

  /** A sessão com as contas ligadas e o provedor do token (`undefined`: ainda não chegou). */
  function setSession(
    providers: SignInMethod[],
    signInProvider: SignInMethod | null | undefined,
  ): void {
    useSessionStore.setState({
      user: {
        uid: 'uid-descarte',
        email: EMAIL,
        displayName: null,
        photoURL: null,
        hasPassword: providers.includes('password'),
        providers,
        ...(signInProvider === undefined ? {} : { signInProvider }),
      },
    });
  }

  it.each([
    ['com a senha', ['password'], 'password', `Entrou como ${EMAIL}`],
    ['com o Google', ['google'], 'google', `Entrou com o Google como ${EMAIL}`],
    // Sem o e-mail, que pode ser o de retransmissão da Apple.
    ['com a Apple', ['apple'], 'apple', 'Entrou com a Apple'],
    // A conta com a Apple e o Google diz por onde a sessão entrou, e não a lista.
    [
      'com a Apple e o Google, pela sessão do Google',
      ['apple', 'google'],
      'google',
      `Entrou com o Google como ${EMAIL}`,
    ],
    [
      'com a Apple e o Google, pela sessão da Apple',
      ['apple', 'google'],
      'apple',
      'Entrou com a Apple',
    ],
    // O token de outro jeito (o Admin SDK, o seed): o texto de sempre.
    ['por outro jeito', [], null, `Entrou como ${EMAIL}`],
  ] as const)('%s: %s', (_, providers, provider, meta) => {
    setSession([...providers], provider);
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByText(meta)).toBeTruthy();
    expect(screen.getByRole('button', { name: `Sair da conta. ${meta}` })).toBeTruthy();
  });

  it('sem o provedor do token (ainda não chegou, ou sem rede), vale o último jeito de entrar do aparelho', () => {
    setSession(['apple', 'google'], undefined);
    usePreferencesStore.setState({ lastSignInMethod: 'apple' });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByRole('button', { name: 'Sair da conta. Entrou com a Apple' })).toBeTruthy();
  });

  it('a conta só com a Apple e o Google não mostra "Trocar e-mail" nem "Trocar senha"', () => {
    setSession(['apple', 'google'], 'google');
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.queryByTestId('settings-change-email')).toBeNull();
    expect(screen.queryByTestId('settings-change-password')).toBeNull();
  });

  it('Sair também sai do Google no aparelho, e o último jeito de entrar fica', async () => {
    setSession(['google'], 'google');
    usePreferencesStore.setState({ lastSignInMethod: 'google' });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-sign-out'));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(signOutGoogle).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().lastSignInMethod).toBe('google');
  });
});

describe('excluir conta', () => {
  it('exclui no Firebase Auth e, com a sessão encerrada, limpa o aparelho e volta à entrada', async () => {
    jest.mocked(deleteUser).mockResolvedValue(undefined);
    const view = renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith(mockUser));
    expect(mockAuth.authStateReady).toHaveBeenCalled();
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Sua conta foi excluída.',
        { queue: true },
      ),
    );
    // Até o guard trocar a tela, o botão segue ocupado e o voltar, desativado.
    expect(screen.getByRole('button', { name: DELETE })).toBeBusy();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();

    // O Firebase encerra a sessão da conta excluída.
    authSaysSignedOut();
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(queryClient.getQueryData(['profile', 'me', 'uid-descarte'])).toBeUndefined();
    expect(removeClient).toHaveBeenCalled();
  });

  it('login antigo: pede a senha, reautentica com a credencial de e-mail e só então exclui', async () => {
    jest
      .mocked(deleteUser)
      .mockRejectedValueOnce(firebaseError('auth/requires-recent-login'))
      .mockResolvedValueOnce(undefined);
    jest.mocked(reauthenticateWithCredential).mockResolvedValue({} as never);
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    const password = await screen.findByLabelText('Sua senha');
    expect(password).toHaveProp('secureTextEntry', true);
    expect(announced()).toContain('Por segurança, confirme sua senha para excluir a conta.');
    expect(haptics.trigger).toHaveBeenCalledWith('warning');

    // Vazia, nada vai ao Firebase.
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    // A mensagem chega ao leitor pelo próprio campo (hint), não pelo texto.
    expect(await screen.findByText('Digite sua senha.', hidden)).toBeTruthy();
    expect(password.props.accessibilityHint).toBe('Digite sua senha.');
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();

    fireEvent.changeText(password, 'descarte-f10');
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledTimes(2));
    expect(EmailAuthProvider.credential).toHaveBeenCalledWith(
      'descarte@teste.imagineup',
      'descarte-f10',
    );
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockUser, {
      email: 'descarte@teste.imagineup',
      password: 'descarte-f10',
    });
    const reauthOrder = jest.mocked(reauthenticateWithCredential).mock.invocationCallOrder[0] ?? 0;
    const deleteOrder = jest.mocked(deleteUser).mock.invocationCallOrder[1] ?? 0;
    expect(reauthOrder).toBeLessThan(deleteOrder);
  });

  it('senha errada: erro no campo, a conta fica, e o erro sai quando o fã volta a digitar', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    const password = await screen.findByLabelText('Sua senha');
    fireEvent.changeText(password, 'senha-errada');
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    expect(await screen.findByText('Senha incorreta.', hidden)).toBeTruthy();
    expect(announced()).toContain('Senha incorreta.');
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(firebaseSignOut).not.toHaveBeenCalled();

    fireEvent.changeText(password, 'senha-certa');
    await waitFor(() => expect(screen.queryByText('Senha incorreta.', hidden)).toBeNull());
  });

  it('sem conexão no meio: mensagem, conta como estava, na mesma tela', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/network-request-failed'));
    const view = renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    const message =
      'Sem conexão. Sua conta continua como estava. Confira a internet e tente de novo.';
    expect(await screen.findByText(message)).toBeTruthy();
    expect(announced()).toContain(message);
    expect(firebaseSignOut).not.toHaveBeenCalled();
    expect(view.getPathname()).toBe('/excluir-conta');
    expect(useSessionStore.getState().status).toBe('signedIn');
    // Dá para tentar de novo.
    expect(screen.getByRole('button', { name: DELETE })).not.toBeDisabled();
  });

  it('sem internet, o botão fica desligado e diz por quê, no próprio botão', () => {
    act(() => onlineManager.setOnline(false));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    const button = screen.getByRole('button', { name: DELETE });
    expect(button).toBeDisabled();
    // O leitor chega ao botão antes do aviso: o motivo vai na dica dele.
    expect(button).toHaveProp(
      'accessibilityHint',
      'Sem internet. Conecte-se para excluir a conta.',
    );
    expect(screen.getByText('Sem internet. Conecte-se para excluir a conta.')).toBeTruthy();
  });

  it('sem internet, nem o "ir" do teclado na senha manda o pedido', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });
    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    const password = await screen.findByLabelText('Sua senha');

    act(() => onlineManager.setOnline(false));
    fireEvent.changeText(password, 'descarte-f10');
    fireEvent(password, 'submitEditing');

    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('enquanto exclui, tocar de novo na aba Perfil não tira o fã da tela', async () => {
    const pending = new Promise<void>(() => undefined);
    jest.mocked(deleteUser).mockReturnValueOnce(pending);
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });
    fireEvent.press(screen.getByTestId('settings-delete-account'));
    await waitFor(() => expect(view.getPathname()).toBe('/excluir-conta'));

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalled());
    fireEvent.press(profileTab());
    // A pilha só volta ao topo no quadro seguinte, se ninguém impedir (o
    // `renderRouter` liga os timers falsos).
    act(() => jest.advanceTimersByTime(100));

    expect(view.getPathname()).toBe('/excluir-conta');
  });

  it('sem exclusão andando, tocar de novo na aba Perfil volta ao topo dela', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });
    fireEvent.press(screen.getByTestId('settings-delete-account'));
    await waitFor(() => expect(view.getPathname()).toBe('/excluir-conta'));

    fireEvent.press(profileTab());

    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
  });

  it('sessão que já tinha caído (token revogado): sai da conta para o fã entrar de novo', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/user-token-expired'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(announced()).toContain('Sua sessão terminou. Entre de novo para excluir a conta.');
  });

  it('sem conta logada no Firebase, nem tenta excluir', async () => {
    mockAuth.currentUser = null;
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe('Sobre (seção 29, frente C)', () => {
  it('privacidade e termos abrem no navegador dentro do app, com a seta de fora do app', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const privacy = screen.getByRole('link', { name: 'Política de privacidade' });
    expect(privacy).toHaveProp('accessibilityHint', 'Abre a página no navegador');
    expect(screen.getByTestId('settings-privacy-trailing', hidden)).toBeTruthy();
    fireEvent.press(privacy);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      PRIVACY_URL,
      expect.objectContaining({ createTask: false }),
    );

    fireEvent.press(screen.getByRole('link', { name: 'Termos de uso' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      TERMS_URL,
      expect.objectContaining({ createTask: false }),
    );
  });

  it('o regulamento só aparece com o endereço no cache da loja', () => {
    queryClient.setQueryData(['rewards', 'list'], {
      rulesUrl: 'https://imagineup-painel.vercel.app/regulamento/',
      rewards: [],
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const rules = screen.getByRole('link', { name: 'Regulamento das recompensas' });
    expect(rules).toHaveProp('accessibilityHint', 'Abre a página no navegador');
    fireEvent.press(rules);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/regulamento/',
      expect.anything(),
    );
  });

  it('sem a loja no cache, nem com o endereço null, a linha não aparece, e a loja não é buscada', () => {
    mockDataSource = 'api';
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.queryByTestId('settings-rules')).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/rewards');
    expect(queryClient.getQueryState(['rewards', 'list'])?.fetchStatus).toBe('idle');
    view.unmount();

    queryClient.setQueryData(['rewards', 'list'], { rulesUrl: null, rewards: [] });
    renderRouter(appTree, { initialUrl: '/ajustes' });
    expect(screen.queryByTestId('settings-rules')).toBeNull();
  });

  it('"Fale com a equipe" abre o app de e-mail, com o endereço na meta', async () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const contact = screen.getByRole('link', { name: `Fale com a equipe. ${SUPPORT_EMAIL}` });
    expect(contact).toHaveProp('accessibilityHint', 'Abre o seu app de e-mail');
    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy();
    fireEvent.press(contact);

    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith(
        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Contato pelo app ImagineUP')}`,
      ),
    );
    expect(screen.queryByTestId('settings-contact-error')).toBeNull();
  });

  it('sem app de e-mail, o endereço aparece embaixo da lista, selecionável, e é anunciado', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('sem app de e-mail'));
    renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-contact'));

    const message = `Não deu para abrir o e-mail. Escreva para ${SUPPORT_EMAIL}.`;
    const error = await screen.findByTestId('settings-contact-error');
    expect(error).toHaveTextContent(message);
    expect(error).toHaveProp('selectable', true);
    expect(announced()).toContain(message);
  });

  it('a versão do binário embutido, sem toque', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const version = screen.getByTestId('settings-version');
    expect(version).toHaveProp('accessibilityLabel', 'Versão do app, 0.1.0');
    expect(version).not.toHaveProp('accessibilityRole', 'button');
    expect(screen.getByText('Versão 0.1.0')).toBeTruthy();
  });

  it('num EAS Update, a versão traz a data e o id curto do update', () => {
    Object.assign(mockUpdate, {
      isEmbeddedLaunch: false,
      // Meio do dia em UTC: "13 out" em qualquer fuso de -12 a +11.
      createdAt: new Date('2026-10-13T12:00:00.000Z'),
      updateId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByText('Versão 0.1.0, atualização de 13 out (a1b2c3d4)')).toBeTruthy();
    expect(screen.getByTestId('settings-version')).toHaveProp(
      'accessibilityLabel',
      'Versão do app, 0.1.0, atualização de 13 out (a1b2c3d4)',
    );
  });
});
