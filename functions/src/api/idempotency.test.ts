import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { MISSING_FAN_PHOTO_FILES } from '../fan-profile/files';
import { planAwards, retryOnAlreadyExists } from '../points/award';
import { DEFAULT_POINTS_CONFIG, staticConfigSource } from '../points/config';
import { NO_GAME } from '../points/model';
import { ApiHttpError } from './errors';
import {
  canonicalJson,
  idempotencyDocId,
  parseIdempotencyKey,
  requestFingerprint,
  runIdempotent,
  storedBody,
  type IdempotentCall,
  type IdempotentWork,
} from './idempotency';
import type { ResolvedDeps } from './types';

describe('chave de idempotência', () => {
  it.each([
    'mg8x3k2a-4f9a1b2c',
    // Chave do convite, com a data ISO (auth/api.ts do app).
    'invite-CAMILA12-2026-10-05T15:00:00.000Z',
    'a'.repeat(200),
  ])('aceita %s', (key) => {
    expect(parseIdempotencyKey(key)).toBe(key);
  });

  it.each([
    undefined,
    '',
    'curta',
    'a'.repeat(201),
    'com espaço aqui',
    'barra/no-meio',
    'acentuação-é',
  ])('recusa %s com idempotency_key_required', (key) => {
    expect(() => parseIdempotencyKey(key)).toThrow(ApiHttpError);
    try {
      parseIdempotencyKey(key);
    } catch (error) {
      expect(error).toMatchObject({ code: 'idempotency_key_required', status: 400 });
    }
  });

  it('o documento é por fã: a mesma chave de dois fãs são pedidos diferentes', () => {
    const camila = idempotencyDocId('uid-camila', 'mg8x3k2a-4f9a1b2c');
    const alan = idempotencyDocId('uid-alan', 'mg8x3k2a-4f9a1b2c');
    expect(camila).toMatch(/^[0-9a-f]{64}$/);
    expect(camila).not.toBe(alan);
    expect(idempotencyDocId('uid-camila', 'mg8x3k2a-4f9a1b2c')).toBe(camila);
  });

  it('a impressão do pedido não muda com as chaves do corpo em outra ordem', () => {
    const a = requestFingerprint('POST', '/posts/p1/comments', {
      text: 'oi',
      meta: { b: 1, a: [2, { y: 1, x: 0 }] },
    });
    const b = requestFingerprint('POST', '/posts/p1/comments', {
      meta: { a: [2, { x: 0, y: 1 }], b: 1 },
      text: 'oi',
    });
    expect(a).toBe(b);
    expect(requestFingerprint('POST', '/posts/p1/comments', { text: 'olá' })).not.toBe(a);
    expect(
      requestFingerprint('POST', '/posts/p2/comments', {
        text: 'oi',
        meta: { b: 1, a: [2, { y: 1, x: 0 }] },
      }),
    ).not.toBe(a);
    expect(requestFingerprint('PUT', '/posts/p1/like', undefined)).toBe(
      requestFingerprint('PUT', '/posts/p1/like', null),
    );
  });

  it('JSON canônico ignora campo undefined e ordena as chaves', () => {
    expect(canonicalJson({ b: 1, a: undefined, c: [undefined, 'x'] })).toBe(
      '{"b":1,"c":[null,"x"]}',
    );
  });
});

describe('ALREADY_EXISTS em volta da transação', () => {
  const alreadyExists = () => Object.assign(new Error('já existe'), { code: 6 });

  it('roda de novo uma vez e devolve a segunda rodada', async () => {
    const run = vi.fn().mockRejectedValueOnce(alreadyExists()).mockResolvedValueOnce('guardada');
    await expect(retryOnAlreadyExists(run)).resolves.toBe('guardada');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('só uma vez: o segundo ALREADY_EXISTS sobe', async () => {
    const run = vi.fn().mockRejectedValue(alreadyExists());
    await expect(retryOnAlreadyExists(run)).rejects.toMatchObject({ code: 6 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('outro erro sobe sem repetir', async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('abortou'), { code: 10 }));
    await expect(retryOnAlreadyExists(run)).rejects.toMatchObject({ code: 10 });
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('resposta guardada', () => {
  it('é o JSON que o app recebe: sem campo undefined e com a data em texto ISO', () => {
    const at = new Date('2026-10-05T15:00:00.000Z');
    expect(
      storedBody({ pointsAwarded: 2, missionCompleted: undefined, at, list: [1, undefined] }),
    ).toEqual({
      pointsAwarded: 2,
      at: '2026-10-05T15:00:00.000Z',
      list: [1, null],
    });
    expect(storedBody(undefined)).toBeNull();
    expect(storedBody(null)).toBeNull();
  });
});

// --- runIdempotent com um Firestore falso -----------------------------------------

const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const UID = 'uid-camila';

type Write = { op: 'create' | 'set' | 'update'; path: string; data: unknown };
type FakeRef = { path: string; id: string; collection(name: string): { doc(id: string): FakeRef } };

/**
 * Firestore falso: `existing` são os documentos que existem. `attempts` roda a
 * função da transação essa quantidade de vezes, como o SDK faz quando o commit
 * perde uma disputa; só a última tentativa vale. Guarda as gravações de cada uma.
 */
function fakeDb(existing: Record<string, DocumentData>, attempts = 1) {
  const ref = (path: string): FakeRef => ({
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const snap = (path: string) => ({
    exists: path in existing,
    data: () => existing[path],
    get: (field: string) => existing[path]?.[field],
  });
  const tries: Write[][] = [];
  const reads: string[] = [];
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      let result: T | undefined;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const writes: Write[] = [];
        tries.push(writes);
        const record = (op: Write['op']) => (target: FakeRef, data: unknown) => {
          writes.push({ op, path: target.path, data });
        };
        result = await fn({
          getAll: async (...refs: FakeRef[]) =>
            refs.map((target) => {
              reads.push(target.path);
              return snap(target.path);
            }),
          get: async (target: FakeRef) => {
            reads.push(target.path);
            return snap(target.path);
          },
          create: record('create'),
          set: record('set'),
          update: record('update'),
        });
      }
      return result as T;
    },
  };
  return { db: db as unknown as Firestore, tries, reads };
}

function deps(db: Firestore, random: () => number): ResolvedDeps {
  return {
    db,
    auth: { verifyIdToken: vi.fn() },
    now: () => NOW,
    random,
    config: staticConfigSource(),
    inviteKey: () => 'segredo-de-teste',
    files: MISSING_FAN_PHOTO_FILES,
    rateLimiter: null,
    appCheck: { mode: 'off', verify: vi.fn() },
  };
}

const CALL: IdempotentCall = {
  uid: UID,
  key: 'chave-0001',
  route: 'PUT /teste/:id',
  fingerprint: 'f',
  now: NOW,
  config: DEFAULT_POINTS_CONFIG,
  game: NO_GAME,
};

// Fã com perfil e sem carteira: a primeira ação do dia marca atividade e grava o shard.
const PROFILE = { [`users/${UID}`]: { displayName: 'Camila Ribeiro' } };

const shardWrites = (writes: Write[]) =>
  writes.filter((write) => write.path.startsWith('statsDaily/')).map((write) => write.path);

describe('runIdempotent', () => {
  it('o trabalho recebe o retrato do perfil lido no getAll da chave, sem leitura a mais (bloco 9)', async () => {
    const { db, reads } = fakeDb(PROFILE);
    let seen: string | undefined;
    const work: IdempotentWork = async ({ profile }) => {
      seen = profile.get('displayName');
      return { body: { ok: true } };
    };
    await runIdempotent(
      deps(db, () => 0),
      CALL,
      work,
    );
    expect(seen).toBe('Camila Ribeiro');
    expect(reads.filter((path) => path === `users/${UID}`)).toHaveLength(1);
  });

  it('sorteia o shard de novo a cada tentativa da transação e grava o da última', async () => {
    const { db, tries } = fakeDb(PROFILE, 2);
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    const work: IdempotentWork = async () => ({ body: { ok: true } });
    await runIdempotent(deps(db, random), CALL, work);

    expect(random).toHaveBeenCalledTimes(2);
    expect(tries.map(shardWrites)).toEqual([
      ['statsDaily/2026-10-05/statsShards/0'],
      ['statsDaily/2026-10-05/statsShards/32'],
    ]);
  });

  it('guarda e devolve a mesma resposta normalizada (undefined some, data vira texto)', async () => {
    const { db, tries } = fakeDb(PROFILE);
    const work: IdempotentWork = async () => ({
      body: { pointsAwarded: 0, opcional: undefined, quando: new Date(NOW) },
    });
    const result = await runIdempotent(
      deps(db, () => 0),
      CALL,
      work,
    );

    const expected = { pointsAwarded: 0, quando: '2026-10-05T15:00:00.000Z' };
    expect(result).toEqual({ status: 200, body: expected, replayed: false });
    const key = tries[0]!.find((write) => write.path.startsWith('idempotency/'));
    expect(key?.data).toMatchObject({ status: 200, body: expected });
  });

  it('plano feito sem o fan de quem chama recusa sem gravar nada (a atividade sumiria)', async () => {
    const { db, tries } = fakeDb(PROFILE);
    const work: IdempotentWork = async ({ tx, award }) => {
      const plan = await planAwards(
        tx,
        db,
        [{ uid: UID, entries: [{ kind: 'earn', source: 'comment', eventId: 'c1' }] }],
        award,
      );
      return { body: { pointsAwarded: plan.pointsAwarded }, plan };
    };
    await expect(
      runIdempotent(
        deps(db, () => 0),
        CALL,
        work,
      ),
    ).rejects.toThrow(/fan de quem chama/);
    expect(tries[0]).toEqual([]);
  });

  it('fã suspenso (bloco 11): 403 account_suspended sem gravar nada, nem a chave', async () => {
    const suspended = {
      [`users/${UID}`]: { displayName: 'Camila Ribeiro', suspendedAt: { seconds: 1 } },
    };
    const { db, tries } = fakeDb(suspended);
    const work = vi.fn<IdempotentWork>(async () => ({ body: { ok: true } }));
    await expect(
      runIdempotent(
        deps(db, () => 0),
        CALL,
        work,
      ),
    ).rejects.toMatchObject({ code: 'account_suspended', status: 403 });
    expect(work).not.toHaveBeenCalled();
    expect(tries[0]).toEqual([]);
  });

  it('a rota com allowSuspended responde ao suspenso; a chave guardada antes também', async () => {
    const suspended = {
      [`users/${UID}`]: { displayName: 'Camila Ribeiro', suspendedAt: { seconds: 1 } },
    };
    const { db, tries } = fakeDb(suspended);
    const result = await runIdempotent(
      deps(db, () => 0),
      { ...CALL, allowSuspended: true },
      async () => ({ body: { ok: true } }),
    );
    expect(result).toEqual({ status: 200, body: { ok: true }, replayed: false });
    expect(tries[0]!.some((write) => write.path.startsWith('idempotency/'))).toBe(true);

    // A resposta guardada antes da suspensão volta como estava, sem efeito novo.
    const saved = fakeDb({
      ...suspended,
      [`idempotency/${idempotencyDocId(UID, CALL.key)}`]: {
        fingerprint: CALL.fingerprint,
        status: 200,
        body: { liked: true },
      },
    });
    await expect(
      runIdempotent(
        deps(saved.db, () => 0),
        CALL,
        async () => ({ body: { ok: false } }),
      ),
    ).resolves.toEqual({ status: 200, body: { liked: true }, replayed: true });
  });

  it('o suspendedAt apagado (null) não trava', async () => {
    const { db } = fakeDb({ [`users/${UID}`]: { displayName: 'Camila', suspendedAt: null } });
    await expect(
      runIdempotent(
        deps(db, () => 0),
        CALL,
        async () => ({ body: { ok: true } }),
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('o mesmo fã duas vezes no plano grava a carteira uma vez, com a atividade', async () => {
    const { db, tries } = fakeDb(PROFILE);
    const work: IdempotentWork = async ({ tx, fan, award }) => {
      const plan = await planAwards(
        tx,
        db,
        [
          { uid: UID, fan, entries: [] },
          { uid: UID, entries: [{ kind: 'earn', source: 'comment', eventId: 'c1' }] },
        ],
        award,
      );
      return { body: { pointsAwarded: plan.pointsAwarded }, plan };
    };
    const result = await runIdempotent(
      deps(db, () => 0),
      CALL,
      work,
    );

    expect(result.body).toEqual({ pointsAwarded: 2 });
    const wallets = tries[0]!.filter((write) => write.path === `wallets/${UID}`);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({
      op: 'create',
      data: { balance: 2, activity: { lastDay: '2026-10-05' } },
    });
  });
});
