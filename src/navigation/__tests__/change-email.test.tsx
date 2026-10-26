import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { FirebaseError } from 'firebase/app';
import {
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Text } from 'react-native';

import SignInRoute from '@/app/(auth)/entrar-com-email';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ChangeEmailRoute from '@/app/trocar-email';
import { useAuthListener } from '@/domains/auth';
import { clearHandedOffEmail, readHandedOffEmail } from '@/domains/auth/email-handoff';
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

/** A entrada com e-mail é a de verdade: ela lê o e-mail guardado para o login. */
const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/entrar': label('entrada'),
  '(auth)/entrar-com-email': SignInRoute,
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
  'trocar-email': ChangeEmailRoute,
};

type AuthCallback = (user: { uid: string; email: string | null } | null) => void;

/** O Firebase avisa que a sessão acabou (sair, ou o link aberto no e-mail novo). */
function authSaysSignedOut(): void {
  const call = jest.mocked(onAuthStateChanged).mock.calls.at(-1);
  if (!call) throw new Error('listener não registrado');
  act(() => (call[1] as AuthCallback)(null));
}

const firebaseError = (code: string) => new FirebaseError(code, code);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

const SUBMIT = 'Mandar o link';
const NEW_EMAIL = 'alan.novo@teste.imagineup';
const emailField = () => screen.getByLabelText('Novo e-mail');
const passwordField = () => screen.getByLabelText('Senha atual');

async function openFromSettings() {
  const view = renderRouter(appTree, { initialUrl: '/ajustes' });
  fireEvent.press(screen.getByTestId('settings-change-email'));
  await waitFor(() => expect(view.getPathname()).toBe('/trocar-email'));
  return view;
}

function fill(email: string, password = 'senha-atual'): void {
  fireEvent.changeText(emailField(), email);
  fireEvent.changeText(passwordField(), password);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearHandedOffEmail();
  mockAuth.currentUser = mockUser;
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(firebaseSignOut).mockResolvedValue(undefined);
  jest.mocked(reauthenticateWithCredential).mockResolvedValue({} as never);
  jest.mocked(verifyBeforeUpdateEmail).mockResolvedValue(undefined);
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
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

describe('"Trocar e-mail" (seção 29, frente D)', () => {
  it('fora das abas, com o e-mail de agora no texto', async () => {
    const view = await openFromSettings();

    expect(view.getSegments()).toEqual(['trocar-email']);
    expect(screen.getByRole('header', { name: 'Trocar e-mail' })).toBeTruthy();
    expect(
      screen.getByText(
        'Hoje sua conta usa alan@teste.imagineup. Mandamos um link para o e-mail novo, e a troca só vale quando você abrir o link.',
      ),
    ).toBeTruthy();
    expect(passwordField()).toHaveProp('secureTextEntry', true);
  });

  it('reautentica e manda o link pelo verifyBeforeUpdateEmail; o "Enviado" mostra o e-mail novo', async () => {
    const view = await openFromSettings();
    fill(' Alan.Novo@Teste.ImagineUP ');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    // O e-mail novo vai normalizado, como no login.
    await waitFor(() => expect(verifyBeforeUpdateEmail).toHaveBeenCalledWith(mockUser, NEW_EMAIL));
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockUser, {
      email: 'alan@teste.imagineup',
      password: 'senha-atual',
    });
    const reauth = jest.mocked(reauthenticateWithCredential).mock.invocationCallOrder[0] ?? 0;
    const verify = jest.mocked(verifyBeforeUpdateEmail).mock.invocationCallOrder[0] ?? 0;
    expect(reauth).toBeLessThan(verify);

    expect(await screen.findByTestId('change-email-sent')).toBeTruthy();
    expect(
      screen.getByText(
        `Mandamos o link para ${NEW_EMAIL}. Depois de abrir o link, o app pede para você entrar de novo com o e-mail novo. Pode levar até 1 hora.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('O e-mail de agora recebe um aviso com um link para desfazer a troca.'),
    ).toBeTruthy();
    expect(announced()).toContain(`Link enviado para ${NEW_EMAIL}.`);
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    // O formulário sai, e o e-mail novo fica guardado para o login.
    expect(screen.queryByLabelText('Novo e-mail')).toBeNull();
    expect(readHandedOffEmail()).toBe(NEW_EMAIL);
    // Nada muda até o link: a sessão segue com o e-mail de agora.
    expect(useSessionStore.getState().user?.email).toBe('alan@teste.imagineup');

    fireEvent.press(screen.getByRole('button', { name: 'Voltar aos ajustes' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeTruthy();
    expect(useSessionStore.getState().user?.email).toBe('alan@teste.imagineup');
  });

  it.each(['alan@teste.imagineup', ' ALAN@Teste.imagineup '])(
    'o e-mail de agora (%j) é recusado no aparelho, sem ir ao Firebase',
    async (typed) => {
      await openFromSettings();
      fill(typed);

      fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

      const message = 'Este já é o e-mail da sua conta.';
      await waitFor(() => expect(emailField().props.accessibilityHint).toBe(message));
      expect(announced()).toContain(message);
      expect(reauthenticateWithCredential).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['auth/email-already-in-use', 'Este e-mail já tem uma conta no ImagineUP.'],
    ['auth/invalid-new-email', 'Digite um e-mail válido.'],
  ])('%s: o erro no campo do e-mail novo', async (code, message) => {
    jest.mocked(verifyBeforeUpdateEmail).mockRejectedValueOnce(firebaseError(code));
    await openFromSettings();
    fill(NEW_EMAIL);

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(emailField().props.accessibilityHint).toBe(message));
    expect(announced()).toContain(message);
    expect(screen.queryByTestId('change-email-sent')).toBeNull();
    expect(readHandedOffEmail()).toBeNull();
  });

  it('senha atual errada: o erro no campo da senha, e o link não sai', async () => {
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/wrong-password'));
    await openFromSettings();
    fill(NEW_EMAIL, 'errada');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(passwordField().props.accessibilityHint).toBe('Senha incorreta.'));
    expect(verifyBeforeUpdateEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      'auth/operation-not-allowed',
      'Não deu para trocar o e-mail agora. Fale com a equipe do ImagineUP.',
    ],
    ['auth/too-many-requests', 'Muitas tentativas. Espere um pouco e tente de novo.'],
    ['auth/network-request-failed', 'Sem conexão. Confira a internet e tente de novo.'],
    ['auth/internal-error', 'Não deu para mandar o link. Tente de novo.'],
  ])('%s: a mensagem embaixo do botão, anunciada', async (code, message) => {
    jest.mocked(verifyBeforeUpdateEmail).mockRejectedValueOnce(firebaseError(code));
    const view = await openFromSettings();
    fill(NEW_EMAIL);

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(announced()).toContain(message);
    expect(view.getPathname()).toBe('/trocar-email');
    expect(firebaseSignOut).not.toHaveBeenCalled();
  });

  it('a sessão que já tinha caído: sai da conta, e o guard leva à entrada', async () => {
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/user-disabled'));
    const view = await openFromSettings();
    fill(NEW_EMAIL);

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(announced()).toContain('Sua sessão terminou. Entre de novo.');
    authSaysSignedOut();
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
  });

  it('a sessão que cai sozinha depois do link: a entrada já vem com o e-mail novo', async () => {
    const view = await openFromSettings();
    fill(NEW_EMAIL);
    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
    await screen.findByTestId('change-email-sent');

    // O fã abriu o link: o Firebase revoga a sessão, e o aparelho sai.
    authSaysSignedOut();
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    act(() => router.push('/entrar-com-email'));

    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveProp('value', NEW_EMAIL));
  });

  it('"Sair" depois do "Enviado": a entrada vem sem o e-mail novo, que ainda não entra', async () => {
    const view = await openFromSettings();
    fill(NEW_EMAIL);
    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
    await screen.findByTestId('change-email-sent');
    fireEvent.press(screen.getByRole('button', { name: 'Voltar aos ajustes' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));

    fireEvent.press(screen.getByTestId('settings-sign-out'));
    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    authSaysSignedOut();
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    act(() => router.push('/entrar-com-email'));

    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveProp('value', ''));
    expect(readHandedOffEmail()).toBeNull();
  });
});
