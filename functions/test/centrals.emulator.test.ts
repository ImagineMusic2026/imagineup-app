import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHandler, type ApiRequest } from '../src/api';
import {
  CAMILA_CENTRALS,
  CENTRAL_ENTRIES_PER_DAY,
  CENTRALS_MAX,
  SEED_CENTRALS,
  seedCamilaCentrals,
  seedCentrals,
} from '../src/centrals';
import {
  CAMILA_SEED,
  createConfigSource,
  dayKey,
  runAward,
  seedCamilaWallet,
  shiftDay,
} from '../src/points';
import { SECTION_IDS } from '../src/staff/model';
import { deleteUserData } from '../src/store';

/**
 * Centrais de verdade (bloco 4) nos emuladores. Rode com `npm run
 * test:functions`, na raiz do app. A função `api` de verdade, pelo HTTP do
 * emulador de Functions, com o ID token do emulador de Auth; o gatilho
 * queueArtistFanCountSync roda no emulador de Functions e a tarefa
 * syncArtistFanCount no do Cloud Tasks, que sobe junto (lá, uma tarefa por
 * gravação, na hora). Os testes esperam o fanCount mudar, até 15 s.
 */
const PROJECT_ID = 'demo-imagine-up-app';
const REGION = 'southamerica-east1';
const app = initializeApp({ projectId: PROJECT_ID }, 'centrais');
const auth = getAuth(app);
const db = getFirestore(app);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let functionsOrigin = '';
let apiBase = '';

beforeAll(async () => {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) throw new Error('Rode com npm run test:functions.');
  const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
    functions?: { host: string; port: number };
  };
  if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
  const { host, port } = emulators.functions;
  functionsOrigin = `http://${host}:${port}`;
  apiBase = `${functionsOrigin}/${PROJECT_ID}/${REGION}/api`;
  const { backends } = (await (await fetch(`${functionsOrigin}/backends`)).json()) as {
    backends: { functionTriggers: { entryPoint: string }[] }[];
  };
  const loaded = backends.flatMap((backend) => backend.functionTriggers.map((t) => t.entryPoint));
  const missing = [
    'api',
    'createUserProfile',
    'deleteUserProfile',
    'deleteArtist',
    'queueArtistFanCountSync',
    'syncArtistFanCount',
  ].filter((name) => !loaded.includes(name));
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

// Ids únicos na execução inteira: uma tarefa atrasada de um teste nunca acerta
// a central do teste seguinte.
let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}`;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

async function waitFor(what: string, check: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando ${what}.`);
    await sleep(200);
  }
}

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
  await waitFor('o perfil do fã', () => exists(`users/${localId}`), 30_000);
  return { uid: localId, token: idToken };
}

const image = (id: string, kind: 'photo' | 'thumb') => ({
  url: `https://storage.exemplo/${id}/${kind}.webp`,
  path: `artists/${id}/${kind}-1-${kind === 'photo' ? 1200 : 480}.webp`,
  width: kind === 'photo' ? 1200 : 480,
  height: kind === 'photo' ? 1600 : 640,
});

/** Central no formato que o painel grava, direto pelo Admin SDK. */
async function central(
  extra: Record<string, unknown> = {},
  id: string = unique('central'),
): Promise<string> {
  const at = Timestamp.now();
  await db.doc(`artists/${id}`).set({
    handle: id,
    name: `Central ${id}`,
    shortName: null,
    genre: null,
    city: null,
    bio: null,
    verified: true,
    photo: image(id, 'photo'),
    thumb: image(id, 'thumb'),
    order: 0,
    status: 'published',
    fanCount: 0,
    publishedAt: at,
    createdAt: at,
    updatedAt: at,
    ...extra,
  });
  return id;
}

type HttpResult = { status: number; body: Record<string, unknown>; headers: Headers };

async function http(
  path: string,
  init: { method?: string; token?: string; key?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.key) headers['Idempotency-Key'] = init.key;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

const join = (fan: Fan, artistId: string, key = unique('chave-entrar-')) =>
  http(`/me/centrals/${artistId}`, { method: 'PUT', token: fan.token, key });
const leave = (fan: Fan, artistId: string, key = unique('chave-sair-')) =>
  http(`/me/centrals/${artistId}`, { method: 'DELETE', token: fan.token, key });
const follow = (fan: Fan, artistIds: unknown, key = unique('chave-seguir-')) =>
  http('/me/artists', { method: 'POST', token: fan.token, key, body: { artistIds } });

/** Soma dos shards do fanCount de uma central. */
async function shardSum(artistId: string): Promise<number> {
  const shards = await db.collection(`artistStats/${artistId}/fanShards`).get();
  return shards.docs.reduce((sum, doc) => sum + (doc.get('count') as number), 0);
}

/** Espera a fila copiar o fanCount esperado (com o fanCountAt). */
async function waitForFanCount(artistId: string, expected: number): Promise<DocumentData> {
  let last: DocumentData | undefined;
  await waitFor(`o fanCount ${expected} em ${artistId}`, async () => {
    last = await read(`artists/${artistId}`);
    return last?.fanCount === expected && last?.fanCountAt instanceof Timestamp;
  });
  return last!;
}

/**
 * Soma de um campo nos shards do painel dos dias dados. O dia é o que o
 * servidor usou (o `day` do extrato, ou os dias entre o antes e o depois do
 * pedido), e não o do relógio depois da resposta: perto da meia-noite de São
 * Paulo os dois não batem.
 */
async function statsSum(
  days: readonly string[],
  pick: (data: DocumentData) => number,
): Promise<number> {
  let total = 0;
  for (const day of new Set(days)) {
    const shards = await db.collection(`statsDaily/${day}/statsShards`).get();
    total += shards.docs.reduce((sum, doc) => sum + pick(doc.data()), 0);
  }
  return total;
}

/** Os dias de São Paulo em que um pedido feito entre `from` e agora pode ter caído. */
const daysSince = (from: number): string[] => [dayKey(from), dayKey(Date.now())];

/** O dia que o servidor usou na entrada paga: o `day` do extrato `central_join`. */
async function joinDay(uid: string, artistId: string): Promise<string> {
  const day = (await read(`wallets/${uid}/ledger/central_join:${artistId}`))?.day;
  if (typeof day !== 'string') throw new Error(`Sem extrato da entrada em ${artistId}.`);
  return day;
}

describe('ler as centrais', () => {
  it('GET /artists: só as publicadas, na ordem, com a miniatura; rascunho e fora do ar não aparecem', async () => {
    const fan = await signUpFan();
    const second = await central({ order: 2, fanCount: 7 });
    const first = await central({ order: 1, photo: null, thumb: null });
    await central({ order: 0, status: 'draft', publishedAt: null });
    await central({ order: 3, status: 'unpublished' });

    const list = await http('/artists', { token: fan.token });
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      { id: first, name: `Central ${first}`, photoURL: null, fanCount: 0, order: 1 },
      {
        id: second,
        name: `Central ${second}`,
        photoURL: `https://storage.exemplo/${second}/thumb.webp`,
        fanCount: 7,
        order: 2,
      },
    ]);
  });

  it('GET /artists/:id: publicada responde; rascunho, fora do ar, inexistente e id malformado dão 404', async () => {
    const fan = await signUpFan();
    const id = await central({ managedByImagine: true });
    const page = await http(`/artists/${id}`, { token: fan.token });
    expect(page).toMatchObject({
      status: 200,
      body: {
        id,
        name: `Central ${id}`,
        coverUrl: `https://storage.exemplo/${id}/photo.webp`,
        photoURL: `https://storage.exemplo/${id}/thumb.webp`,
        verified: true,
        managedByImagine: true,
        fanCount: 0,
        postCount: 0,
        centralPoints: 0,
        isMember: false,
      },
    });

    const draft = await central({ status: 'draft' });
    const off = await central({ status: 'unpublished' });
    for (const path of [
      `/artists/${draft}`,
      `/artists/${off}`,
      '/artists/naoexiste',
      '/artists/Netto-Brito',
    ]) {
      expect(await http(path, { token: fan.token })).toMatchObject({
        status: 404,
        body: { code: 'artist_not_found', message: 'Central não encontrada.' },
      });
    }
  });

  it('"PTS DA CENTRAL" soma o total dos fãs na central, e isMember vem do vínculo', async () => {
    const id = await central();
    const camila = await signUpFan();
    const alan = await signUpFan('Alan Ferreira');
    const config = (await createConfigSource(db, { ttlMs: 0 }).get()).points;
    const actor = { type: 'system' as const, uid: null, name: null };
    await runAward(
      db,
      camila.uid,
      [{ kind: 'adjust', source: 'seed', eventId: 'a', central: { artistId: id, total: 300 } }],
      { now: Date.now(), config, actor },
    );
    await runAward(
      db,
      alan.uid,
      [{ kind: 'adjust', source: 'seed', eventId: 'b', central: { artistId: id, total: 45 } }],
      { now: Date.now(), config, actor },
    );

    expect((await http(`/artists/${id}`, { token: alan.token })).body).toMatchObject({
      centralPoints: 345,
      isMember: false,
    });
    expect((await join(camila, id)).status).toBe(200);
    expect((await http(`/artists/${id}`, { token: camila.token })).body).toMatchObject({
      centralPoints: 355,
      isMember: true,
    });
  });
});

describe('entrar na central (PUT /me/centrals/:artistId)', () => {
  it('vínculo, +1 nos shards, a fila copia o fanCount, paga 10 e soma joined no painel', async () => {
    const fan = await signUpFan();
    const id = await central();
    const before = Date.now();

    const result = await join(fan, id, 'chave-entrar-1');
    expect(result).toMatchObject({ status: 200, body: { artistId: id, pointsAwarded: 10 } });

    // Logo depois, com ou sem a cópia: a página e "Suas centrais" contam o fã.
    const page = await http(`/artists/${id}`, { token: fan.token });
    expect(page.body).toMatchObject({ isMember: true, fanCount: 1 });
    const mine = await http('/me/centrals', { token: fan.token });
    expect(mine.body).toEqual([
      {
        artistId: id,
        name: `Central ${id}`,
        shortName: null,
        photoURL: `https://storage.exemplo/${id}/thumb.webp`,
        fanCount: 1,
        fanRank: null,
        seasonPoints: 0,
      },
    ]);

    expect(await read(`users/${fan.uid}/centrals/${id}`)).toMatchObject({
      uid: fan.uid,
      artistId: id,
      via: 'page',
      schemaVersion: 1,
    });
    expect(await shardSum(id)).toBe(1);
    const copied = await waitForFanCount(id, 1);
    expect((copied.fanCountAt as Timestamp).toMillis()).toBeGreaterThanOrEqual(before);
    // A cópia não mexe no carimbo das edições da equipe.
    expect(copied.updatedAt).toEqual(copied.createdAt);

    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 10, xp: 10 });
    expect(await read(`wallets/${fan.uid}/ledger/central_join:${id}`)).toMatchObject({
      source: 'central_join',
      points: 10,
      artistId: id,
      subject: { type: 'artist', id },
    });
    // Membro da central (bloco 8, 23.7): entra no ranking dela.
    expect(await read(`wallets/${fan.uid}/centralPoints/${id}`)).toMatchObject({
      totalPoints: 10,
      member: true,
    });
    const day = await joinDay(fan.uid, id);
    expect(await statsSum([day], (d) => d.totals?.joined ?? 0)).toBe(1);
    expect(await statsSum([day], (d) => d.byArtist?.[id]?.joined ?? 0)).toBe(1);
    // A entrada conta no teto do dia, na carteira.
    const entries = async () =>
      (await db.doc(`wallets/${fan.uid}`).get()).get(
        new FieldPath('days', day, 'count', 'central_entry'),
      );
    expect(await entries()).toBe(1);

    // A mesma chave devolve a resposta guardada, sem efeito.
    const replay = await join(fan, id, 'chave-entrar-1');
    expect(replay.body).toEqual(result.body);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    // Outra chave com o fã dentro: 0 ponto, nada nos shards, e não conta no teto.
    expect(await join(fan, id)).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    expect(await shardSum(id)).toBe(1);
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(10);
    expect(await entries()).toBe(1);
  });

  it('com o teto do dia, entrar é recusado com 429 e Retry-After; sair sempre pode', async () => {
    const fan = await signUpFan();
    const a = await central();
    const b = await central();
    expect((await join(fan, a)).status).toBe(200);
    // O teto no dia de agora e no seguinte: o pedido pode cair depois da meia-noite.
    const today = dayKey(Date.now());
    await db
      .doc(`wallets/${fan.uid}`)
      .update(
        new FieldPath('days', today, 'count', 'central_entry'),
        CENTRAL_ENTRIES_PER_DAY,
        new FieldPath('days', shiftDay(today, 1), 'count', 'central_entry'),
        CENTRAL_ENTRIES_PER_DAY,
      );

    const refused = await join(fan, b);
    expect(refused).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: CENTRAL_ENTRIES_PER_DAY } },
    });
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);
    expect(await exists(`users/${fan.uid}/centrals/${b}`)).toBe(false);
    expect(await shardSum(b)).toBe(0);
    expect(await follow(fan, [b])).toMatchObject({ status: 429 });

    // Quem já está na central não cria vínculo, e não é recusado.
    expect(await join(fan, a)).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    // Sair vale; voltar é entrada de novo, e o teto continua.
    expect(await leave(fan, a)).toMatchObject({ status: 200 });
    expect(await shardSum(a)).toBe(0);
    expect(await join(fan, a)).toMatchObject({ status: 429 });
    expect(await exists(`users/${fan.uid}/centrals/${a}`)).toBe(false);
  });

  it('central fora do ar ou em rascunho: 404 e nada gravado', async () => {
    const fan = await signUpFan();
    for (const status of ['draft', 'unpublished']) {
      const id = await central({ status });
      expect(await join(fan, id)).toMatchObject({
        status: 404,
        body: { code: 'artist_not_found' },
      });
      expect(await exists(`users/${fan.uid}/centrals/${id}`)).toBe(false);
      expect(await shardSum(id)).toBe(0);
    }
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);
  });

  it('sem perfil: 503 profile_not_ready; conta só da equipe: 403 not_fan', async () => {
    const id = await central();
    const fan = await signUpFan();
    await db.doc(`users/${fan.uid}`).delete();
    expect(await join(fan, id)).toMatchObject({ status: 503, body: { code: 'profile_not_ready' } });

    const uid = unique('equipe');
    await db
      .doc(`staff/${uid}`)
      .set({ uid, role: 'viewer', status: 'active', accountCreatedByInvite: true });
    await auth.createUser({ uid, email: `${uid}@teste.dev`, password: 'senha-da-equipe' });
    const token = await signIn(`${uid}@teste.dev`, 'senha-da-equipe');
    expect(await join({ uid, token }, id)).toMatchObject({
      status: 403,
      body: { code: 'not_fan' },
    });
    expect(await shardSum(id)).toBe(0);
  });
});

describe('sair da central (DELETE /me/centrals/:artistId)', () => {
  it('tira o vínculo, desconta o shard, a fila volta o fanCount, soma left, e os pontos ficam', async () => {
    const fan = await signUpFan();
    const id = await central();
    await join(fan, id);
    await waitForFanCount(id, 1);

    const leftFrom = Date.now();
    expect(await leave(fan, id)).toMatchObject({ status: 200, body: { artistId: id } });
    const leftDays = daysSince(leftFrom);
    expect(await exists(`users/${fan.uid}/centrals/${id}`)).toBe(false);
    expect(await shardSum(id)).toBe(0);
    await waitForFanCount(id, 0);
    expect(await statsSum(leftDays, (d) => d.byArtist?.[id]?.left ?? 0)).toBe(1);
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 10, xp: 10 });
    // Sai do ranking da central (member: false) e os pontos ficam (bloco 8, 23.7).
    expect(await read(`wallets/${fan.uid}/centralPoints/${id}`)).toMatchObject({
      totalPoints: 10,
      member: false,
    });
    expect((await http(`/artists/${id}`, { token: fan.token })).body).toMatchObject({
      isMember: false,
    });
    expect((await http('/me/centrals', { token: fan.token })).body).toEqual([]);

    // Sair sem vínculo: 200 sem mexer em shard.
    expect(await leave(fan, id)).toMatchObject({ status: 200, body: { artistId: id } });
    expect(await shardSum(id)).toBe(0);

    // Entrar de novo cria o vínculo, volta ao ranking com os pontos e não paga a entrada outra vez.
    expect(await join(fan, id)).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    expect(await exists(`users/${fan.uid}/centrals/${id}`)).toBe(true);
    expect(await read(`wallets/${fan.uid}/centralPoints/${id}`)).toMatchObject({
      totalPoints: 10,
      member: true,
    });
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(10);
    await waitForFanCount(id, 1);
  });

  it('sair vale em qualquer status da central, e desconta o fanCount dela', async () => {
    const fan = await signUpFan();
    const id = await central();
    await join(fan, id);
    await waitForFanCount(id, 1);
    await db.doc(`artists/${id}`).update({ status: 'unpublished' });
    expect((await http('/me/centrals', { token: fan.token })).body).toEqual([]);
    expect(await leave(fan, id)).toMatchObject({ status: 200 });
    expect(await exists(`users/${fan.uid}/centrals/${id}`)).toBe(false);
    expect(await shardSum(id)).toBe(0);
    await waitForFanCount(id, 0);
  });
});

describe('seguir na escolha de artistas (POST /me/artists)', () => {
  it('3 centrais: 3 vínculos, 30 pontos e followedArtistIds na ordem', async () => {
    const fan = await signUpFan();
    const a = await central({ order: 2 });
    const b = await central({ order: 0 });
    const c = await central({ order: 1 });
    const result = await follow(fan, [a, b, c]);
    expect(result).toMatchObject({
      status: 200,
      body: { followedArtistIds: [b, c, a], pointsAwarded: 30 },
    });
    for (const id of [a, b, c]) {
      expect(await read(`users/${fan.uid}/centrals/${id}`)).toMatchObject({ via: 'onboarding' });
      expect(await read(`wallets/${fan.uid}/centralPoints/${id}`)).toMatchObject({ member: true });
    }
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(30);
    const mine = (await http('/me/centrals', { token: fan.token })).body as unknown as {
      artistId: string;
    }[];
    expect(mine.map((item) => item.artistId)).toEqual([b, c, a]);
  });

  it('uma fora do ar: 404 com os ids, e nada gravado (tudo ou nada)', async () => {
    const fan = await signUpFan();
    const ok = await central();
    const off = await central({ status: 'unpublished' });
    expect(await follow(fan, [ok, off])).toMatchObject({
      status: 404,
      body: { code: 'artist_not_found', details: { artistIds: [off] } },
    });
    expect(await exists(`users/${fan.uid}/centrals/${ok}`)).toBe(false);
    expect(await shardSum(ok)).toBe(0);
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);
  });

  it('a que o fã já segue não paga de novo e continua na lista', async () => {
    const fan = await signUpFan();
    const a = await central({ order: 0 });
    const b = await central({ order: 1 });
    await join(fan, a);
    const result = await follow(fan, [a, b]);
    // As recompensas da ação vão sempre (bloco 7, 22.2), também sem missão nenhuma.
    expect(result.body).toEqual({
      followedArtistIds: [a, b],
      pointsAwarded: 10,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
    expect(await shardSum(a)).toBe(1);
  });

  it('a 11ª do dia entra sem ponto (limite diário de central_join)', async () => {
    const fan = await signUpFan();
    const ids: string[] = [];
    for (let index = 0; index < 11; index += 1) ids.push(await central({ order: index }));
    const result = await follow(fan, ids);
    expect(result.body).toMatchObject({ pointsAwarded: 100 });
    expect((result.body.followedArtistIds as string[]).length).toBe(11);
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${ids[10]}`)).toBe(false);
  });

  it('fã com mais de 240 vínculos: a pedida que ele já segue, fora da lista, não quebra o pedido', async () => {
    const fan = await signUpFan();
    // Vem depois dos 240 na ordem dos ids: a lista do readFollow não a traz.
    const id = await central({}, unique('zzcentral'));
    const at = Timestamp.now();
    const batch = db.batch();
    const link = (artistId: string) =>
      batch.set(db.doc(`users/${fan.uid}/centrals/${artistId}`), {
        uid: fan.uid,
        artistId,
        via: 'seed',
        joinedAt: at,
        schemaVersion: 1,
      });
    for (let index = 0; index < CENTRALS_MAX; index += 1) {
      link(`a${String(index).padStart(3, '0')}`);
    }
    link(id);
    await batch.commit();

    const result = await follow(fan, [id]);
    expect(result).toMatchObject({
      status: 200,
      body: { followedArtistIds: [id], pointsAwarded: 0 },
    });
    expect(await shardSum(id)).toBe(0);
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${id}`)).toBe(false);
  });

  it('51 ids ou id repetido: 400', async () => {
    const fan = await signUpFan();
    const many = Array.from({ length: 51 }, (_, index) => `central${index + 1}`);
    expect(await follow(fan, many)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request' },
    });
    expect(await follow(fan, ['nenho', 'nenho'])).toMatchObject({ status: 400 });
  });
});

describe('concorrência', () => {
  it('10 fãs entrando juntos na mesma central: shards e fanCount em 10', async () => {
    const id = await central();
    const fans = await Promise.all(
      Array.from({ length: 10 }, (_, index) => signUpFan(`Fã Número ${index + 1}`)),
    );
    const results = await Promise.all(fans.map((fan) => join(fan, id)));
    expect(results.map((result) => result.status)).toEqual(Array(10).fill(200));
    expect(await shardSum(id)).toBe(10);
    await waitForFanCount(id, 10);
  });

  it('o mesmo fã entrando e saindo em paralelo, com chaves diferentes: vínculo e soma coerentes', async () => {
    const fan = await signUpFan();
    const id = await central();
    const results = await Promise.all([
      join(fan, id),
      leave(fan, id),
      join(fan, id),
      leave(fan, id),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
    const member = await exists(`users/${fan.uid}/centrals/${id}`);
    expect(await shardSum(id)).toBe(member ? 1 : 0);
    await waitForFanCount(id, member ? 1 : 0);
    // A entrada paga uma vez só, por mais que o fã entre e saia.
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(10);
  });
});

describe('exclusão de conta', () => {
  it('desconta o fanCount de cada central do fã, nunca negativo, e não desconta duas vezes', async () => {
    const fan = await signUpFan();
    const other = await signUpFan('Alan Ferreira');
    const ids = [
      await central({ order: 0 }),
      await central({ order: 1 }),
      await central({ order: 2 }),
    ];
    await follow(fan, ids);
    await join(other, ids[0]!);
    await waitForFanCount(ids[0]!, 2);

    await deleteUserData(db, fan.uid);
    expect((await db.collection(`users/${fan.uid}/centrals`).get()).size).toBe(0);
    expect(await exists(`users/${fan.uid}`)).toBe(false);
    expect(await shardSum(ids[0]!)).toBe(1);
    expect(await shardSum(ids[1]!)).toBe(0);
    await waitForFanCount(ids[0]!, 1);
    await waitForFanCount(ids[1]!, 0);
    await waitForFanCount(ids[2]!, 0);

    // De novo (o gatilho de exclusão repete): nada sai duas vezes.
    await deleteUserData(db, fan.uid);
    expect(await shardSum(ids[0]!)).toBe(1);
    expect(await shardSum(ids[2]!)).toBe(0);

    // Com o perfil apagado, entrar dá 503 e não cria vínculo.
    expect(await join(fan, ids[1]!)).toMatchObject({
      status: 503,
      body: { code: 'profile_not_ready' },
    });
    expect(await exists(`users/${fan.uid}/centrals/${ids[1]}`)).toBe(false);
  });

  it('excluir a conta no Auth tira o fã das centrais pelo gatilho', async () => {
    const fan = await signUpFan();
    const id = await central();
    await join(fan, id);
    await waitForFanCount(id, 1);
    await auth.deleteUser(fan.uid);
    await waitForFanCount(id, 0);
    expect((await db.collection(`users/${fan.uid}/centrals`).get()).size).toBe(0);
  });
});

describe('a fila do fanCount', () => {
  it('shards somando negativo deixam o fanCount em 0', async () => {
    const id = await central({ fanCount: 3 });
    await db.doc(`artistStats/${id}/fanShards/0`).set({ count: -1, updatedAt: Timestamp.now() });
    await waitForFanCount(id, 0);
  });

  it('central apagada não é recriada pela tarefa', async () => {
    const id = await central();
    await db.doc(`artists/${id}`).delete();
    await db.doc(`artistStats/${id}/fanShards/3`).set({ count: 1, updatedAt: Timestamp.now() });
    await sleep(3_000);
    expect(await exists(`artists/${id}`)).toBe(false);
  });

  it('entrada e saída de fãs diferentes com a soma igual ainda avançam o fanCountAt', async () => {
    const id = await central();
    const camila = await signUpFan();
    const alan = await signUpFan('Alan Ferreira');
    await join(camila, id);
    const first = await waitForFanCount(id, 1);
    const firstAt = (first.fanCountAt as Timestamp).toMillis();
    await join(alan, id);
    await leave(camila, id);
    await waitFor('o fanCountAt andar', async () => {
      const artist = await read(`artists/${id}`);
      return artist?.fanCount === 1 && (artist.fanCountAt as Timestamp).toMillis() > firstAt;
    });
    // Para o Alan, que entrou depois da primeira cópia, a página não soma 1 a mais.
    await waitFor('a cópia contar o Alan', async () => {
      const page = await http(`/artists/${id}`, { token: alan.token });
      return page.body.fanCount === 1;
    });
  });
});

// --- deleteArtist coerente com os shards -------------------------------------------

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string; error?: { message: string } };
  if (!body.idToken) throw new Error(`Não entrou com ${email}: ${body.error?.message}`);
  return body.idToken;
}

/** Admin gravado direto, como o aceite do convite deixaria. */
async function seedAdmin(): Promise<string> {
  const uid = unique('admin');
  const email = `${uid}@teste.dev`;
  const now = Timestamp.now();
  await db.doc(`staff/${uid}`).set({
    uid,
    email,
    displayName: 'Admin Um',
    role: 'admin',
    sections: [...SECTION_IDS],
    status: 'active',
    accountCreatedByInvite: true,
    inviteId: 'semente',
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  await auth.createUser({ uid, email, password: 'senha-da-equipe', emailVerified: true });
  return signIn(email, 'senha-da-equipe');
}

/** Chama o deleteArtist como o painel (POST { data } com o ID token). */
async function deleteArtist(
  token: string,
  artistId: string,
): Promise<{ result?: unknown; error?: { status: string; details?: { reason?: string } } }> {
  const response = await fetch(`${functionsOrigin}/${PROJECT_ID}/${REGION}/deleteArtist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { artistId } }),
  });
  return (await response.json()) as never;
}

describe('deleteArtist pela soma dos shards', () => {
  it('fanCount 0 com a soma 1 (cópia atrasada): recusa com has-fans', async () => {
    const admin = await seedAdmin();
    const id = await central();
    await db.doc(`artistStats/${id}/fanShards/0`).set({ count: 1, updatedAt: Timestamp.now() });
    await waitForFanCount(id, 1);
    // A cópia ficou para trás.
    await db.doc(`artists/${id}`).update({ fanCount: 0 });
    const { error } = await deleteArtist(admin, id);
    expect(error).toMatchObject({ status: 'FAILED_PRECONDITION', details: { reason: 'has-fans' } });
    expect(await exists(`artists/${id}`)).toBe(true);
  });

  it('fanCount 1 com a soma 0 (cópia atrasada ou perdida): apaga a central e os shards', async () => {
    const admin = await seedAdmin();
    const id = await central();
    await db.doc(`artistStats/${id}/fanShards/0`).set({ count: 1, updatedAt: Timestamp.now() });
    await db.doc(`artistStats/${id}/fanShards/1`).set({ count: -1, updatedAt: Timestamp.now() });
    await waitForFanCount(id, 0);
    await db.doc(`artists/${id}`).update({ fanCount: 1 });
    const { error } = await deleteArtist(admin, id);
    expect(error).toBeUndefined();
    expect(await exists(`artists/${id}`)).toBe(false);
    expect((await db.collection(`artistStats/${id}/fanShards`).get()).size).toBe(0);
    // Apagar os shards dispara o gatilho; a tarefa acha a central apagada e não grava.
    await sleep(2_000);
    expect(await exists(`artists/${id}`)).toBe(false);
  });

  it('soma 0 e fanCount 0: apaga os shards junto', async () => {
    const admin = await seedAdmin();
    const id = await central();
    await db.doc(`artistStats/${id}/fanShards/2`).set({ count: 0, updatedAt: Timestamp.now() });
    const { error } = await deleteArtist(admin, id);
    expect(error).toBeUndefined();
    expect((await db.collection(`artistStats/${id}/fanShards`).get()).size).toBe(0);
  });
});

// --- Seed e "Suas centrais" com a temporada ----------------------------------------

/** O handler da API no processo, com a configuração lida sem cache. */
function localGet(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const handler = createApiHandler({ db, auth, config: createConfigSource(db, { ttlMs: 0 }) });
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const req: ApiRequest = {
    method: 'GET',
    path,
    get: (name) => headers[name.toLowerCase()],
    query: {},
    body: undefined,
  };
  const sent = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    set() {
      return res;
    },
    json(body: unknown) {
      sent.body = body;
    },
  };
  return handler(req, res).then(() => sent);
}

describe('seed das centrais', () => {
  it('as centrais de teste, a Camila fã de Netto, Nenho e Juninho, e a carteira igual', async () => {
    const camila = await signUpFan();
    expect(await seedCentrals(db)).toBe(SEED_CENTRALS.length);
    await seedCamilaWallet(db, camila.uid);
    const wallet = await read(`wallets/${camila.uid}`);
    await seedCamilaCentrals(db, camila.uid);

    expect(await read('artists/nettobrito')).toMatchObject({
      handle: 'nettobrito',
      name: 'Netto Brito',
      status: 'published',
      order: 0,
      verified: true,
      managedByImagine: true,
      photo: null,
    });
    expect(await read('artists/artista7')).toMatchObject({ status: 'draft', publishedAt: null });
    expect(await read('artists/artista7')).not.toHaveProperty('managedByImagine');
    expect(await read('usernames/nenho')).toMatchObject({ artistId: 'nenho' });
    expect(await read('artistPrivate/juninhomoraes')).toMatchObject({ imageRightsConfirmed: true });

    for (const id of CAMILA_CENTRALS) {
      expect(await read(`users/${camila.uid}/centrals/${id}`)).toMatchObject({ via: 'seed' });
      // Membro: no Juninho, sem pontos, o documento nasce zerado (bloco 8, 23.7).
      expect(await read(`wallets/${camila.uid}/centralPoints/${id}`)).toMatchObject({
        member: true,
      });
    }
    // A entrada vale 0 no seed: a carteira fica a do protótipo, sem extrato novo.
    expect(await read(`wallets/${camila.uid}`)).toEqual(wallet);
    expect(await exists(`wallets/${camila.uid}/ledger/central_join:nettobrito`)).toBe(false);
    for (const id of CAMILA_CENTRALS) await waitForFanCount(id, 1);

    const list = await localGet('/artists', camila.token);
    expect((list.body as { id: string }[]).map((item) => item.id)).toEqual([
      'nettobrito',
      'nenho',
      'juninhomoraes',
      'rocksalles',
      'artista5',
      'artista6',
    ]);
    const mine = await localGet('/me/centrals', camila.token);
    expect(mine.body).toEqual([
      {
        artistId: 'nettobrito',
        name: 'Netto Brito',
        shortName: null,
        photoURL: null,
        fanCount: 1,
        // A única no ranking das duas centrais (bloco 8); no Juninho, sem pontos, sem posição.
        fanRank: 1,
        seasonPoints: CAMILA_SEED.centrals.nettobrito,
      },
      {
        artistId: 'nenho',
        name: 'Nenho',
        shortName: null,
        photoURL: null,
        fanCount: 1,
        fanRank: 1,
        seasonPoints: CAMILA_SEED.centrals.nenho,
      },
      {
        artistId: 'juninhomoraes',
        name: 'Juninho Moraes',
        shortName: 'Juninho M.',
        photoURL: null,
        fanCount: 1,
        fanRank: null,
        seasonPoints: 0,
      },
    ]);
    expect((await localGet('/artists/nettobrito', camila.token)).body).toMatchObject({
      isMember: true,
      fanCount: 1,
      centralPoints: CAMILA_SEED.centrals.nettobrito,
      coverUrl: null,
    });

    // Rodar de novo não muda nada.
    expect(await seedCentrals(db)).toBe(0);
    await seedCamilaCentrals(db, camila.uid);
    expect(await shardSum('nettobrito')).toBe(1);
    expect(await read(`wallets/${camila.uid}`)).toEqual(wallet);
  });
});
