import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import {
  AppleAuthenticationCredentialState,
  getCredentialStateAsync,
  signInAsync,
  type AppleAuthenticationCredential,
} from 'expo-apple-authentication';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Text } from 'react-native';

import DeleteAccountRoute from '@/app/excluir-conta';
import { useAppleCredentialCheck, useAuthListener } from '@/domains/auth';
import { useSessionGate } from '@/hooks/use-session-gate';
import { t } from '@/i18n';
import { googleIdToken, revokeGoogleAccess } from '@/services/google-sign-in';
import { haptics } from '@/services/haptics';
import { queryClient, queryPersister } from '@/services/query';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// A tela "Excluir conta" com a Apple, no iPhone (39.4 de docs/arquitetura-api.md),
// com o listener do Auth e a conferência da Apple montados como no `_layout.tsx`:
// a sessão da Apple, que confirma pela folha e revoga antes do `deleteUser`, a
// Apple ligada a uma sessão de senha, e as contas do Google e da senha, como
// antes. A Apple é a do `jest.setup.js`; o jest-expo roda como iOS.

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
  OAuthProvider: jest.fn((providerId: string) => ({
    credential: (options: Record<string, unknown>) => ({ providerId, ...options }),
  })),
  EmailAuthProvider: {
    credential: jest.fn((email: string, password: string) => ({
      providerId: 'password',
      email,
      password,
    })),
  },
  GoogleAuthProvider: {
    credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })),
  },
  reauthenticateWithCredential: jest.fn(),
  deleteUser: jest.fn(),
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(() => () => undefined),
  updateDoc: jest.fn(),
  serverTimestamp: jest.fn(),
}));

// A conta do Firebase que a tela exclui; a sessão já confirmada.
const mockAuth = {
  authStateReady: jest.fn(() => Promise.resolve()),
  currentUser: null as unknown,
};
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
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
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/services/google-sign-in', () => ({
  GoogleSignInError: class GoogleSignInError extends Error {},
  isGoogleSignInAvailable: () => false,
  googleIdToken: jest.fn(),
  signOutGoogle: jest.fn(() => Promise.resolve()),
  revokeGoogleAccess: jest.fn(() => Promise.resolve()),
}));

/** Os guards do app, o listener do Auth e a conferência da Apple, como no `_layout.tsx`. */
function RootLayout() {
  useAuthListener();
  useAppleCredentialCheck();
  const { signedIn } = useSessionGate();
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="excluir-conta" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}

function Entry(): ReactNode {
  return <Text>entrada</Text>;
}

const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/entrar': Entry,
  'excluir-conta': DeleteAccountRoute,
};

const UID = 'uid-camila';
const EMAIL = 'camila@gmail.com';
const APPLE_UID = '000123.apple';
const DELETE = t('deleteAccount.submit');
const CONFIRM = t('deleteAccount.confirm');
const CONFIRM_APPLE = t('deleteAccount.confirmApple');
const CONFIRM_GOOGLE = t('deleteAccount.confirmGoogle');
const WRONG_PASSWORD = t('deleteAccount.errors.wrongPassword');
const hidden = { includeHiddenElements: true } as const;
const { AUTHORIZED, REVOKED, NOT_FOUND } = AppleAuthenticationCredentialState;

const removeAccount = jest.mocked(deleteUser);
const reauth = jest.mocked(reauthenticateWithCredential);
const appleSheet = jest.mocked(signInAsync);
const appleState = jest.mocked(getCredentialStateAsync);
const fetchMock = jest.fn();
const realFetch = globalThis.fetch;
const emitRevoked = (): void =>
  jest.requireMock<{ mockEmitRevoked: () => void }>('expo-apple-authentication').mockEmitRevoked();

const firebaseError = (code: string) => new FirebaseError(code, code);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
const button = (name: string) => screen.getByRole('button', { name });

/** A conta da sessão: os provedores dela e o provedor que abriu a sessão (o token). */
function signedInWith(providers: string[], signInProvider: string | Error) {
  const user = {
    uid: UID,
    email: EMAIL,
    displayName: 'Camila Ribeiro',
    photoURL: null,
    providerData: providers.map((providerId) => ({
      providerId,
      uid: providerId === 'apple.com' ? APPLE_UID : `${providerId}-camila`,
    })),
    getIdToken: jest.fn(async () => 'id-token-da-sessao'),
    getIdTokenResult: jest.fn(async () => {
      if (signInProvider instanceof Error) throw signInProvider;
      return { signInProvider };
    }),
  };
  mockAuth.currentUser = user;
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: UID,
      email: EMAIL,
      displayName: 'Camila Ribeiro',
      photoURL: null,
      hasPassword: providers.includes('password'),
    },
    authHolds: 0,
    deletingAccount: false,
  });
  return user;
}

function appleCredentialWith(
  overrides: Partial<AppleAuthenticationCredential> = {},
): AppleAuthenticationCredential {
  return {
    user: APPLE_UID,
    state: null,
    fullName: null,
    email: null,
    realUserStatus: 2,
    identityToken: 'token-da-apple',
    authorizationCode: 'codigo-da-apple',
    ...overrides,
  } as AppleAuthenticationCredential;
}

/** Quando o mock foi chamado pela primeira vez, para conferir a ordem. */
const firstCall = (mock: unknown): number =>
  jest.mocked(mock as jest.Mock).mock.invocationCallOrder[0] ?? -1;

const openDelete = () => renderRouter(appTree, { initialUrl: '/excluir-conta' });

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  removeAccount.mockReset();
  removeAccount.mockResolvedValue(undefined);
  reauth.mockReset();
  reauth.mockResolvedValue({} as never);
  appleState.mockReset();
  appleState.mockResolvedValue(AUTHORIZED);
  appleSheet.mockResolvedValue(appleCredentialWith());
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(firebaseSignOut).mockResolvedValue(undefined);
  jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: UID,
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  // A revogação que falha avisa no desenvolvimento.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
  jest.restoreAllMocks();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('a sessão da Apple', () => {
  it('a tela pede a confirmação da Apple, e o toque abre a folha, reautentica, revoga e só então exclui', async () => {
    const user = signedInWith(['apple.com'], 'apple.com');
    openDelete();

    expect(await screen.findByRole('button', { name: CONFIRM_APPLE })).toBeTruthy();
    expect(screen.getByText(t('deleteAccount.appleLead'))).toBeTruthy();

    fireEvent.press(button(CONFIRM_APPLE));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledWith(user));
    expect(reauth).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ providerId: 'apple.com', idToken: 'token-da-apple' }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      tokenType: 'CODE',
      token: 'codigo-da-apple',
    });
    expect(firstCall(appleSheet)).toBeLessThan(firstCall(reauth));
    expect(firstCall(reauth)).toBeLessThan(firstCall(fetchMock));
    expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        t('deleteAccount.done'),
        { queue: true },
      ),
    );
    expect(screen.queryByLabelText(t('deleteAccount.password'))).toBeNull();
  });

  it('o REVOKED que chega durante a revogação da própria exclusão não tira a sessão', async () => {
    signedInWith(['apple.com'], 'apple.com');
    fetchMock.mockImplementationOnce(async () => {
      appleState.mockResolvedValue(REVOKED);
      emitRevoked();
      return { ok: true };
    });
    openDelete();

    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_APPLE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalled());
    await act(async () => undefined);
    expect(appleState).toHaveBeenCalledTimes(2);
    expect(firebaseSignOut).not.toHaveBeenCalled();
  });

  it('a folha fechada: nenhuma mensagem, o botão livre de novo e a exclusão fora de andamento', async () => {
    signedInWith(['apple.com'], 'apple.com');
    appleSheet.mockRejectedValueOnce(
      Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    openDelete();

    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_APPLE }));

    await waitFor(() => expect(button(CONFIRM_APPLE)).not.toBeBusy());
    expect(button(CONFIRM_APPLE)).toBeEnabled();
    expect(removeAccount).not.toHaveBeenCalled();
    expect(useSessionStore.getState().deletingAccount).toBe(false);
    expect(screen.queryByText(t('deleteAccount.errors.appleUnavailable'))).toBeNull();
  });

  it('outra Conta Apple no iPhone: a frase dela embaixo do botão, com o toque de erro', async () => {
    signedInWith(['apple.com'], 'apple.com');
    reauth.mockRejectedValueOnce(firebaseError('auth/user-mismatch'));
    openDelete();

    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_APPLE }));

    expect(await screen.findByText(t('deleteAccount.errors.wrongAppleAccount'))).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(announced()).toContain(t('deleteAccount.errors.wrongAppleAccount'));
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('o token que o Firebase recusa: appleUnavailable, nunca "Senha incorreta."', async () => {
    signedInWith(['apple.com'], 'apple.com');
    reauth.mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    openDelete();

    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_APPLE }));

    expect(await screen.findByText(t('deleteAccount.errors.appleUnavailable'))).toBeTruthy();
    expect(screen.queryByText(WRONG_PASSWORD, hidden)).toBeNull();
    expect(screen.queryByLabelText(t('deleteAccount.password'))).toBeNull();
  });

  it('a conta só da Apple sem o token ainda vai pela Apple, nunca pelo campo da senha', async () => {
    signedInWith(['apple.com'], firebaseError('auth/network-request-failed'));
    openDelete();

    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_APPLE }));

    await waitFor(() => expect(removeAccount).toHaveBeenCalled());
    expect(appleSheet).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(t('deleteAccount.password'))).toBeNull();
  });
});

describe('a Apple ligada a uma sessão de senha', () => {
  it('o aviso aparece, e o primeiro toque pede a senha sem abrir a folha', async () => {
    signedInWith(['password', 'apple.com'], 'password');
    openDelete();

    expect(await screen.findByText(t('deleteAccount.appleLinkedNotice'))).toBeTruthy();
    fireEvent.press(button(DELETE));

    expect(await screen.findByLabelText(t('deleteAccount.password'))).toBeTruthy();
    expect(appleSheet).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('com a senha: a credencial autorizada abre a folha, revoga e exclui', async () => {
    const user = signedInWith(['password', 'apple.com'], 'password');
    openDelete();
    await screen.findByText(t('deleteAccount.appleLinkedNotice'));
    fireEvent.press(button(DELETE));

    fireEvent.changeText(await screen.findByLabelText(t('deleteAccount.password')), 'senha-certa');
    fireEvent.press(button(CONFIRM));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledWith(user));
    expect(reauth).toHaveBeenCalledWith(user, expect.objectContaining({ providerId: 'password' }));
    expect(appleState).toHaveBeenCalledWith(APPLE_UID);
    expect(appleSheet).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
  });

  it('cancelar a folha da Apple exclui a conta do mesmo jeito', async () => {
    signedInWith(['password', 'apple.com'], 'password');
    appleSheet.mockRejectedValueOnce(
      Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    openDelete();
    await screen.findByText(t('deleteAccount.appleLinkedNotice'));
    fireEvent.press(button(DELETE));

    fireEvent.changeText(await screen.findByLabelText(t('deleteAccount.password')), 'senha-certa');
    fireEvent.press(button(CONFIRM));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a credencial que não está neste iPhone: exclui sem abrir a folha', async () => {
    signedInWith(['password', 'apple.com'], 'password');
    openDelete();
    await screen.findByText(t('deleteAccount.appleLinkedNotice'));
    fireEvent.press(button(DELETE));
    appleState.mockResolvedValue(NOT_FOUND);

    fireEvent.changeText(await screen.findByLabelText(t('deleteAccount.password')), 'senha-certa');
    fireEvent.press(button(CONFIRM));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));
    expect(appleSheet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a senha errada: "Senha incorreta.", sem a folha e sem excluir', async () => {
    signedInWith(['password', 'apple.com'], 'password');
    reauth.mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    openDelete();
    await screen.findByText(t('deleteAccount.appleLinkedNotice'));
    fireEvent.press(button(DELETE));

    fireEvent.changeText(await screen.findByLabelText(t('deleteAccount.password')), 'errada');
    fireEvent.press(button(CONFIRM));

    expect(await screen.findByText(WRONG_PASSWORD, hidden)).toBeTruthy();
    expect(appleSheet).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });
});

describe('a conta do Google, sem a Apple', () => {
  it('o login antigo pede o Google; o toque reautentica, exclui e revoga o acesso do Google', async () => {
    const user = signedInWith(['google.com'], 'google.com');
    jest.mocked(googleIdToken).mockResolvedValue({ idToken: 'id-novo', email: EMAIL });
    removeAccount.mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    openDelete();

    fireEvent.press(button(DELETE));

    expect(await screen.findByRole('button', { name: CONFIRM_GOOGLE })).toBeTruthy();
    expect(screen.getByText(t('deleteAccount.errors.needsGoogle'))).toBeTruthy();

    fireEvent.press(button(CONFIRM_GOOGLE));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(2));
    expect(reauth).toHaveBeenCalledWith(user, { providerId: 'google.com', idToken: 'id-novo' });
    expect(revokeGoogleAccess).toHaveBeenCalledTimes(1);
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();
  });

  it('outra conta do Google: a frase dela, e a conta fica', async () => {
    signedInWith(['google.com'], 'google.com');
    jest.mocked(googleIdToken).mockResolvedValue({ idToken: 'id-de-outra', email: 'outra@x.com' });
    removeAccount.mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    reauth.mockRejectedValueOnce(firebaseError('auth/user-mismatch'));
    openDelete();

    fireEvent.press(button(DELETE));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM_GOOGLE }));

    expect(await screen.findByText(t('deleteAccount.errors.wrongGoogleAccount'))).toBeTruthy();
    expect(removeAccount).toHaveBeenCalledTimes(1);
  });
});

describe('a conta de senha, sem a Apple, no iPhone', () => {
  it('como antes: o primeiro toque exclui, sem ler o token', async () => {
    const user = signedInWith(['password'], 'password');
    const view = openDelete();

    fireEvent.press(button(DELETE));

    await waitFor(() => expect(removeAccount).toHaveBeenCalledWith(user));
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
    expect(appleState).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();

    // O Firebase encerra a sessão da conta excluída, e o guard leva à entrada.
    const call = jest.mocked(onAuthStateChanged).mock.calls.at(-1);
    act(() => (call?.[1] as (user: null) => void)(null));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(useSessionStore.getState().deletingAccount).toBe(false);
  });
});
