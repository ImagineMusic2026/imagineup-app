import {
  AppleAuthenticationCredentialState,
  AppleAuthenticationScope,
  getCredentialStateAsync,
  isAvailableAsync,
  signInAsync,
  type AppleAuthenticationCredential,
} from 'expo-apple-authentication';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import { isExpoGo } from '@/config/runtime';

import {
  appleCredential,
  appleCredentialState,
  appleFullName,
  isAppleSignInAvailable,
  onAppleRevoked,
} from '../apple-sign-in';

/**
 * Entrar com a Apple (seção 33 de docs/arquitetura-api.md). O
 * `expo-apple-authentication` e o `expo-crypto` são os do `jest.setup.js`: as
 * respostas de um iPhone e o crypto do Node, com o SHA-256 de verdade.
 */

// O host dos emuladores, lido a cada uso (getter, sem espalhar o objeto).
const mockServer: { firebaseEmulatorHost: string | undefined } = {
  firebaseEmulatorHost: undefined,
};
jest.mock('@/config/server', () => ({
  get firebaseEmulatorHost() {
    return mockServer.firebaseEmulatorHost;
  },
}));

const expoGo = jest.mocked(isExpoGo);
const signIn = jest.mocked(signInAsync);

/** O SHA-256 em hex de `nonce-bruto-1`, calculado à parte: é o que a Apple recebe. */
const NONCE_SHA256 = '120b2a6a334cdf9cdd0c7fa4aa8d7d79e439fcb909c031eda5a8991d816f15e9';

function credential(overrides: Partial<AppleAuthenticationCredential> = {}) {
  return {
    user: '000123.apple',
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

beforeEach(() => {
  mockServer.firebaseEmulatorHost = undefined;
  expoGo.mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  expoGo.mockReturnValue(false);
});

describe('quando o botão da Apple aparece', () => {
  it('no iPhone, numa build própria, aparece', async () => {
    await expect(isAppleSignInAvailable()).resolves.toBe(true);
  });

  it('no Android, nunca (nem pergunta ao sistema)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(isAvailableAsync).mockClear();

    await expect(isAppleSignInAvailable()).resolves.toBe(false);
    expect(isAvailableAsync).not.toHaveBeenCalled();
  });

  it('no Expo Go sem os emuladores, não aparece; com eles, aparece', async () => {
    expoGo.mockReturnValue(true);
    await expect(isAppleSignInAvailable()).resolves.toBe(false);

    mockServer.firebaseEmulatorHost = '10.0.2.2';
    await expect(isAppleSignInAvailable()).resolves.toBe(true);
  });

  it('com o sistema sem a Apple, ou o erro do módulo, não aparece', async () => {
    jest.mocked(isAvailableAsync).mockResolvedValueOnce(false);
    await expect(isAppleSignInAvailable()).resolves.toBe(false);

    jest.mocked(isAvailableAsync).mockRejectedValueOnce(new Error('módulo'));
    await expect(isAppleSignInAvailable()).resolves.toBe(false);
  });
});

describe('a folha da Apple', () => {
  it('o nonce bruto volta para o Firebase, e a Apple recebe o SHA-256 dele em hex', async () => {
    jest.mocked(randomUUID).mockReturnValueOnce('nonce-bruto-1');
    signIn.mockResolvedValueOnce(credential());

    const result = await appleCredential();

    expect(signIn).toHaveBeenLastCalledWith({
      requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
      nonce: NONCE_SHA256,
    });
    expect(result).toEqual({
      user: '000123.apple',
      identityToken: 'token-da-apple',
      rawNonce: 'nonce-bruto-1',
      authorizationCode: 'codigo-da-apple',
      fullName: 'Camila Ribeiro',
      email: 'camila@privaterelay.appleid.com',
    });
  });

  it('cada entrada tem um nonce novo', async () => {
    await appleCredential();
    await appleCredential();
    const [first, second] = signIn.mock.calls.slice(-2).map(([options]) => options?.nonce);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it('a segunda entrada da mesma pessoa vem sem nome e sem e-mail', async () => {
    // A resposta padrão do mock é a de quem já entrou antes.
    await expect(appleCredential()).resolves.toMatchObject({ fullName: null, email: null });
  });

  it('cancelada pelo fã, null, sem erro', async () => {
    signIn.mockRejectedValueOnce(
      Object.assign(new Error('cancelada'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    await expect(appleCredential()).resolves.toBeNull();
  });

  it('outra falha da Apple passa adiante', async () => {
    const failure = Object.assign(new Error('falhou'), { code: 'ERR_REQUEST_FAILED' });
    signIn.mockRejectedValueOnce(failure);
    await expect(appleCredential()).rejects.toBe(failure);
  });
});

describe('o nome da Apple numa linha', () => {
  const name = (
    givenName: string | null,
    familyName: string | null,
    middleName: string | null = null,
  ) => ({ namePrefix: null, givenName, middleName, familyName, nameSuffix: null, nickname: null });

  it.each([
    ['nome e sobrenome', name('Camila', 'Ribeiro'), 'Camila Ribeiro'],
    ['com o nome do meio', name('Camila', 'Ribeiro', 'Souza'), 'Camila Souza Ribeiro'],
    ['só o nome', name('Camila', null), 'Camila'],
    ['espaços nas pontas', name('  Camila ', ' Ribeiro  '), 'Camila Ribeiro'],
    ['tudo vazio', name('', '  '), null],
    ['sem nome', name(null, null), null],
    ['sem o objeto', null, null],
  ])('%s', (_, fullName, expected) => {
    expect(appleFullName(fullName)).toBe(expected);
  });
});

describe('a credencial da Apple no aparelho', () => {
  it('diz o estado da credencial da pessoa', async () => {
    jest
      .mocked(getCredentialStateAsync)
      .mockResolvedValueOnce(AppleAuthenticationCredentialState.REVOKED);

    await expect(appleCredentialState('000123.apple')).resolves.toBe(
      AppleAuthenticationCredentialState.REVOKED,
    );
    expect(getCredentialStateAsync).toHaveBeenLastCalledWith('000123.apple');
  });

  it('o erro (o simulador sempre lança) vira null', async () => {
    jest.mocked(getCredentialStateAsync).mockRejectedValueOnce(new Error('simulador'));
    await expect(appleCredentialState('000123.apple')).resolves.toBeNull();
  });

  it('no Android, null, sem perguntar', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getCredentialStateAsync).mockClear();

    await expect(appleCredentialState('000123.apple')).resolves.toBeNull();
    expect(getCredentialStateAsync).not.toHaveBeenCalled();
  });

  it('avisa quando a pessoa tira o app do ID Apple, até parar de ouvir', () => {
    const { mockEmitRevoked } = jest.requireMock<{ mockEmitRevoked: () => void }>(
      'expo-apple-authentication',
    );
    const listener = jest.fn();
    const stop = onAppleRevoked(listener);

    mockEmitRevoked();
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    mockEmitRevoked();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('no Android, ninguém ouve', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { mockEmitRevoked } = jest.requireMock<{ mockEmitRevoked: () => void }>(
      'expo-apple-authentication',
    );
    const listener = jest.fn();
    const stop = onAppleRevoked(listener);

    mockEmitRevoked();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
