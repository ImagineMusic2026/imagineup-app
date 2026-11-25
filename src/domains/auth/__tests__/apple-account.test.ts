import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from 'firebase/auth';

import { StorageKeys } from '@/storage/storage';

import {
  appleUidOf,
  clearPendingAppleName,
  clearPendingAppleNameOf,
  readPendingAppleName,
  revokeAppleToken,
  savePendingAppleName,
} from '../apple-account';
import { APPLE_REVOKE_TIMEOUT_MS, IOS_BUNDLE_ID } from '../consts';

/**
 * A Apple na conta (seção 39 de docs/arquitetura-api.md): o `uid` da Apple, o
 * nome guardado e a revogação pelo REST do Identity Toolkit, e as travas da
 * configuração que o app precisa para a Apple (o `app.config.ts` e o
 * `fingerprint.config.js`).
 */

// A conta da sessão, que a revogação confere antes e depois do token.
const mockAuth: { currentUser: { uid: string } | null } = { currentUser: null };
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));

// A configuração do Firebase e o host dos emuladores, lidos a cada uso.
const mockEnv: {
  firebaseEnv: { firebaseApiKey: string } | null;
  firebaseEmulatorHost: string | undefined;
} = { firebaseEnv: null, firebaseEmulatorHost: undefined };
jest.mock('@/config/env', () => ({
  get firebaseEnv() {
    return mockEnv.firebaseEnv;
  },
  get firebaseEmulatorHost() {
    return mockEnv.firebaseEmulatorHost;
  },
}));

// O app.config.ts carregado de verdade: o plugin do manifesto do Android não importa aqui.
jest.mock('expo/config-plugins', () => ({ withAndroidManifest: (config: unknown) => config }));

const APPLE_UID = '000123.apple';

function account(uid = 'uid-camila', getIdToken = jest.fn(async () => 'id-token-da-conta')): User {
  return {
    uid,
    providerData: [{ providerId: 'apple.com', uid: APPLE_UID }],
    getIdToken,
  } as unknown as User;
}

const storedName = () => AsyncStorage.getItem(StorageKeys.ApplePendingName);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuth.currentUser = null;
  mockEnv.firebaseEnv = null;
  mockEnv.firebaseEmulatorHost = undefined;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('o uid da Apple na conta', () => {
  it('é o da Apple no providerData, e nenhum sem a Apple', () => {
    expect(appleUidOf(account())).toBe(APPLE_UID);
    expect(
      appleUidOf({ providerData: [{ providerId: 'password', uid: 'x' }] } as unknown as User),
    ).toBeNull();
    expect(appleUidOf({} as User)).toBeNull();
  });
});

describe('o nome guardado da Apple', () => {
  it('guarda, lê e tira', async () => {
    await savePendingAppleName({ appleUserId: APPLE_UID, name: 'Camila Ribeiro' });
    await expect(readPendingAppleName()).resolves.toEqual({
      appleUserId: APPLE_UID,
      name: 'Camila Ribeiro',
    });

    await clearPendingAppleName();
    await expect(readPendingAppleName()).resolves.toBeNull();
  });

  it('o guardado fora do formato vale como nenhum', async () => {
    await AsyncStorage.setItem(StorageKeys.ApplePendingName, JSON.stringify({ name: 'Camila' }));
    await expect(readPendingAppleName()).resolves.toBeNull();
  });

  it('tira só o nome do mesmo user da Apple', async () => {
    await savePendingAppleName({ appleUserId: 'outra.apple', name: 'Bia Souza' });
    await clearPendingAppleNameOf(APPLE_UID);
    expect(await storedName()).not.toBeNull();

    await clearPendingAppleNameOf('outra.apple');
    expect(await storedName()).toBeNull();
  });
});

describe('a revogação da Apple (39.4)', () => {
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    mockEnv.firebaseEnv = { firebaseApiKey: 'chave-publica' };
    // A revogação que falha avisa no desenvolvimento.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('manda o código como CODE, com o ID token da conta que sai e o bundle ID no cabeçalho', async () => {
    const user = account();
    mockAuth.currentUser = user;

    await expect(revokeAppleToken('codigo-da-apple', user)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=chave-publica',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Ios-Bundle-Identifier': 'br.com.imaginegroup.imagineup',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      providerId: 'apple.com',
      tokenType: 'CODE',
      token: 'codigo-da-apple',
      idToken: 'id-token-da-conta',
    });
    expect(user.getIdToken).toHaveBeenCalledTimes(1);
  });

  it('a recusa do servidor ou a falha da rede dão false, sem lançar', async () => {
    const user = account();
    mockAuth.currentUser = user;

    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);
  });

  it('sem resposta em 10 s, desiste sem lançar e aborta o pedido', async () => {
    jest.useFakeTimers();
    const user = account();
    mockAuth.currentUser = user;
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });

    const answer = revokeAppleToken('codigo', user);
    await jest.advanceTimersByTimeAsync(APPLE_REVOKE_TIMEOUT_MS);

    await expect(answer).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it('com o emulador, que não tem a rota, nem tenta', async () => {
    const user = account();
    mockAuth.currentUser = user;
    mockEnv.firebaseEmulatorHost = '10.0.2.2';

    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem a configuração do Firebase, sem sessão ou com a sessão de outra conta, não tenta', async () => {
    const user = account();
    mockEnv.firebaseEnv = null;
    mockAuth.currentUser = user;
    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);

    mockEnv.firebaseEnv = { firebaseApiKey: 'chave-publica' };
    mockAuth.currentUser = null;
    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);

    mockAuth.currentUser = { uid: 'outra-conta' };
    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);

    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a sessão que troca enquanto o token sai não manda nada', async () => {
    const user = account(
      'uid-camila',
      jest.fn(async () => {
        mockAuth.currentUser = { uid: 'outra-conta' };
        return 'id-token-da-conta';
      }),
    );
    mockAuth.currentUser = user;

    await expect(revokeAppleToken('codigo', user)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a configuração do app para a Apple', () => {
  type Config = {
    version?: string;
    plugins?: (string | [string, unknown])[];
    ios?: {
      bundleIdentifier?: string;
      usesAppleSignIn?: boolean;
      infoPlist?: Record<string, unknown>;
    };
  };
  const appConfig = (): Config =>
    jest
      .requireActual<{ default: (context: { config: object }) => Config }>('../../../../app.config')
      .default({ config: {} });

  it('o bundle ID da revogação é o do app.config.ts', () => {
    expect(appConfig().ios?.bundleIdentifier).toBe(IOS_BUNDLE_ID);
  });

  it('o plugin da Apple está na lista, com o usesAppleSignIn e o CFBundleAllowMixedLocalizations escrito como false (39.9)', () => {
    const config = appConfig();
    const plugins = (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );
    expect(plugins).toContain('expo-apple-authentication');
    expect(config.ios?.usesAppleSignIn).toBe(true);
    expect(config.ios?.infoPlist?.CFBundleAllowMixedLocalizations).toBe(false);
  });

  it('o fingerprint deixa a versão de fora e mantém o padrão (o sourceSkips troca o padrão, e um nome errado sai calado)', () => {
    expect(jest.requireActual('../../../../fingerprint.config')).toEqual({
      sourceSkips: ['ExpoConfigVersions', 'PackageJsonAndroidAndIosScriptsIfNotContainRun'],
    });
  });
});
