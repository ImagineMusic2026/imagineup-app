import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_LOG_MESSAGE,
  clientIp,
  isPanelCall,
  logAccess,
  onPanelCall,
  type IpSource,
} from './access-log';
import * as exported from './index';
import { EMAILJS_PRIVATE_KEY, PANEL_ORIGINS } from './staff';

// O vi.mock sobe para antes dos imports: o logger acima já é o falso.
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

// O registro de acesso (docs/arquitetura-api.md, 31.6 e 31.11): o IP com
// cabeçalhos forjados, a linha exata que o sink lê, o onPanelCall pelo `.run`,
// o manifesto, com toda callable exportada vinda dele, e o `cors` do painel
// em cada uma.

/** Um pedido como o Express entrega: o cabeçalho pelo `get`, sem caixa, e o `req.ip`. */
function req(forwarded?: string, ip?: string): IpSource {
  return {
    get: (name) => (name.toLowerCase() === 'x-forwarded-for' ? forwarded : undefined),
    ip,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('clientIp: o IP de quem chamou', () => {
  it('com o X-Forwarded-For, o último item, nunca o primeiro (que o cliente forja)', () => {
    expect(clientIp(req('203.0.113.7, 198.51.100.4'))).toBe('198.51.100.4');
    expect(clientIp(req('203.0.113.7,198.51.100.4'))).toBe('198.51.100.4');
    expect(clientIp(req('10.0.0.1, 203.0.113.7, 198.51.100.4'))).toBe('198.51.100.4');
    expect(clientIp(req('198.51.100.4'))).toBe('198.51.100.4');
  });

  it('apara os espaços; item vazio no meio não conta, e o último vazio dá null', () => {
    expect(clientIp(req('  198.51.100.4  '))).toBe('198.51.100.4');
    expect(clientIp(req(' 203.0.113.7 ,, 198.51.100.4 '))).toBe('198.51.100.4');
    expect(clientIp(req(',,198.51.100.4'))).toBe('198.51.100.4');
    // Nunca volta a um item anterior: ele pode ter vindo do cliente.
    expect(clientIp(req('198.51.100.4,'))).toBeNull();
    expect(clientIp(req('198.51.100.4, '))).toBeNull();
    expect(clientIp(req(''))).toBeNull();
    expect(clientIp(req('   '))).toBeNull();
  });

  it('IPv6, na forma em que veio', () => {
    expect(clientIp(req('203.0.113.7, 2001:db8::1'))).toBe('2001:db8::1');
    expect(clientIp(req('2804:214:8000:1::7'))).toBe('2804:214:8000:1::7');
    expect(clientIp(req('::ffff:198.51.100.4'))).toBe('::ffff:198.51.100.4');
  });

  it('o último item que não é um IP dá null: nenhum texto do cliente chega à linha', () => {
    for (const forwarded of [
      '198.51.100.4, unknown',
      '198.51.100.4, texto do cliente',
      '198.51.100.4, {"uid":"outro"}',
      '198.51.100.4, 198.51.100.5\n{"message":"acesso"}',
      '198.51.100.4\nacesso',
      '198.51.100.4:443',
      '[2001:db8::1]',
      '2001:db8::1%texto',
      'fe80::1%eth0',
      '198.51.100.256',
      '0198.51.100.4',
    ]) {
      expect(clientIp(req(forwarded)), JSON.stringify(forwarded)).toBeNull();
    }
  });

  it('sem o cabeçalho, o req.ip se for um IP, ou null', () => {
    expect(clientIp(req(undefined, '198.51.100.9'))).toBe('198.51.100.9');
    expect(clientIp(req(undefined, '::1'))).toBe('::1');
    expect(clientIp(req(undefined, 'texto'))).toBeNull();
    expect(clientIp(req(undefined, undefined))).toBeNull();
    expect(clientIp({ ip: '198.51.100.9' })).toBe('198.51.100.9');
  });

  it('com o cabeçalho, nunca o req.ip (o Express tira dele o primeiro item)', () => {
    expect(clientIp(req('203.0.113.7, 198.51.100.4', '203.0.113.7'))).toBe('198.51.100.4');
    expect(clientIp(req('texto', '198.51.100.9'))).toBeNull();
    expect(clientIp(req('', '198.51.100.9'))).toBeNull();
  });

  it('sem pedido (o .run sem rawRequest), null', () => {
    expect(clientIp(undefined)).toBeNull();
  });
});

describe('a linha `acesso`: contrato do sink e da consulta judicial', () => {
  it('o texto é "acesso", escrito por extenso aqui', () => {
    // O filtro do sink casa com jsonPayload.message="acesso" (31.7).
    expect(ACCESS_LOG_MESSAGE).toBe('acesso');
  });

  it('sai no info, exatamente com ("acesso", { ip, uid }), só essas duas chaves', () => {
    logAccess('198.51.100.4', 'uid-equipe');
    logAccess(null, null);
    expect(vi.mocked(logger.info).mock.calls).toEqual([
      ['acesso', { ip: '198.51.100.4', uid: 'uid-equipe' }],
      ['acesso', { ip: null, uid: null }],
    ]);
    for (const [, fields] of vi.mocked(logger.info).mock.calls) {
      expect(Object.keys(fields as object)).toEqual(['ip', 'uid']);
    }
    // O warn e o error vão ao stderr, e o sink só lê o stdout.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('o filtro do sink, no repositório, lê o mesmo texto no stdout de qualquer função', () => {
    // O outro lado do contrato (31.2 e 31.7): trocar a constante e o texto
    // acima sem mudar o filtro quebra aqui, e não calado no bucket.
    const filter = readFileSync(
      resolve(__dirname, '../../docs/protecao/registro-acesso/filtro-linha-acesso.txt'),
      'utf8',
    );
    expect(filter.trim().split(/\r?\n/)).toEqual([
      'resource.type="cloud_run_revision"',
      'log_id("run.googleapis.com/stdout")',
      `jsonPayload.message="${ACCESS_LOG_MESSAGE}"`,
    ]);
  });
});

describe('onPanelCall', () => {
  const OPTIONS = { cors: PANEL_ORIGINS, secrets: [EMAILJS_PRIVATE_KEY], timeoutSeconds: 120 };

  /** O que o SDK entrega ao handler; o `.run` aceita objetos parciais. */
  function callRequest(extra: Partial<CallableRequest<unknown>> = {}): CallableRequest<unknown> {
    return {
      data: { handle: 'nenho' },
      acceptsStreaming: false,
      rawRequest: {
        get: (name: string) =>
          name.toLowerCase() === 'x-forwarded-for' ? '203.0.113.7, 198.51.100.4' : undefined,
        ip: '203.0.113.7',
      },
      ...extra,
    } as unknown as CallableRequest<unknown>;
  }

  const auth = { uid: 'uid-equipe', token: {} } as CallableRequest<unknown>['auth'];

  it('escreve a linha antes do handler, com o IP do rawRequest e o uid do auth', async () => {
    const handler = vi.fn(async (request: CallableRequest<unknown>) => ({ got: request.data }));
    const fn = onPanelCall(OPTIONS, handler);
    expect(await fn.run(callRequest({ auth }))).toEqual({ got: { handle: 'nenho' } });
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('acesso', { ip: '198.51.100.4', uid: 'uid-equipe' });
    expect(handler).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.info).mock.invocationCallOrder[0]).toBeLessThan(
      handler.mock.invocationCallOrder[0],
    );
  });

  it('o resultado e o erro do handler passam iguais', async () => {
    const result = { available: true, reason: null };
    expect(await onPanelCall(OPTIONS, async () => result).run(callRequest({ auth }))).toBe(result);
    expect(await onPanelCall(OPTIONS, () => 7).run(callRequest({ auth }))).toBe(7);

    const refusal = new HttpsError('permission-denied', 'Sem acesso.');
    await expect(
      onPanelCall(OPTIONS, async () => {
        throw refusal;
      }).run(callRequest({ auth })),
    ).rejects.toBe(refusal);
    // A recusa também deixa a linha: ela vem antes do handler.
    expect(
      vi.mocked(logger.info).mock.calls.filter(([message]) => message === 'acesso'),
    ).toHaveLength(3);
  });

  it('sem auth, o uid null; sem rawRequest, o ip null', async () => {
    const fn = onPanelCall(OPTIONS, async () => 'ok');
    await fn.run(callRequest());
    await fn.run(callRequest({ auth, rawRequest: undefined }));
    expect(vi.mocked(logger.info).mock.calls).toEqual([
      ['acesso', { ip: '198.51.100.4', uid: null }],
      ['acesso', { ip: null, uid: 'uid-equipe' }],
    ]);
  });

  it('o __endpoint e o __trigger são os do onCall com as mesmas opções', () => {
    for (const options of [
      OPTIONS,
      { cors: PANEL_ORIGINS },
      { cors: PANEL_ORIGINS, timeoutSeconds: 30 },
    ]) {
      const handler = async () => null;
      const panel = onPanelCall(options, handler);
      const plain = onCall(options, handler);
      expect(panel.__endpoint).toEqual(plain.__endpoint);
      expect(panel.__trigger).toEqual(plain.__trigger);
      expect(panel.__endpoint.callableTrigger).toEqual({});
    }
    expect(isPanelCall(onPanelCall(OPTIONS, async () => null))).toBe(true);
    expect(isPanelCall(onCall(OPTIONS, async () => null))).toBe(false);
  });
});

describe('o manifesto: toda callable exportada vem do onPanelCall', () => {
  const functions = Object.entries(exported as Record<string, unknown>).filter(
    ([, value]) => typeof value === 'function' && '__endpoint' in value,
  );
  const callables = functions
    .filter(
      ([, value]) =>
        (value as { __endpoint: { callableTrigger?: unknown } }).__endpoint.callableTrigger,
    )
    .map(([name]) => name);

  it('as callables do painel são todas do onPanelCall (55 em 14/10/2026)', () => {
    expect(callables.length).toBeGreaterThanOrEqual(55);
    expect(callables).toEqual(expect.arrayContaining(['createStaffInvite', 'hideFanComments']));
    const plain = callables.filter((name) => !isPanelCall(exported[name as keyof typeof exported]));
    expect(plain).toEqual([]);
  });

  it('a api, as agendadas, os gatilhos e as filas não ganham a linha pelo embrulho', () => {
    const panel = functions.filter(([, value]) => isPanelCall(value)).map(([name]) => name);
    expect(panel.sort()).toEqual([...callables].sort());
    for (const name of [
      'api',
      'rankingTick',
      'closeStatsDays',
      'createUserProfile',
      'deleteUserProfile',
      'queuePostCountSync',
      'syncPostCounts',
    ]) {
      expect(isPanelCall(exported[name as keyof typeof exported]), name).toBe(false);
    }
  });
});

describe('o cors das callables: só as origens do painel', () => {
  // O emulador abre o CORS de toda função (o `enableCors` do
  // FIREBASE_DEBUG_FEATURES), então a lista é conferida aqui: a função HTTP de
  // verdade que cada export é, atrás de um servidor do `node:http`, sem o
  // emulador. O preflight termina no `cors`, antes do handler.
  const PANEL_ORIGIN = 'https://imagineup-admin.vercel.app';
  const httpFunctions = exported as unknown as Record<
    string,
    (req: unknown, res: unknown) => unknown
  >;
  const server = createServer((request, response) => {
    void httpFunctions[(request.url ?? '/').slice(1)](request, response);
  });
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  const preflight = (name: string, origin: string) =>
    fetch(`${base}/${name}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

  const callables = Object.entries(exported as Record<string, unknown>)
    .filter(([, value]) => isPanelCall(value))
    .map(([name]) => name);

  it('as origens do painel são as de produção (fora do emulador)', () => {
    expect(PANEL_ORIGINS).toEqual([PANEL_ORIGIN, 'http://localhost:3000']);
  });

  it('o preflight de toda callable devolve a origem do painel, e nada a outra origem', async () => {
    expect(callables.length).toBeGreaterThanOrEqual(55);
    for (const name of callables) {
      const panel = await preflight(name, PANEL_ORIGIN);
      expect(panel.status, name).toBe(204);
      expect(panel.headers.get('access-control-allow-origin'), name).toBe(PANEL_ORIGIN);
      expect(panel.headers.get('access-control-allow-methods'), name).toBe('POST');

      const other = await preflight(name, 'https://outro-site.example');
      expect(other.status, name).toBe(204);
      expect(other.headers.get('access-control-allow-origin'), name).toBeNull();
    }
    // O preflight não chega ao handler: nenhuma linha `acesso`.
    expect(logger.info).not.toHaveBeenCalled();
  });
});
