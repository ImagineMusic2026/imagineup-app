import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppleAuthenticationCredentialState,
  getCredentialStateAsync,
  signInAsync,
  type AppleAuthenticationCredential,
} from 'expo-apple-authentication';
import { randomUUID } from 'expo-crypto';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { revokeGoogleAccess } from '@/services/google-sign-in';
import { StorageKeys } from '@/storage/storage';

import {
  appleDeletionMode,
  deleteAccount,
  deleteAccountFailure,
  sessionSignInProvider,
} from '../api';
import { IOS_BUNDLE_ID } from '../consts';

/**
 * A exclusão da conta com a Apple, no iPhone (39.4 de docs/arquitetura-api.md):
 * o modo de cada conta, a sessão da Apple (a folha, a reautenticação, a
 * revogação e só então o `deleteUser`), a Apple ligada a uma sessão de senha
 * (a senha no primeiro toque, a conferência da credencial e a tentativa de
 * revogar), o Android de antes e o nome guardado que sai com a conta. A Apple
 * é a do `jest.setup.js`.
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
  GoogleAuthProvider: { credential: jest.fn() },
  reauthenticateWithCredential: jest.fn(),
  deleteUser: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({}));

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
  firebaseEnv: { firebaseApiKey: 'chave-publica' },
  firebaseEmulatorHost: undefined,
  googleWebClientId: undefined,
  apiUrl: undefined,
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/services/google-sign-in', () => ({
  GoogleSignInError: class GoogleSignInError extends Error {},
  googleIdToken: jest.fn(),
  signOutGoogle: jest.fn(() => Promise.resolve()),
  revokeGoogleAccess: jest.fn(() => Promise.resolve()),
}));

const removeAccount = jest.mocked(deleteUser);
const reauth = jest.mocked(reauthenticateWithCredential);
const appleSheet = jest.mocked(signInAsync);
const credentialState = jest.mocked(getCredentialStateAsync);
const fetchMock = jest.fn();
const realFetch = globalThis.fetch;

const APPLE_UID = '000123.apple';
const EMAIL = 'camila@gmail.com';
const { AUTHORIZED, REVOKED, NOT_FOUND, TRANSFERRED } = AppleAuthenticationCredentialState;

/** A conta da sessão, com os provedores dela e o provedor que abriu a sessão (o token). */
function sessionAccount(
  providers: string[],
  signInProvider: string | Error = providers[0] === 'apple.com' ? 'apple.com' : 'password',
): User {
  const user = {
    uid: 'uid-camila',
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
  } as unknown as User;
  mockAuth.currentUser = user;
  return user;
}

const anotherSession = () => ({ uid: 'outra-conta' }) as User;

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

/** O corpo da revogação que foi ao REST do Identity Toolkit. */
function revokedBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const canceled = () => Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' });
const failureOf = (attempt: Promise<unknown>) =>
  attempt.then(() => 'sem erro', deleteAccountFailure);
const storedName = () => AsyncStorage.getItem(StorageKeys.ApplePendingName);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuth.currentUser = null;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  removeAccount.mockReset();
  removeAccount.mockResolvedValue(undefined);
  reauth.mockReset();
  reauth.mockResolvedValue({} as UserCredential);
  credentialState.mockResolvedValue(AUTHORIZED);
  appleSheet.mockResolvedValue(appleCredentialWith());
  // A revogação que falha avisa no desenvolvimento.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('o provedor que abriu a sessão', () => {
  it('vem do token: a Apple, a senha; o token que não sai e o usuário sem o método dão null', async () => {
    await expect(sessionSignInProvider(sessionAccount(['apple.com']))).resolves.toBe('apple.com');
    await expect(sessionSignInProvider(sessionAccount(['password']))).resolves.toBe('password');
    await expect(
      sessionSignInProvider(sessionAccount(['apple.com'], new Error('rede'))),
    ).resolves.toBeNull();
    await expect(sessionSignInProvider({ uid: 'à-mão' } as User)).resolves.toBeNull();
  });
});

describe('o modo da Apple na exclusão', () => {
  it.each([
    ['a sessão da Apple', ['apple.com'], 'apple.com', 'apple'],
    [
      'a senha com a Apple ligada, pela senha',
      ['password', 'apple.com'],
      'password',
      'appleLinked',
    ],
    [
      'a senha com a Apple ligada, sem o token',
      ['password', 'apple.com'],
      new Error('rede'),
      'appleLinked',
    ],
    ['só a Apple, sem o token (nunca a senha)', ['apple.com'], new Error('rede'), 'apple'],
    ['a Apple e o Google, sem senha', ['google.com', 'apple.com'], 'google.com', 'apple'],
  ] as const)('%s', async (_, providers, signInProvider, mode) => {
    const user = sessionAccount([...providers], signInProvider as string | Error);
    await expect(appleDeletionMode(user.uid)).resolves.toBe(mode);
  });

  it('sem a Apple na conta, null, sem ler o token', async () => {
    const user = sessionAccount(['password']);
    await expect(appleDeletionMode(user.uid)).resolves.toBeNull();
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
  });

  it('no Android, null, sem ler o token', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const user = sessionAccount(['apple.com']);
    await expect(appleDeletionMode(user.uid)).resolves.toBeNull();
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
  });

  it('com a sessão de outra conta, null', async () => {
    sessionAccount(['apple.com']);
    await expect(appleDeletionMode('outra-conta')).resolves.toBeNull();
  });
});

describe('a conta sem a Apple, no iPhone, como antes', () => {
  it('exclui direto, sem ler o token nem abrir a folha da Apple', async () => {
    const user = sessionAccount(['password']);

    await expect(deleteAccount(undefined, false, user.uid)).resolves.toBe('deleted');
    expect(removeAccount).toHaveBeenCalledWith(user);
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();
  });

  it('a sessão invalidada na leitura do token do deleteUser ainda dá sessionEnded, e não um cancelar calado', async () => {
    sessionAccount(['password']);
    removeAccount.mockImplementationOnce(async () => {
      mockAuth.currentUser = null;
      throw new FirebaseError('auth/user-token-expired', 'token');
    });

    await expect(failureOf(deleteAccount())).resolves.toBe('sessionEnded');
  });
});

describe('a sessão da Apple, no iPhone', () => {
  it('a folha, a reautenticação com o nonce bruto, a revogação com o código e o bundle ID e só então o deleteUser', async () => {
    jest.mocked(randomUUID).mockReturnValueOnce('nonce-bruto');
    const user = sessionAccount(['apple.com']);

    await expect(deleteAccount(undefined, false, user.uid)).resolves.toBe('deleted');

    expect(reauth).toHaveBeenCalledWith(user, {
      providerId: 'apple.com',
      idToken: 'token-da-apple',
      rawNonce: 'nonce-bruto',
    });
    expect(revokedBody()).toEqual({
      providerId: 'apple.com',
      tokenType: 'CODE',
      token: 'codigo-da-apple',
      idToken: 'id-token-da-sessao',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'X-Ios-Bundle-Identifier': IOS_BUNDLE_ID });
    expect(firstCall(appleSheet)).toBeLessThan(firstCall(reauth));
    expect(firstCall(reauth)).toBeLessThan(firstCall(fetchMock));
    expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
    expect(removeAccount).toHaveBeenCalledWith(user);
    expect(revokeGoogleAccess).not.toHaveBeenCalled();
  });

  it('a revogação que falha não trava a exclusão', async () => {
    sessionAccount(['apple.com']);

    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(deleteAccount()).resolves.toBe('deleted');
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(deleteAccount()).resolves.toBe('deleted');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(removeAccount).toHaveBeenCalledTimes(2);
  });

  it('a folha fechada pelo fã: nada muda, sem erro', async () => {
    sessionAccount(['apple.com']);
    appleSheet.mockRejectedValueOnce(canceled());

    await expect(deleteAccount()).resolves.toBe('canceled');
    expect(reauth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('outra Conta Apple: wrongAppleAccount, sem revogar nem excluir', async () => {
    sessionAccount(['apple.com']);
    appleSheet.mockResolvedValueOnce(appleCredentialWith({ user: 'outra.apple' }));
    reauth.mockRejectedValueOnce(new FirebaseError('auth/user-mismatch', 'outra conta'));

    await expect(failureOf(deleteAccount())).resolves.toBe('wrongAppleAccount');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it.each(['auth/invalid-credential', 'auth/missing-or-invalid-nonce'])(
    'o token que o Firebase recusa (%s): appleUnavailable, nunca a senha',
    async (code) => {
      sessionAccount(['apple.com']);
      reauth.mockRejectedValueOnce(new FirebaseError(code, 'recusado'));

      await expect(failureOf(deleteAccount())).resolves.toBe('appleUnavailable');
      expect(removeAccount).not.toHaveBeenCalled();
    },
  );

  it('a folha com erro: appleUnavailable, sem reautenticar', async () => {
    sessionAccount(['apple.com']);
    appleSheet.mockRejectedValueOnce(
      Object.assign(new Error('falhou'), { code: 'ERR_REQUEST_FAILED' }),
    );

    await expect(failureOf(deleteAccount())).resolves.toBe('appleUnavailable');
    expect(reauth).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('sem o código na resposta da folha, exclui sem revogar', async () => {
    sessionAccount(['apple.com']);
    appleSheet.mockResolvedValueOnce(appleCredentialWith({ authorizationCode: null }));

    await expect(deleteAccount()).resolves.toBe('deleted');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).toHaveBeenCalledTimes(1);
  });

  it('o login recente pedido depois da reautenticação: appleUnavailable, e não o campo da senha', async () => {
    sessionAccount(['apple.com']);
    removeAccount.mockRejectedValueOnce(new FirebaseError('auth/requires-recent-login', 'antigo'));

    await expect(failureOf(deleteAccount())).resolves.toBe('appleUnavailable');
  });

  it('a sessão que troca enquanto a folha está à vista: cancelado, sem reautenticar', async () => {
    sessionAccount(['apple.com']);
    appleSheet.mockImplementationOnce(async () => {
      mockAuth.currentUser = anotherSession();
      return appleCredentialWith();
    });

    await expect(deleteAccount()).resolves.toBe('canceled');
    expect(reauth).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('a sessão que troca logo depois da reautenticação: cancelado, sem revogar nem excluir', async () => {
    sessionAccount(['apple.com']);
    reauth.mockImplementationOnce(async () => {
      mockAuth.currentUser = anotherSession();
      return {} as UserCredential;
    });

    await expect(deleteAccount()).resolves.toBe('canceled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('a sessão que acaba enquanto a folha está à vista: sessionEnded', async () => {
    sessionAccount(['apple.com']);
    appleSheet.mockImplementationOnce(async () => {
      mockAuth.currentUser = null;
      return appleCredentialWith();
    });

    await expect(failureOf(deleteAccount())).resolves.toBe('sessionEnded');
    expect(reauth).not.toHaveBeenCalled();
  });
});

describe('a Apple ligada a uma sessão de senha, no iPhone', () => {
  it('o primeiro toque pede a senha, sem a folha e sem excluir', async () => {
    sessionAccount(['password', 'apple.com']);

    await expect(failureOf(deleteAccount())).resolves.toBe('needsPassword');
    expect(appleSheet).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('a senha errada: wrongPassword, sem a folha, sem revogar e sem excluir', async () => {
    sessionAccount(['password', 'apple.com']);
    reauth.mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'senha'));

    await expect(failureOf(deleteAccount('errada'))).resolves.toBe('wrongPassword');
    expect(credentialState).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });

  it('com a senha: a reautenticação, o estado da credencial, a folha, a revogação da mesma conta e o deleteUser', async () => {
    const user = sessionAccount(['password', 'apple.com']);

    await expect(deleteAccount('senha-certa', false, user.uid)).resolves.toBe('deleted');

    expect(EmailAuthProvider.credential).toHaveBeenCalledWith(EMAIL, 'senha-certa');
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(reauth).toHaveBeenCalledWith(user, expect.objectContaining({ providerId: 'password' }));
    expect(credentialState).toHaveBeenCalledWith(APPLE_UID);
    expect(revokedBody()).toMatchObject({ tokenType: 'CODE', token: 'codigo-da-apple' });
    expect(user.getIdToken).toHaveBeenCalled();
    expect(firstCall(reauth)).toBeLessThan(firstCall(credentialState));
    expect(firstCall(credentialState)).toBeLessThan(firstCall(appleSheet));
    expect(firstCall(appleSheet)).toBeLessThan(firstCall(fetchMock));
    expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
  });

  it.each([
    ['NOT_FOUND', NOT_FOUND],
    ['REVOKED', REVOKED],
    ['TRANSFERRED', TRANSFERRED],
  ])('a credencial %s neste iPhone: sem a folha, e a conta sai', async (_, state) => {
    sessionAccount(['password', 'apple.com']);
    credentialState.mockResolvedValueOnce(state);

    await expect(deleteAccount('senha-certa')).resolves.toBe('deleted');
    expect(appleSheet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).toHaveBeenCalledTimes(1);
  });

  it('a credencial autorizada ou o estado desconhecido abrem a folha', async () => {
    sessionAccount(['password', 'apple.com']);
    await expect(deleteAccount('senha-certa')).resolves.toBe('deleted');
    expect(appleSheet).toHaveBeenCalledTimes(1);

    sessionAccount(['password', 'apple.com']);
    credentialState.mockRejectedValueOnce(new Error('rede'));
    await expect(deleteAccount('senha-certa')).resolves.toBe('deleted');
    expect(appleSheet).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['cancelar a folha', () => appleSheet.mockRejectedValueOnce(canceled())],
    [
      'outra Conta Apple',
      () => appleSheet.mockResolvedValueOnce(appleCredentialWith({ user: 'outra.apple' })),
    ],
    ['a folha com erro', () => appleSheet.mockRejectedValueOnce(new Error('falhou'))],
  ])('%s: exclui do mesmo jeito, sem revogar', async (_, sheet) => {
    sessionAccount(['password', 'apple.com']);
    sheet();

    await expect(deleteAccount('senha-certa')).resolves.toBe('deleted');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(removeAccount).toHaveBeenCalledTimes(1);
  });

  it('a sessão que troca enquanto a folha está à vista: sem revogar, cancelado', async () => {
    sessionAccount(['password', 'apple.com']);
    appleSheet.mockImplementationOnce(async () => {
      mockAuth.currentUser = anotherSession();
      return appleCredentialWith();
    });

    await expect(deleteAccount('senha-certa')).resolves.toBe('canceled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeAccount).not.toHaveBeenCalled();
  });
});

describe('no Android, a exclusão de antes', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('a conta só da Apple exclui direto, sem a folha e sem revogar', async () => {
    const user = sessionAccount(['apple.com']);

    await expect(deleteAccount()).resolves.toBe('deleted');
    expect(removeAccount).toHaveBeenCalledWith(user);
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a senha com a Apple ligada exclui no primeiro toque, sem a folha', async () => {
    sessionAccount(['password', 'apple.com']);

    await expect(deleteAccount()).resolves.toBe('deleted');
    expect(credentialState).not.toHaveBeenCalled();
    expect(appleSheet).not.toHaveBeenCalled();
  });
});

describe('o nome guardado da Apple sai com a conta', () => {
  async function keep(appleUserId: string): Promise<void> {
    await AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId, name: 'Camila Ribeiro' }),
    );
  }

  it('excluída a conta, sai o nome guardado da Apple dela', async () => {
    await keep(APPLE_UID);
    sessionAccount(['apple.com']);

    await expect(deleteAccount()).resolves.toBe('deleted');
    expect(await storedName()).toBeNull();
  });

  it('o nome de outra Conta Apple fica', async () => {
    await keep('outra.apple');
    sessionAccount(['password', 'apple.com']);

    await expect(deleteAccount('senha-certa')).resolves.toBe('deleted');
    expect(await storedName()).not.toBeNull();
  });

  it('cancelada ou com erro, o nome fica', async () => {
    await keep(APPLE_UID);
    sessionAccount(['apple.com']);
    appleSheet.mockRejectedValueOnce(canceled());
    await expect(deleteAccount()).resolves.toBe('canceled');

    removeAccount.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));
    await expect(failureOf(deleteAccount())).resolves.toBe('network');

    expect(await storedName()).not.toBeNull();
  });
});

describe('por que a exclusão não passou', () => {
  it('as falhas da Apple chegam à tela pelo nome delas', async () => {
    sessionAccount(['apple.com']);
    reauth.mockRejectedValueOnce(new FirebaseError('auth/user-mismatch', 'outra'));
    await expect(failureOf(deleteAccount())).resolves.toBe('wrongAppleAccount');

    appleSheet.mockRejectedValueOnce(new Error('falhou'));
    await expect(failureOf(deleteAccount())).resolves.toBe('appleUnavailable');
  });

  it.each([
    [new FirebaseError('auth/requires-recent-login', ''), 'needsPassword'],
    [new FirebaseError('auth/wrong-password', ''), 'wrongPassword'],
    [new FirebaseError('auth/network-request-failed', ''), 'network'],
    [new FirebaseError('auth/too-many-requests', ''), 'tooManyRequests'],
    [new FirebaseError('auth/user-disabled', ''), 'sessionEnded'],
    [new Error('outra coisa'), 'unknown'],
  ])('%p dá %s', (error, failure) => {
    expect(deleteAccountFailure(error)).toBe(failure);
  });
});
