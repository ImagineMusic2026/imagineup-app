import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgendaError } from '../agenda/model';
import { CentralError } from '../centrals/model';
import { InviteError } from '../invites/model';
import { ProfileEditError } from '../fan-profile/model';
import { DailyCapError, ModerationError } from '../moderation/model';
import { staticConfigSource } from '../points/config';
import { PostError } from '../posts/model';
import { RewardError } from '../rewards/model';
import { API_ROUTES, createApiHandler } from './index';
import type { ApiRequest, ApiRoute } from './types';

// O vi.mock sobe para antes dos imports: o logger acima já é o falso.
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const NOW = Date.parse('2026-10-05T15:00:00.000Z');

// Firestore falso: toda carteira lida não existe, e toda contagem dá 0 (os
// links e as pessoas trazidas do convite, no /me/progress).
const zeroCount = { count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }) };
const emptyDb = {
  collection: () => ({
    doc: () => ({
      get: async () => ({ data: () => undefined }),
      collection: () => zeroCount,
    }),
    where: () => zeroCount,
  }),
} as unknown as Firestore;

const auth = {
  verifyIdToken: vi.fn(async (token: string) => {
    if (token === 'token-da-camila') {
      return { uid: 'uid-camila', email: 'camila@teste.imagineup' } as never;
    }
    if (token === 'token-sem-email') return { uid: 'uid-sem-email' } as never;
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
      body: { balance: 0, xp: 0, seasonPoints: 0, updatedAt: null },
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

describe('convite (bloco 5)', () => {
  it('InviteError: 404 invite_not_found e 409 invite_not_allowed com o motivo', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/teste/sem-convite',
        writes: false,
        handle: async () => {
          throw new InviteError('invite_not_found');
        },
      },
      {
        method: 'GET',
        pattern: '/teste/autoconvite',
        writes: false,
        handle: async () => {
          throw new InviteError('invite_not_allowed', { reason: 'self' });
        },
      },
    ];
    const missing = await call(request('GET', '/teste/sem-convite'), routes);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ code: 'invite_not_found', message: 'Convite não encontrado.' });
    const self = await call(request('GET', '/teste/autoconvite'), routes);
    expect(self.status).toBe(409);
    expect(self.body).toEqual({
      code: 'invite_not_allowed',
      message: 'Este convite não vale para esta conta.',
      details: { reason: 'self' },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('linkId fora do formato: 400 com o campo, antes de abrir a transação', async () => {
    for (const linkId of ['convite', 'artist%3A__trio__', 'post%3A']) {
      const sent = await call(
        request('PUT', `/me/invite/links/${linkId}`, {
          headers: { 'Idempotency-Key': 'chave-link-0001' },
        }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'linkId' } });
    }
  });

  it('claim e visita com o corpo fora do formato: 400 com o campo', async () => {
    const claim = await call(
      request('POST', '/invites/claim', {
        body: { code: 'K7P3M9QX', via: 'install', link: { path: '/' } },
        headers: { 'Idempotency-Key': 'invite-K7P3M9QX-2026' },
      }),
    );
    expect(claim.status).toBe(400);
    expect(claim.body).toMatchObject({ code: 'invalid_request', details: { field: 'via' } });
    const visit = await call(
      request('POST', '/invites/visit', {
        body: { code: 'K7P3M9QX' },
        headers: { 'Idempotency-Key': 'visit-K7P3M9QX-2026' },
      }),
    );
    expect(visit.status).toBe(400);
    expect(visit.body).toMatchObject({ code: 'invalid_request', details: { field: 'link' } });
  });

  it('as três que gravam exigem a Idempotency-Key', async () => {
    for (const [method, path] of [
      ['POST', '/invites/claim'],
      ['POST', '/invites/visit'],
      ['PUT', '/me/invite/links/invite'],
    ] as const) {
      const sent = await call(request(method, path, { body: { code: 'K7P3M9QX' } }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
    }
  });

  it('o e-mail do contexto vem do token, nunca do corpo; o segredo vem das dependências', async () => {
    const seen: unknown[] = [];
    const routes: ApiRoute[] = [
      {
        method: 'POST',
        pattern: '/teste/quem',
        writes: false,
        handle: async ({ email, deps }) => {
          seen.push({ email, key: deps.inviteKey() });
          return { ok: true };
        },
      },
    ];
    const handler = createApiHandler(
      {
        db: emptyDb,
        auth,
        now: () => NOW,
        config: staticConfigSource(),
        inviteKey: () => 'segredo-fixo',
      },
      routes,
    );
    for (const token of ['token-da-camila', 'token-sem-email']) {
      const { res } = response();
      await handler(
        request('POST', '/teste/quem', {
          body: { email: 'falso@x.com' },
          headers: { Authorization: `Bearer ${token}` },
        }),
        res,
      );
    }
    expect(seen).toEqual([
      { email: 'camila@teste.imagineup', key: 'segredo-fixo' },
      { email: null, key: 'segredo-fixo' },
    ]);
  });

  it('sem o segredo nas dependências, a rota do convite falha com 500 e as outras seguem', async () => {
    const routes: ApiRoute[] = [
      ...API_ROUTES,
      {
        method: 'GET',
        pattern: '/teste/segredo',
        writes: false,
        handle: async ({ deps }) => ({ key: deps.inviteKey() }),
      },
    ];
    const failed = await call(request('GET', '/teste/segredo'), routes);
    expect(failed.status).toBe(500);
    expect((await call(request('GET', '/me/wallet'), routes)).status).toBe(200);
  });
});

describe('mural, agenda e moderação (bloco 6)', () => {
  const thrower = (error: unknown): ApiRoute[] => [
    {
      method: 'GET',
      pattern: '/teste/bloco6',
      writes: false,
      handle: async () => {
        throw error;
      },
    },
  ];

  it.each([
    [
      new PostError('post_not_found'),
      404,
      { code: 'post_not_found', message: 'Post não encontrado.' },
    ],
    [
      new PostError('comment_invalid', { reason: 'invisible' }),
      400,
      {
        code: 'comment_invalid',
        message: 'Comentário vazio, longo demais ou com caracteres invisíveis.',
        details: { reason: 'invisible' },
      },
    ],
    [
      new AgendaError('event_not_found', { reason: 'ended' }),
      404,
      { code: 'event_not_found', message: 'Show não encontrado.', details: { reason: 'ended' } },
    ],
    [
      new ModerationError('comment_not_found'),
      404,
      { code: 'comment_not_found', message: 'Comentário não encontrado.' },
    ],
    [
      new ModerationError('fan_not_found'),
      404,
      { code: 'fan_not_found', message: 'Fã não encontrado.' },
    ],
    [
      new ModerationError('block_list_full'),
      409,
      { code: 'block_list_full', message: 'Você chegou ao limite de fãs bloqueados.' },
    ],
    [
      new ModerationError('own_comment'),
      400,
      { code: 'invalid_request', message: 'Pedido inválido.', details: { reason: 'own_comment' } },
    ],
    [
      new ModerationError('self'),
      400,
      { code: 'invalid_request', message: 'Pedido inválido.', details: { reason: 'self' } },
    ],
  ])('%s vira o código combinado', async (error, status, body) => {
    const sent = await call(request('GET', '/teste/bloco6'), thrower(error));
    expect(sent.status).toBe(status);
    expect(sent.body).toEqual(body);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('teto do dia: 429 too_many_requests com o teto, a ação e o Retry-After', async () => {
    const sent = await call(
      request('GET', '/teste/bloco6'),
      thrower(new DailyCapError('like', 300, 1800)),
    );
    expect(sent.status).toBe(429);
    expect(sent.body).toEqual({
      code: 'too_many_requests',
      message: 'Tentativas demais por hoje. Tente amanhã.',
      details: { limit: 300, action: 'like' },
    });
    expect(sent.headers['Retry-After']).toBe('1800');
  });

  it.each([
    ['GET', '/posts/__x__', 'post_not_found'],
    ['GET', '/posts/p.clipe/comments', 'post_not_found'],
    ['PUT', '/posts/p%20clipe/like', 'post_not_found'],
    ['POST', '/posts/p-clipe/comments/c.1/report', 'comment_not_found'],
    ['PUT', '/events/sao.joao/rsvp', 'event_not_found'],
    ['PUT', '/me/blocks/uid-com-hifen', 'fan_not_found'],
    ['GET', '/artists/Netto/posts', 'artist_not_found'],
  ])('id fora do formato em %s %s: o 404 do recurso', async (method, path, code) => {
    const sent = await call(
      request(method, path, { headers: { 'Idempotency-Key': 'chave-bloco-6-1' }, body: {} }),
    );
    expect(sent.status).toBe(404);
    expect(sent.body).toMatchObject({ code });
  });

  it('limite e cursor fora do formato: 400 com o campo', async () => {
    for (const [query, field] of [
      [{ limit: '0' }, 'limit'],
      [{ limit: '51' }, 'limit'],
      [{ limit: 'dez' }, 'limit'],
      [{ cursor: 'não é cursor' }, 'cursor'],
      [{ cursor: Buffer.from('[1,"a/b"]').toString('base64url') }, 'cursor'],
      [{ cursor: Buffer.from('[253402300800000,"p-1"]').toString('base64url') }, 'cursor'],
    ] as const) {
      const sent = await call(request('GET', '/feed', { query }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field } });
    }
    const agenda = await call(request('GET', '/agenda', { query: { artistId: 'Netto' } }));
    expect(agenda.status).toBe(404);
    expect(agenda.body).toMatchObject({ code: 'artist_not_found' });
  });

  it('comentário inválido: 400 comment_invalid com o motivo, antes de abrir a transação', async () => {
    for (const [text, reason] of [
      ['   \n  ', 'empty'],
      ['a'.repeat(501), 'too_long'],
      ['oi\nㅤ', 'invisible'],
    ] as const) {
      const sent = await call(
        request('POST', '/posts/p-clipe/comments', {
          body: { text },
          headers: { 'Idempotency-Key': 'chave-comentario-1' },
        }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'comment_invalid', details: { reason } });
    }
    const notText = await call(
      request('POST', '/posts/p-clipe/comments', {
        body: { text: 42 },
        headers: { 'Idempotency-Key': 'chave-comentario-2' },
      }),
    );
    expect(notText.body).toMatchObject({ code: 'invalid_request', details: { field: 'text' } });
  });

  it('denúncia com motivo fora da lista: 400 com o campo', async () => {
    const sent = await call(
      request('POST', '/posts/p-clipe/comments/seed-c-1/report', {
        body: { reason: 'chato' },
        headers: { 'Idempotency-Key': 'chave-denuncia-1' },
      }),
    );
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'reason' } });
  });

  it('as que gravam exigem a Idempotency-Key', async () => {
    for (const [method, path] of [
      ['POST', '/posts/p-clipe/comments'],
      ['PUT', '/posts/p-clipe/like'],
      ['DELETE', '/posts/p-clipe/like'],
      ['POST', '/posts/p-clipe/comments/c1/report'],
      ['PUT', '/me/blocks/uidEnzo'],
      ['DELETE', '/me/blocks/uidEnzo'],
      ['PUT', '/events/sao-joao-irara/rsvp'],
      ['DELETE', '/events/sao-joao-irara/rsvp'],
    ] as const) {
      const sent = await call(request(method, path, { body: { text: 'oi' } }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
    }
  });
});

describe('missões e conquistas (bloco 7)', () => {
  it('fã sem carteira e catálogo vazio: sem meta, sem missões e sem missão do dia', async () => {
    const list = await call(request('GET', '/missions'));
    expect(list).toMatchObject({ status: 200, body: { season: null, missions: [] } });
    const daily = await call(request('GET', '/missions/daily'));
    expect(daily).toMatchObject({ status: 200, body: { mission: null } });
  });

  it('as conquistas do fã novo: 0 de 10 (o Top 20 no ar, bloco 8), com a de nível seguinte primeiro', async () => {
    const sent = await call(request('GET', '/me/achievements'));
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ unlockedCount: 0, totalCount: 10 });
    expect(
      (sent.body as { highlights: { id: string }[] }).highlights.map((item) => item.id),
    ).toEqual(['pe-de-serra', 'boca-a-boca', 'fa-de-show', 'missao-cumprida']);
  });

  it('as rotas novas só leem: sem Idempotency-Key e sem perfil', async () => {
    const sent = await call(
      request('GET', '/missions', { headers: { Authorization: 'Bearer token-sem-email' } }),
    );
    expect(sent.status).toBe(200);
  });
});

describe('ranking (bloco 8)', () => {
  it('cursor fora do formato: 400 com o campo; central fora do formato: 404 sem ler nada', async () => {
    const reads = vi.fn();
    const watchingDb = new Proxy(emptyDb, {
      get(target, prop, receiver) {
        reads(prop);
        return Reflect.get(target, prop, receiver);
      },
    });
    const handler = createApiHandler({
      db: watchingDb,
      auth,
      now: () => NOW,
      random: () => 0,
      config: staticConfigSource(),
    });
    for (const cursor of [
      'não é cursor',
      Buffer.from('[0,1,"uid",1]').toString('base64url'),
      Buffer.from('[10,1,"uid/x",1]').toString('base64url'),
      Buffer.from('[10,1,"uid",0]').toString('base64url'),
    ]) {
      const { res, sent } = response();
      await handler(request('GET', '/ranking', { query: { cursor } }), res);
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'cursor' } });
    }
    for (const path of ['/ranking', '/me/rank']) {
      for (const artistId of ['Netto', '__nenho__', 'a']) {
        const { res, sent } = response();
        await handler(request('GET', path, { query: { artistId } }), res);
        expect(sent.status).toBe(404);
        expect(sent.body).toMatchObject({ code: 'artist_not_found' });
      }
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it('sem temporada: a temporada é null, o ranking vazio e o fã sem posição', async () => {
    expect((await call(request('GET', '/ranking/season'))).body).toEqual({ season: null });
    expect((await call(request('GET', '/ranking'))).body).toEqual({ items: [], nextCursor: null });
    expect((await call(request('GET', '/me/rank'))).body).toEqual({
      position: null,
      points: 0,
      target: null,
    });
  });
});

describe('perfil editável (bloco 9)', () => {
  const thrower = (error: unknown): ApiRoute[] => [
    {
      method: 'GET',
      pattern: '/teste/bloco9',
      writes: false,
      handle: async () => {
        throw error;
      },
    },
  ];

  it.each([
    [
      new ProfileEditError('username_invalid', { reason: 'reserved' }),
      400,
      {
        code: 'username_invalid',
        message: 'Este @ não vale. Use de 3 a 20 letras minúsculas e números.',
        details: { reason: 'reserved' },
      },
    ],
    [
      new ProfileEditError('photo_invalid', { reason: 'dimensions' }),
      400,
      {
        code: 'photo_invalid',
        message: 'Foto fora do formato. Escolha outra.',
        details: { reason: 'dimensions' },
      },
    ],
    [
      new ProfileEditError('photo_not_found'),
      404,
      { code: 'photo_not_found', message: 'Foto não encontrada. Envie de novo.' },
    ],
    [
      new ProfileEditError('username_taken'),
      409,
      { code: 'username_taken', message: 'Este @ já tem dono.' },
    ],
    [
      new ProfileEditError('username_change_too_soon', {
        changeableAt: '2026-11-06T15:00:00.000Z',
      }),
      409,
      {
        code: 'username_change_too_soon',
        message: 'Você trocou o @ há pouco. Tente de novo mais tarde.',
        details: { changeableAt: '2026-11-06T15:00:00.000Z' },
      },
    ],
  ])('%s vira o código combinado', async (error, status, body) => {
    const sent = await call(request('GET', '/teste/bloco9'), thrower(error));
    expect(sent.status).toBe(status);
    expect(sent.body).toEqual(body);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('teto das trocas de foto: 429 com a ação photo', async () => {
    const sent = await call(
      request('GET', '/teste/bloco9'),
      thrower(new DailyCapError('photo', 10, 600)),
    );
    expect(sent.status).toBe(429);
    expect(sent.body).toMatchObject({ details: { limit: 10, action: 'photo' } });
    expect(sent.headers['Retry-After']).toBe('600');
  });

  it('disponibilidade: o username é obrigatório, texto de até 64; fora do formato é invalid sem ler', async () => {
    for (const query of [{}, { username: ['a', 'b'] }, { username: 'a'.repeat(65) }]) {
      const sent = await call(request('GET', '/me/username/availability', { query }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'username' } });
    }
    const sent = await call(
      request('GET', '/me/username/availability', { query: { username: ' @Camila_Rib ' } }),
    );
    expect(sent).toMatchObject({
      status: 200,
      body: { username: 'camila_rib', status: 'invalid' },
    });
  });

  it('PUT /me/username e PUT /me/photo conferem o corpo antes de abrir a transação', async () => {
    const key = { 'Idempotency-Key': 'chave-0001' };
    const cases: [string, unknown, number, Record<string, unknown>][] = [
      [
        '/me/username',
        { username: 'ab' },
        400,
        { code: 'username_invalid', details: { reason: 'format' } },
      ],
      ['/me/username', { username: 'camila.rib' }, 400, { code: 'username_invalid' }],
      [
        '/me/username',
        'camilarib',
        400,
        { code: 'invalid_request', details: { field: 'username' } },
      ],
      ['/me/username', { username: 7 }, 400, { code: 'invalid_request' }],
      [
        '/me/photo',
        { path: 'fans/uid/avatar.jpg' },
        400,
        { code: 'photo_invalid', details: { reason: 'path' } },
      ],
      ['/me/photo', { path: 'artists/nenho/photo-abcdefgh.jpg' }, 400, { code: 'photo_invalid' }],
      ['/me/photo', {}, 400, { code: 'invalid_request', details: { field: 'path' } }],
    ];
    for (const [path, body, status, expected] of cases) {
      const sent = await call(request('PUT', path, { body, headers: key }));
      expect(sent.status).toBe(status);
      expect(sent.body).toMatchObject(expected);
    }
  });

  it('as três que gravam exigem a Idempotency-Key', async () => {
    for (const [method, path, body] of [
      ['PUT', '/me/username', { username: 'camilaribeiro' }],
      ['PUT', '/me/photo', { path: 'fans/uidCamila/photo-abcdefgh.jpg' }],
      ['DELETE', '/me/photo', undefined],
    ] as const) {
      const sent = await call(request(method, path, { body }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
    }
  });

  it('sem files nas dependências, só as rotas da foto falham com 500', async () => {
    // Firestore falso com transação: o perfil existe, sem foto, e nada mais.
    const profileOnly = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          path: `${name}/${id}`,
          id,
          collection: (sub: string) => ({
            doc: (other: string) => ({ path: `${name}/${id}/${sub}/${other}` }),
          }),
          get: async () => ({ data: () => undefined }),
        }),
      }),
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          getAll: async (...refs: { path: string }[]) =>
            refs.map((ref) => {
              const exists = ref.path === 'users/uidCamila';
              return {
                exists,
                data: () => (exists ? { displayName: 'Camila' } : undefined),
                get: (field: string) => (exists && field === 'displayName' ? 'Camila' : undefined),
              };
            }),
          get: async () => ({ exists: false, data: () => undefined, get: () => undefined }),
          create: vi.fn(),
          set: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        }),
    } as unknown as Firestore;
    const camila = { verifyIdToken: vi.fn(async () => ({ uid: 'uidCamila' }) as never) };
    const handler = createApiHandler({
      db: profileOnly,
      auth: camila,
      now: () => NOW,
      random: () => 0,
      config: staticConfigSource(),
    });
    const send = async (method: string, path: string, body?: unknown) => {
      const { res, sent } = response();
      await handler(
        request(method, path, { body, headers: { 'Idempotency-Key': `chave-${method}-0001` } }),
        res,
      );
      return sent;
    };
    // O caminho é de outro uid: recusa antes de olhar o Storage.
    const other = await send('PUT', '/me/photo', { path: 'fans/uidOutro/photo-abcdefgh.jpg' });
    expect(other.status).toBe(400);
    expect(other.body).toMatchObject({ code: 'photo_invalid', details: { reason: 'path' } });
    expect(logger.error).not.toHaveBeenCalled();
    // O da pasta dela chega ao Storage, que falta: 500, com o log.
    const own = await send('PUT', '/me/photo', { path: 'fans/uidCamila/photo-abcdefgh.jpg' });
    expect(own.status).toBe(500);
    expect(logger.error).toHaveBeenCalledOnce();
    // Sem foto, remover responde sem tocar no Storage; as leituras seguem.
    expect(await send('DELETE', '/me/photo')).toMatchObject({
      status: 200,
      body: { photoURL: null },
    });
    expect((await send('GET', '/me/wallet')).status).toBe(200);
  });
});

describe('loja e resgate (bloco 10)', () => {
  const thrower = (error: unknown): ApiRoute[] => [
    {
      method: 'GET',
      pattern: '/teste/bloco10',
      writes: false,
      handle: async () => {
        throw error;
      },
    },
  ];

  const cases: [RewardError, number, Record<string, unknown>][] = [
    [
      new RewardError('reward_not_found'),
      404,
      { code: 'reward_not_found', message: 'Recompensa não encontrada.' },
    ],
    ...(['closed', 'stock', 'event'] as const).map(
      (reason): [RewardError, number, Record<string, unknown>] => [
        new RewardError('sold_out', { reason }),
        409,
        { code: 'sold_out', message: 'Recompensa esgotada.', details: { reason } },
      ],
    ),
    [
      new RewardError('redeem_limit_reached', { limit: 1 }),
      409,
      {
        code: 'redeem_limit_reached',
        message: 'Você chegou ao limite de resgates desta recompensa.',
        details: { limit: 1 },
      },
    ],
    [
      new RewardError('reward_changed', { cost: 7_000 }),
      409,
      {
        code: 'reward_changed',
        message: 'O custo desta recompensa mudou. Confira antes de resgatar.',
        details: { cost: 7_000 },
      },
    ],
  ];

  it.each(cases)('%s vira o código combinado', async (error, status, body) => {
    const sent = await call(request('GET', '/teste/bloco10'), thrower(error));
    expect(sent.status).toBe(status);
    expect(sent.body).toEqual(body);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('teto dos resgates: 429 com a ação redeem e o Retry-After', async () => {
    const sent = await call(
      request('GET', '/teste/bloco10'),
      thrower(new DailyCapError('redeem', 10, 3600)),
    );
    expect(sent.status).toBe(429);
    expect(sent.body).toEqual({
      code: 'too_many_requests',
      message: 'Tentativas demais por hoje. Tente amanhã.',
      details: { limit: 10, action: 'redeem' },
    });
    expect(sent.headers['Retry-After']).toBe('3600');
  });

  it('corpo sem expectedCost, ou fora do formato: 400 com o campo, antes de abrir a transação', async () => {
    for (const body of [undefined, {}, { expectedCost: 0 }, { expectedCost: '6000' }, [6_000]]) {
      const sent = await call(
        request('POST', '/rewards/camisa/redeem', {
          headers: { 'Idempotency-Key': 'chave-resgate-1' },
          body,
        }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({
        code: 'invalid_request',
        details: { field: 'expectedCost' },
      });
    }
  });

  it('id fora do formato: 404 reward_not_found, sem ler nada', async () => {
    for (const path of ['/rewards/__x__/redeem', '/rewards/meet.netto/redeem']) {
      const sent = await call(
        request('POST', path, {
          headers: { 'Idempotency-Key': 'chave-resgate-1' },
          body: { expectedCost: 10_000 },
        }),
      );
      expect(sent.status).toBe(404);
      expect(sent.body).toEqual({
        code: 'reward_not_found',
        message: 'Recompensa não encontrada.',
      });
    }
  });

  it('o resgate exige a Idempotency-Key; a loja só lê', async () => {
    const redeem = await call(
      request('POST', '/rewards/camisa/redeem', { body: { expectedCost: 15_000 } }),
    );
    expect(redeem.status).toBe(400);
    expect(redeem.body).toMatchObject({ code: 'idempotency_key_required' });
    const wrong = await call(request('GET', '/rewards/camisa/redeem'));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.Allow).toBe('POST');
  });
});

describe('suspensão do fã (bloco 11)', () => {
  it('as rotas que gravam e aceitam o suspenso são só as de desfazer e de segurança', () => {
    const allowed = API_ROUTES.filter((route) => route.writes && route.allowSuspended).map(
      (route) => `${route.method} ${route.pattern}`,
    );
    expect(allowed.sort()).toEqual(
      [
        'DELETE /me/centrals/:artistId',
        'DELETE /posts/:postId/like',
        'DELETE /events/:eventId/rsvp',
        'DELETE /me/photo',
        'PUT /me/blocks/:fanId',
        'DELETE /me/blocks/:fanId',
      ].sort(),
    );
    // Toda rota que lê ignora a trava (ela mora no runIdempotent).
    expect(API_ROUTES.filter((route) => !route.writes && 'allowSuspended' in route)).toEqual([]);
  });

  it('o código do suspenso sem código novo: 403 account_suspended no formato combinado', async () => {
    const routes: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/teste/suspenso',
        writes: false,
        handle: async () => {
          throw new InviteError('account_suspended');
        },
      },
    ];
    const sent = await call(request('GET', '/teste/suspenso'), routes);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({
      code: 'account_suspended',
      message: 'Sua conta está suspensa. Fale com a equipe do ImagineUP.',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
