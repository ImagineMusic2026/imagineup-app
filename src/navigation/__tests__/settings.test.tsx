import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Text } from 'react-native';

import DeleteAccountRoute from '@/app/(tabs)/(perfil)/excluir-conta';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import { useAuthListener } from '@/domains/auth';
import { useSessionGate } from '@/hooks/use-session-gate';
import { queryClient, queryPersister } from '@/services/query';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

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
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = mockUser;
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
    expect(screen.getByText(/o seu @, que fica livre para outra pessoa/)).toBeTruthy();
    expect(screen.getByText(/o saldo, o nível e as conquistas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: DELETE })).toBeTruthy();
    expect(deleteUser).not.toHaveBeenCalled();

    // "Manter minha conta" volta aos Ajustes.
    fireEvent.press(screen.getByRole('button', { name: 'Manter minha conta' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(deleteUser).not.toHaveBeenCalled();
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
