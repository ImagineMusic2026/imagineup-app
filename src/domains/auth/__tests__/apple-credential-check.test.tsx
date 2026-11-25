import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  addRevokeListener,
  AppleAuthenticationCredentialState,
  getCredentialStateAsync,
} from 'expo-apple-authentication';
import { onAuthStateChanged, signOut, updateProfile } from 'firebase/auth';
import { onSnapshot, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { playStackExit } from '@/hooks/use-stack-fade';
import { appleSignInAvailability } from '@/services/apple-sign-in';
import { queryClient, queryPersister } from '@/services/query';
import { StorageKeys } from '@/storage/storage';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { handOffEmail, readHandedOffEmail } from '../email-handoff';
import { useAppleCredentialCheck } from '../hooks/use-apple-credential-check';
import { useAuthListener } from '../hooks/use-auth-listener';

/**
 * A Apple em cada sessão (seção 39 de docs/arquitetura-api.md), com o listener
 * do Auth e a conferência montados como no `_layout.tsx`: a credencial
 * revogada que tira só a sessão da Apple, a exclusão em andamento, o Android,
 * a disponibilidade pedida na abertura e o nome guardado da Apple.
 */

// O build do Firebase que o Jest resolve é ESM; o listener e a conferência só usam estas peças.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
  updateProfile: jest.fn(() => Promise.resolve()),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(() => () => undefined),
  updateDoc: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => 'agora-do-servidor'),
}));
// A conta de agora no Auth: a conferência lê o `uid` da Apple e o token dela.
const mockAuth: { currentUser: unknown } = { currentUser: null };
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
jest.mock('@/hooks/use-stack-fade', () => ({ playStackExit: jest.fn() }));
// A disponibilidade de verdade, só vigiada: a abertura a pede uma vez.
jest.mock('@/services/apple-sign-in', () => ({
  ...jest.requireActual('@/services/apple-sign-in'),
  appleSignInAvailability: jest.fn(() => Promise.resolve(false)),
}));

const APPLE_UID = '000123.apple';
const appleState = jest.mocked(getCredentialStateAsync);
const { REVOKED, AUTHORIZED } = AppleAuthenticationCredentialState;
const emitRevoked = (): void =>
  jest.requireMock<{ mockEmitRevoked: () => void }>('expo-apple-authentication').mockEmitRevoked();

type AuthCallback = (user: unknown) => void;

/** O callback que o listener registrou no Firebase. */
function authCallback(): AuthCallback {
  const call = jest.mocked(onAuthStateChanged).mock.calls[0];
  if (!call) throw new Error('listener não registrado');
  return call[1] as AuthCallback;
}

/** A conta do Firebase, com os provedores e o token que diz por onde a sessão entrou. */
function firebaseUser(signInProvider: string | Error, providers = ['apple.com']) {
  return {
    uid: 'uid-camila',
    email: 'camila@privaterelay.appleid.com',
    displayName: null,
    photoURL: null,
    providerData: providers.map((providerId) => ({
      providerId,
      uid: providerId === 'apple.com' ? APPLE_UID : 'outro-uid',
    })),
    getIdTokenResult: jest.fn(async () => {
      if (signInProvider instanceof Error) throw signInProvider;
      return { signInProvider };
    }),
  };
}

/** O app abre com a sessão salva, com o listener e a conferência montados, como no `_layout`. */
async function openWith(user: ReturnType<typeof firebaseUser>): Promise<void> {
  renderHook(() => {
    useAuthListener();
    useAppleCredentialCheck();
  });
  mockAuth.currentUser = user;
  await act(async () => authCallback()(user));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuth.currentUser = null;
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(playStackExit).mockResolvedValue(undefined);
  jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  useSessionStore.setState({ status: 'loading', user: null, authHolds: 0, deletingAccount: false });
  usePreferencesStore.setState({ hydrated: true, lastSessionUid: 'uid-camila' });
  appleState.mockReset();
  appleState.mockResolvedValue(AUTHORIZED);
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

describe('a credencial da Apple revogada (39.5)', () => {
  it('a sessão aberta pela Apple sai, e o e-mail guardado para o login vai junto', async () => {
    handOffEmail('camila@privaterelay.appleid.com');
    appleState.mockResolvedValueOnce(REVOKED);
    await openWith(firebaseUser('apple.com'));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(appleState).toHaveBeenCalledWith(APPLE_UID);
    expect(readHandedOffEmail()).toBeNull();
  });

  it('a credencial autorizada, ou a conferência que falha, deixam a sessão', async () => {
    await openWith(firebaseUser('apple.com'));
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(1));

    appleState.mockRejectedValueOnce(new Error('rede'));
    await act(async () => emitRevoked());
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(2));
    expect(signOut).not.toHaveBeenCalled();
  });

  it('o aviso de revogação confere de novo e tira a sessão revogada', async () => {
    await openWith(firebaseUser('apple.com'));
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(1));
    expect(signOut).not.toHaveBeenCalled();

    appleState.mockResolvedValueOnce(REVOKED);
    await act(async () => emitRevoked());

    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it('a sessão de senha, com a Apple ligada, nunca sai pela Apple', async () => {
    appleState.mockResolvedValue(REVOKED);
    await openWith(firebaseUser('password', ['password', 'apple.com']));
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(1));
    await act(async () => emitRevoked());
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(2));

    expect(signOut).not.toHaveBeenCalled();
  });

  it('sem o token, a conta só da Apple sai', async () => {
    appleState.mockResolvedValueOnce(REVOKED);
    await openWith(firebaseUser(new Error('auth/network-request-failed')));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it('sem o token, a conta da Apple com a senha fica', async () => {
    appleState.mockResolvedValueOnce(REVOKED);
    const user = firebaseUser(new Error('auth/network-request-failed'), ['apple.com', 'password']);
    await openWith(user);

    await waitFor(() => expect(user.getIdTokenResult).toHaveBeenCalled());
    await act(async () => undefined);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('com a exclusão da conta em andamento, o REVOKED não tira a sessão', async () => {
    await openWith(firebaseUser('apple.com'));
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(1));

    // A exclusão revoga a Apple antes do `deleteUser`, e o aviso chega no meio.
    act(() => useSessionStore.getState().setDeletingAccount(true));
    appleState.mockResolvedValueOnce(REVOKED);
    await act(async () => emitRevoked());

    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(2));
    expect(signOut).not.toHaveBeenCalled();
  });

  it('a conta sem a Apple nem confere a credencial, nem ouve a revogação', async () => {
    await openWith(firebaseUser('password', ['password']));
    await act(async () => undefined);

    expect(appleState).not.toHaveBeenCalled();
    expect(addRevokeListener).not.toHaveBeenCalled();
  });

  it('no Android, nada é conferido', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    appleState.mockResolvedValue(REVOKED);
    await openWith(firebaseUser('apple.com'));
    await act(async () => undefined);

    expect(appleState).not.toHaveBeenCalled();
    expect(addRevokeListener).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('depois que a sessão sai, ninguém ouve a revogação dela', async () => {
    appleState.mockResolvedValueOnce(REVOKED);
    await openWith(firebaseUser('apple.com'));
    await waitFor(() => expect(signOut).toHaveBeenCalled());

    // O Firebase avisa a saída.
    mockAuth.currentUser = null;
    await act(async () => authCallback()(null));
    await waitFor(() => expect(useSessionStore.getState().status).toBe('signedOut'));

    const calls = appleState.mock.calls.length;
    await act(async () => emitRevoked());
    expect(appleState).toHaveBeenCalledTimes(calls);
  });
});

describe('a disponibilidade da Apple na abertura', () => {
  it('é pedida uma vez, ao montar, no iPhone com o Firebase configurado', async () => {
    const { rerender } = renderHook(() => useAppleCredentialCheck());
    rerender({});
    await act(async () => undefined);

    expect(appleSignInAvailability).toHaveBeenCalledTimes(1);
  });

  it('no Android, nem é pedida', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    renderHook(() => useAppleCredentialCheck());

    expect(appleSignInAvailability).not.toHaveBeenCalled();
  });
});

describe('o nome guardado da Apple (39.5)', () => {
  /** O perfil do Firestore nasce na hora em que a conferência o lê. */
  function profileArrives(displayName: string | null): void {
    jest.mocked(onSnapshot).mockImplementation(((
      _ref: unknown,
      next: (snapshot: unknown) => void,
    ) => {
      next({ exists: () => true, data: () => ({ displayName }) });
      return () => undefined;
    }) as unknown as typeof onSnapshot);
  }

  function keepName(appleUserId: string): Promise<void> {
    return AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId, name: 'Camila Ribeiro' }),
    );
  }

  afterEach(() => {
    jest.mocked(onSnapshot).mockImplementation(() => () => undefined);
  });

  it('a sessão restaurada (o app fechado entre a credencial e o nome) recebe o nome no Auth e no perfil', async () => {
    await keepName(APPLE_UID);
    profileArrives(null);
    const user = firebaseUser('apple.com');
    await openWith(user);

    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith('users/uid-camila', {
        displayName: 'Camila Ribeiro',
        updatedAt: 'agora-do-servidor',
      }),
    );
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(StorageKeys.ApplePendingName)).toBeNull(),
    );
  });

  it('também na sessão de outro provedor, com a mesma Apple ligada', async () => {
    await keepName(APPLE_UID);
    profileArrives(null);
    await openWith(firebaseUser('password', ['password', 'apple.com']));

    await waitFor(() => expect(updateDoc).toHaveBeenCalled());
  });

  it('a chave de outra Conta Apple fica no aparelho, e nada é gravado', async () => {
    await keepName('outra.apple');
    profileArrives(null);
    await openWith(firebaseUser('apple.com'));
    await act(async () => undefined);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(StorageKeys.ApplePendingName)).not.toBeNull();
  });

  it('com o perfil que já tem nome, a chave sai sem gravar', async () => {
    await keepName(APPLE_UID);
    profileArrives('Camila Ribeiro');
    await openWith(firebaseUser('apple.com'));

    await waitFor(async () =>
      expect(await AsyncStorage.getItem(StorageKeys.ApplePendingName)).toBeNull(),
    );
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('enquanto uma entrada segura o fã, quem cuida do nome é ela; solto, a sessão confere', async () => {
    await keepName(APPLE_UID);
    profileArrives(null);
    let release = (): void => undefined;
    act(() => {
      release = useSessionStore.getState().holdAuth();
    });
    await openWith(firebaseUser('apple.com'));
    await act(async () => undefined);
    expect(updateDoc).not.toHaveBeenCalled();

    act(() => release());

    await waitFor(() => expect(updateDoc).toHaveBeenCalled());
  });
});
