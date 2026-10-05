import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { api, ApiError } from '@/services/api';

// O interceptador de verdade, com o Firebase trocado por uma sessão que o teste
// muda no meio e um adaptador falso no lugar da rede: o pedido que sai é o que
// o adaptador recebe.

type FakeUser = { uid: string; getIdToken: jest.Mock<Promise<string>, [boolean?]> };

const mockAuth: { authStateReady: jest.Mock; currentUser: FakeUser | null } = {
  authStateReady: jest.fn(async () => undefined),
  currentUser: null,
};

jest.mock('@/config/env', () => ({ apiUrl: 'http://api.teste' }));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  isFirebaseConfigured: true,
}));

/** Como o Firebase: o token renovado fica guardado e é o que as chamadas seguintes devolvem. */
function fakeUser(uid: string): FakeUser {
  let token = `token-${uid}`;
  return {
    uid,
    getIdToken: jest.fn(async (forceRefresh?: boolean) => {
      if (forceRefresh) token = `token-${uid}-novo`;
      return token;
    }),
  };
}

const ok = (config: InternalAxiosRequestConfig): AxiosResponse => ({
  data: { ok: true },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});

function unauthorized(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, {
    data: { code: 'unauthenticated', message: 'Sessão inválida.' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  });
}

/** Os pedidos que chegaram à "rede", com o cabeçalho de autorização de cada um. */
const sent: (string | undefined)[] = [];

function adapter(respond: (config: InternalAxiosRequestConfig, call: number) => AxiosResponse) {
  const fn: AxiosAdapter = async (config) => {
    sent.push(AxiosHeaders.from(config.headers).get('Authorization')?.toString());
    return respond(config, sent.length);
  };
  return jest.fn(fn);
}

beforeEach(() => {
  sent.length = 0;
  mockAuth.currentUser = null;
  mockAuth.authStateReady.mockClear();
});

describe('token da sessão (interceptador do axios)', () => {
  it('sem sessionUid, o pedido vai com o token de quem está na sessão', async () => {
    mockAuth.currentUser = fakeUser('bia');
    const send = adapter(ok);
    await api.get('/me/wallet', { adapter: send });
    expect(mockAuth.authStateReady).toHaveBeenCalled();
    expect(sent).toEqual(['Bearer token-bia']);
  });

  it('com o sessionUid da conta da sessão, o pedido sai com o token dela', async () => {
    mockAuth.currentUser = fakeUser('bia');
    const send = adapter(ok);
    await expect(
      api.post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' }),
    ).resolves.toMatchObject({ status: 200 });
    expect(sent).toEqual(['Bearer token-bia']);
  });

  it('com a sessão de outra conta, recusa antes de sair: ApiError incerto, sem status, e nada chega à rede', async () => {
    const alan = fakeUser('alan');
    mockAuth.currentUser = alan;
    const send = adapter(ok);
    const error = await api
      .post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'unknown', status: null, code: null });
    expect(send).not.toHaveBeenCalled();
    expect(alan.getIdToken).not.toHaveBeenCalled();
  });

  it('sem ninguém na sessão e com sessionUid, também recusa sem sair', async () => {
    const send = adapter(ok);
    await expect(
      api.post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' }),
    ).rejects.toMatchObject({ kind: 'unknown', status: null });
    expect(send).not.toHaveBeenCalled();
  });

  it('o getIdToken que falha (sem rede, token vencido) vira ApiError incerto, sem status', async () => {
    const bia = fakeUser('bia');
    bia.getIdToken.mockRejectedValueOnce(new Error('auth/network-request-failed'));
    mockAuth.currentUser = bia;
    const send = adapter(ok);
    await expect(
      api.post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' }),
    ).rejects.toMatchObject({ kind: 'unknown', status: null, code: null });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('401 e a renovação do token', () => {
  it('renova uma vez e repete com o token novo da mesma conta', async () => {
    const bia = fakeUser('bia');
    mockAuth.currentUser = bia;
    const send = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>(async (config) => {
      sent.push(AxiosHeaders.from(config.headers).get('Authorization')?.toString());
      if (sent.length === 1) throw unauthorized(config);
      return ok(config);
    });
    await expect(
      api.post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' }),
    ).resolves.toMatchObject({ status: 200 });
    expect(sent).toEqual(['Bearer token-bia', 'Bearer token-bia-novo']);
    // O pedido, a renovação forçada e o pedido repetido, que passa de novo pelo interceptador.
    expect(bia.getIdToken.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('com a sessão trocada no meio, não repete com o token de outra conta', async () => {
    mockAuth.currentUser = fakeUser('bia');
    const alan = fakeUser('alan');
    const send = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>(async (config) => {
      sent.push(AxiosHeaders.from(config.headers).get('Authorization')?.toString());
      // Outro fã entra enquanto o pedido estava fora.
      mockAuth.currentUser = alan;
      throw unauthorized(config);
    });
    const error = await api
      .post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ kind: 'unknown', status: null });
    expect(sent).toEqual(['Bearer token-bia']);
    expect(alan.getIdToken).not.toHaveBeenCalled();
  });

  it('a renovação que falha vira ApiError incerto, sem status, e não repete', async () => {
    const bia = fakeUser('bia');
    mockAuth.currentUser = bia;
    const send = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>(async (config) => {
      sent.push(AxiosHeaders.from(config.headers).get('Authorization')?.toString());
      bia.getIdToken.mockRejectedValueOnce(new Error('auth/network-request-failed'));
      throw unauthorized(config);
    });
    await expect(
      api.post('/invites/claim', {}, { adapter: send, sessionUid: 'bia' }),
    ).rejects.toMatchObject({ kind: 'unknown', status: null });
    expect(sent).toHaveLength(1);
  });

  it('o 401 que se repete depois da renovação chega como unauthorized, com o status', async () => {
    mockAuth.currentUser = fakeUser('bia');
    const send = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>(async (config) => {
      sent.push(AxiosHeaders.from(config.headers).get('Authorization')?.toString());
      throw unauthorized(config);
    });
    await expect(api.get('/me/wallet', { adapter: send })).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
      code: 'unauthenticated',
    });
    expect(sent).toEqual(['Bearer token-bia', 'Bearer token-bia-novo']);
  });
});
