import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgendaError } from '../agenda/model';
import { CentralError } from '../centrals/model';
import { FAN_CLUB_PRIZE_NOTICE, FanClubError } from '../fan-clubs/model';
import { InviteError } from '../invites/model';
import { ProfileEditError } from '../fan-profile/model';
import { DailyCapError, ModerationError } from '../moderation/model';
import { staticConfigSource } from '../points/config';
import { PostError } from '../posts/model';
import { RewardError } from '../rewards/model';
import {
  API_ROUTES,
  APP_CHECK_MODE,
  apiError,
  createApiHandler,
  createRateLimiter,
  HEALTH_BODY,
} from './index';
import type { ApiDeps, ApiRequest, ApiRoute } from './types';

// O vi.mock sobe para antes dos imports: o logger acima já é o falso.
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

// O filtro do que o fã publica (seção 30) trocado por um de palavras neutras:
// nenhum termo da lista de verdade entra no repositório (30.11).
vi.mock('../content-filter', async (importOriginal) => {
  const { fakeContentFilter } = await import('../../test/content-filter-fake.js');
  return fakeContentFilter(await importOriginal());
});

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
  // O perfil público lê o alvo e a lista de quem pede num getAll (seção 29).
  getAll: async (...refs: unknown[]) =>
    refs.map(() => ({ exists: false, data: () => undefined, get: () => undefined })),
} as unknown as Firestore;

// Firestore que lança na primeira leitura (e não tem transação): a rota que
// responde com ele não leu nada.
const noReads = {
  collection: () => {
    throw new Error('leu o Firestore');
  },
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
    ip: extra.ip,
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

async function call(
  req: ApiRequest,
  routes: readonly ApiRoute[] = API_ROUTES,
  db: Firestore = emptyDb,
) {
  const handler = createApiHandler(
    { db, auth, now: () => NOW, random: () => 0, config: staticConfigSource() },
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
      // O teto é 20 desde a proteção contra abuso (27.2).
      { limit: '21' },
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
    for (const linkId of ['convite', 'artist%3A__trio__', 'post%3A', 'fanclub%3A__clube__']) {
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
        message:
          'Comentário vazio, longo demais, com caracteres invisíveis ou fora dos Termos de uso do ImagineUP.',
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
    // A denúncia de perfil (seção 29): o próprio perfil.
    [
      new ModerationError('own_profile'),
      400,
      { code: 'invalid_request', message: 'Pedido inválido.', details: { reason: 'own_profile' } },
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
      // O teto é 20 desde a proteção contra abuso (27.2).
      [{ limit: '21' }, 'limit'],
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

describe('denúncia de perfil e lista de bloqueados (seção 29)', () => {
  /** O handler com o Firestore que lança na primeira leitura: a resposta veio sem ler. */
  async function withoutReads(req: ApiRequest) {
    const handler = createApiHandler({
      db: noReads,
      auth,
      now: () => NOW,
      random: () => 0,
      config: staticConfigSource(),
    });
    const { res, sent } = response();
    await handler(req, res);
    return sent;
  }

  const key = { 'Idempotency-Key': 'chave-denuncia-perfil-1' };

  it('POST /fans/:fanId/report com o id fora do formato: 404 fan_not_found, sem ler nada', async () => {
    for (const fanId of ['fa-rank-01', 'a'.repeat(129), 'uid%20com%20espaco']) {
      const sent = await withoutReads(
        request('POST', `/fans/${fanId}/report`, { headers: key, body: { reason: 'spam' } }),
      );
      expect(sent.status, fanId).toBe(404);
      expect(sent.body).toEqual({ code: 'fan_not_found', message: 'Fã não encontrado.' });
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('POST /fans/:fanId/report com o motivo fora da lista: 400 com o campo, sem ler nada', async () => {
    for (const body of [{ reason: 'chato' }, { reason: 1 }, 'spam', []]) {
      const sent = await withoutReads(
        request('POST', '/fans/uidPromo/report', { headers: key, body }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'reason' } });
    }
  });

  it('POST /fans/:fanId/report exige a Idempotency-Key, antes de ler', async () => {
    const sent = await withoutReads(
      request('POST', '/fans/uidPromo/report', { body: { reason: 'spam' } }),
    );
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
  });

  it('GET /me/blocks com o cursor e o limit fora do formato: 400 com o campo, sem ler nada', async () => {
    for (const [query, field] of [
      [{ limit: '0' }, 'limit'],
      [{ limit: '21' }, 'limit'],
      [{ limit: 'dez' }, 'limit'],
      [{ cursor: 'uidEnzo' }, 'cursor'],
      [{ cursor: '1000:uidEnzo' }, 'cursor'],
      [{ cursor: '-1:uidEnzo' }, 'cursor'],
      [{ cursor: '3:uid-com-hifen' }, 'cursor'],
      // O cursor das outras listas não vale aqui.
      [{ cursor: Buffer.from('[1,"p-1"]').toString('base64url') }, 'cursor'],
    ] as const) {
      const sent = await withoutReads(request('GET', '/me/blocks', { query }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field } });
    }
  });

  it('GET /me/blocks só lê: sem chave; sem lista, a página vazia', async () => {
    const sent = await call(request('GET', '/me/blocks'));
    expect(sent).toMatchObject({ status: 200, body: { items: [], nextCursor: null } });
  });

  it('a denúncia de perfil grava e não aceita o suspenso; a lista de bloqueados só lê', () => {
    const report = API_ROUTES.find(
      (route) => route.method === 'POST' && route.pattern === '/fans/:fanId/report',
    );
    expect(report).toMatchObject({ writes: true });
    expect(report && 'allowSuspended' in report).toBe(false);
    const list = API_ROUTES.find(
      (route) => route.method === 'GET' && route.pattern === '/me/blocks',
    );
    expect(list).toMatchObject({ writes: false });
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
    // O perfil novo (seção 28): o campo fora da regra, com o campo e o motivo.
    [
      new ProfileEditError('profile_invalid', { field: 'socials.x', reason: 'format' }),
      400,
      {
        code: 'profile_invalid',
        message: 'Perfil fora do formato. Confira os campos.',
        details: { field: 'socials.x', reason: 'format' },
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
    // A vaga do envio (27.4) confere o mesmo caminho, antes de abrir a transação.
    for (const [body, expected] of [
      [{ path: 'fans/uid/avatar.jpg' }, { code: 'photo_invalid', details: { reason: 'path' } }],
      [{ path: 'artists/nenho/photo-abcdefgh.jpg' }, { code: 'photo_invalid' }],
      [{}, { code: 'invalid_request', details: { field: 'path' } }],
    ] as const) {
      const sent = await call(request('POST', '/me/photo/upload', { body, headers: key }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject(expected);
    }
  });

  it('os tetos do perfil novo (seção 28): 429 com a ação name ou profile e o Retry-After', async () => {
    for (const [action, limit] of [
      ['name', 5],
      ['profile', 20],
    ] as const) {
      const sent = await call(
        request('GET', '/teste/bloco9'),
        thrower(new DailyCapError(action, limit, 600)),
      );
      expect(sent.status).toBe(429);
      expect(sent.body).toMatchObject({ code: 'too_many_requests', details: { limit, action } });
      expect(sent.headers['Retry-After']).toBe('600');
    }
  });

  it('PUT /me/profile confere o corpo antes de abrir a transação (sem leitura)', async () => {
    // Com o `noReads`, qualquer leitura (da rota ou do handler antes dela) e o
    // corpo que passasse da conferência, sem transação, dariam 500.
    const key = { 'Idempotency-Key': 'chave-perfil-0001' };
    const cases: [unknown, Record<string, unknown>][] = [
      [undefined, { code: 'invalid_request', details: { field: 'body' } }],
      [{}, { code: 'invalid_request', details: { field: 'body' } }],
      [
        { bio: 'oi', photoURL: 'x' },
        { code: 'invalid_request', details: { field: 'photoURL' } },
      ],
      [
        JSON.parse('{"__proto__": {"bio": "oi"}}'),
        { code: 'invalid_request', details: { field: '__proto__' } },
      ],
      [
        { socials: JSON.parse('{"__proto__": "x"}') },
        { code: 'invalid_request', details: { field: 'socials.__proto__' } },
      ],
      [
        { privateAccount: 'sim' },
        { code: 'invalid_request', details: { field: 'privateAccount' } },
      ],
      [
        { displayName: '   ' },
        { code: 'profile_invalid', details: { field: 'displayName', reason: 'empty' } },
      ],
      [
        { bio: 'a\nb\nc\nd\ne\nf\ng' },
        { code: 'profile_invalid', details: { field: 'bio', reason: 'too_many_lines' } },
      ],
      [
        { city: 'x'.repeat(81) },
        { code: 'profile_invalid', details: { field: 'city', reason: 'too_long' } },
      ],
      [
        { gender: 'outro' },
        { code: 'profile_invalid', details: { field: 'gender', reason: 'unknown' } },
      ],
      [
        { socials: { instagram: 'https://golpe.example/camila' } },
        { code: 'profile_invalid', details: { field: 'socials.instagram', reason: 'host' } },
      ],
      [
        { username: 'ca', bio: 'oi' },
        { code: 'username_invalid', details: { reason: 'format' } },
      ],
    ];
    for (const [body, expected] of cases) {
      const sent = await call(
        request('PUT', '/me/profile', { body, headers: key }),
        API_ROUTES,
        noReads,
      );
      expect(sent.status, JSON.stringify(body)).toBe(400);
      expect(sent.body).toMatchObject(expected);
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('GET /fans/:fanId com o id fora do formato: 404 fan_not_found, sem ler nada', async () => {
    const handler = createApiHandler({
      db: noReads,
      auth,
      now: () => NOW,
      random: () => 0,
      config: staticConfigSource(),
    });
    for (const fanId of ['fa-rank-01', 'a'.repeat(129), 'uid%20com%20espaco']) {
      const { res, sent } = response();
      await handler(request('GET', `/fans/${fanId}`), res);
      expect(sent.status, fanId).toBe(404);
      expect(sent.body).toEqual({ code: 'fan_not_found', message: 'Fã não encontrado.' });
    }
    // A barra codificada é 400, como em toda rota.
    const { res, sent } = response();
    await handler(request('GET', '/fans/a%2Fb'), res);
    expect(sent.status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('as que gravam exigem a Idempotency-Key; o perfil público só lê', async () => {
    for (const [method, path, body] of [
      ['PUT', '/me/profile', { bio: 'Feira de Santana.' }],
      ['PUT', '/me/username', { username: 'camilaribeiro' }],
      ['PUT', '/me/photo', { path: 'fans/uidCamila/photo-abcdefgh.jpg' }],
      ['POST', '/me/photo/upload', { path: 'fans/uidCamila/photo-abcdefgh.jpg' }],
      ['DELETE', '/me/photo', undefined],
    ] as const) {
      const sent = await call(request(method, path, { body }));
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
    }
    // O perfil público não pede a chave: chega à leitura (aqui, o perfil que não existe).
    const read = await call(request('GET', '/fans/uidThalita'));
    expect(read).toMatchObject({ status: 404, body: { code: 'fan_not_found' } });
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

  it('WhatsApp fora do formato (seção 35): 400 com o campo, antes de abrir a transação', async () => {
    for (const whatsapp of [null, '', '(75) 3221-4567', '(20) 99123-4567', 75991234567, ['x']]) {
      const sent = await call(
        request('POST', '/rewards/camisa/redeem', {
          headers: { 'Idempotency-Key': 'chave-resgate-1' },
          body: { expectedCost: 15_000, whatsapp },
        }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({
        code: 'invalid_request',
        details: { field: 'whatsapp' },
      });
    }
  });

  it('GET /me/contact (seção 35): o número guardado, conferido de novo, sem chave', async () => {
    const contactDb = (data: Record<string, unknown> | undefined) =>
      ({
        collection: (name: string) => ({
          doc: (uid: string) => ({
            collection: (sub: string) => ({
              doc: (id: string) => ({
                get: async () => {
                  expect([name, uid, sub, id]).toEqual(['users', 'uid-camila', 'contact', 'main']);
                  return { data: () => data };
                },
              }),
            }),
          }),
        }),
      }) as unknown as Firestore;
    const saved = await call(
      request('GET', '/me/contact'),
      API_ROUTES,
      contactDb({ whatsapp: '+5575991234567', source: 'store' }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ whatsapp: '+5575991234567' });
    for (const data of [undefined, { whatsapp: null }, { whatsapp: '(75) 99123-4567' }]) {
      const sent = await call(request('GET', '/me/contact'), API_ROUTES, contactDb(data));
      expect(sent.body).toEqual({ whatsapp: null });
    }
  });

  it('PUT /me/contact (seção 35): o corpo fora do formato é 400 com o campo, antes da transação; sem chave, 400', async () => {
    for (const body of [
      undefined,
      {},
      { whatsapp: '' },
      { whatsapp: '(75) 3221-4567' },
      { whatsapp: 75991234567 },
      [{ whatsapp: '+5575991234567' }],
    ]) {
      const sent = await call(
        request('PUT', '/me/contact', { headers: { 'Idempotency-Key': 'chave-contato-1' }, body }),
      );
      expect(sent.status).toBe(400);
      expect(sent.body).toMatchObject({ code: 'invalid_request', details: { field: 'whatsapp' } });
    }
    const keyless = await call(request('PUT', '/me/contact', { body: { whatsapp: null } }));
    expect(keyless.body).toMatchObject({ code: 'idempotency_key_required' });
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

describe('proteção contra abuso (27.3 e 27.5)', () => {
  async function callWith(req: ApiRequest, extra: Partial<ApiDeps>) {
    const handler = createApiHandler({
      db: emptyDb,
      auth,
      now: () => NOW,
      random: () => 0,
      config: staticConfigSource(),
      ...extra,
    });
    const { res, sent } = response();
    await handler(req, res);
    return sent;
  }

  it('sem ficha: 429 rate_limited com o Retry-After, sem rodar a rota; outro fã segue', async () => {
    const rateLimiter = createRateLimiter({ burst: 2, perSecond: 1 });
    for (let i = 0; i < 2; i += 1) {
      expect((await callWith(request('GET', '/me/wallet'), { rateLimiter })).status).toBe(200);
    }
    const sent = await callWith(request('GET', '/me/wallet'), { rateLimiter });
    expect(sent.status).toBe(429);
    expect(sent.headers['Retry-After']).toBe('1');
    expect(sent.body).toEqual({
      code: 'rate_limited',
      message: 'Muitos pedidos seguidos. Espere alguns segundos e tente de novo.',
    });
    const other = await callWith(
      request('GET', '/me/wallet', { headers: { Authorization: 'Bearer token-sem-email' } }),
      { rateLimiter },
    );
    expect(other.status).toBe(200);
  });

  it('o ritmo conta depois do login: o pedido sem token é 401 e não gasta ficha', async () => {
    const rateLimiter = { take: vi.fn(() => null) };
    const sent = await callWith(request('GET', '/me/wallet', { headers: { Authorization: '' } }), {
      rateLimiter,
    });
    expect(sent.status).toBe(401);
    expect(rateLimiter.take).not.toHaveBeenCalled();
  });

  it('App Check desligado não lê o cabeçalho', async () => {
    const verify = vi.fn();
    const sent = await callWith(request('GET', '/me/wallet'), {
      appCheck: { mode: 'off', verify },
    });
    expect(sent.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
  });

  it('App Check em monitor: sem token, segue com o aviso no log', async () => {
    const verify = vi.fn();
    const sent = await callWith(request('GET', '/me/wallet'), {
      appCheck: { mode: 'monitor', verify },
    });
    expect(sent.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith('api: pedido sem App Check válido', {
      problem: 'missing',
      route: 'GET /me/wallet',
    });
  });

  it('App Check exigido: sem token ou com token inválido, 403 app_check_failed; válido, segue', async () => {
    const verify = vi.fn(async (token: string) => {
      if (token !== 'token-do-aparelho') throw new Error('invalid');
    });
    const appCheck = { mode: 'enforce' as const, verify };
    const missing = await callWith(request('GET', '/me/wallet'), { appCheck });
    expect(missing.status).toBe(403);
    expect(missing.body).toMatchObject({
      code: 'app_check_failed',
      details: { reason: 'missing' },
    });
    const invalid = await callWith(
      request('GET', '/me/wallet', { headers: { 'X-Firebase-AppCheck': 'outro' } }),
      { appCheck },
    );
    expect(invalid.body).toMatchObject({
      code: 'app_check_failed',
      details: { reason: 'invalid' },
    });
    const valid = await callWith(
      request('GET', '/me/wallet', { headers: { 'X-Firebase-AppCheck': 'token-do-aparelho' } }),
      { appCheck },
    );
    expect(valid.status).toBe(200);
  });

  it('o App Check da função publicada está desligado até a build das lojas', () => {
    expect(APP_CHECK_MODE).toBe('off');
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
        // O fã-clube (seção 34): desistir da candidatura e retirar a publicação
        // são de desfazer.
        'DELETE /me/fan-club/application',
        'DELETE /me/fan-club/posts/:postId',
      ].sort(),
    );
    // Toda rota que lê ignora a trava (ela mora no runIdempotent).
    expect(API_ROUTES.filter((route) => !route.writes && 'allowSuspended' in route)).toEqual([]);
    // O perfil novo (seção 28, decisão 11): o suspenso não edita nada.
    const edit = API_ROUTES.find(
      (route) => route.method === 'PUT' && route.pattern === '/me/profile',
    );
    expect(edit).toMatchObject({ writes: true });
    expect(edit && 'allowSuspended' in edit).toBe(false);
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

describe('filtro do que o fã publica (seção 30)', () => {
  const commentKey = { 'Idempotency-Key': 'chave-filtro-comentario-1' };
  const profileKey = { 'Idempotency-Key': 'chave-filtro-perfil-0001' };

  /** A última linha `api` do log. */
  const lastLine = () => vi.mocked(logger.info).mock.calls.at(-1)?.[1] as Record<string, unknown>;

  it('o comentário barrado: 400 comment_invalid com not_allowed, sem ler nada nem abrir transação', async () => {
    // Com o `noReads` (sem `runTransaction`), qualquer leitura ou transação daria 500.
    for (const text of ['Que pepino, Netto', 'Abacaxi!', 'chuchu azedo']) {
      const sent = await call(
        request('POST', '/posts/p-clipe/comments', { body: { text }, headers: commentKey }),
        API_ROUTES,
        noReads,
      );
      expect(sent.status, text).toBe(400);
      expect(sent.body).toEqual({
        code: 'comment_invalid',
        message:
          'Comentário vazio, longo demais, com caracteres invisíveis ou fora dos Termos de uso do ImagineUP.',
        details: { reason: 'not_allowed' },
      });
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('também para o suspenso: a recusa vem antes do runIdempotent, que é quem dá o 403', async () => {
    // A transação recusa como o runIdempotent recusa o perfil suspenso.
    const runTransaction = vi.fn(async () => {
      throw apiError('account_suspended');
    });
    const suspended = {
      collection: () => ({ doc: () => ({}) }),
      runTransaction,
    } as unknown as Firestore;
    const send = (text: string) =>
      call(
        request('POST', '/posts/p-clipe/comments', { body: { text }, headers: commentKey }),
        API_ROUTES,
        suspended,
      );

    const barred = await send('Que pepino');
    expect(barred.status).toBe(400);
    expect(barred.body).toMatchObject({
      code: 'comment_invalid',
      details: { reason: 'not_allowed' },
    });
    expect(runTransaction).not.toHaveBeenCalled();

    const clean = await send('Que show');
    expect(clean.status).toBe(403);
    expect(clean.body).toMatchObject({ code: 'account_suspended' });
    expect(runTransaction).toHaveBeenCalledOnce();
  });

  it('o perfil barrado: 400 profile_invalid com o campo, sem ler nada nem abrir transação', async () => {
    for (const [body, field] of [
      [{ displayName: 'Abacaxi' }, 'displayName'],
      [{ bio: 'Fã do Netto. Que pepino.' }, 'bio'],
      [{ city: 'Altoberinjela' }, 'city'],
      [{ socials: { instagram: 'camila.pepino' } }, 'socials.instagram'],
      [{ socials: { x: 'pepino' } }, 'socials.x'],
    ] as const) {
      const sent = await call(
        request('PUT', '/me/profile', { body, headers: profileKey }),
        API_ROUTES,
        noReads,
      );
      expect(sent.status, field).toBe(400);
      expect(sent.body).toEqual({
        code: 'profile_invalid',
        message: 'Perfil fora do formato. Confira os campos.',
        details: { field, reason: 'not_allowed' },
      });
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a linha do log da recusa ganha o code e o reason, nunca o texto nem o field', async () => {
    await call(
      request('POST', '/posts/p-clipe/comments', {
        body: { text: 'Que pepino, Netto' },
        headers: commentKey,
      }),
      API_ROUTES,
      noReads,
    );
    expect(lastLine()).toEqual({
      method: 'POST',
      route: 'POST /posts/:postId/comments',
      status: 400,
      ms: expect.any(Number),
      uid: 'uid-camila',
      replayed: false,
      code: 'comment_invalid',
      reason: 'not_allowed',
    });

    await call(
      request('PUT', '/me/profile', { body: { bio: 'Que pepino' }, headers: profileKey }),
      API_ROUTES,
      noReads,
    );
    expect(lastLine()).toEqual({
      method: 'PUT',
      route: 'PUT /me/profile',
      status: 400,
      ms: expect.any(Number),
      uid: 'uid-camila',
      replayed: false,
      code: 'profile_invalid',
      reason: 'not_allowed',
    });
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).not.toContain('pepino');
    expect(logged).not.toContain('"field"');
    expect(logged).not.toContain('bio');
  });

  it('o reason só entra no formato fechado; o field e os outros detalhes nunca entram', async () => {
    const thrower = (error: unknown): ApiRoute[] => [
      {
        method: 'GET',
        pattern: '/teste/log',
        writes: false,
        handle: async () => {
          throw error;
        },
      },
    ];
    for (const [error, expected] of [
      [apiError('invalid_request', { field: 'qualquer.chave' }), { code: 'invalid_request' }],
      [
        apiError('invalid_request', { reason: 'own_profile' }),
        { code: 'invalid_request', reason: 'own_profile' },
      ],
      [apiError('invalid_request', { reason: 'Texto do fã' }), { code: 'invalid_request' }],
      [apiError('invalid_request', { reason: 'a'.repeat(41) }), { code: 'invalid_request' }],
      [apiError('invalid_request', { reason: 'not-allowed' }), { code: 'invalid_request' }],
      [apiError('invalid_request', { reason: 42 }), { code: 'invalid_request' }],
      [
        new PostError('comment_invalid', { reason: 'not_allowed' }),
        { code: 'comment_invalid', reason: 'not_allowed' },
      ],
      [new DailyCapError('comment', 100, 600), { code: 'too_many_requests' }],
      [new Error('quebrou'), { code: 'internal' }],
    ] as const) {
      await call(request('GET', '/teste/log'), thrower(error));
      expect(lastLine(), JSON.stringify(expected)).toEqual({
        method: 'GET',
        route: 'GET /teste/log',
        status: expect.any(Number),
        ms: expect.any(Number),
        uid: 'uid-camila',
        replayed: false,
        ...expected,
      });
    }
    // A rota que não existe também leva o código.
    await call(request('GET', '/nao/existe'));
    expect(lastLine()).toMatchObject({ route: 'unmatched', status: 404, code: 'not_found' });
    expect(lastLine()).not.toHaveProperty('reason');
  });

  it('a linha de sucesso não muda: só method, route, status, ms, uid e replayed', async () => {
    expect((await call(request('GET', '/me/wallet'))).status).toBe(200);
    expect(Object.keys(lastLine()).sort()).toEqual(
      ['method', 'ms', 'replayed', 'route', 'status', 'uid'].sort(),
    );
  });
});

describe('registro de acesso: a linha `acesso` (31.6)', () => {
  /** O cabeçalho forjado: o cliente escreve o primeiro item, o Google acrescenta o último. */
  const forged = { 'X-Forwarded-For': '203.0.113.7, 198.51.100.4' };
  /** O `req.ip` do Express que confia no proxy: o primeiro item, o forjado. */
  const forgedIp = '203.0.113.7';

  const messages = () => vi.mocked(logger.info).mock.calls.map(([message]) => message);
  const accessLines = () =>
    vi.mocked(logger.info).mock.calls.filter(([message]) => message === 'acesso');

  it('o 401 sem token: o último item do cabeçalho e o uid null', async () => {
    const sent = await call(
      request('GET', '/me/wallet', {
        headers: { ...forged, Authorization: '' },
        ip: forgedIp,
      }),
    );
    expect(sent.status).toBe(401);
    expect(accessLines()).toEqual([['acesso', { ip: '198.51.100.4', uid: null }]]);
  });

  it('o token inválido também sai com o uid null', async () => {
    const sent = await call(
      request('GET', '/me/wallet', {
        headers: { ...forged, Authorization: 'Bearer token-falso' },
        ip: forgedIp,
      }),
    );
    expect(sent.status).toBe(401);
    expect(accessLines()).toEqual([['acesso', { ip: '198.51.100.4', uid: null }]]);
  });

  it('com login, o uid de quem chamou; só as chaves ip e uid, sem rota nem status', async () => {
    const sent = await call(request('GET', '/me/wallet', { headers: forged, ip: forgedIp }));
    expect(sent.status).toBe(200);
    expect(accessLines()).toEqual([['acesso', { ip: '198.51.100.4', uid: 'uid-camila' }]]);
    expect(Object.keys(accessLines()[0][1] as object)).toEqual(['ip', 'uid']);
  });

  it('o 404 e o 500 também escrevem a linha; o 404 vem antes do token, com o uid null', async () => {
    // O pedido leva o token da Camila, mas a rota é conferida antes dele (31.6).
    expect((await call(request('GET', '/me/carteira', { headers: forged }))).status).toBe(404);
    const broken: ApiRoute[] = [
      {
        method: 'GET',
        pattern: '/teste/acesso',
        writes: false,
        handle: async () => {
          throw new Error('quebrou');
        },
      },
    ];
    expect((await call(request('GET', '/teste/acesso', { headers: forged }), broken)).status).toBe(
      500,
    );
    expect(accessLines()).toEqual([
      ['acesso', { ip: '198.51.100.4', uid: null }],
      ['acesso', { ip: '198.51.100.4', uid: 'uid-camila' }],
    ]);
  });

  it('sem o cabeçalho, o req.ip; com o último item fora do formato, null, nunca o texto', async () => {
    await call(request('GET', '/me/wallet', { ip: '198.51.100.9' }));
    await call(
      request('GET', '/me/wallet', {
        headers: { 'X-Forwarded-For': '198.51.100.4, {"uid":"outro"}' },
        ip: '198.51.100.4',
      }),
    );
    expect(accessLines()).toEqual([
      ['acesso', { ip: '198.51.100.9', uid: 'uid-camila' }],
      ['acesso', { ip: null, uid: 'uid-camila' }],
    ]);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('outro');
  });

  it('a `acesso` vem logo antes da `api`, que continua a última do pedido', async () => {
    await call(request('GET', '/me/wallet', { headers: forged }));
    await call(request('GET', '/nao/existe', { headers: forged }));
    expect(messages()).toEqual(['acesso', 'api', 'acesso', 'api']);
  });
});

describe('rota de saúde: o GET /health (32.2)', () => {
  /** Um Firestore que lança em qualquer uso: a rota que responde com ele não tocou nele. */
  const untouchable = new Proxy(
    {},
    {
      get() {
        throw new Error('usou o Firestore');
      },
    },
  ) as Firestore;

  it('200 com {"ok":true} e no-store, antes do Auth, do Firestore, do App Check, do ritmo e das linhas', async () => {
    const verifyIdToken = vi.fn();
    const verify = vi.fn();
    // Um limitador sem ficha nenhuma: qualquer pedido que passasse por ele seria 429.
    const rateLimiter = { take: vi.fn(() => 60) };
    const handler = createApiHandler({
      db: untouchable,
      auth: { verifyIdToken },
      now: () => NOW,
      appCheck: { mode: 'enforce', verify },
      rateLimiter,
    });
    // Sem login, com o cabeçalho de IP e um corpo acima do teto: nada disso é lido.
    const req = request('GET', '/health', {
      headers: { Authorization: '', 'X-Forwarded-For': '203.0.113.7, 198.51.100.4' },
      rawBody: Buffer.alloc(16 * 1024 + 1),
    });
    const get = vi.fn(req.get);
    req.get = get;
    const { res, sent } = response();
    await handler(req, res);

    expect(sent).toEqual({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { ok: true },
    });
    // O texto exato é contrato do teste de disponibilidade (o --matcher-content de 32.7).
    expect(JSON.stringify(sent.body)).toBe('{"ok":true}');
    expect(JSON.stringify(HEALTH_BODY)).toBe('{"ok":true}');
    expect(Object.isFrozen(HEALTH_BODY)).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(rateLimiter.take).not.toHaveBeenCalled();
    // Nem a linha `acesso` nem a `api` (decisão 18 de 32.1), e nenhum aviso.
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('só o GET com o caminho exato: o POST, o HEAD, o /health/ e o /health/x dão 404 not_found, com a linha `acesso`', async () => {
    const forged = { 'X-Forwarded-For': '203.0.113.7, 198.51.100.4' };
    const cases: [string, string][] = [
      ['POST', '/health'],
      ['HEAD', '/health'],
      ['GET', '/health/'],
      ['GET', '/health/x'],
    ];
    for (const [method, path] of cases) {
      vi.mocked(logger.info).mockClear();
      const sent = await call(request(method, path, { headers: forged }));
      expect(sent.status).toBe(404);
      expect(sent.body).toEqual({ code: 'not_found', message: 'Não encontrado.' });
      expect(vi.mocked(logger.info).mock.calls).toEqual([
        ['acesso', { ip: '198.51.100.4', uid: null }],
        [
          'api',
          {
            method,
            route: 'unmatched',
            status: 404,
            ms: expect.any(Number),
            uid: null,
            replayed: false,
            code: 'not_found',
          },
        ],
      ]);
    }
  });

  it('fica fora da API_ROUTES: nenhuma rota da tabela tem o caminho /health', () => {
    expect(API_ROUTES.filter((route) => route.pattern.startsWith('/health'))).toEqual([]);
  });
});

describe('fã-clube gerido pelo fã (seção 34)', () => {
  const thrower = (error: unknown): ApiRoute[] => [
    {
      method: 'GET',
      pattern: '/teste/fa-clube',
      writes: false,
      handle: async () => {
        throw error;
      },
    },
  ];

  it('o FanClubError vira o 400 fan_club_invalid e o 409 fan_club_refused, com os detalhes', async () => {
    const invalid = await call(
      request('GET', '/teste/fa-clube'),
      thrower(new FanClubError('fan_club_invalid', { field: 'name', reason: 'official' })),
    );
    expect(invalid).toMatchObject({
      status: 400,
      body: {
        code: 'fan_club_invalid',
        message: 'Campo fora do formato. Confira e tente de novo.',
        details: { field: 'name', reason: 'official' },
      },
    });
    const refused = await call(
      request('GET', '/teste/fa-clube'),
      thrower(
        new FanClubError('fan_club_refused', {
          reason: 'cooldown',
          canReapplyAt: '2026-11-04T15:00:00.000Z',
        }),
      ),
    );
    expect(refused).toMatchObject({
      status: 409,
      body: {
        code: 'fan_club_refused',
        message: 'Isso não pode ser feito no fã-clube agora.',
        details: { reason: 'cooldown', canReapplyAt: '2026-11-04T15:00:00.000Z' },
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('o teto das candidaturas: 429 com a ação club_apply e o Retry-After', async () => {
    const sent = await call(
      request('GET', '/teste/fa-clube'),
      thrower(new DailyCapError('club_apply', 3, 3600)),
    );
    expect(sent).toMatchObject({
      status: 429,
      headers: { 'Retry-After': '3600' },
      body: { code: 'too_many_requests', details: { limit: 3, action: 'club_apply' } },
    });
  });

  it('GET /me/fan-club sem candidatura: o programa e nada mais, com uma leitura', async () => {
    const read: string[] = [];
    const db = {
      collection: (name: string) => ({ doc: (id: string) => ({ path: name + '/' + id }) }),
      getAll: async (...refs: { path: string }[]) => {
        read.push(...refs.map((ref) => ref.path));
        return refs.map(() => ({ exists: false, data: () => undefined }));
      },
    } as unknown as Firestore;
    const sent = await call(request('GET', '/me/fan-club'), API_ROUTES, db);
    expect(sent).toMatchObject({
      status: 200,
      body: {
        open: true,
        rulesUrl: null,
        rulesVersion: 'termos-2026-10',
        notice: FAN_CLUB_PRIZE_NOTICE,
        application: null,
        club: null,
      },
    });
    expect(read).toEqual(['fanClubApplications/uid-camila']);
  });

  it('POST /me/fan-club/application confere o corpo antes de abrir a transação (sem leitura)', async () => {
    const key = { 'Idempotency-Key': 'chave-fa-clube-0001' };
    const valid = {
      artistId: 'nettobrito',
      name: 'Netto de Coração',
      instagram: 'camila.teste.up',
      whatsapp: '(75) 99123-4567',
      pitch: 'Divulgo o artista nos stories e no grupo dos fãs da cidade.',
      adult: true,
      rulesVersion: 'termos-2026-10',
    };
    const cases: [unknown, Record<string, unknown>][] = [
      [undefined, { code: 'invalid_request', details: { field: 'body' } }],
      [
        { ...valid, foto: 1 },
        { code: 'invalid_request', details: { field: 'foto' } },
      ],
      [
        { ...valid, artistId: 'Netto' },
        { code: 'invalid_request', details: { field: 'artistId' } },
      ],
      [
        { ...valid, adult: 'sim' },
        { code: 'invalid_request', details: { field: 'adult' } },
      ],
      [
        { ...valid, name: 'Netto Oficial' },
        { code: 'fan_club_invalid', details: { field: 'name', reason: 'official' } },
      ],
      [
        { ...valid, name: 'Netto Pepino' },
        { code: 'fan_club_invalid', details: { field: 'name', reason: 'not_allowed' } },
      ],
      [
        { ...valid, pitch: 'curto' },
        { code: 'fan_club_invalid', details: { field: 'pitch', reason: 'format' } },
      ],
      [
        { ...valid, instagram: null },
        { code: 'fan_club_invalid', details: { field: 'socials', reason: 'format' } },
      ],
      [
        { ...valid, whatsapp: 75991234567 },
        { code: 'invalid_request', details: { field: 'whatsapp' } },
      ],
      [
        { ...valid, whatsapp: '(75) 3221-4567' },
        { code: 'fan_club_invalid', details: { field: 'whatsapp', reason: 'format' } },
      ],
      [
        { ...valid, adult: false },
        { code: 'fan_club_invalid', details: { field: 'adult', reason: 'format' } },
      ],
      [
        { ...valid, rulesVersion: 'regulamento-2027' },
        { code: 'fan_club_invalid', details: { field: 'rulesVersion', reason: 'format' } },
      ],
    ];
    for (const [body, expected] of cases) {
      const sent = await call(
        request('POST', '/me/fan-club/application', { body, headers: key }),
        API_ROUTES,
        noReads,
      );
      expect(sent.status, JSON.stringify(body)).toBe(400);
      expect(sent.body).toMatchObject(expected);
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('as que gravam exigem a Idempotency-Key; as de leitura, não', async () => {
    for (const [method, path] of [
      ['POST', '/me/fan-club/application'],
      ['DELETE', '/me/fan-club/application'],
      ['PUT', '/me/fan-club/rules'],
      ['POST', '/me/fan-club/upload'],
      ['POST', '/me/fan-club/posts'],
      ['DELETE', '/me/fan-club/posts/pub1'],
      ['POST', '/fan-club-posts/pub1/report'],
    ] as const) {
      const sent = await call(request(method, path, { body: {} }), API_ROUTES, noReads);
      expect(sent.status, `${method} ${path}`).toBe(400);
      expect(sent.body).toMatchObject({ code: 'idempotency_key_required' });
    }
    const routes = API_ROUTES.filter(
      (route) =>
        route.pattern.startsWith('/me/fan-club') ||
        route.pattern.includes('/fan-club') ||
        route.pattern.startsWith('/fan-clubs'),
    );
    expect(routes.map((route) => [route.method, route.pattern, route.writes])).toEqual([
      ['GET', '/me/fan-club', false],
      ['GET', '/me/fan-club/numbers', false],
      ['GET', '/me/fan-club/artists', false],
      ['POST', '/me/fan-club/application', true],
      ['DELETE', '/me/fan-club/application', true],
      ['PUT', '/me/fan-club/rules', true],
      ['GET', '/me/fan-club/posts', false],
      ['POST', '/me/fan-club/upload', true],
      ['POST', '/me/fan-club/posts', true],
      ['DELETE', '/me/fan-club/posts/:postId', true],
      ['GET', '/artists/:artistId/fan-clubs', false],
      ['GET', '/fan-clubs/:clubId', false],
      ['GET', '/fan-clubs/:clubId/posts', false],
      ['POST', '/fan-club-posts/:postId/report', true],
    ]);
    // Candidatar, publicar, abrir a vaga, o novo aceite e denunciar criam: o
    // suspenso não manda (sem `allowSuspended`); retirar é de desfazer.
    for (const route of routes.filter((item) => item.writes)) {
      const undo =
        route.method === 'DELETE' &&
        (route.pattern === '/me/fan-club/application' ||
          route.pattern === '/me/fan-club/posts/:postId');
      expect('allowSuspended' in route && route.allowSuspended, route.pattern).toBe(
        undo ? true : false,
      );
    }
  });

  it('os ids fora do formato são 404 sem ler nada (etapa 2)', async () => {
    const key = { 'Idempotency-Key': 'chave-fa-clube-0002' };
    const cases: [string, string, string][] = [
      ['GET', '/fan-clubs/__clube__', 'fan_club_not_found'],
      ['GET', '/fan-clubs/__clube__/posts', 'fan_club_not_found'],
      ['DELETE', '/me/fan-club/posts/__pub__', 'fan_club_post_not_found'],
      ['POST', '/fan-club-posts/__pub__/report', 'fan_club_post_not_found'],
      ['GET', '/artists/Netto/fan-clubs', 'artist_not_found'],
    ];
    for (const [method, path, code] of cases) {
      const sent = await call(request(method, path, { headers: key }), API_ROUTES, noReads);
      expect(sent.status, `${method} ${path}`).toBe(404);
      expect(sent.body).toMatchObject({ code });
      expect(sent.body).not.toHaveProperty('details');
    }
  });

  it('POST /me/fan-club/posts confere o corpo antes de abrir a transação (sem leitura)', async () => {
    const key = { 'Idempotency-Key': 'chave-fa-clube-0003' };
    const cases: [unknown, Record<string, unknown>][] = [
      [undefined, { code: 'invalid_request', details: { field: 'body' } }],
      [
        { text: 'Oi', photo: false, foto: 1 },
        { code: 'invalid_request', details: { field: 'foto' } },
      ],
      [{ photo: false }, { code: 'invalid_request', details: { field: 'text' } }],
      [{ text: 'Oi' }, { code: 'invalid_request', details: { field: 'photo' } }],
      [
        { text: 'Oi', photo: 'sim' },
        { code: 'invalid_request', details: { field: 'photo' } },
      ],
      [
        { text: '   ', photo: false },
        { code: 'fan_club_invalid', details: { field: 'text', reason: 'format' } },
      ],
      [
        { text: 'a'.repeat(1_001), photo: false },
        { code: 'fan_club_invalid', details: { field: 'text', reason: 'format' } },
      ],
      [
        { text: 'Que pepino esse show', photo: true },
        { code: 'fan_club_invalid', details: { field: 'text', reason: 'not_allowed' } },
      ],
    ];
    for (const [body, expected] of cases) {
      const sent = await call(
        request('POST', '/me/fan-club/posts', { body, headers: key }),
        API_ROUTES,
        noReads,
      );
      expect(sent.status, JSON.stringify(body)).toBe(400);
      expect(sent.body).toMatchObject(expected);
    }
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('PUT /me/fan-club/rules e a denúncia conferem o corpo antes de abrir a transação', async () => {
    const key = { 'Idempotency-Key': 'chave-fa-clube-0004' };
    const cases: [string, string, unknown, Record<string, unknown>][] = [
      [
        'PUT',
        '/me/fan-club/rules',
        {},
        { code: 'invalid_request', details: { field: 'rulesVersion' } },
      ],
      [
        'PUT',
        '/me/fan-club/rules',
        { rulesVersion: 'termos-2026-10', outro: 1 },
        { code: 'invalid_request', details: { field: 'outro' } },
      ],
      [
        'PUT',
        '/me/fan-club/rules',
        { rulesVersion: 'regulamento-2027' },
        { code: 'fan_club_invalid', details: { field: 'rulesVersion', reason: 'format' } },
      ],
      [
        'POST',
        '/fan-club-posts/pub1/report',
        { reason: 'nudez' },
        { code: 'invalid_request', details: { field: 'reason' } },
      ],
      [
        'POST',
        '/fan-club-posts/pub1/report',
        ['spam'],
        { code: 'invalid_request', details: { field: 'reason' } },
      ],
    ];
    for (const [method, path, body, expected] of cases) {
      const sent = await call(request(method, path, { body, headers: key }), API_ROUTES, noReads);
      expect(sent.status, JSON.stringify(body)).toBe(400);
      expect(sent.body).toMatchObject(expected);
    }
  });

  it('os 404 do fã-clube e da publicação saem sem detalhes, e os tetos novos levam a ação', async () => {
    for (const [error, code, message] of [
      [
        new FanClubError('fan_club_not_found'),
        'fan_club_not_found',
        'Este fã-clube não está disponível.',
      ],
      [
        new FanClubError('fan_club_post_not_found'),
        'fan_club_post_not_found',
        'Publicação não encontrada.',
      ],
    ] as const) {
      const sent = await call(request('GET', '/teste/fa-clube'), thrower(error));
      expect(sent).toMatchObject({ status: 404, body: { code, message } });
      expect(sent.body).not.toHaveProperty('details');
    }
    for (const [action, limit] of [
      ['club_post', 5],
      ['club_upload', 10],
    ] as const) {
      const sent = await call(
        request('GET', '/teste/fa-clube'),
        thrower(new DailyCapError(action, limit, 3600)),
      );
      expect(sent).toMatchObject({
        status: 429,
        body: { code: 'too_many_requests', details: { limit, action } },
      });
    }
    expect(logger.error).not.toHaveBeenCalled();
  });
});
