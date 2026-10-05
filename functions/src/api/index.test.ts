import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CentralError } from '../centrals/model';
import { staticConfigSource } from '../points/config';
import { API_ROUTES, createApiHandler } from './index';
import type { ApiRequest, ApiRoute } from './types';

// O vi.mock sobe para antes dos imports: o logger acima já é o falso.
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const NOW = Date.parse('2026-10-05T15:00:00.000Z');

// Firestore falso: toda carteira lida não existe.
const emptyDb = {
  collection: () => ({
    doc: () => ({ get: async () => ({ data: () => undefined }) }),
  }),
} as unknown as Firestore;

const auth = {
  verifyIdToken: vi.fn(async (token: string) => {
    if (token === 'token-da-camila') return { uid: 'uid-camila' } as never;
    throw Object.assign(new Error('Decoding Firebase ID token failed.'), {
      code: 'auth/argument-error',
    });
  }),
};

function request(
  method: string,
  path: string,
  extra: Partial<ApiRequest> & { headers?: Record<string, string> } = {},
): ApiRequest {
  const headers = Object.fromEntries(
    Object.entries({ Authorization: 'Bearer token-da-camila', ...extra.headers }).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  return {
    method,
    path,
    get: (name) => headers[name.toLowerCase()],
    query: extra.query ?? {},
    body: extra.body,
    rawBody: extra.rawBody,
  };
}

function response() {
  const sent: { status: number; headers: Record<string, string>; body: unknown } = {
    status: 0,
    headers: {},
    body: undefined,
  };
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    set(field: string, value: string) {
      sent.headers[field] = value;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
    },
  };
  return { res, sent };
}

async function call(req: ApiRequest, routes: readonly ApiRoute[] = API_ROUTES) {
  const handler = createApiHandler(
    { db: emptyDb, auth, now: () => NOW, random: () => 0, config: staticConfigSource() },
    routes,
  );
  const { res, sent } = response();
  await handler(req, res);
  return sent;
}

beforeEach(() => vi.clearAllMocks());

describe('formato da resposta e dos erros', () => {
  it('carteira que não existe responde zerada, sem envelope e sem cache', async () => {
    const sent = await call(request('GET', '/me/wallet'));
    expect(sent).toEqual({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { balance: 0, xp: 0, seasonPoints: 0 },
    });
    expect(logger.info).toHaveBeenCalledWith('api', {
      method: 'GET',
      route: 'GET /me/wallet',
      status: 200,
      ms: expect.any(Number),
      uid: 'uid-camila',
      replayed: false,
    });
  });

  it('progresso de quem não tem carteira: nível 1, próximo 2, semana e números zerados', async () => {
    const sent = await call(request('GET', '/me/progress/'));
    expect(sent.body).toEqual({
      xp: 0,
      level: { number: 1, name: 'Primeiro passo', minXp: 0 },
      nextLevel: { number: 2, name: 'Na roda', minXp: 600 },
      weekEarned: 0,
      stats: { linksCreated: 0, peopleBrought: 0, seasons: 0 },
    });
  });

  it('rota que não existe: 404 not_found no formato combinado', async () => {
    const sent = await call(request('GET', '/me/carteira'));
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ code: 'not_found', message: 'Não encontrado.' });
    expect(sent.headers['Cache-Control']).toBe('no-store');
  });

  it('método errado: 405 com os métodos aceitos', async () => {
    const sent = await call(request('POST', '/me/wallet'));
    expect(sent.status).toBe(405);
    expect(sent.body).toMatchObject({ code: 'method_not_allowed' });
    expect(sent.headers.Allow).toBe('GET');
  });

  it('sem token ou com token inválido: 401 unauthenticated', async () => {
    for (const header of [undefined, 'Bearer', 'Basic abc', 'Bearer token-falso']) {
      const req = request('GET', '/me/wallet');
      const get = req.get;
      req.get = (name) => (name.toLowerCase() === 'authorization' ? header : get(name));
      const sent = await call(req);
      expect(sent.status).toBe(401);
      expect(sent.body).toEqual({
        code: 'unauthenticated',
        message: 'Entre na sua conta para continuar.',
      });
    }
  });

  it('corpo acima de 16 KiB: 413 antes de olhar o token', async () => {
    const sent = await call(
      request('GET', '/me/wallet', {
        rawBody: Buffer.alloc(16 * 1024 + 1),
        headers: { Authorization: 'Bearer token-falso' },
      }),
    );
    expect(sent.status).toBe(413);
    expect(sent.body).toMatchObject({ code: 'payload_too_large' });
  });

  it('extrato com limite ou cursor fora do formato: 400 invalid_request', async () => {
    for (const query of [
      { limit: '0' },
      { limit: '51' },
      { limit: 'dez' },
      { limit: ['1', '2'] },
      { cursor: '!!!' },
      // Decodifica, mas o instante passa do que o Timestamp do Firestore aceita.
      { cursor: Buffer.from('[100000000000000000000,"mission:m1"]').toString('base64url') },
      // O id não é de lançamento (`<origem>:<evento>`).
      { cursor: Buffer.from('[1791000000000,"sem-origem"]').toString('base64url') },
    ]) {
      const sent = await call(request('GET', '/me/ledger', { query }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request' });
    }
  });

  it('id com barra codificada: 400', async () => {
    const routes: ApiRoute[] = [
      { method: 'GET', pattern: '/posts/:postId', writes: false, handle: async () => ({}) },
    ];
    const sent = await call(request('GET', '/posts/a%2Fb'), routes);
    expect(sent.status).toBe(400);
  });

  it('rota que grava sem Idempotency-Key: 400 idempotency_key_required', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'PUT',
        pattern: '/posts/:postId/like',
        writes: true,
        handle: async () => ({ body: { pointsAwarded: 0 } }),
      },
    ];
    const sent = await call(request('PUT', '/posts/p1/like'), routes);
    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({
      code: 'idempotency_key_required',
      message: 'Falta a chave de idempotência.',
    });
  });

  it('erro inesperado: 500 internal, com a rota e o uid no log, nunca o token', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/quebra',
        writes: false,
        handle: async () => {
          throw new Error('banco fora');
        },
      },
    ];
    const sent = await call(request('GET', '/quebra'), routes);
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ code: 'internal', message: 'Algo deu errado. Tente de novo.' });
    expect(logger.error).toHaveBeenCalledWith('api: erro inesperado', {
      route: 'GET /quebra',
      uid: 'uid-camila',
      error: 'banco fora',
    });
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('token-da-camila');
  });

  it('disputa que sobrou das tentativas: 503 unavailable com Retry-After', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/disputa',
        writes: false,
        handle: async () => {
          throw Object.assign(new Error('aborted'), { code: 10 });
        },
      },
    ];
    const sent = await call(request('GET', '/disputa'), routes);
    expect(sent.status).toBe(503);
    expect(sent.body).toMatchObject({ code: 'unavailable' });
    expect(sent.headers['Retry-After']).toBe('1');
  });

  // Os formatos que o verifyIdToken do firebase-admin 14 lança quando a busca
  // das chaves públicas do Google falha (mapJwtErrorToAuthError) e no erro interno.
  it.each([
    [
      'resposta do Google',
      'auth/argument-error',
      'Error fetching public keys for Google certs: backendError (Service Unavailable)',
    ],
    [
      'rede',
      'auth/argument-error',
      'Error while making request: getaddrinfo ENOTFOUND www.googleapis.com. Error code: ENOTFOUND',
    ],
    ['erro interno do Auth', 'auth/internal-error', 'Internal error.'],
  ])(
    'falha ao conferir o token (%s): 503 unavailable com Retry-After, não 401',
    async (_case, code, message) => {
      auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error(message), { code }));
      const sent = await call(request('GET', '/me/wallet'));
      expect(sent.status).toBe(503);
      expect(sent.body).toEqual({
        code: 'unavailable',
        message: 'Serviço ocupado. Tente de novo.',
      });
      expect(sent.headers['Retry-After']).toBe('1');
    },
  );

  it('token com assinatura inválida ou vencido segue 401', async () => {
    for (const [code, message] of [
      ['auth/argument-error', 'Firebase ID token has invalid signature.'],
      ['auth/id-token-expired', 'Firebase ID token has expired.'],
    ]) {
      auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error(message), { code }));
      const sent = await call(request('GET', '/me/wallet'));
      expect(sent.status).toBe(401);
      expect(sent.body).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('erro que não é do Auth (a rede do emulador) sobe como 500', async () => {
    auth.verifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Error while making request: socket hang up.'), {
        code: 'app/network-error',
      }),
    );
    const sent = await call(request('GET', '/me/wallet'));
    expect(sent.status).toBe(500);
  });
});

describe('centrais (bloco 4)', () => {
  it('central que não existe: 404 artist_not_found no formato combinado, com os ids', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/teste/central',
        writes: false,
        handle: async () => {
          throw new CentralError('artist_not_found', { artistIds: ['artista7'] });
        },
      },
    ];
    const sent = await call(request('GET', '/teste/central'), routes);
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({
      code: 'artist_not_found',
      message: 'Central não encontrada.',
      details: { artistIds: ['artista7'] },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('entradas demais no dia: 429 too_many_requests com o teto e o Retry-After', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/teste/teto',
        writes: false,
        handle: async () => {
          throw new CentralError('too_many_entries', { limit: 30 }, 3600);
        },
      },
    ];
    const sent = await call(request('GET', '/teste/teto'), routes);
    expect(sent.status).toBe(429);
    expect(sent.body).toEqual({
      code: 'too_many_requests',
      message: 'Tentativas demais por hoje. Tente amanhã.',
      details: { limit: 30 },
    });
    expect(sent.headers['Retry-After']).toBe('3600');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/artists/Netto-Brito'],
    ['GET', '/artists/__trio__'],
    ['PUT', '/me/centrals/ab'],
    ['DELETE', '/me/centrals/net%C3%B6'],
  ])('id fora do formato do @ em %s %s: 404 artist_not_found', async (method, path) => {
    const sent = await call(
      request(method, path, { headers: { 'Idempotency-Key': 'chave-central-1' } }),
    );
    expect(sent.status).toBe(404);
    expect(sent.body).toEqual({ code: 'artist_not_found', message: 'Central não encontrada.' });
  });

  it('seguir com o corpo fora do formato: 400 com o campo', async () => {
    for (const body of [{ artistIds: [] }, { artistIds: ['nenho', 'nenho'] }, null]) {
      const sent = await call(
        request('POST', '/me/artists', { body, headers: { 'Idempotency-Key': 'chave-seguir-1' } }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'artistIds' } });
    }
  });

  it('as três que gravam exigem a Idempotency-Key', async () => {
    for (const [method, path] of [
      ['POST', '/me/artists'],
      ['PUT', '/me/centrals/nenho'],
      ['DELETE', '/me/centrals/nenho'],
    ] as const) {
      const sent = await call(request(method, path, { body: { artistIds: ['nenho'] } }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
    }
  });

  it('GET /me/centrals/nenho: 405 com PUT e DELETE', async () => {
    const sent = await call(request('GET', '/me/centrals/nenho'));
    expect(sent.status).toBe(405);
    expect(sent.headers.Allow).toBe('PUT, DELETE');
  });
});
