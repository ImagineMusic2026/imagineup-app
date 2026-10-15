import { QueryClientProvider } from '@tanstack/react-query';
import {
  AppleAuthenticationCredentialState,
  getCredentialStateAsync,
  signInAsync,
} from 'expo-apple-authentication';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform, Text } from 'react-native';

import DeleteAccountRoute from '@/app/(tabs)/(perfil)/excluir-conta';
import { useAppleCredentialCheck, useAuthListener } from '@/domains/auth';
import { useSessionGate } from '@/hooks/use-session-gate';
import { googleIdToken, revokeGoogleAccess, signOutGoogle } from '@/services/google-sign-in';
import { haptics } from '@/services/haptics';
import { queryClient, queryPersister } from '@/services/query';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore, type SignInMethod } from '@/stores/session';

/**
 * A tela "Excluir conta" pelo provedor da sessão (seção 33 de
 * docs/arquitetura-api.md, decisão 12): a frase e a folha da Apple, o estágio
 * "Confirmar com o Google", a Apple ligada à sessão do Google e a outra conta.
 * A exclusão com a senha tem os casos dela no `settings.test.tsx`. A Apple é a
 * do `jest.setup.js` (as respostas de um iPhone, com o `user`
 * `mock-apple-user`); o Google é falso aqui.
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
jest.mock('firebase/auth', () => ({
  deleteUser: jest.fn(),
  EmailAuthProvider: {
    credential: jest.fn((email: string, password: string) => ({ email, password })),
  },
  GoogleAuthProvider: {
    credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })),
  },
  OAuthProvider: jest.fn((providerId: string) => ({
    credential: (options: Record<string, unknown>) => ({ providerId, ...options }),
  })),
  onAuthStateChanged: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  signOut: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));

const APPLE_UID = 'mock-apple-user';

/** A conta do Firebase que a tela exclui, com os provedores dela; a sessão já confirmada. */
const mockUser = {
  uid: 'uid-camila',
  email: 'camila@gmail.com',
  displayName: 'Camila Ribeiro',
  photoURL: null,
  providerData: [] as { providerId: string; uid: string }[],
  getIdToken: jest.fn(() => Promise.resolve('id-token-da-sessao')),
};
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
// A configuração do Firebase, para a revogação da Apple sair (sem o emulador).
jest.mock('@/config/env', () => ({
  firebaseEnv: { firebaseApiKey: 'chave-publica' },
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
  googleWebClientId: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));
jest.mock('@/services/google-sign-in', () => ({
  ...jest.requireActual('@/services/google-sign-in'),
  googleIdToken: jest.fn(),
  revokeGoogleAccess: jest.fn(() => Promise.resolve()),
  signOutGoogle: jest.fn(() => Promise.resolve()),
}));

/** Os guards do app, o listener do Auth e a conferência da Apple de verdade. */
function RootLayout() {
  useAuthListener();
  useAppleCredentialCheck();
  const { signedIn, onboarded } = useSessionGate();
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
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
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(perfil)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(perfil)/excluir-conta': DeleteAccountRoute,
};

const DELETE = 'Excluir minha conta';
const CONFIRM_GOOGLE = 'Confirmar com o Google';
const APPLE_NOTICE =
  'Para excluir, a Apple pede a sua confirmação. Depois, o ImagineUP perde o acesso ao seu ID Apple.';
const APPLE_LINKED_NOTICE =
  'Sua conta também entra pela Apple. Depois de confirmar, a Apple pede a sua confirmação para o ImagineUP perder o acesso ao seu ID Apple. Se você cancelar, a conta é excluída do mesmo jeito.';
const GOOGLE_LEAD = 'Por segurança, confirme com o Google para excluir a conta.';
const WRONG_ACCOUNT = 'Use a mesma conta com que você entrou no ImagineUP.';
const UNKNOWN = 'Não deu para excluir a conta agora. Ela continua como estava.';
const WRONG_PASSWORD = 'Senha incorreta.';
const hidden = { includeHiddenElements: true } as const;

const fetchMock = jest.fn();
const realFetch = globalThis.fetch;
const removeAccount = jest.mocked(deleteUser);
const reauth = jest.mocked(reauthenticateWithCredential);
const appleSheet = jest.mocked(signInAsync);
const googleSheet = jest.mocked(googleIdToken);

const firebaseError = (code: string) => new FirebaseError(code, code);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
/** Quando o mock foi chamado pela primeira vez, para conferir a ordem. */
const firstCall = (mock: unknown): number =>
  jest.mocked(mock as jest.Mock).mock.invocationCallOrder[0] ?? -1;

/**
 * A sessão: os provedores da conta (no Firebase e no espelho da sessão), o
 * provedor do token (`undefined`: ainda não chegou) e o último jeito de entrar
 * do aparelho.
 */
function session(
  providers: [SignInMethod, string][],
  signInProvider: SignInMethod | undefined,
  lastSignInMethod: SignInMethod | null = signInProvider ?? null,
): void {
  const providerIds: Record<SignInMethod, string> = {
    password: 'password',
    google: 'google.com',
    apple: 'apple.com',
  };
  mockUser.providerData = providers.map(([method, uid]) => ({
    providerId: providerIds[method],
    uid,
  }));
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: mockUser.uid,
      email: mockUser.email,
      displayName: mockUser.displayName,
      photoURL: null,
      hasPassword: providers.some(([method]) => method === 'password'),
      providers: providers.map(([method]) => method),
      ...(signInProvider === undefined ? {} : { signInProvider }),
    },
    authHolds: 0,
    deletingAccount: false,
  });
  usePreferencesStore.setState({ lastSignInMethod });
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  mockAuth.currentUser = mockUser;
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(firebaseSignOut).mockResolvedValue(undefined);
  removeAccount.mockReset();
  removeAccount.mockResolvedValue(undefined);
  reauth.mockReset();
  reauth.mockResolvedValue({} as never);
  jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: mockUser.uid,
    lastSignInMethod: null,
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('a sessão da Apple, no iPhone', () => {
  it('a frase da Apple embaixo da lista, e o botão abre a folha: reautentica, revoga e exclui', async () => {
    session([['apple', APPLE_UID]], 'apple');
    // O aviso de revogação que a própria revogação dispara, com a exclusão andando.
    let deletingDuringRevoke: boolean | null = null;
    fetchMock.mockImplementationOnce(async () => {
      deletingDuringRevoke = useSessionStore.getState().deletingAccount;
      jest
        .mocked(getCredentialStateAsync)
        .mockResolvedValueOnce(AppleAuthenticationCredentialState.REVOKED);
      jest
        .requireMock<{ mockEmitRevoked: () => void }>('expo-apple-authentication')
        .mockEmitRevoked();
      return { ok: true };
    });
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    expect(screen.getByTestId('delete-account-apple-notice')).toHaveTextContent(APPLE_NOTICE);
    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledWith(mockUser));
    expect(appleSheet).toHaveBeenCalledTimes(1);
    expect(reauth).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({ providerId: 'apple.com', idToken: 'mock-apple-identity-token' }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      providerId: 'apple.com',
      tokenType: 'CODE',
      token: 'mock-apple-authorization-code',
    });
    expect(firstCall(reauth)).toBeLessThan(firstCall(fetchMock));
    expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
    // A marca segurou o REVOKED: a sessão não saiu no meio da exclusão.
    expect(deletingDuringRevoke).toBe(true);
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Sua conta foi excluída.',
        { queue: true },
      ),
    );
    expect(firebaseSignOut).not.toHaveBeenCalled();
    expect(revokeGoogleAccess).not.toHaveBeenCalled();
    // A abertura não diz mais o jeito da conta que sumiu.
    expect(usePreferencesStore.getState().lastSignInMethod).toBeNull();
    expect(screen.getByRole('button', { name: DELETE })).toBeBusy();
  });

  it('fechar a folha da Apple volta sem erro: nada é excluído, e o botão fica livre', async () => {
    session([['apple', APPLE_UID]], 'apple');
    appleSheet.mockRejectedValueOnce(
      Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(appleSheet).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: DELETE })).not.toBeBusy());
    expect(screen.getByRole('button', { name: DELETE })).not.toBeDisabled();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(reauth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalledWith('error');
    expect(useSessionStore.getState().deletingAccount).toBe(false);
    expect(usePreferencesStore.getState().lastSignInMethod).toBe('apple');
  });

  it('outro ID Apple na folha diz para usar a mesma conta, sem excluir', async () => {
    session([['apple', APPLE_UID]], 'apple');
    reauth.mockRejectedValueOnce(firebaseError('auth/user-mismatch'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    expect(await screen.findByText(WRONG_ACCOUNT)).toBeTruthy();
    expect(announced()).toContain(WRONG_ACCOUNT);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(removeAccount).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().deletingAccount).toBe(false);
  });

  it('o token da Apple recusado na reautenticação diz que a conta continua, sem falar de senha', async () => {
    session([['apple', APPLE_UID]], 'apple');
    reauth.mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    expect(await screen.findByText(UNKNOWN)).toBeTruthy();
    expect(announced()).toEqual([UNKNOWN]);
    expect(screen.queryByText(WRONG_PASSWORD, hidden)).toBeNull();
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(screen.getByRole('button', { name: DELETE })).not.toBeDisabled();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().deletingAccount).toBe(false);
  });

  it('sem o provedor do token, vale o último jeito de entrar do aparelho', () => {
    session([['apple', APPLE_UID]], undefined, 'apple');
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    expect(screen.getByText(APPLE_NOTICE)).toBeTruthy();
  });
});

describe('a sessão do Google', () => {
  it('o login antigo vira o estágio "Confirmar com o Google", que reautentica, exclui e tira o acesso do Google', async () => {
    session([['google', 'g-bia']], 'google');
    removeAccount.mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    googleSheet.mockResolvedValueOnce({ idToken: 'id-novo', email: 'bia@gmail.com' });
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    expect(screen.queryByTestId('delete-account-apple-notice')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    const lead = await screen.findByTestId('delete-account-google');
    expect(lead).toHaveTextContent(GOOGLE_LEAD);
    expect(announced()).toContain(GOOGLE_LEAD);
    expect(haptics.trigger).toHaveBeenCalledWith('warning');
    // No lugar do campo de senha.
    expect(screen.queryByLabelText('Sua senha')).toBeNull();
    expect(googleSheet).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM_GOOGLE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(2));
    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('id-novo');
    expect(reauth).toHaveBeenCalledWith(mockUser, { providerId: 'google.com', idToken: 'id-novo' });
    expect(firstCall(reauth)).toBeLessThan(
      jest.mocked(removeAccount).mock.invocationCallOrder[1] ?? 0,
    );
    expect(revokeGoogleAccess).toHaveBeenCalledTimes(1);
    expect(appleSheet).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Sua conta foi excluída.',
        { queue: true },
      ),
    );
  });

  it('outra conta Google diz para usar a mesma conta, e o estágio fica', async () => {
    session([['google', 'g-bia']], 'google');
    removeAccount.mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    googleSheet.mockResolvedValueOnce({ idToken: 'id-de-outra', email: 'outra@gmail.com' });
    reauth.mockRejectedValueOnce(firebaseError('auth/user-mismatch'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_GOOGLE }));

    expect(await screen.findByText(WRONG_ACCOUNT)).toBeTruthy();
    expect(announced()).toContain(WRONG_ACCOUNT);
    expect(screen.getByRole('button', { name: CONFIRM_GOOGLE })).not.toBeDisabled();
    expect(screen.getByTestId('delete-account-google')).toBeTruthy();
    expect(removeAccount).toHaveBeenCalledTimes(1);
    expect(revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('o token do Google recusado na reautenticação diz que a conta continua, sem falar de senha, e o estágio fica', async () => {
    session([['google', 'g-bia']], 'google');
    removeAccount.mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    googleSheet.mockResolvedValueOnce({ idToken: 'id-recusado', email: 'bia@gmail.com' });
    reauth.mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_GOOGLE }));

    expect(await screen.findByText(UNKNOWN)).toBeTruthy();
    expect(announced()).toContain(UNKNOWN);
    expect(announced()).not.toContain(WRONG_PASSWORD);
    expect(screen.queryByText(WRONG_PASSWORD, hidden)).toBeNull();
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(screen.getByTestId('delete-account-google')).toBeTruthy();
    expect(screen.getByRole('button', { name: CONFIRM_GOOGLE })).not.toBeDisabled();
    // A próxima tentativa abre o seletor de contas de novo.
    expect(signOutGoogle).toHaveBeenCalled();
    expect(removeAccount).toHaveBeenCalledTimes(1);
    expect(revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('fechar a folha do Google deixa o estágio como estava, sem erro', async () => {
    session([['google', 'g-bia']], 'google');
    removeAccount.mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    googleSheet.mockResolvedValueOnce(null);
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_GOOGLE }));

    await waitFor(() => expect(googleSheet).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONFIRM_GOOGLE })).not.toBeBusy(),
    );
    expect(reauth).not.toHaveBeenCalled();
    expect(removeAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(WRONG_ACCOUNT, hidden)).toBeNull();
  });
});

describe('a Apple ligada à sessão do Google', () => {
  it('a frase da Apple ligada; o primeiro toque pede o Google, e depois dele a folha da Apple revoga e a conta sai', async () => {
    session(
      [
        ['google', 'g-camila'],
        ['apple', APPLE_UID],
      ],
      'google',
    );
    googleSheet.mockResolvedValueOnce({ idToken: 'id-novo', email: 'camila@gmail.com' });
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    expect(screen.getByTestId('delete-account-apple-notice')).toHaveTextContent(
      APPLE_LINKED_NOTICE,
    );
    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    // A confirmação da sessão vem antes de qualquer folha.
    expect(await screen.findByRole('button', { name: CONFIRM_GOOGLE })).toBeTruthy();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM_GOOGLE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));
    // Só o Google reautentica; a Apple é a tentativa de revogação.
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(reauth).toHaveBeenCalledWith(mockUser, { providerId: 'google.com', idToken: 'id-novo' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      tokenType: 'CODE',
      token: 'mock-apple-authorization-code',
    });
    expect(firstCall(reauth)).toBeLessThan(firstCall(appleSheet));
    expect(firstCall(appleSheet)).toBeLessThan(firstCall(fetchMock));
    expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
    expect(revokeGoogleAccess).toHaveBeenCalledTimes(1);
  });

  it('cancelar a folha da Apple exclui do mesmo jeito, sem revogar', async () => {
    session(
      [
        ['google', 'g-camila'],
        ['apple', APPLE_UID],
      ],
      'google',
    );
    googleSheet.mockResolvedValueOnce({ idToken: 'id-novo', email: 'camila@gmail.com' });
    appleSheet.mockRejectedValueOnce(
      Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_GOOGLE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Sua conta foi excluída.',
        { queue: true },
      ),
    );
  });

  it('no Android, sem a frase da Apple: o primeiro toque exclui, sem a folha da Apple (limite)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    session(
      [
        ['google', 'g-camila'],
        ['apple', APPLE_UID],
      ],
      'google',
    );
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    expect(screen.queryByTestId('delete-account-apple-notice')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));
    expect(appleSheet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(googleSheet).not.toHaveBeenCalled();
  });
});

describe('a sessão de senha', () => {
  it('sem a Apple, nenhuma frase da Apple; com a Apple ligada, a frase e a senha já no primeiro toque', async () => {
    session([['password', mockUser.email]], 'password');
    const view = renderRouter(appTree, { initialUrl: '/excluir-conta' });
    expect(screen.queryByTestId('delete-account-apple-notice')).toBeNull();
    view.unmount();

    session(
      [
        ['password', mockUser.email],
        ['apple', APPLE_UID],
      ],
      'password',
    );
    renderRouter(appTree, { initialUrl: '/excluir-conta' });
    expect(screen.getByText(APPLE_LINKED_NOTICE)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    expect(await screen.findByLabelText('Sua senha')).toBeTruthy();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();
  });
});
