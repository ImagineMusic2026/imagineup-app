import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInAsync, type AppleAuthenticationCredential } from 'expo-apple-authentication';
import { randomUUID } from 'expo-crypto';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  EmailAuthProvider,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  linkWithCredential,
  OAuthProvider,
  reauthenticateWithCredential,
  signInWithCredential,
  updateProfile,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { onSnapshot, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { sourceOf } from '@/config/data-source';
import { api, ApiError } from '@/services/api';
import {
  GoogleSignInError,
  googleIdToken,
  revokeGoogleAccess,
  signOutGoogle,
} from '@/services/google-sign-in';
import { StorageKeys } from '@/storage/storage';

import { RecentLoginRequiredError, SessionEndedError } from '../api';
import { APPLE_REVOKE_TIMEOUT_MS, EXISTING_ACCOUNT_CHECK_MS, IOS_BUNDLE_ID } from '../consts';
import {
  applyPendingAppleName,
  currentAppleUid,
  deleteAccount,
  deletionKindOf,
  forgetPendingGoogleLink,
  hasAnyCentral,
  linkPendingGoogle,
  pendingGoogleLinkEmail,
  readPendingAppleName,
  revokeAppleToken,
  settlePendingAppleName,
  settleSessionAppleName,
  signInWithApple,
  signInWithGoogle,
  socialErrorMessageKey,
} from '../social';

/**
 * O núcleo da entrada social (seção 33 de docs/arquitetura-api.md): a
 * credencial de cada provedor, o nome da Apple guardado antes, a ligação
 * pendente do Google, a revogação da Apple e as centrais da conta que já
 * existe. A Apple é a do `jest.setup.js` (as respostas de um iPhone); o Google
 * é falso aqui, porque o serviço dele tem os testes próprios.
 */

// O build do Firebase que o Jest resolve é ESM; aqui só chegam estas peças.
jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code: string;
    customData?: Record<string, unknown>;
    constructor(code: string, message: string, customData?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.customData = customData;
    }
  },
}));
jest.mock('firebase/auth', () => ({
  GoogleAuthProvider: {
    credential: jest.fn((idToken: string) => ({ providerId: 'google.com', idToken })),
  },
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
  signInWithCredential: jest.fn(),
  getAdditionalUserInfo: jest.fn(),
  linkWithCredential: jest.fn(),
  updateProfile: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  deleteUser: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(() => () => undefined),
  updateDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'agora-do-servidor'),
}));

// A conta da sessão, que a revogação da Apple e a exclusão leem.
const mockAuth: { currentUser: User | null; authStateReady: () => Promise<void> } = {
  currentUser: null,
  authStateReady: jest.fn(() => Promise.resolve()),
};
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
  googleWebClientId: undefined,
  apiUrl: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: jest.fn(() => 'api'),
  usesFixtures: () => false,
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
jest.mock('@/services/google-sign-in', () => ({
  ...jest.requireActual('@/services/google-sign-in'),
  googleIdToken: jest.fn(),
  signOutGoogle: jest.fn(() => Promise.resolve()),
  revokeGoogleAccess: jest.fn(() => Promise.resolve()),
}));

const firebaseSignIn = jest.mocked(signInWithCredential);
const setAuthName = jest.mocked(updateProfile);
const link = jest.mocked(linkWithCredential);
const writeProfile = jest.mocked(updateDoc);
const appleSignIn = jest.mocked(signInAsync);
const google = jest.mocked(googleIdToken);
const leaveGoogle = jest.mocked(signOutGoogle);
const get = jest.mocked(api.get);
const source = jest.mocked(sourceOf);

const APPLE_UID = '000123.apple';

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    uid: 'uid-nova',
    email: 'camila@gmail.com',
    displayName: null,
    photoURL: null,
    providerData: [{ providerId: 'apple.com', uid: APPLE_UID }],
    getIdToken: jest.fn(async () => 'id-token-da-sessao'),
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
  mockEnv.firebaseEnv = null;
  mockEnv.firebaseEmulatorHost = undefined;
  source.mockReturnValue('api');
  setAuthName.mockImplementation(async (user, { displayName }) => {
    Object.assign(user, { displayName });
  });
  forgetPendingGoogleLink();
  leaveGoogle.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
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
      method: 'apple',
      user,
      isNewUser: true,
      appleName: 'Camila Ribeiro',
    });
    // A chave só sai quando o perfil tem nome.
    expect(await readPendingAppleName()).toEqual({
      appleUserId: APPLE_UID,
      name: 'Camila Ribeiro',
    });
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
    expect(await readPendingAppleName()).toMatchObject({ name: 'Camila Ribeiro' });

    // A Apple não manda o nome de novo.
    appleSignIn.mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }));
    const user = fakeUser();
    firebaseReturns(user, false);

    await expect(signInWithApple()).resolves.toMatchObject({
      isNewUser: false,
      appleName: 'Camila Ribeiro',
    });
    expect(setAuthName).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
  });

  it('sem nome (de quem já entrou) e sem chave, nada vai para o nome', async () => {
    firebaseReturns(fakeUser(), false);
    await expect(signInWithApple()).resolves.toMatchObject({ appleName: null });
    expect(setAuthName).not.toHaveBeenCalled();
    expect(await storedName()).toBeNull();
  });

  it('o nome guardado de outro ID Apple não vai para esta conta, e fica guardado', async () => {
    await AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId: 'outro.apple', name: 'Bia Souza' }),
    );
    firebaseReturns(fakeUser(), false);

    await expect(signInWithApple()).resolves.toMatchObject({ appleName: null });
    expect(setAuthName).not.toHaveBeenCalled();
    expect(await readPendingAppleName()).toEqual({ appleUserId: 'outro.apple', name: 'Bia Souza' });
  });

  it('a falha do nome no Auth não segura a entrada: o nome ainda vai para o perfil', async () => {
    appleSignIn.mockResolvedValueOnce(appleCredentialWith());
    setAuthName.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    firebaseReturns(fakeUser(), true);

    await expect(signInWithApple()).resolves.toMatchObject({ appleName: 'Camila Ribeiro' });
    warn.mockRestore();
  });
});

describe('o nome guardado da Apple', () => {
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

  async function keep(name = 'Camila Ribeiro'): Promise<void> {
    await AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId: APPLE_UID, name }),
    );
  }

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
    await keep('   ');
    await settlePendingAppleName('uid-nova', { displayName: null }, '   ');
    expect(writeProfile).not.toHaveBeenCalled();
    expect(await storedName()).toBeNull();
  });
});

describe('o nome guardado da Apple no início da sessão (decisão 6)', () => {
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

  async function keep(appleUserId = APPLE_UID): Promise<void> {
    await AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId, name: 'Camila Ribeiro' }),
    );
  }

  afterEach(() => {
    jest.mocked(onSnapshot).mockImplementation(() => () => undefined);
  });

  it('o `uid` da Apple é o da conta da sessão, e de nenhuma outra', () => {
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

describe('entrar com o Google', () => {
  it('troca o idToken pela sessão', async () => {
    google.mockResolvedValueOnce({ idToken: 'id-do-google', email: 'bia@gmail.com' });
    const user = fakeUser({ displayName: 'Bia Souza', providerData: [] } as never);
    firebaseReturns(user, true);

    await expect(signInWithGoogle()).resolves.toEqual({
      kind: 'signedIn',
      method: 'google',
      user,
      isNewUser: true,
      appleName: null,
    });
    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('id-do-google');
    expect(firebaseSignIn).toHaveBeenCalledWith(mockAuth, {
      providerId: 'google.com',
      idToken: 'id-do-google',
    });
  });

  it('cancelada, null, sem tocar no Firebase', async () => {
    google.mockResolvedValueOnce(null);
    await expect(signInWithGoogle()).resolves.toBeNull();
    expect(firebaseSignIn).not.toHaveBeenCalled();
  });

  it('outra falha do Firebase sai do Google no aparelho e passa adiante', async () => {
    google.mockResolvedValueOnce({ idToken: 'id-do-google', email: 'bia@gmail.com' });
    firebaseSignIn.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    expect(leaveGoogle).toHaveBeenCalledTimes(1);
  });
});

describe('o modo "ligar" do Google (decisão 8)', () => {
  /** O Google fora do Gmail numa conta de senha com o mesmo e-mail. */
  async function googleHitsPasswordAccount(customData?: Record<string, unknown>) {
    google.mockResolvedValueOnce({ idToken: 'id-do-google', email: 'Enzo@Empresa.com.br' });
    firebaseSignIn.mockRejectedValueOnce(
      new FirebaseError('auth/account-exists-with-different-credential', 'existe', customData),
    );
    return signInWithGoogle();
  }

  it('vira a ligação pendente, com o e-mail do pacote, mesmo sem o e-mail no erro', async () => {
    await expect(googleHitsPasswordAccount()).resolves.toEqual({
      kind: 'link',
      email: 'Enzo@Empresa.com.br',
    });
    expect(pendingGoogleLinkEmail()).toBe('Enzo@Empresa.com.br');
    // O Google continua no aparelho, para a ligação.
    expect(leaveGoogle).not.toHaveBeenCalled();
  });

  it('o e-mail do pacote vale também quando o erro traz outro', async () => {
    await googleHitsPasswordAccount({ email: 'outro@x.com' });
    expect(pendingGoogleLinkEmail()).toBe('Enzo@Empresa.com.br');
  });

  it('depois de entrar com a senha da conta, liga a credencial do mesmo idToken, uma vez', async () => {
    await googleHitsPasswordAccount();
    const user = fakeUser({ email: 'enzo@empresa.com.br' });
    link.mockResolvedValueOnce({ user } as UserCredential);

    await expect(linkPendingGoogle(user)).resolves.toBe('linked');
    expect(link).toHaveBeenCalledWith(user, { providerId: 'google.com', idToken: 'id-do-google' });
    expect(pendingGoogleLinkEmail()).toBeNull();
    await expect(linkPendingGoogle(user)).resolves.toBeNull();
    expect(link).toHaveBeenCalledTimes(1);
  });

  it('a conta de outro e-mail não recebe o Google', async () => {
    await googleHitsPasswordAccount();
    await expect(linkPendingGoogle(fakeUser({ email: 'camila@x.com' }))).resolves.toBe('failed');
    expect(link).not.toHaveBeenCalled();
    expect(leaveGoogle).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['auth/credential-already-in-use', 'inUse'],
    ['auth/email-already-in-use', 'inUse'],
    ['auth/network-request-failed', 'failed'],
  ])('a ligação recusada com %s vira %s, e sai do Google no aparelho', async (code, outcome) => {
    await googleHitsPasswordAccount();
    link.mockRejectedValueOnce(new FirebaseError(code, code));

    await expect(linkPendingGoogle(fakeUser({ email: 'enzo@empresa.com.br' }))).resolves.toBe(
      outcome,
    );
    expect(leaveGoogle).toHaveBeenCalledTimes(1);
    expect(pendingGoogleLinkEmail()).toBeNull();
  });

  it('sem ligação pendente, nada', async () => {
    await expect(linkPendingGoogle(fakeUser())).resolves.toBeNull();
    expect(link).not.toHaveBeenCalled();
  });

  it('sair da tela sem entrar esquece a credencial e sai do Google', async () => {
    await googleHitsPasswordAccount();
    forgetPendingGoogleLink();
    expect(pendingGoogleLinkEmail()).toBeNull();
    expect(leaveGoogle).toHaveBeenCalledTimes(1);
    await expect(linkPendingGoogle(fakeUser({ email: 'enzo@empresa.com.br' }))).resolves.toBeNull();
  });

  it('outra entrada social esquece a ligação pendente', async () => {
    await googleHitsPasswordAccount();
    firebaseReturns(fakeUser(), false);
    await signInWithApple();
    expect(pendingGoogleLinkEmail()).toBeNull();
  });
});

describe('a frase do erro da entrada social', () => {
  it.each([
    ['o Google desligado', new GoogleSignInError('unavailable'), 'auth.social.errors.unavailable'],
    ['sem o idToken', new GoogleSignInError('noIdToken'), 'auth.social.errors.unavailable'],
    ['o Play Services', new GoogleSignInError('playServices'), 'auth.social.errors.playServices'],
    [
      'o provedor desligado no console',
      new FirebaseError('auth/operation-not-allowed', 'x'),
      'auth.social.errors.unavailable',
    ],
    [
      'o token recusado pelo projeto',
      new FirebaseError('auth/invalid-credential', 'x'),
      'auth.social.errors.unavailable',
    ],
    ['sem rede', new FirebaseError('auth/network-request-failed', 'x'), 'auth.errors.network'],
    [
      'muitas tentativas',
      new FirebaseError('auth/too-many-requests', 'x'),
      'auth.errors.tooManyRequests',
    ],
    [
      'a conta desativada',
      new FirebaseError('auth/user-disabled', 'x'),
      'auth.social.errors.unknown',
    ],
    [
      'o módulo da Apple que não existe',
      Object.assign(new Error('x'), { code: 'ERR_UNAVAILABLE' }),
      'auth.social.errors.unavailable',
    ],
    [
      'a falha da Apple',
      Object.assign(new Error('x'), { code: 'ERR_REQUEST_FAILED' }),
      'auth.social.errors.unknown',
    ],
    ['qualquer outra coisa', 'x', 'auth.social.errors.unknown'],
  ])('%s', (_, error, key) => {
    expect(socialErrorMessageKey(error)).toBe(key);
  });
});

describe('as centrais da conta que já existe (decisão 11)', () => {
  it('com alguma central, verdadeiro, com o token só da conta que entrou', async () => {
    get.mockResolvedValueOnce({ data: [{ artistId: 'nettobrito' }] });
    await expect(hasAnyCentral('uid-camila')).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(
      '/me/centrals',
      expect.objectContaining({ sessionUid: 'uid-camila', signal: expect.any(AbortSignal) }),
    );
  });

  it('sem nenhuma, falso', async () => {
    get.mockResolvedValueOnce({ data: [] });
    await expect(hasAnyCentral('uid-camila')).resolves.toBe(false);
  });

  it('a falha ou a resposta fora do formato, null', async () => {
    get.mockRejectedValueOnce(new ApiError('network', 'rede'));
    await expect(hasAnyCentral('uid-camila')).resolves.toBeNull();
    get.mockResolvedValueOnce({ data: { centrals: [] } });
    await expect(hasAnyCentral('uid-camila')).resolves.toBeNull();
  });

  it('sem a resposta em 3 s, null, e o pedido é abortado', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    get.mockImplementationOnce((_url, config) => {
      signal = config?.signal as AbortSignal;
      return new Promise(() => undefined);
    });

    const answer = hasAnyCentral('uid-camila');
    await jest.advanceTimersByTimeAsync(EXISTING_ACCOUNT_CHECK_MS);

    await expect(answer).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('sem a API (as fixtures), null, sem pedir', async () => {
    source.mockReturnValue('fixtures');
    await expect(hasAnyCentral('uid-camila')).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('a revogação da Apple (decisão 12)', () => {
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    mockEnv.firebaseEnv = { firebaseApiKey: 'chave-publica' };
    mockAuth.currentUser = fakeUser();
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('manda o código como CODE, com o ID token da conta viva e o bundle ID no cabeçalho', async () => {
    await expect(revokeAppleToken('codigo-da-apple')).resolves.toBe(true);

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
      idToken: 'id-token-da-sessao',
    });
  });

  it('o bundle ID é o do app.config.ts', () => {
    // A configuração do Expo, na raiz do projeto.
    const { default: appConfig } = jest.requireActual<{
      default: (context: { config: object }) => { ios?: { bundleIdentifier?: string } };
    }>('../../../../app.config');
    expect(appConfig({ config: {} }).ios?.bundleIdentifier).toBe(IOS_BUNDLE_ID);
  });

  it('a recusa do servidor ou a falha da rede não lançam', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(revokeAppleToken('codigo')).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(revokeAppleToken('codigo')).resolves.toBe(false);
  });

  it('sem resposta em 10 s, desiste sem lançar e aborta o pedido', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });

    const answer = revokeAppleToken('codigo');
    await jest.advanceTimersByTimeAsync(APPLE_REVOKE_TIMEOUT_MS);

    await expect(answer).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it('com o emulador, que não tem a rota, nem tenta', async () => {
    mockEnv.firebaseEmulatorHost = '10.0.2.2';
    await expect(revokeAppleToken('codigo')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem a configuração do Firebase ou sem a conta logada, não tenta', async () => {
    mockEnv.firebaseEnv = null;
    await expect(revokeAppleToken('codigo')).resolves.toBe(false);
    mockEnv.firebaseEnv = { firebaseApiKey: 'chave-publica' };
    mockAuth.currentUser = null;
    await expect(revokeAppleToken('codigo')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a exclusão da conta pelo provedor da sessão (decisão 12)', () => {
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;
  const removeAccount = jest.mocked(deleteUser);
  const reauth = jest.mocked(reauthenticateWithCredential);
  const revokeGoogle = jest.mocked(revokeGoogleAccess);

  /** Quando o mock foi chamado pela primeira vez, para conferir a ordem. */
  const firstCall = (mock: unknown): number =>
    jest.mocked(mock as jest.Mock).mock.invocationCallOrder[0] ?? -1;

  const recentLogin = () => new FirebaseError('auth/requires-recent-login', 'login antigo');
  const canceled = () => Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' });

  /** A conta da sessão com os provedores dela (o `providerId` e o `uid` de cada um). */
  function sessionAccount(...providers: [string, string][]): User {
    const user = fakeUser({
      providerData: providers.map(([providerId, uid]) => ({ providerId, uid })),
    } as never);
    mockAuth.currentUser = user;
    return user;
  }

  /** O corpo da revogação que foi ao REST do Identity Toolkit. */
  function revokedBody(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    mockEnv.firebaseEnv = { firebaseApiKey: 'chave-publica' };
    removeAccount.mockReset();
    removeAccount.mockResolvedValue(undefined);
    reauth.mockReset();
    reauth.mockResolvedValue({} as UserCredential);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it.each([
    ['a Apple, no iPhone', 'apple', 'ios', 'apple'],
    ['a Apple, fora do iPhone (não acontece), como a senha', 'apple', 'android', 'password'],
    ['o Google', 'google', 'ios', 'google'],
    ['a senha', 'password', 'ios', 'password'],
    ['sem o provedor (o Admin SDK, o aparelho sem entrada), como a senha', null, 'ios', 'password'],
  ] as const)('o jeito de confirmar: %s', (_, method, os, kind) => {
    jest.replaceProperty(Platform, 'OS', os);
    expect(deletionKindOf(method)).toBe(kind);
  });

  describe('a senha', () => {
    it('exclui direto, sem reautenticar e sem nenhum provedor', async () => {
      const user = sessionAccount(['password', 'camila@gmail.com']);

      await expect(deleteAccount({ kind: 'password' })).resolves.toBe('deleted');

      expect(mockAuth.authStateReady).toHaveBeenCalled();
      expect(removeAccount).toHaveBeenCalledWith(user);
      expect(reauth).not.toHaveBeenCalled();
      expect(appleSignIn).not.toHaveBeenCalled();
      expect(revokeGoogle).not.toHaveBeenCalled();
    });

    it('com o login antigo, pede a senha (o RecentLoginRequiredError)', async () => {
      sessionAccount(['password', 'camila@gmail.com']);
      removeAccount.mockRejectedValueOnce(recentLogin());

      const attempt = deleteAccount({ kind: 'password' });

      await expect(attempt).rejects.toBeInstanceOf(RecentLoginRequiredError);
      await expect(attempt).rejects.toMatchObject({ method: 'password' });
    });

    it('a senha reautentica com a credencial de e-mail antes de excluir', async () => {
      const user = sessionAccount(['password', 'camila@gmail.com']);

      await expect(deleteAccount({ kind: 'password', password: 'senha-certa' })).resolves.toBe(
        'deleted',
      );

      expect(EmailAuthProvider.credential).toHaveBeenCalledWith('camila@gmail.com', 'senha-certa');
      expect(reauth).toHaveBeenCalledWith(user, {
        providerId: 'password',
        email: 'camila@gmail.com',
        password: 'senha-certa',
      });
      expect(firstCall(reauth)).toBeLessThan(firstCall(removeAccount));
    });

    it('a senha errada passa adiante, sem excluir', async () => {
      sessionAccount(['password', 'camila@gmail.com']);
      reauth.mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'senha'));

      await expect(deleteAccount({ kind: 'password', password: 'errada' })).rejects.toMatchObject({
        code: 'auth/invalid-credential',
      });
      expect(removeAccount).not.toHaveBeenCalled();
    });

    it('com o Google ligado à conta, o acesso do Google sai depois da exclusão', async () => {
      sessionAccount(['password', 'enzo@empresa.com.br'], ['google.com', 'g-enzo']);

      await expect(deleteAccount({ kind: 'password' })).resolves.toBe('deleted');

      expect(revokeGoogle).toHaveBeenCalledTimes(1);
      expect(firstCall(removeAccount)).toBeLessThan(firstCall(revokeGoogle));
    });

    it('sem conta logada, a sessão terminou, sem excluir', async () => {
      mockAuth.currentUser = null;
      await expect(deleteAccount({ kind: 'password' })).rejects.toBeInstanceOf(SessionEndedError);
      expect(removeAccount).not.toHaveBeenCalled();
    });
  });

  describe('o Google', () => {
    it('exclui direto e, depois, tira o acesso do Google e sai dele no aparelho', async () => {
      const user = sessionAccount(['google.com', 'g-bia']);

      await expect(deleteAccount({ kind: 'google' })).resolves.toBe('deleted');

      expect(google).not.toHaveBeenCalled();
      expect(reauth).not.toHaveBeenCalled();
      expect(removeAccount).toHaveBeenCalledWith(user);
      expect(revokeGoogle).toHaveBeenCalledTimes(1);
      expect(firstCall(removeAccount)).toBeLessThan(firstCall(revokeGoogle));
    });

    it('com o login antigo, pede a confirmação do Google, sem abrir a folha nem revogar', async () => {
      sessionAccount(['google.com', 'g-bia']);
      removeAccount.mockRejectedValueOnce(recentLogin());

      await expect(deleteAccount({ kind: 'google' })).rejects.toMatchObject({ method: 'google' });
      expect(google).not.toHaveBeenCalled();
      expect(revokeGoogle).not.toHaveBeenCalled();
    });

    it('confirmado: a folha traz um idToken novo, que reautentica, exclui e revoga, nessa ordem', async () => {
      const user = sessionAccount(['google.com', 'g-bia']);
      google.mockResolvedValueOnce({ idToken: 'id-novo', email: 'bia@gmail.com' });

      await expect(deleteAccount({ kind: 'google', confirm: true })).resolves.toBe('deleted');

      expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('id-novo');
      expect(reauth).toHaveBeenCalledWith(user, { providerId: 'google.com', idToken: 'id-novo' });
      expect(firstCall(google)).toBeLessThan(firstCall(reauth));
      expect(firstCall(reauth)).toBeLessThan(firstCall(removeAccount));
      expect(firstCall(removeAccount)).toBeLessThan(firstCall(revokeGoogle));
    });

    it('a folha do Google fechada pelo fã: nada muda, sem erro', async () => {
      sessionAccount(['google.com', 'g-bia']);
      google.mockResolvedValueOnce(null);

      await expect(deleteAccount({ kind: 'google', confirm: true })).resolves.toBe('canceled');
      expect(reauth).not.toHaveBeenCalled();
      expect(removeAccount).not.toHaveBeenCalled();
      expect(revokeGoogle).not.toHaveBeenCalled();
    });

    it('outra conta Google: o auth/user-mismatch passa adiante, sem excluir, e o Google sai do aparelho', async () => {
      sessionAccount(['google.com', 'g-bia']);
      google.mockResolvedValueOnce({ idToken: 'id-de-outra', email: 'outra@gmail.com' });
      reauth.mockRejectedValueOnce(new FirebaseError('auth/user-mismatch', 'outra conta'));

      await expect(deleteAccount({ kind: 'google', confirm: true })).rejects.toMatchObject({
        code: 'auth/user-mismatch',
      });
      expect(removeAccount).not.toHaveBeenCalled();
      expect(revokeGoogle).not.toHaveBeenCalled();
      // A próxima tentativa abre o seletor de contas de novo.
      expect(leaveGoogle).toHaveBeenCalledTimes(1);
    });
  });

  describe('a Apple, no iPhone', () => {
    it('a folha reautentica, o código é revogado com o bundle ID e só então a conta sai', async () => {
      jest.mocked(randomUUID).mockReturnValueOnce('nonce-bruto');
      appleSignIn.mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }));
      const user = sessionAccount(['apple.com', APPLE_UID]);

      await expect(deleteAccount({ kind: 'apple' })).resolves.toBe('deleted');

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
      expect(firstCall(reauth)).toBeLessThan(firstCall(fetchMock));
      expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
      expect(revokeGoogle).not.toHaveBeenCalled();
    });

    it('a revogação que falha não trava a exclusão', async () => {
      sessionAccount(['apple.com', APPLE_UID]);
      appleSignIn
        .mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }))
        .mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }));

      fetchMock.mockResolvedValueOnce({ ok: false });
      await expect(deleteAccount({ kind: 'apple' })).resolves.toBe('deleted');
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      await expect(deleteAccount({ kind: 'apple' })).resolves.toBe('deleted');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(removeAccount).toHaveBeenCalledTimes(2);
    });

    it('a folha da Apple fechada pelo fã: nada muda, sem erro', async () => {
      sessionAccount(['apple.com', APPLE_UID]);
      appleSignIn.mockRejectedValueOnce(canceled());

      await expect(deleteAccount({ kind: 'apple' })).resolves.toBe('canceled');
      expect(reauth).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(removeAccount).not.toHaveBeenCalled();
    });

    it('outro ID Apple: o auth/user-mismatch passa adiante, sem revogar nem excluir', async () => {
      sessionAccount(['apple.com', APPLE_UID]);
      appleSignIn.mockResolvedValueOnce(appleCredentialWith({ user: 'outra.apple' }));
      reauth.mockRejectedValueOnce(new FirebaseError('auth/user-mismatch', 'outra conta'));

      await expect(deleteAccount({ kind: 'apple' })).rejects.toMatchObject({
        code: 'auth/user-mismatch',
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(removeAccount).not.toHaveBeenCalled();
    });

    it('sem o código na resposta da folha, exclui sem revogar', async () => {
      sessionAccount(['apple.com', APPLE_UID]);
      appleSignIn.mockResolvedValueOnce(appleCredentialWith({ authorizationCode: null }));

      await expect(deleteAccount({ kind: 'apple' })).resolves.toBe('deleted');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(removeAccount).toHaveBeenCalledTimes(1);
    });
  });

  describe('a Apple ligada à sessão de outro provedor', () => {
    it('sem a sessão confirmada agora, pede a confirmação do Google antes de abrir a folha da Apple', async () => {
      sessionAccount(['google.com', 'g-camila'], ['apple.com', APPLE_UID]);

      await expect(deleteAccount({ kind: 'google' })).rejects.toMatchObject({ method: 'google' });
      expect(appleSignIn).not.toHaveBeenCalled();
      expect(google).not.toHaveBeenCalled();
      expect(removeAccount).not.toHaveBeenCalled();
    });

    it('confirmada pelo Google, a folha da Apple revoga o código da mesma pessoa, e a conta sai', async () => {
      const user = sessionAccount(['google.com', 'g-camila'], ['apple.com', APPLE_UID]);
      google.mockResolvedValueOnce({ idToken: 'id-novo', email: 'camila@gmail.com' });
      appleSignIn.mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }));

      await expect(deleteAccount({ kind: 'google', confirm: true })).resolves.toBe('deleted');

      // Reautentica só pelo Google: nunca pela Apple.
      expect(reauth).toHaveBeenCalledTimes(1);
      expect(reauth).toHaveBeenCalledWith(user, { providerId: 'google.com', idToken: 'id-novo' });
      expect(revokedBody()).toMatchObject({ tokenType: 'CODE', token: 'codigo-da-apple' });
      expect(firstCall(reauth)).toBeLessThan(firstCall(appleSignIn));
      expect(firstCall(appleSignIn)).toBeLessThan(firstCall(fetchMock));
      expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
      expect(firstCall(removeAccount)).toBeLessThan(firstCall(revokeGoogle));
    });

    it('cancelar a folha da Apple exclui do mesmo jeito, sem revogar', async () => {
      sessionAccount(['google.com', 'g-camila'], ['apple.com', APPLE_UID]);
      google.mockResolvedValueOnce({ idToken: 'id-novo', email: 'camila@gmail.com' });
      appleSignIn.mockRejectedValueOnce(canceled());

      await expect(deleteAccount({ kind: 'google', confirm: true })).resolves.toBe('deleted');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(removeAccount).toHaveBeenCalledTimes(1);
    });

    it('outro ID Apple no aparelho: exclui sem mandar o código dele', async () => {
      sessionAccount(['google.com', 'g-camila'], ['apple.com', APPLE_UID]);
      google.mockResolvedValueOnce({ idToken: 'id-novo', email: 'camila@gmail.com' });
      appleSignIn.mockResolvedValueOnce(appleCredentialWith({ user: 'outra.apple' }));

      await expect(deleteAccount({ kind: 'google', confirm: true })).resolves.toBe('deleted');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(reauth).toHaveBeenCalledTimes(1);
      expect(removeAccount).toHaveBeenCalledTimes(1);
    });

    it('a folha da Apple com erro: exclui sem revogar', async () => {
      sessionAccount(['google.com', 'g-camila'], ['apple.com', APPLE_UID]);
      google.mockResolvedValueOnce({ idToken: 'id-novo', email: 'camila@gmail.com' });
      appleSignIn.mockRejectedValueOnce(new Error('A folha falhou.'));

      await expect(deleteAccount({ kind: 'google', confirm: true })).resolves.toBe('deleted');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('na sessão de senha, a senha vem antes da folha da Apple', async () => {
      const user = sessionAccount(['password', 'camila@gmail.com'], ['apple.com', APPLE_UID]);
      appleSignIn.mockResolvedValueOnce(appleCredentialWith({ fullName: null, email: null }));

      await expect(deleteAccount({ kind: 'password' })).rejects.toMatchObject({
        method: 'password',
      });
      expect(appleSignIn).not.toHaveBeenCalled();

      await expect(deleteAccount({ kind: 'password', password: 'senha-certa' })).resolves.toBe(
        'deleted',
      );
      expect(reauth).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ providerId: 'password' }),
      );
      expect(revokedBody()).toMatchObject({ token: 'codigo-da-apple' });
      expect(firstCall(reauth)).toBeLessThan(firstCall(appleSignIn));
      expect(firstCall(fetchMock)).toBeLessThan(firstCall(removeAccount));
    });

    it('no Android, não há folha da Apple: exclui sem revogar e sem pedir a confirmação (limite)', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      sessionAccount(['google.com', 'g-camila'], ['apple.com', APPLE_UID]);

      await expect(deleteAccount({ kind: 'google' })).resolves.toBe('deleted');
      expect(appleSignIn).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(revokeGoogle).toHaveBeenCalledTimes(1);
    });
  });
});
