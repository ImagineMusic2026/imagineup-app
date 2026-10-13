import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { FirebaseError } from 'firebase/app';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  updatePassword,
} from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Text } from 'react-native';

import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ChangePasswordRoute from '@/app/trocar-senha';
import { useAuthListener } from '@/domains/auth';
import { useSessionGate } from '@/hooks/use-session-gate';
import { haptics } from '@/services/haptics';
import { queryClient, queryPersister } from '@/services/query';
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
  updatePassword: jest.fn(),
  updateProfile: jest.fn(),
  verifyBeforeUpdateEmail: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));

// A conta do Alan, descartável (a conferência da etapa 6 troca a senha nela).
const mockUser = { uid: 'uid-alan', email: 'alan@teste.imagineup' };
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

/** Os guards do app e o listener do Auth de verdade, como no app. */
function RootLayout() {
  useAuthListener();
  const { signedIn, onboarded } = useSessionGate();
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="trocar-senha" />
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
  'trocar-senha': ChangePasswordRoute,
};

type AuthCallback = (user: { uid: string; email: string | null } | null) => void;

/** O Firebase avisa que a sessão acabou. */
function authSaysSignedOut(): void {
  const call = jest.mocked(onAuthStateChanged).mock.calls.at(-1);
  if (!call) throw new Error('listener não registrado');
  act(() => (call[1] as AuthCallback)(null));
}

const firebaseError = (code: string) => new FirebaseError(code, code);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
const hidden = { includeHiddenElements: true } as const;

const SUBMIT = 'Trocar senha';
const current = () => screen.getByLabelText('Senha atual');
const next = () => screen.getByLabelText('Nova senha');

/** Abre a tela pelos Ajustes, para o voltar ter para onde ir. */
async function openFromSettings() {
  const view = renderRouter(appTree, { initialUrl: '/ajustes' });
  fireEvent.press(screen.getByTestId('settings-change-password'));
  await waitFor(() => expect(view.getPathname()).toBe('/trocar-senha'));
  return view;
}

function fill(currentPassword: string, nextPassword: string): void {
  fireEvent.changeText(current(), currentPassword);
  fireEvent.changeText(next(), nextPassword);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = mockUser;
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(firebaseSignOut).mockResolvedValue(undefined);
  jest.mocked(reauthenticateWithCredential).mockResolvedValue({} as never);
  jest.mocked(updatePassword).mockResolvedValue(undefined);
  jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: 'uid-alan',
      email: 'alan@teste.imagineup',
      displayName: null,
      photoURL: null,
      hasPassword: true,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: 'uid-alan',
  });
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

describe('"Trocar senha" (seção 29, frente D)', () => {
  it('fora das abas: o título, o texto e os dois campos de senha', async () => {
    const view = await openFromSettings();

    expect(view.getSegments()).toEqual(['trocar-senha']);
    expect(screen.getByRole('header', { name: 'Trocar senha' })).toBeTruthy();
    expect(
      screen.getByText(
        'Digite a senha atual e a nova. Nos outros aparelhos, você sai da conta em até 1 hora.',
      ),
    ).toBeTruthy();
    expect(current()).toHaveProp('secureTextEntry', true);
    expect(next()).toHaveProp('secureTextEntry', true);
    // A regra da senha nova chega ao leitor pelo próprio campo.
    expect(next().props.accessibilityHint).toBe('Pelo menos 6 caracteres.');
  });

  it('reautentica com a senha atual antes de trocar; o sucesso anuncia, toca e volta aos Ajustes', async () => {
    const view = await openFromSettings();
    fill('senha-velha', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith(mockUser, 'senha-nova-10'));
    expect(mockAuth.authStateReady).toHaveBeenCalled();
    expect(EmailAuthProvider.credential).toHaveBeenCalledWith(
      'alan@teste.imagineup',
      'senha-velha',
    );
    const reauth = jest.mocked(reauthenticateWithCredential).mock.invocationCallOrder[0] ?? 0;
    const update = jest.mocked(updatePassword).mock.invocationCallOrder[0] ?? 0;
    expect(reauth).toBeLessThan(update);

    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      'Senha trocada.',
      { queue: true },
    );
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    // A sessão continua: o SDK renova o token deste aparelho.
    expect(firebaseSignOut).not.toHaveBeenCalled();
  });

  it('enquanto a troca vai, o botão fica ocupado e o voltar, desligado', async () => {
    jest.mocked(updatePassword).mockReturnValueOnce(new Promise<void>(() => undefined));
    await openFromSettings();
    fill('senha-velha', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(screen.getByRole('button', { name: SUBMIT })).toBeBusy());
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();
  });

  it('senha atual errada: o erro no campo dela, anunciado, e sai quando o fã volta a digitar', async () => {
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    const view = await openFromSettings();
    fill('errada', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(current().props.accessibilityHint).toBe('Senha incorreta.'));
    expect(announced()).toContain('Senha incorreta.');
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(updatePassword).not.toHaveBeenCalled();
    expect(view.getPathname()).toBe('/trocar-senha');

    fireEvent.changeText(current(), 'certa');
    await waitFor(() => expect(screen.queryByText('Senha incorreta.', hidden)).toBeNull());
  });

  it('senha nova recusada pelo Firebase: o erro no campo da nova', async () => {
    jest.mocked(updatePassword).mockRejectedValueOnce(firebaseError('auth/weak-password'));
    await openFromSettings();
    fill('senha-velha', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() =>
      expect(next().props.accessibilityHint).toContain('Escolha uma senha mais forte.'),
    );
    expect(current().props.accessibilityHint).toBeUndefined();
  });

  it.each([
    ['auth/too-many-requests', 'Muitas tentativas. Espere um pouco e tente de novo.'],
    ['auth/network-request-failed', 'Sem conexão. Confira a internet e tente de novo.'],
    ['auth/internal-error', 'Não deu para trocar a senha. Tente de novo.'],
  ])('%s: a mensagem embaixo do botão, anunciada, e a tela fica', async (code, message) => {
    jest.mocked(updatePassword).mockRejectedValueOnce(firebaseError(code));
    const view = await openFromSettings();
    fill('senha-velha', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(announced()).toContain(message);
    expect(view.getPathname()).toBe('/trocar-senha');
    expect(firebaseSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: SUBMIT })).not.toBeDisabled();
  });

  it('a sessão que já tinha caído: sai da conta, e o guard leva à entrada', async () => {
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/user-token-expired'));
    const view = await openFromSettings();
    fill('senha-velha', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(announced()).toContain('Sua sessão terminou. Entre de novo.');
    authSaysSignedOut();
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
  });

  it('sem conta logada no Firebase, nem reautentica: sai da conta', async () => {
    mockAuth.currentUser = null;
    await openFromSettings();
    fill('senha-velha', 'senha-nova-10');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('a senha nova igual à atual é recusada no aparelho, sem ir ao Firebase', async () => {
    await openFromSettings();
    fill('mesma-senha', 'mesma-senha');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    const message = 'A senha nova precisa ser diferente da atual.';
    await waitFor(() => expect(next().props.accessibilityHint).toContain(message));
    expect(announced()).toContain(message);
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('campos vazios ou senha nova curta: nada vai ao Firebase', async () => {
    await openFromSettings();

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
    await waitFor(() => expect(current().props.accessibilityHint).toBe('Digite sua senha.'));

    fill('senha-velha', '12345');
    fireEvent(next(), 'submitEditing');
    await waitFor(() =>
      expect(next().props.accessibilityHint).toContain(
        'A senha precisa de pelo menos 6 caracteres.',
      ),
    );
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('"Esqueci minha senha" manda o link para o e-mail da sessão', async () => {
    jest.mocked(sendPasswordResetEmail).mockResolvedValueOnce(undefined);
    await openFromSettings();

    fireEvent.press(screen.getByRole('button', { name: 'Esqueci minha senha' }));

    await waitFor(() =>
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(mockAuth, 'alan@teste.imagineup'),
    );
    const sent =
      'Se existir uma conta com esse e-mail, enviamos um link para criar uma senha nova.';
    expect(await screen.findByText(sent)).toBeTruthy();
    expect(announced()).toContain(sent);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('sem internet, o botão fica desligado e diz por quê', async () => {
    act(() => onlineManager.setOnline(false));
    await openFromSettings();

    const button = screen.getByRole('button', { name: SUBMIT });
    expect(button).toBeDisabled();
    expect(button).toHaveProp('accessibilityHint', 'Sem internet. Conecte-se para trocar a senha.');
    fill('senha-velha', 'senha-nova-10');
    fireEvent(next(), 'submitEditing');
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('aberta a frio, o voltar leva ao início', async () => {
    const view = renderRouter(appTree, { initialUrl: '/trocar-senha' });

    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));

    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });
});
