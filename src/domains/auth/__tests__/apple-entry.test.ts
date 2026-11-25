import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInAsync, type AppleAuthenticationCredential } from 'expo-apple-authentication';
import { randomUUID } from 'expo-crypto';
import { FirebaseError } from 'firebase/app';
import {
  getAdditionalUserInfo,
  OAuthProvider,
  signInWithCredential,
  updateProfile,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { onSnapshot, updateDoc } from 'firebase/firestore';

import { StorageKeys } from '@/storage/storage';

import { SessionEndedError } from '../api';
import {
  appleSignInErrorKey,
  applyPendingAppleName,
  currentAppleUid,
  settlePendingAppleName,
  settleSessionAppleName,
  signInWithApple,
  signsOutOnRevoke,
} from '../apple-entry';
import { readPendingAppleName } from '../apple-account';

/**
 * A entrada com a Apple, sem React (seção 39 de docs/arquitetura-api.md): o
 * token da folha trocado pela sessão com o nonce bruto, o nome guardado antes
 * e levado ao Auth e ao perfil, as conferências da sessão, quem sai com a
 * credencial revogada e as frases de erro. A Apple é a do `jest.setup.js`.
 */

// O build do Firebase que o Jest resolve é ESM; aqui só chegam estas peças.
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
  signInWithCredential: jest.fn(),
  getAdditionalUserInfo: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(() => () => undefined),
  updateDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'agora-do-servidor'),
}));

// A conta da sessão, que a entrada e a conferência leem.
const mockAuth: { currentUser: User | null; authStateReady: () => Promise<void> } = {
  currentUser: null,
  authStateReady: jest.fn(() => Promise.resolve()),
};
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  firebaseEmulatorHost: undefined,
  googleWebClientId: undefined,
  apiUrl: undefined,
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { get: jest.fn(), post: jest.fn() },
}));

const firebaseSignIn = jest.mocked(signInWithCredential);
const setAuthName = jest.mocked(updateProfile);
const writeProfile = jest.mocked(updateDoc);
const appleSignIn = jest.mocked(signInAsync);

const APPLE_UID = '000123.apple';

function fakeUser(overrides: Partial<User> = {}, signInProvider: unknown = 'apple.com'): User {
  return {
    uid: 'uid-nova',
    email: 'camila@privaterelay.appleid.com',
    displayName: null,
    photoURL: null,
    providerData: [{ providerId: 'apple.com', uid: APPLE_UID }],
    getIdToken: jest.fn(async () => 'id-token-da-sessao'),
    getIdTokenResult: jest.fn(async () => {
      if (signInProvider instanceof Error) throw signInProvider;
      return { signInProvider };
    }),
    ...overrides,
  } as unknown as User;
}

function appleCredentialWith(
  overrides: Partial<AppleAuthenticationCredential> = {},
): AppleAuthenticationCredential {
  return {
    user: APPLE_UID,
    state: null,
    fullName: {
      namePrefix: null,
      givenName: 'Camila',
      middleName: null,
      familyName: 'Ribeiro',
      nameSuffix: null,
      nickname: null,
    },
    email: 'camila@privaterelay.appleid.com',
    realUserStatus: 2,
    identityToken: 'token-da-apple',
    authorizationCode: 'codigo-da-apple',
    ...overrides,
  } as AppleAuthenticationCredential;
}

/** O Firebase devolve a conta; `isNewUser` diz se ela nasceu agora. */
function firebaseReturns(user: User, isNewUser: boolean): void {
  firebaseSignIn.mockResolvedValueOnce({ user } as UserCredential);
  jest.mocked(getAdditionalUserInfo).mockReturnValueOnce({
    isNewUser,
    providerId: null,
    profile: null,
  });
}

const storedName = () => AsyncStorage.getItem(StorageKeys.ApplePendingName);

async function keep(appleUserId = APPLE_UID, name = 'Camila Ribeiro'): Promise<void> {
  await AsyncStorage.setItem(StorageKeys.ApplePendingName, JSON.stringify({ appleUserId, name }));
}

/** Espera o mock ser chamado (as leituras do aparelho vêm antes dele). */
async function waitForCall(mock: unknown): Promise<void> {
  for (let tries = 0; tries < 50; tries += 1) {
    if (jest.mocked(mock as jest.Mock).mock.calls.length > 0) return;
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });
  }
  throw new Error('o mock não foi chamado');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuth.currentUser = null;
  setAuthName.mockImplementation(async (user, { displayName }) => {
    Object.assign(user, { displayName });
  });
  writeProfile.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('entrar com a Apple', () => {
  it('troca o token pela sessão com o nonce bruto, e o nome vai guardado antes e para a conta depois', async () => {
    jest.mocked(randomUUID).mockReturnValueOnce('nonce-bruto');
    appleSignIn.mockResolvedValueOnce(appleCredentialWith());
    const user = fakeUser();
    let nameBeforeSignIn: string | null = null;
    firebaseSignIn.mockImplementationOnce(async () => {
      nameBeforeSignIn = await storedName();
      return { user } as UserCredential;
    });
    jest
      .mocked(getAdditionalUserInfo)
      .mockReturnValueOnce({ isNewUser: true, providerId: null, profile: null });

    const result = await signInWithApple();

    expect(OAuthProvider).toHaveBeenCalledWith('apple.com');
    expect(firebaseSignIn).toHaveBeenCalledWith(mockAuth, {
      providerId: 'apple.com',
      idToken: 'token-da-apple',
      rawNonce: 'nonce-bruto',
    });
    // Guardado antes: depois do signInWithCredential, um erro o perderia.
    expect(JSON.parse(nameBeforeSignIn ?? 'null')).toEqual({
      appleUserId: APPLE_UID,
      name: 'Camila Ribeiro',
    });
    expect(setAuthName).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
    expect(result).toEqual({
      kind: 'signedIn',
      user,
      isNewUser: true,
      profileName: 'Camila Ribeiro',
    });
    // A chave só sai quando o perfil tem nome.
    await expect(readPendingAppleName()).resolves.toEqual({
      appleUserId: APPLE_UID,
      name: 'Camila Ribeiro',
    });
  });

  it('com uma sessão já aberta antes da folha, a entrada já terminou: a folha nem abre', async () => {
    mockAuth.currentUser = fakeUser({ uid: 'outra-conta' });

    await expect(signInWithApple()).rejects.toBeInstanceOf(SessionEndedError);
    expect(appleSignIn).not.toHaveBeenCalled();
    expect(firebaseSignIn).not.toHaveBeenCalled();
  });

  it('a sessão que abre enquanto a folha está à vista: o token não vai ao Firebase', async () => {
    appleSignIn.mockImplementationOnce(async () => {
      mockAuth.currentUser = fakeUser({ uid: 'outra-conta' });
      return appleCredentialWith();
    });

    await expect(signInWithApple()).rejects.toBeInstanceOf(SessionEndedError);
    expect(firebaseSignIn).not.toHaveBeenCalled();
  });

  it('cancelada, null, sem tocar no Firebase', async () => {
    appleSignIn.mockRejectedValueOnce(
      Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    await expect(signInWithApple()).resolves.toBeNull();
    expect(firebaseSignIn).not.toHaveBeenCalled();
  });

  it('a entrada que falha no Firebase não perde o nome, que vale na entrada seguinte, sem nome', async () => {
    appleSignIn.mockResolvedValueOnce(appleCredentialWith());
    firebaseSignIn.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));
    await expect(signInWithApple()).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    await expect(readPendingAppleName()).resolves.toMatchObject({ name: 'Camila Ribeiro' });

    // A Apple não manda o nome de novo.
    appleSignIn.mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }));
    const user = fakeUser();
    firebaseReturns(user, false);

    await expect(signInWithApple()).resolves.toMatchObject({
      isNewUser: false,
      profileName: 'Camila Ribeiro',
    });
    expect(setAuthName).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
  });

  it('sem nome (de quem já entrou) e sem chave, nada vai para o nome', async () => {
    firebaseReturns(fakeUser(), false);
    await expect(signInWithApple()).resolves.toMatchObject({ profileName: null });
    expect(setAuthName).not.toHaveBeenCalled();
    expect(await storedName()).toBeNull();
  });

  it('o nome guardado de outra Conta Apple não vai para esta conta, e fica guardado', async () => {
    await keep('outra.apple', 'Bia Souza');
    firebaseReturns(fakeUser(), false);

    await expect(signInWithApple()).resolves.toMatchObject({ profileName: null });
    expect(setAuthName).not.toHaveBeenCalled();
    await expect(readPendingAppleName()).resolves.toEqual({
      appleUserId: 'outra.apple',
      name: 'Bia Souza',
    });
  });

  it('a falha do nome no Auth não segura a entrada: o nome ainda vai para o perfil', async () => {
    appleSignIn.mockResolvedValueOnce(appleCredentialWith());
    setAuthName.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    firebaseReturns(fakeUser(), true);

    await expect(signInWithApple()).resolves.toMatchObject({ profileName: 'Camila Ribeiro' });
  });

  it('o aparelho que não guarda o nome: o nome da memória ainda vale nesta entrada', async () => {
    appleSignIn.mockResolvedValueOnce(appleCredentialWith());
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disco cheio'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = fakeUser();
    firebaseReturns(user, true);

    await expect(signInWithApple()).resolves.toMatchObject({ profileName: 'Camila Ribeiro' });
    expect(setAuthName).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('o nome da Apple no Auth e no perfil', () => {
  it('a conta que já tem nome no Auth não recebe outro, mas o nome ainda vai para o perfil', async () => {
    const user = fakeUser({ displayName: 'Camila' });
    await expect(
      applyPendingAppleName(user, { appleUserId: APPLE_UID, name: 'Camila Ribeiro' }),
    ).resolves.toBe('Camila Ribeiro');
    expect(setAuthName).not.toHaveBeenCalled();
  });

  it('a conta sem a Apple não recebe o nome guardado', async () => {
    const user = fakeUser({ providerData: [{ providerId: 'google.com', uid: 'g-1' }] } as never);
    await expect(
      applyPendingAppleName(user, { appleUserId: APPLE_UID, name: 'Camila Ribeiro' }),
    ).resolves.toBeNull();
  });

  it('o perfil com nome: a chave sai, sem gravar', async () => {
    await keep();
    await settlePendingAppleName('uid-nova', { displayName: 'Camila Ribeiro' }, 'Camila Ribeiro');
    expect(writeProfile).not.toHaveBeenCalled();
    expect(await storedName()).toBeNull();
  });

  it('o perfil sem nome: o nome vai pela regra do primeiro nome, e a chave sai', async () => {
    await keep();
    await settlePendingAppleName('uid-nova', { displayName: null }, 'Camila Ribeiro');
    expect(writeProfile).toHaveBeenCalledWith('users/uid-nova', {
      displayName: 'Camila Ribeiro',
      updatedAt: 'agora-do-servidor',
    });
    expect(await storedName()).toBeNull();
  });

  it('o perfil que não chegou: a chave fica para o início da próxima sessão', async () => {
    await keep();
    await settlePendingAppleName('uid-nova', null, 'Camila Ribeiro');
    expect(writeProfile).not.toHaveBeenCalled();
    expect(await storedName()).not.toBeNull();
  });

  it('a gravação recusada: a chave fica', async () => {
    await keep();
    writeProfile.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(
      settlePendingAppleName('uid-nova', { displayName: null }, 'Camila Ribeiro'),
    ).rejects.toThrow('permission-denied');
    expect(await storedName()).not.toBeNull();
  });

  it('o nome que as regras não aceitam: a chave sai, sem gravar', async () => {
    await keep(APPLE_UID, '   ');
    await settlePendingAppleName('uid-nova', { displayName: null }, '   ');
    expect(writeProfile).not.toHaveBeenCalled();
    expect(await storedName()).toBeNull();
  });
});

describe('o nome guardado da Apple no início da sessão (39.5)', () => {
  type SnapshotListener = (snapshot: {
    exists: () => boolean;
    data: () => { displayName: string | null };
  }) => void;

  /** O perfil do Firestore: o teste decide quando ele chega. */
  function profileListener(): { arrives: (displayName: string | null) => void } {
    let listener: SnapshotListener | null = null;
    jest.mocked(onSnapshot).mockImplementation(((_ref: unknown, next: SnapshotListener) => {
      listener = next;
      return () => undefined;
    }) as unknown as typeof onSnapshot);
    return {
      arrives: (displayName) => listener?.({ exists: () => true, data: () => ({ displayName }) }),
    };
  }

  afterEach(() => {
    jest.mocked(onSnapshot).mockImplementation(() => () => undefined);
  });

  it('o uid da Apple é o da conta da sessão, e de nenhuma outra', () => {
    mockAuth.currentUser = fakeUser();
    expect(currentAppleUid('uid-nova')).toBe(APPLE_UID);
    expect(currentAppleUid('outra-conta')).toBeNull();
    mockAuth.currentUser = fakeUser({ providerData: [] } as never);
    expect(currentAppleUid('uid-nova')).toBeNull();
  });

  it('sem a chave no aparelho, nem lê o perfil', async () => {
    mockAuth.currentUser = fakeUser();
    await settleSessionAppleName('uid-nova');
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(setAuthName).not.toHaveBeenCalled();
  });

  it('o nome vai para o Auth sem nome e para o perfil sem nome, e a chave sai', async () => {
    await keep();
    const user = fakeUser();
    mockAuth.currentUser = user;
    const profile = profileListener();

    const done = settleSessionAppleName('uid-nova');
    await waitForCall(onSnapshot);
    profile.arrives(null);
    await done;

    expect(setAuthName).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
    expect(writeProfile).toHaveBeenCalledWith('users/uid-nova', {
      displayName: 'Camila Ribeiro',
      updatedAt: 'agora-do-servidor',
    });
    expect(await storedName()).toBeNull();
  });

  it('a sessão que troca enquanto o perfil é lido não recebe o nome, e a chave fica', async () => {
    await keep();
    mockAuth.currentUser = fakeUser();
    const profile = profileListener();

    const done = settleSessionAppleName('uid-nova');
    await waitForCall(onSnapshot);
    mockAuth.currentUser = fakeUser({ uid: 'outra-conta' });
    profile.arrives(null);
    await done;

    expect(writeProfile).not.toHaveBeenCalled();
    expect(await storedName()).not.toBeNull();
  });

  it('a conta de outra sessão (o Auth já trocou) nem toca no nome', async () => {
    await keep();
    mockAuth.currentUser = fakeUser({ uid: 'outra-conta' });
    await settleSessionAppleName('uid-nova');
    expect(setAuthName).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
  });
});

describe('quem sai com a credencial da Apple revogada (39.5)', () => {
  const tokenFailure = new FirebaseError('auth/network-request-failed', 'rede');

  it('a sessão aberta pela Apple sai', async () => {
    mockAuth.currentUser = fakeUser();
    await expect(signsOutOnRevoke('uid-nova')).resolves.toBe(true);
  });

  it('a sessão de senha, com a Apple ligada, fica', async () => {
    mockAuth.currentUser = fakeUser(
      {
        providerData: [
          { providerId: 'password', uid: 'camila@privaterelay.appleid.com' },
          { providerId: 'apple.com', uid: APPLE_UID },
        ],
      } as never,
      'password',
    );
    await expect(signsOutOnRevoke('uid-nova')).resolves.toBe(false);
  });

  it('a sessão de outra conta não sai por esta', async () => {
    mockAuth.currentUser = fakeUser({ uid: 'outra-conta' });
    await expect(signsOutOnRevoke('uid-nova')).resolves.toBe(false);
  });

  it('sem o token, sai só a conta que tem a Apple como único provedor', async () => {
    mockAuth.currentUser = fakeUser({}, tokenFailure);
    await expect(signsOutOnRevoke('uid-nova')).resolves.toBe(true);

    mockAuth.currentUser = fakeUser(
      {
        providerData: [
          { providerId: 'apple.com', uid: APPLE_UID },
          { providerId: 'password', uid: 'camila@privaterelay.appleid.com' },
        ],
      } as never,
      tokenFailure,
    );
    await expect(signsOutOnRevoke('uid-nova')).resolves.toBe(false);
  });

  it('a leitura do token que encerra a sessão invalidada: nada a fazer', async () => {
    const user = fakeUser();
    jest.mocked(user.getIdTokenResult).mockImplementationOnce(async () => {
      mockAuth.currentUser = null;
      throw new FirebaseError('auth/user-token-expired', 'token');
    });
    mockAuth.currentUser = user;

    await expect(signsOutOnRevoke('uid-nova')).resolves.toBe(false);
  });
});

describe('a frase do erro da entrada com a Apple', () => {
  it.each([
    [new FirebaseError('auth/operation-not-allowed', ''), 'auth.apple.errors.unavailable'],
    [new FirebaseError('auth/invalid-credential', ''), 'auth.apple.errors.unavailable'],
    [new FirebaseError('auth/missing-or-invalid-nonce', ''), 'auth.apple.errors.unavailable'],
    [new FirebaseError('auth/network-request-failed', ''), 'auth.errors.network'],
    [new FirebaseError('auth/too-many-requests', ''), 'auth.errors.tooManyRequests'],
    [new FirebaseError('auth/internal-error', ''), 'auth.apple.errors.unknown'],
    [
      Object.assign(new Error('sem módulo'), { code: 'ERR_UNAVAILABLE' }),
      'auth.apple.errors.unavailable',
    ],
    [new SessionEndedError(), 'auth.apple.errors.unknown'],
    ['qualquer coisa', 'auth.apple.errors.unknown'],
  ])('%p dá %s', (error, key) => {
    expect(appleSignInErrorKey(error)).toBe(key);
  });
});
