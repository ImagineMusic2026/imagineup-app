import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_ROUTES, createApiHandler, type ApiRequest, type ApiRoute } from '../src/api';
import {
  CAMILA_SEED,
  DEFAULT_POINTS_CONFIG,
  createConfigSource,
  dayKey,
  planAwards,
  seedCamilaWallet,
  staticConfigSource,
  type AwardEntry,
  type ConfigSource,
  type PointsConfig,
} from '../src/points';
import { deleteUserData } from '../src/store';

/**
 * API do app e núcleo de pontos nos emuladores. Rode com `npm run
 * test:functions`, na raiz do app. Duas frentes:
 * - a função `api` de verdade, pelo HTTP do emulador de Functions, com o ID
 *   token do emulador de Auth (o mesmo caminho que o app monta);
 * - o handler da API no processo do teste, contra o Firestore do emulador, com
 *   rotas de teste que gravam (as do bloco 1 só leem), para a idempotência, o
 *   award, o débito, os limites do dia e a exclusão de conta.
 */
const PROJECT_ID = 'demo-imagine-up-app';
const REGION = 'southamerica-east1';
const app = initializeApp({ projectId: PROJECT_ID }, 'pontos');
const auth = getAuth(app);
const db = getFirestore(app);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let apiBase = '';

const DAY_MS = 24 * 60 * 60 * 1000;
// Segunda-feira, meio-dia em São Paulo.
const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const TODAY = dayKey(NOW);
const SEASON_A = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: Timestamp.fromMillis(NOW - 18 * DAY_MS),
  endsAt: Timestamp.fromMillis(NOW + 12 * DAY_MS),
  leaderTitle: null,
};

beforeAll(async () => {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) throw new Error('Rode com npm run test:functions.');
  const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
    functions?: { host: string; port: number };
  };
  if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
  const { host, port } = emulators.functions;
  // O mesmo endereço que o app monta a partir do EXPO_PUBLIC_FIREBASE_EMULATOR_HOST.
  apiBase = `http://${host}:${port}/${PROJECT_ID}/${REGION}/api`;
  const { backends } = (await (await fetch(`http://${host}:${port}/backends`)).json()) as {
    backends: { functionTriggers: { entryPoint: string }[] }[];
  };
  const loaded = backends.flatMap((backend) => backend.functionTriggers.map((t) => t.entryPoint));
  const missing = ['api', 'createUserProfile', 'deleteUserProfile'].filter(
    (name) => !loaded.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `O emulador não carregou ${missing.join(', ')}: procure "Failed to load function definition" no log.`,
    );
  }
});

beforeEach(async () => {
  if (!authHost || !firestoreHost) throw new Error('Rode com npm run test:functions.');
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
});

let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}`;

type Fan = { uid: string; token: string };

/** Fã que se cadastra pela API do Auth, como o app, e ganha o perfil pelo gatilho. */
async function signUpFan(displayName = 'Camila Ribeiro'): Promise<Fan> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${unique('fa')}@teste.dev`,
        password: 'senha-do-fa-1',
        displayName,
        returnSecureToken: true,
      }),
    },
  );
  const { localId, idToken } = (await response.json()) as { localId: string; idToken: string };
  const deadline = Date.now() + 30_000;
  while (!(await db.doc(`users/${localId}`).get()).exists) {
    if (Date.now() > deadline) throw new Error('O perfil do fã não apareceu.');
    await sleep(200);
  }
  return { uid: localId, token: idToken };
}

async function waitFor(what: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando ${what}.`);
    await sleep(200);
  }
}

// --- HTTP: a função de verdade --------------------------------------------------

type HttpResult = { status: number; body: Record<string, unknown>; headers: Headers };

async function http(
  path: string,
  init: { method?: string; token?: string } = {},
): Promise<HttpResult> {
  const response = await fetch(`${apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers: init.token ? { Authorization: `Bearer ${init.token}` } : {},
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

describe('a função api no emulador', () => {
  it('a Camila do seed: carteira e progresso do servidor iguais aos do protótipo', async () => {
    const camila = await signUpFan();
    await seedCamilaWallet(db, camila.uid);

    // A função guarda a configuração por 60 s: espera a temporada do seed chegar a ela.
    let wallet: HttpResult;
    const deadline = Date.now() + 70_000;
    for (;;) {
      wallet = await http('/me/wallet', { token: camila.token });
      if (wallet.body.seasonPoints === CAMILA_SEED.seasonPoints || Date.now() > deadline) break;
      await sleep(1_000);
    }
    expect(wallet.status).toBe(200);
    expect(wallet.body).toEqual({ balance: 12_480, xp: 12_480, seasonPoints: 4_120 });
    expect(wallet.headers.get('cache-control')).toBe('no-store');

    const progress = await http('/me/progress/', { token: camila.token });
    expect(progress.body).toEqual({
      xp: 12_480,
      level: { number: 7, name: 'Purainha', minXp: 7_000 },
      nextLevel: { number: 8, name: 'Xodó', minXp: 15_000 },
      weekEarned: 840,
      stats: { linksCreated: 0, peopleBrought: 0, seasons: 3 },
    });

    // De 2 em 2 até o fim. Os três ajustes do seed têm o mesmo createdAt, e a
    // terceira página corta entre eles: só o id no cursor desempata (sem ele, a
    // página seguinte pularia o que sobrou daquele milissegundo).
    type Item = { id: string; points: number };
    const pages: string[][] = [];
    const all: Item[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `limit=2&cursor=${cursor}` : 'limit=2';
      const page = await http(`/me/ledger?${query}`, { token: camila.token });
      expect(page.status).toBe(200);
      const items = page.body.items as Item[];
      pages.push(items.map((item) => item.id));
      all.push(...items);
      cursor = page.body.nextCursor as string | null;
    } while (cursor && pages.length < 10);
    expect(pages).toEqual([
      ['mission:seed-camila-4', 'mission:seed-camila-3'],
      ['mission:seed-camila-2', 'mission:seed-camila-1'],
      ['seed:camila-base-netto', 'seed:camila-base-nenho'],
      ['seed:camila-base'],
    ]);
    // Uma página de 5 corta entre o Netto e o Nenho, do mesmo milissegundo.
    const five = await http('/me/ledger?limit=5', { token: camila.token });
    const after = await http(`/me/ledger?limit=50&cursor=${String(five.body.nextCursor)}`, {
      token: camila.token,
    });
    expect((after.body.items as Item[]).map((item) => item.id)).toEqual([
      'seed:camila-base-nenho',
      'seed:camila-base',
    ]);
    expect(after.body.nextCursor).toBeNull();
    // Carteira e extrato fecham.
    expect(all.reduce((sum, item) => sum + item.points, 0)).toBe(12_480);
  });

  it('sem token, token inválido, rota desconhecida e método errado, no formato combinado', async () => {
    const fan = await signUpFan('Alan Ferreira');
    expect(await http('/me/wallet')).toMatchObject({
      status: 401,
      body: { code: 'unauthenticated', message: 'Entre na sua conta para continuar.' },
    });
    expect(await http('/me/wallet', { token: 'nao-e-um-token' })).toMatchObject({
      status: 401,
      body: { code: 'unauthenticated' },
    });
    expect(await http('/me/carteira', { token: fan.token })).toMatchObject({
      status: 404,
      body: { code: 'not_found', message: 'Não encontrado.' },
    });
    expect(await http('/me/wallet', { method: 'DELETE', token: fan.token })).toMatchObject({
      status: 405,
      body: { code: 'method_not_allowed' },
    });
  });

  it('fã novo, sem carteira: tudo zerado e nada criado', async () => {
    const fan = await signUpFan('Alan Ferreira');
    expect((await http('/me/wallet', { token: fan.token })).body).toEqual({
      balance: 0,
      xp: 0,
      seasonPoints: 0,
    });
    expect((await http('/me/progress', { token: fan.token })).body).toEqual({
      xp: 0,
      level: { number: 1, name: 'Primeiro passo', minXp: 0 },
      nextLevel: { number: 2, name: 'Na roda', minXp: 600 },
      weekEarned: 0,
      stats: { linksCreated: 0, peopleBrought: 0, seasons: 0 },
    });
    expect((await http('/me/ledger', { token: fan.token })).body).toEqual({
      items: [],
      nextCursor: null,
    });
    expect((await db.doc(`wallets/${fan.uid}`).get()).exists).toBe(false);
  });

  it('excluir a conta no Auth apaga a carteira, o extrato e os pontos por central', async () => {
    const fan = await signUpFan();
    await seedCamilaWallet(db, fan.uid);
    await auth.deleteUser(fan.uid);
    await waitFor(
      'a carteira sumir',
      async () => !(await db.doc(`wallets/${fan.uid}`).get()).exists,
    );
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(0);
    expect((await db.collection(`wallets/${fan.uid}/centralPoints`).get()).size).toBe(0);
  });
});

// --- O handler no processo, com rotas de teste que gravam -------------------------

const commentEntry = (id: string, artistId?: string): AwardEntry => ({
  kind: 'earn',
  source: 'comment',
  eventId: id,
  ...(artistId ? { artistId } : {}),
});

/**
 * Rotas que só existem neste teste. A ordem é a de uma rota de verdade:
 * leituras do domínio, planAwards, gravações do domínio.
 */
const TEST_ROUTES: ApiRoute[] = [
  {
    method: 'POST',
    pattern: '/teste/comentarios/:commentId',
    writes: true,
    async handle({ tx, fan, award, params, body, deps }) {
      const artistId = (body as { artistId?: string } | null)?.artistId;
      const ref = deps.db.doc(`testeComentarios/${params.commentId}`);
      await tx.get(ref);
      const plan = await planAwards(
        tx,
        deps.db,
        [{ uid: fan.uid, fan, entries: [commentEntry(params.commentId!, artistId)] }],
        award,
      );
      tx.set(ref, { uid: fan.uid });
      return { body: { id: params.commentId, pointsAwarded: plan.pointsAwarded }, plan };
    },
  },
  {
    method: 'POST',
    pattern: '/teste/resgates/:redemptionId',
    writes: true,
    async handle({ tx, fan, award, params, body, deps }) {
      const cost = (body as { cost: number }).cost;
      const plan = await planAwards(
        tx,
        deps.db,
        [
          {
            uid: fan.uid,
            fan,
            entries: [
              { kind: 'spend', source: 'redeem', eventId: params.redemptionId!, points: cost },
            ],
          },
        ],
        award,
      );
      tx.set(deps.db.doc(`testeResgates/${params.redemptionId}`), { uid: fan.uid, cost });
      return {
        body: { redemptionId: params.redemptionId, balance: plan.fans[0]!.wallet!.state.balance },
        plan,
      };
    },
  },
  {
    // Gravação sem ponto (como descurtir): só a atividade de quem chama.
    method: 'PUT',
    pattern: '/teste/marcas/:id',
    writes: true,
    async handle({ fan, params, tx, deps }) {
      tx.set(deps.db.doc(`testeMarcas/${params.id}`), { uid: fan.uid });
      return { body: { ok: true } };
    },
  },
  {
    // O claim do próprio convite (bloco 5): quem chama entra duas vezes no plano,
    // com o retrato e como quem convidou.
    method: 'POST',
    pattern: '/teste/proprio-convite/:id',
    writes: true,
    async handle({ tx, fan, award, params, deps }) {
      const plan = await planAwards(
        tx,
        deps.db,
        [
          { uid: fan.uid, fan, entries: [] },
          { uid: fan.uid, entries: [commentEntry(params.id!)] },
        ],
        award,
      );
      return { body: { pointsAwarded: plan.pointsAwarded }, plan };
    },
  },
  {
    // Resposta com campo undefined e data: o que a rota devolve é o que o app recebe.
    method: 'PUT',
    pattern: '/teste/formatos/:id',
    writes: true,
    async handle({ params, now }) {
      return { body: { id: params.id, opcional: undefined, quando: new Date(now) } };
    },
  },
];

type LocalResult = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function localApi(
  options: { now?: () => number; config?: ConfigSource; random?: () => number } = {},
) {
  const handler = createApiHandler(
    {
      db,
      auth,
      now: options.now ?? (() => NOW),
      random: options.random,
      config: options.config ?? staticConfigSource(),
    },
    [...API_ROUTES, ...TEST_ROUTES],
  );
  return async (
    method: string,
    path: string,
    request: { token: string; key?: string; body?: unknown },
  ): Promise<LocalResult> => {
    const headers: Record<string, string | undefined> = {
      authorization: `Bearer ${request.token}`,
      'idempotency-key': request.key,
    };
    const req: ApiRequest = {
      method,
      path,
      get: (name) => headers[name.toLowerCase()],
      query: {},
      body: request.body,
    };
    const sent: LocalResult = { status: 0, body: {}, headers: {} };
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
        sent.body = body as Record<string, unknown>;
      },
    };
    await handler(req, res);
    return sent;
  };
}

const withLimits = (dailyLimits: Partial<PointsConfig['dailyLimits']>): ConfigSource =>
  staticConfigSource({
    points: {
      ...DEFAULT_POINTS_CONFIG,
      dailyLimits: { ...DEFAULT_POINTS_CONFIG.dailyLimits, ...dailyLimits },
    },
  });

const read = async (path: string) => (await db.doc(path).get()).data();

async function seasonDoc(season: typeof SEASON_A | null): Promise<void> {
  await db
    .doc('config/season')
    .set({ version: 1, season, updatedAt: Timestamp.now(), updatedBy: null });
}

/** Soma de um campo numérico em todos os shards do dia. */
async function shardSum(day: string, pick: (data: DocumentData) => number): Promise<number> {
  const shards = await db.collection(`statsDaily/${day}/statsShards`).get();
  return shards.docs.reduce((sum, doc) => sum + pick(doc.data()), 0);
}

describe('award pela API', () => {
  it('comentar numa central: os três contadores, a central, o extrato e o shard do dia', async () => {
    await seasonDoc(SEASON_A);
    const fan = await signUpFan();
    const call = localApi();
    const result = await call('POST', '/teste/comentarios/c1', {
      token: fan.token,
      key: 'chave-c1-000',
      body: { artistId: 'nettobrito' },
    });
    expect(result).toMatchObject({ status: 200, body: { id: 'c1', pointsAwarded: 2 } });

    expect(await read(`wallets/${fan.uid}`)).toMatchObject({
      uid: fan.uid,
      balance: 2,
      xp: 2,
      seasonId: SEASON_A.id,
      seasonPoints: 2,
      earnedTotal: 2,
      days: { [TODAY]: { earned: 2, count: { comment: 1 } } },
      activity: { lastDay: TODAY, lastWeek: '2026-W41', lastMonth: '2026-10' },
      schemaVersion: 1,
    });
    expect(await read(`wallets/${fan.uid}/centralPoints/nettobrito`)).toMatchObject({
      seasonId: SEASON_A.id,
      seasonPoints: 2,
      totalPoints: 2,
    });
    expect(await read(`wallets/${fan.uid}/ledger/comment:c1`)).toMatchObject({
      kind: 'earn',
      source: 'comment',
      points: 2,
      artistId: 'nettobrito',
      actor: { type: 'fan', uid: fan.uid, name: null },
      day: TODAY,
    });
    expect(await read('testeComentarios/c1')).toEqual({ uid: fan.uid });
    expect(await shardSum(TODAY, (d) => d.totals?.earned ?? 0)).toBe(2);
    expect(
      await shardSum(TODAY, (d) => d.byArtist?.nettobrito?.bySource?.comment?.points ?? 0),
    ).toBe(2);
    expect(await shardSum(TODAY, (d) => d.actives?.day ?? 0)).toBe(1);
  });

  it('o mesmo evento não paga duas vezes, nem com outra chave', async () => {
    const fan = await signUpFan();
    const call = localApi();
    await call('POST', '/teste/comentarios/c1', { token: fan.token, key: 'chave-1-000' });
    const again = await call('POST', '/teste/comentarios/c1', {
      token: fan.token,
      key: 'chave-2-000',
    });
    expect(again).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(2);
  });

  it('a mesma chave devolve a resposta guardada, sem lançar de novo; com outro pedido, 422', async () => {
    const fan = await signUpFan();
    const call = localApi();
    const first = await call('POST', '/teste/comentarios/c1', {
      token: fan.token,
      key: 'mesma-chave-1',
    });
    const replay = await call('POST', '/teste/comentarios/c1', {
      token: fan.token,
      key: 'mesma-chave-1',
    });
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['Idempotency-Replayed']).toBe('true');
    expect(first.headers['Idempotency-Replayed']).toBeUndefined();

    const other = await call('POST', '/teste/comentarios/c2', {
      token: fan.token,
      key: 'mesma-chave-1',
    });
    expect(other).toMatchObject({
      status: 422,
      body: { code: 'idempotency_key_reused', message: 'Esta chave já foi usada em outro pedido.' },
    });
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(2);
    expect(await read('testeComentarios/c2')).toBeUndefined();

    // A chave vale por fã: a mesma chave de outro fã é outro pedido.
    const alan = await signUpFan('Alan Ferreira');
    const alanCall = await call('POST', '/teste/comentarios/c1', {
      token: alan.token,
      key: 'mesma-chave-1',
    });
    expect(alanCall.headers['Idempotency-Replayed']).toBeUndefined();
    expect((await read(`wallets/${alan.uid}`))?.balance).toBe(2);
  });

  it('resposta com campo undefined e data: grava, e a repetição é igual à primeira', async () => {
    const fan = await signUpFan();
    const call = localApi();
    const first = await call('PUT', '/teste/formatos/f1', { token: fan.token, key: 'formato-01' });
    expect(first).toMatchObject({
      status: 200,
      body: { id: 'f1', quando: '2026-10-05T15:00:00.000Z' },
    });
    expect(first.body).not.toHaveProperty('opcional');
    const replay = await call('PUT', '/teste/formatos/f1', { token: fan.token, key: 'formato-01' });
    expect(replay.headers['Idempotency-Replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('o mesmo fã duas vezes no plano (o próprio convite): uma carteira, com o ponto e a atividade', async () => {
    const fan = await signUpFan();
    const call = localApi({ random: () => 0 });
    const result = await call('POST', '/teste/proprio-convite/c1', {
      token: fan.token,
      key: 'proprio-0001',
    });
    expect(result).toMatchObject({ status: 200, body: { pointsAwarded: 2 } });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({
      balance: 2,
      days: { [TODAY]: { earned: 2, count: { comment: 1 } } },
      activity: { lastDay: TODAY, lastWeek: '2026-W41', lastMonth: '2026-10' },
    });
    expect(await read(`statsDaily/${TODAY}/statsShards/0`)).toMatchObject({
      totals: { earned: 2, earnedEvents: 1 },
      actives: { day: 1 },
    });

    // A atividade ficou na carteira: a ação seguinte do dia não conta o fã de novo.
    await call('PUT', '/teste/marcas/m1', { token: fan.token, key: 'proprio-0002' });
    expect(await shardSum(TODAY, (d) => d.actives?.day ?? 0)).toBe(1);
  });

  it('dois lançamentos no mesmo shard somam (merge com increment, sem sobrescrever)', async () => {
    const fan = await signUpFan();
    const call = localApi({ random: () => 0 });
    for (const id of ['c1', 'c2']) {
      await call('POST', `/teste/comentarios/${id}`, {
        token: fan.token,
        key: `mesmo-shard-${id}`,
        body: { artistId: 'nettobrito' },
      });
    }
    // Só os shards com pontos: o cadastro do fã (gatilho, signups.total) pode cair
    // no mesmo dia, num shard sorteado, quando o relógio real é o deste teste.
    const shards = (await db.collection(`statsDaily/${TODAY}/statsShards`).get()).docs.filter(
      (doc) => doc.get('totals') !== undefined,
    );
    expect(shards.map((doc) => doc.id)).toEqual(['0']);
    expect(shards[0]!.data()).toMatchObject({
      totals: { earned: 4, earnedEvents: 2 },
      bySource: { comment: { points: 4, events: 2 } },
      byArtist: {
        nettobrito: {
          earned: 4,
          earnedEvents: 2,
          bySource: { comment: { points: 4, events: 2 } },
        },
      },
      actives: { day: 1, newInWeek: 1, newInMonth: 1 },
    });
  });

  it('dois pedidos em paralelo com a mesma chave lançam uma vez', async () => {
    const fan = await signUpFan();
    const call = localApi({ random: Math.random });
    const results = await Promise.all(
      [0, 1].map(() =>
        call('POST', '/teste/comentarios/c1', { token: fan.token, key: 'paralela-1' }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(results.filter((r) => r.headers['Idempotency-Replayed'] === 'true')).toHaveLength(1);
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(2);
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(1);
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(1);
  });

  it('dez lançamentos em paralelo do mesmo fã somam certo, no extrato e no shard', async () => {
    const fan = await signUpFan();
    const call = localApi({ random: Math.random });
    await call('POST', '/teste/comentarios/c0', { token: fan.token, key: 'paralelo-000' });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        call('POST', `/teste/comentarios/c${index + 1}`, {
          token: fan.token,
          key: `paralelo-${String(index + 1).padStart(3, '0')}`,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({
      balance: 22,
      xp: 22,
      days: { [TODAY]: { earned: 22, count: { comment: 11 } } },
    });
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(11);
    expect(await shardSum(TODAY, (d) => d.totals?.earned ?? 0)).toBe(22);
    expect(await shardSum(TODAY, (d) => d.totals?.earnedEvents ?? 0)).toBe(11);
    expect(await shardSum(TODAY, (d) => d.bySource?.comment?.events ?? 0)).toBe(11);
  });

  it('o limite do dia corta sem erro, e o dia seguinte paga de novo', async () => {
    const fan = await signUpFan();
    let clock = NOW;
    const call = localApi({ now: () => clock, config: withLimits({ comment: 2 }) });
    const points: unknown[] = [];
    for (const id of ['c1', 'c2', 'c3']) {
      const result = await call('POST', `/teste/comentarios/${id}`, {
        token: fan.token,
        key: `limite-${id}-00`,
      });
      expect(result.status).toBe(200);
      points.push(result.body.pointsAwarded);
    }
    expect(points).toEqual([2, 2, 0]);
    // O comentário que passou do limite aconteceu (a ação), sem lançamento.
    expect(await read('testeComentarios/c3')).toEqual({ uid: fan.uid });
    expect(await read(`wallets/${fan.uid}/ledger/comment:c3`)).toBeUndefined();

    clock = Date.parse('2026-10-06T03:00:00.000Z');
    const tomorrow = await call('POST', '/teste/comentarios/c3', {
      token: fan.token,
      key: 'limite-c3-01',
    });
    expect(tomorrow.body.pointsAwarded).toBe(2);
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(6);
  });

  it('a temporada trocada em config/season vale no lançamento seguinte, sem esperar o cache, e não volta', async () => {
    await seasonDoc(SEASON_A);
    const fan = await signUpFan();
    // Duas instâncias com o cache de 60 s: a segunda leu a configuração antes da troca.
    const first = localApi({ config: createConfigSource(db) });
    const stale = localApi({ config: createConfigSource(db) });
    await first('POST', '/teste/comentarios/c1', { token: fan.token, key: 'temporada-1' });
    await stale('GET', '/me/wallet', { token: fan.token });

    await seasonDoc({ ...SEASON_A, id: 'temporada-de-verao' });
    await first('POST', '/teste/comentarios/c2', { token: fan.token, key: 'temporada-2' });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({
      seasonId: 'temporada-de-verao',
      seasonPoints: 2,
      stats: { pastSeasons: 1 },
    });

    await stale('POST', '/teste/comentarios/c3', { token: fan.token, key: 'temporada-3' });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({
      seasonId: 'temporada-de-verao',
      seasonPoints: 4,
      stats: { pastSeasons: 1 },
    });
  });

  it('perfil ausente: 503 profile_not_ready, também em gravação sem ponto, e nada gravado', async () => {
    const fan = await signUpFan();
    await db.doc(`users/${fan.uid}`).delete();
    const call = localApi();
    for (const [method, path] of [
      ['POST', '/teste/comentarios/c1'],
      ['PUT', '/teste/marcas/m1'],
    ] as const) {
      const result = await call(method, path, { token: fan.token, key: 'sem-perfil-1' });
      expect(result).toMatchObject({
        status: 503,
        body: {
          code: 'profile_not_ready',
          message: 'Seu perfil ainda está sendo criado. Tente de novo em instantes.',
        },
      });
    }
    expect(await read(`wallets/${fan.uid}`)).toBeUndefined();
    expect(await read('testeMarcas/m1')).toBeUndefined();
    expect((await db.collection('idempotency').get()).size).toBe(0);
  });

  it('conta só da equipe: 403 not_fan', async () => {
    const uid = unique('equipe');
    await db
      .doc(`staff/${uid}`)
      .set({ uid, status: 'active', role: 'admin', accountCreatedByInvite: true });
    await auth.createUser({ uid, email: `${uid}@teste.dev`, password: 'senha-da-equipe' });
    const token = await signInToken(`${uid}@teste.dev`, 'senha-da-equipe');
    const result = await localApi()('PUT', '/teste/marcas/m1', { token, key: 'equipe-0001' });
    expect(result).toMatchObject({
      status: 403,
      body: { code: 'not_fan', message: 'Esta conta não é de fã.' },
    });
  });

  it('primeira ação sem ponto do dia marca o fã ativo; a segunda não grava carteira nem shard', async () => {
    const fan = await signUpFan();
    const call = localApi({ random: () => 0 });
    await call('PUT', '/teste/marcas/m1', { token: fan.token, key: 'marca-0001' });
    const wallet = await db.doc(`wallets/${fan.uid}`).get();
    expect(wallet.data()).toMatchObject({
      balance: 0,
      activity: { lastDay: TODAY, lastWeek: '2026-W41', lastMonth: '2026-10' },
    });
    const shard = await db.doc(`statsDaily/${TODAY}/statsShards/0`).get();
    expect(shard.data()).toMatchObject({
      day: TODAY,
      actives: { day: 1, newInWeek: 1, newInMonth: 1 },
    });
    // A coorte é a semana do cadastro (hoje, no relógio real do gatilho).
    expect(Object.values(shard.get('cohorts') as Record<string, { active: number }>)).toEqual([
      { active: 1 },
    ]);

    await call('PUT', '/teste/marcas/m2', { token: fan.token, key: 'marca-0002' });
    expect((await db.doc(`wallets/${fan.uid}`).get()).updateTime).toEqual(wallet.updateTime);
    expect((await db.doc(`statsDaily/${TODAY}/statsShards/0`).get()).updateTime).toEqual(
      shard.updateTime,
    );
    expect(await read('testeMarcas/m2')).toEqual({ uid: fan.uid });
  });
});

/** Entra pela API do Auth e devolve o ID token. */
async function signInToken(email: string, password: string): Promise<string> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`Não entrou com ${email}.`);
  return body.idToken;
}

describe('débito do resgate', () => {
  it('sem saldo recusa com 409 insufficient_points, sem gravar nada, nem a chave', async () => {
    const fan = await signUpFan();
    const call = localApi();
    await call('POST', '/teste/comentarios/c1', { token: fan.token, key: 'saldo-0001' });
    const before = await db.doc(`wallets/${fan.uid}`).get();

    const refused = await call('POST', '/teste/resgates/r1', {
      token: fan.token,
      key: 'resgate-0001',
      body: { cost: 300 },
    });
    expect(refused).toMatchObject({
      status: 409,
      body: {
        code: 'insufficient_points',
        message: 'Saldo insuficiente.',
        details: { balance: 2, cost: 300 },
      },
    });
    expect((await db.doc(`wallets/${fan.uid}`).get()).updateTime).toEqual(before.updateTime);
    expect(await read('testeResgates/r1')).toBeUndefined();
    expect(await read(`wallets/${fan.uid}/ledger/redeem:r1`)).toBeUndefined();
    // Recusa não grava a chave: a mesma chave é avaliada de novo.
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(1);
  });

  it('com saldo, só o saldo cai', async () => {
    await seasonDoc(SEASON_A);
    const fan = await signUpFan();
    await seedCamilaWallet(db, fan.uid, { now: NOW });
    const result = await localApi()('POST', '/teste/resgates/r1', {
      token: fan.token,
      key: 'resgate-0002',
      body: { cost: 8_500 },
    });
    expect(result).toMatchObject({ status: 200, body: { redemptionId: 'r1', balance: 3_980 } });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({
      balance: 3_980,
      xp: 12_480,
      seasonPoints: 4_120,
      spentTotal: 8_500,
    });
    expect(await read(`wallets/${fan.uid}/ledger/redeem:r1`)).toMatchObject({
      kind: 'spend',
      points: -8_500,
      xpDelta: 0,
      seasonDelta: 0,
      balanceAfter: 3_980,
    });
    expect(await shardSum(TODAY, (d) => d.totals?.spent ?? 0)).toBe(8_500);
  });
});

describe('exclusão de conta', () => {
  it('deleteUserData apaga carteira, extrato, centrais e chaves; os agregados ficam; gravar depois recusa', async () => {
    const fan = await signUpFan();
    const call = localApi({ random: () => 0 });
    await call('POST', '/teste/comentarios/c1', {
      token: fan.token,
      key: 'exclui-0001',
      body: { artistId: 'nenho' },
    });
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(1);

    await deleteUserData(db, fan.uid);

    expect(await read(`users/${fan.uid}`)).toBeUndefined();
    expect(await read(`wallets/${fan.uid}`)).toBeUndefined();
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(0);
    expect((await db.collection(`wallets/${fan.uid}/centralPoints`).get()).size).toBe(0);
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(0);
    // Os agregados contam o que aconteceu no dia, sem uid: não descontam.
    expect(await read(`statsDaily/${TODAY}/statsShards/0`)).toMatchObject({
      totals: { earned: 2 },
    });

    // O token ainda vale, mas toda gravação exige o perfil.
    const after = await call('POST', '/teste/comentarios/c2', {
      token: fan.token,
      key: 'exclui-0002',
    });
    expect(after).toMatchObject({ status: 503, body: { code: 'profile_not_ready' } });
    expect(await read(`wallets/${fan.uid}`)).toBeUndefined();
  });
});

describe('seed da Camila', () => {
  it('fica com 12.480, 12.480, 4.120, Netto 4.120 e Nenho 2.980; rodar de novo não muda nada', async () => {
    const camila = await signUpFan();
    await seedCamilaWallet(db, camila.uid, { now: NOW });
    const wallet = await db.doc(`wallets/${camila.uid}`).get();
    expect(wallet.data()).toMatchObject({
      balance: 12_480,
      xp: 12_480,
      seasonId: 'temporada-sao-joao',
      seasonPoints: 4_120,
      earnedTotal: 840,
      stats: { pastSeasons: 2 },
    });
    expect(await read(`wallets/${camila.uid}/centralPoints/nettobrito`)).toMatchObject({
      seasonPoints: 4_120,
      totalPoints: 4_120,
    });
    expect(await read(`wallets/${camila.uid}/centralPoints/nenho`)).toMatchObject({
      seasonPoints: 2_980,
      totalPoints: 2_980,
    });
    // O seed não marca atividade (ator do sistema).
    expect(wallet.get('activity')).toEqual({ lastDay: null, lastWeek: null, lastMonth: null });

    const progress = await localApi({ config: createConfigSource(db) })('GET', '/me/progress', {
      token: camila.token,
    });
    expect(progress.body).toMatchObject({ xp: 12_480, weekEarned: 840, stats: { seasons: 3 } });

    await seedCamilaWallet(db, camila.uid, { now: NOW });
    const again = await db.doc(`wallets/${camila.uid}`).get();
    expect(again.data()).toEqual(wallet.data());
    expect((await db.collection(`wallets/${camila.uid}/ledger`).get()).size).toBe(7);
  });
});
