import { act, renderHook } from '@testing-library/react-native';
import { onAuthStateChanged } from 'firebase/auth';

import { followFixture } from '@/domains/artists/fixtures';
import { playStackExit } from '@/hooks/use-stack-fade';
import { fixtureWallet } from '@/services/fixtures';
import { queryClient, queryPersister } from '@/services/query';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore, type SessionUser } from '@/stores/session';

import { useAuthListener } from '../hooks/use-auth-listener';

// O build do Firebase que o Jest resolve é ESM; o listener só usa estas peças.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
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
