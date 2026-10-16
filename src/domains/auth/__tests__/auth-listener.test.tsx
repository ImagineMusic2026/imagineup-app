import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  AppleAuthenticationCredentialState,
  getCredentialStateAsync,
} from 'expo-apple-authentication';
import { onAuthStateChanged, signOut, updateProfile } from 'firebase/auth';
import { onSnapshot, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { followFixture } from '@/domains/artists/fixtures';
import { playStackExit } from '@/hooks/use-stack-fade';
import { fixtureWallet } from '@/services/fixtures';
import { queryClient, queryPersister } from '@/services/query';
import { StorageKeys } from '@/storage/storage';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore, type SessionUser } from '@/stores/session';

import { useAppleCredentialCheck } from '../hooks/use-apple-credential-check';
import { useAuthListener } from '../hooks/use-auth-listener';

// O build do Firebase que o Jest resolve é ESM; o listener e a conferência da
// Apple só usam estas peças.
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
// A conta de agora no Auth: o provedor da sessão só vale para ela, e a
// conferência da Apple lê o `uid` da Apple no `providerData` dela.
const mockAuth: { currentUser: { uid: string; providerData?: unknown[] } | null } = {
  currentUser: null,
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
jest.mock('@/hooks/use-stack-fade', () => ({ playStackExit: jest.fn() }));

const CAMILA: SessionUser = {
  uid: 'uid-camila',
  email: 'camila@teste.imagineup',
  displayName: 'Camila Ribeiro',
  photoURL: null,
};

type AuthCallback = (user: { uid: string } | null) => void;

/** O callback que o listener registrou no Firebase. */
function authCallback(): AuthCallback {
  const call = jest.mocked(onAuthStateChanged).mock.calls[0];
  if (!call) throw new Error('listener não registrado');
  return call[1] as AuthCallback;
}

/** Promessa que o teste resolve quando quiser. */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let removeClient: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = null;
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  removeClient = jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  useSessionStore.setState({ status: 'signedIn', user: CAMILA, authHolds: 0 });
  usePreferencesStore.setState({ hydrated: true, lastSessionUid: 'uid-camila' });
  queryClient.setQueryData(['profile', 'me', 'uid-camila'], { username: 'camilarib' });
});

afterEach(() => {
  queryClient.clear();
  fixtureWallet.reset();
  followFixture.reset();
  jest.restoreAllMocks();
});

describe('fim da sessão', () => {
  it('as abas saem em fade antes de o cache ir embora e de o guard levar à entrada', async () => {
    const exit = deferred();
    jest.mocked(playStackExit).mockReturnValue(exit.promise);
    renderHook(() => useAuthListener());

    act(() => authCallback()(null));

    // Durante o fade, a tela ainda é a do fã, com os dados dele.
    expect(playStackExit).toHaveBeenCalledWith('tabs');
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(queryClient.getQueryData(['profile', 'me', 'uid-camila'])).toBeDefined();

    await act(async () => exit.resolve());

    expect(queryClient.getQueryData(['profile', 'me', 'uid-camila'])).toBeUndefined();
    expect(removeClient).toHaveBeenCalled();
    expect(usePreferencesStore.getState().lastSessionUid).toBeNull();
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedOut', user: null });
  });

  it('outro fã que entra durante a saída não é desfeito por ela nem vê os dados do anterior', async () => {
    const exit = deferred();
    jest.mocked(playStackExit).mockReturnValue(exit.promise);
    renderHook(() => useAuthListener());

    act(() => authCallback()(null));
    act(() => authCallback()({ ...CAMILA, uid: 'uid-alan' }));

    // Os dados da Camila vão embora já na entrada do Alan, sem esperar o fade.
    expect(queryClient.getQueryData(['profile', 'me', 'uid-camila'])).toBeUndefined();
    expect(removeClient).toHaveBeenCalled();

    await act(async () => exit.resolve());

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      user: { uid: 'uid-alan' },
    });
    expect(usePreferencesStore.getState().lastSessionUid).toBe('uid-alan');
  });

  it('o mesmo fã de volta durante a saída (o Auth oscilando) mantém o cache', async () => {
    const exit = deferred();
    jest.mocked(playStackExit).mockReturnValue(exit.promise);
    renderHook(() => useAuthListener());

    act(() => authCallback()(null));
    act(() => authCallback()(CAMILA));
    await act(async () => exit.resolve());

    expect(queryClient.getQueryData(['profile', 'me', 'uid-camila'])).toBeDefined();
    expect(removeClient).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedIn', user: CAMILA });
  });

  it('no modo fixtures, o "servidor" em memória volta ao início com a sessão', async () => {
    jest.mocked(playStackExit).mockResolvedValue(undefined);
    fixtureWallet.spend(6_000);
    followFixture.follow(['rocksalles'], 'chave-teste');
    renderHook(() => useAuthListener());

    await act(async () => authCallback()(null));

    expect(fixtureWallet.get().balance).toBe(12_480);
    expect(followFixture.followedIds()).not.toContain('rocksalles');
  });
});

describe('o provedor da sessão (seção 33)', () => {
  /** A conta do Firebase com o token dizendo por onde a sessão entrou. */
  function firebaseUser(uid: string, signInProvider: string) {
    return {
      ...CAMILA,
      uid,
      providerData: [{ providerId: 'apple.com' }, { providerId: 'google.com' }],
      getIdTokenResult: jest.fn(async () => ({ signInProvider })),
    };
  }

  it('chega depois da sessão, pelo token, e o aviso seguinte da mesma conta não o apaga', async () => {
    renderHook(() => useAuthListener());
    mockAuth.currentUser = { uid: 'uid-camila' };

    await act(async () => authCallback()(firebaseUser('uid-camila', 'google.com')));

    expect(useSessionStore.getState().user).toMatchObject({
      uid: 'uid-camila',
      providers: ['apple', 'google'],
      signInProvider: 'google',
    });

    // O Auth avisa de novo (o token renovado): o provedor fica até o token dizer outro.
    const refreshed = { ...CAMILA, providerData: [{ providerId: 'apple.com' }] };
    act(() => authCallback()(refreshed));
    expect(useSessionStore.getState().user).toMatchObject({
      uid: 'uid-camila',
      providers: ['apple'],
      signInProvider: 'google',
    });
  });

  it('outra conta não herda o provedor da anterior', async () => {
    renderHook(() => useAuthListener());
    mockAuth.currentUser = { uid: 'uid-camila' };
    await act(async () => authCallback()(firebaseUser('uid-camila', 'apple.com')));
    expect(useSessionStore.getState().user?.signInProvider).toBe('apple');

    mockAuth.currentUser = { uid: 'uid-alan' };
    act(() => authCallback()({ ...CAMILA, uid: 'uid-alan' }));

    expect(useSessionStore.getState().user).toMatchObject({ uid: 'uid-alan' });
    expect(useSessionStore.getState().user?.signInProvider).toBeUndefined();
  });
});

describe('a Apple no início da sessão (seção 33, decisões 6 e 9)', () => {
  const APPLE_UID = '000123.apple';
  const appleState = jest.mocked(getCredentialStateAsync);
  const { REVOKED, AUTHORIZED } = AppleAuthenticationCredentialState;
  const emitRevoked = (): void =>
    jest
      .requireMock<{ mockEmitRevoked: () => void }>('expo-apple-authentication')
      .mockEmitRevoked();

  /** A conta do Firebase, com as contas ligadas e o token dizendo por onde a sessão entrou. */
  function firebaseUser(signInProvider: string, providers = ['apple.com']) {
    return {
      ...CAMILA,
      displayName: null,
      providerData: providers.map((providerId) => ({
        providerId,
        uid: providerId === 'apple.com' ? APPLE_UID : 'g-1',
      })),
      getIdTokenResult: jest.fn(async () => ({ signInProvider })),
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
    useSessionStore.setState({ status: 'loading', user: null, deletingAccount: false });
    usePreferencesStore.setState({ lastSignInMethod: null });
    appleState.mockReset();
    appleState.mockResolvedValue(AUTHORIZED);
    jest.mocked(playStackExit).mockResolvedValue(undefined);
  });

  it('com a sessão aberta pela Apple, a credencial revogada tira a sessão', async () => {
    appleState.mockResolvedValueOnce(REVOKED);
    await openWith(firebaseUser('apple.com'));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(appleState).toHaveBeenCalledWith(APPLE_UID);
  });

  it('a credencial autorizada, ou a conferência que falha, deixam a sessão', async () => {
    await openWith(firebaseUser('apple.com'));
    await waitFor(() => expect(appleState).toHaveBeenCalledTimes(1));

    // O simulador sempre lança; o erro não faz nada.
    appleState.mockRejectedValueOnce(new Error('simulador'));
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

  it('a conta com o Google e a Apple que entrou pelo Google não sai por causa da Apple', async () => {
    appleState.mockResolvedValue(REVOKED);
    await openWith(firebaseUser('google.com', ['google.com', 'apple.com']));
    await act(async () => emitRevoked());

    expect(useSessionStore.getState().user?.signInProvider).toBe('google');
    expect(appleState).not.toHaveBeenCalled();
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

  it('sem o provedor do token (sem rede), vale o último jeito de entrar do aparelho', async () => {
    usePreferencesStore.setState({ lastSignInMethod: 'apple' });
    appleState.mockResolvedValueOnce(REVOKED);
    const user = firebaseUser('apple.com');
    user.getIdTokenResult.mockRejectedValue(new Error('auth/network-request-failed'));
    await openWith(user);

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(useSessionStore.getState().user?.signInProvider).toBeUndefined();
  });

  it('no Android, nada é conferido', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    appleState.mockResolvedValue(REVOKED);
    await openWith(firebaseUser('apple.com'));

    expect(useSessionStore.getState().user?.signInProvider).toBe('apple');
    expect(appleState).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  describe('o nome guardado da Apple', () => {
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

    it('a sessão restaurada (o app fechado entre a credencial e o nome) recebe o nome', async () => {
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
      await openWith(firebaseUser('google.com', ['google.com', 'apple.com']));

      await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    });

    it('a chave de outro ID Apple fica no aparelho, e nada é gravado', async () => {
      await keepName('outro.apple');
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
});
