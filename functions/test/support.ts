import { initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import {
  getFirestore,
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { API_ROUTES, createApiHandler, type ApiRequest, type ApiRoute } from '../src/api';
import { fanPhotoFiles } from '../src/fan-profile';
import { EMULATOR_INVITE_KEY } from '../src/invites';
import { dayKey, staticConfigSource, type ConfigSource } from '../src/points';
import { SECTION_IDS } from '../src/staff/model';

/**
 * O que os testes de emulador do bloco 6 (mural, agenda, moderação e as
 * callables de conteúdo) dividem: o app do Admin SDK, a conferência das
 * funções carregadas, a limpeza entre os testes, o fã que se cadastra como o
 * app, a `api` de verdade pelo HTTP do emulador, as callables como o painel
 * chama e o handler no processo, com o relógio fixo. Rode com
 * `npm run test:functions`, na raiz do app.
 */
export const PROJECT_ID = 'demo-imagine-up-app';
export const REGION = 'southamerica-east1';
export const BUCKET = `${PROJECT_ID}.appspot.com`;

export type Emulators = {
  app: App;
  auth: Auth;
  db: Firestore;
  bucket: ReturnType<ReturnType<typeof getStorage>['bucket']>;
  origin: () => string;
};

/**
 * Prazo da limpeza dos emuladores: as tarefas que um teste deixa na fila podem
 * segurar travas do Firestore por mais de um minuto (ver `resetEmulators`).
 */
export const RESET_TIMEOUT_MS = 180_000;

/**
 * Apaga todos os documentos do Firestore e todas as contas do Auth do
 * emulador, e confere que apagou. O emulador do Firestore recusa a limpeza
 * inteira (409, "Transaction lock timeout", sem apagar nada) enquanto alguma
 * transação segura uma trava, como as tarefas syncArtistFanCount que o seed do
 * ranking deixa na fila (no emulador, uma por gravação, todas disputando as
 * mesmas centrais). Sem conferir, o teste seguinte, e até o arquivo seguinte,
 * rodava sobre os dados do anterior, e o resultado dependia da ordem dos
 * arquivos. O 409 tenta de novo até o prazo; outro erro falha na hora.
 */
export async function resetEmulators(): Promise<void> {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!authHost || !firestoreHost) throw new Error('Rode com npm run test:functions.');
  const deadline = Date.now() + RESET_TIMEOUT_MS - 10_000;
  await clearEmulator(
    'o Firestore',
    `http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    deadline,
  );
  await clearEmulator(
    'o Auth',
    `http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    deadline,
  );
}

async function clearEmulator(what: string, url: string, deadline: number): Promise<void> {
  for (;;) {
    const response = await fetch(url, { method: 'DELETE' });
    if (response.ok) return;
    const body = await response.text();
    if (response.status !== 409 || Date.now() > deadline) {
      throw new Error(`O emulador não limpou ${what}: ${response.status} ${body}`);
    }
    await sleep(250);
  }
}

/**
 * Limpa os emuladores antes de cada teste e no fim do arquivo. A do fim faz
 * das tarefas que ficaram na fila tarefas sem efeito (a central já não existe)
 * antes de o arquivo seguinte começar.
 */
export function useCleanEmulators(): void {
  beforeEach(resetEmulators, RESET_TIMEOUT_MS);
  afterAll(resetEmulators, RESET_TIMEOUT_MS);
}

/**
 * Liga o arquivo de teste aos emuladores: confere que as funções carregaram
 * (sem elas, os testes esperariam até o tempo esgotar) e limpa o Firestore e o
 * Auth antes de cada teste e no fim do arquivo (`useCleanEmulators`).
 */
export function useEmulators(name: string, functions: readonly string[]): Emulators {
  const app = initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET }, name);
  let origin = '';
  beforeAll(async () => {
    const hub = process.env.FIREBASE_EMULATOR_HUB;
    if (!hub) throw new Error('Rode com npm run test:functions.');
    const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
      functions?: { host: string; port: number };
    };
    if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
    origin = `http://${emulators.functions.host}:${emulators.functions.port}`;
    const { backends } = (await (await fetch(`${origin}/backends`)).json()) as {
      backends: { functionTriggers: { entryPoint: string }[] }[];
    };
    const loaded = backends.flatMap((backend) => backend.functionTriggers.map((t) => t.entryPoint));
    const missing = functions.filter((fn) => !loaded.includes(fn));
    if (missing.length > 0) {
      throw new Error(
        `O emulador não carregou ${missing.join(', ')}: procure "Failed to load function definition" no log.`,
      );
    }
  });
  useCleanEmulators();
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    bucket: getStorage(app).bucket(BUCKET),
    origin: () => origin,
  };
}

// Ids únicos na execução inteira: uma tarefa atrasada de um teste nunca acerta
// o post do teste seguinte, e o Storage não é limpo entre os testes.
let counter = 0;
export const unique = (prefix: string) => `${prefix}${++counter}`;

export async function waitFor(
  what: string,
  check: () => Promise<boolean>,
  ms = 20_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando ${what}.`);
    await sleep(200);
  }
}

export type Fan = { uid: string; token: string; email: string; password: string };

/** Fã que se cadastra pela API do Auth, como o app, e ganha o perfil pelo gatilho. */
export async function signUpFan(
  db: Firestore,
  displayName = 'Fã de Teste',
  email = `${unique('fa')}@teste.dev`,
): Promise<Fan> {
  const password = 'senha-do-fa-1';
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { localId?: string; idToken?: string };
  if (!body.localId || !body.idToken) throw new Error(`Não criou ${email}.`);
  const uid = body.localId;
  await waitFor('o perfil do fã', async () => (await db.doc(`users/${uid}`).get()).exists, 30_000);
  return { uid, token: body.idToken, email, password };
}

/** Entra pela API do Auth e devolve o ID token. */
export async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-falsa`,
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

export type HttpResult = { status: number; body: Record<string, unknown>; headers: Headers };

/** A função `api` de verdade, pelo HTTP do emulador de Functions. */
export async function http(
  env: Emulators,
  path: string,
  init: { method?: string; token?: string; key?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.key) headers['Idempotency-Key'] = init.key;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${env.origin()}/${PROJECT_ID}/${REGION}/api${path}`, {
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

export type LocalResult = {
  status: number;
  body: Record<string, unknown>;
  /** Os cabeçalhos da resposta, só com `withHeaders` (o `Retry-After` dos tetos do dia). */
  headers?: Record<string, string>;
};

/**
 * O handler da API no processo do teste, com o relógio e a configuração
 * fixos (para o corte da meia-noite, os limites e os valores injetados). As
 * rotas da foto (bloco 9) usam o bucket do emulador. `routes` acrescenta rotas
 * só do teste (a colisão do código do resgate, bloco 10). Com `withHeaders`,
 * o resultado traz também os cabeçalhos (sem ele, só o status e o corpo, como
 * os testes comparam).
 */
export function localApi(
  env: Emulators,
  options: {
    now?: () => number;
    config?: ConfigSource;
    routes?: readonly ApiRoute[];
    withHeaders?: boolean;
  } = {},
) {
  const startedAt = Date.now();
  const handler = createApiHandler(
    {
      db: env.db,
      auth: env.auth,
      now: options.now ?? (() => startedAt),
      config: options.config ?? staticConfigSource(),
      inviteKey: () => EMULATOR_INVITE_KEY,
      files: fanPhotoFiles(() => env.bucket),
    },
    [...API_ROUTES, ...(options.routes ?? [])],
  );
  return async (
    method: string,
    path: string,
    request: { token: string; key?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<LocalResult> => {
    const headers: Record<string, string | undefined> = {
      authorization: `Bearer ${request.token}`,
      'idempotency-key': request.key,
    };
    const req: ApiRequest = {
      method,
      path,
      get: (name) => headers[name.toLowerCase()],
      query: request.query ?? {},
      body: request.body,
    };
    const sent: LocalResult = { status: 0, body: {} };
    const headersSent: Record<string, string> = {};
    if (options.withHeaders) sent.headers = headersSent;
    const res = {
      status(code: number) {
        sent.status = code;
        return res;
      },
      set(field: string, value: string) {
        headersSent[field] = value;
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

export type CallError = { status: string; message: string; details?: { reason?: string } };

/** A callable de verdade, como o SDK do painel chama: POST { data } com o ID token. */
export async function callable<T = Record<string, unknown>>(
  env: Emulators,
  name: string,
  data: unknown,
  token?: string,
): Promise<{ result?: T; error?: CallError }> {
  const response = await fetch(`${env.origin()}/${PROJECT_ID}/${REGION}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return (await response.json()) as { result?: T; error?: CallError };
}

export type Member = { uid: string; email: string; password: string; token: string };

/**
 * Membro da equipe gravado direto, como o aceite do convite deixaria: a marca
 * em staff/{uid} vem antes da conta, então o gatilho não cria perfil de fã.
 */
export async function seedMember(
  env: Emulators,
  displayName: string,
  role: 'admin' | 'editor' | 'viewer',
  sections: string[] = [],
  status: 'active' | 'disabled' = 'active',
): Promise<Member> {
  const uid = unique(role);
  const email = `${uid}@teste.dev`;
  const password = 'senha-da-equipe';
  const now = Timestamp.now();
  await env.db.doc(`staff/${uid}`).set({
    uid,
    email,
    displayName,
    role,
    sections: role === 'admin' ? [...SECTION_IDS] : sections,
    status,
    accountCreatedByInvite: true,
    inviteId: 'semente',
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  await env.auth.createUser({ uid, email, password, displayName, emailVerified: true });
  return { uid, email, password, token: await signIn(email, password) };
}

/** Central publicada, direto pelo Admin SDK, no formato do painel. */
export async function central(
  env: Emulators,
  extra: Record<string, unknown> = {},
  id: string = unique('central'),
): Promise<string> {
  const at = Timestamp.now();
  await env.db.doc(`artists/${id}`).set({
    handle: id,
    name: `Central ${id}`,
    shortName: null,
    genre: null,
    city: null,
    bio: null,
    verified: true,
    photo: null,
    thumb: null,
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

/** Post no ar, direto pelo Admin SDK, no formato das callables. */
export async function post(
  env: Emulators,
  artistId: string,
  extra: Record<string, unknown> = {},
  id: string = unique('post'),
): Promise<string> {
  const at = Timestamp.now();
  await env.db.doc(`posts/${id}`).set({
    artistId,
    kind: 'text',
    text: `Post ${id}`,
    media: null,
    eventId: null,
    status: 'published',
    publishedAt: at,
    likeCount: 0,
    commentCount: 0,
    countsAt: null,
    createdAt: at,
    updatedAt: at,
    createdBy: 'teste',
    updatedBy: 'teste',
    schemaVersion: 1,
    ...extra,
  });
  return id;
}

/** Show no ar, direto pelo Admin SDK, no formato das callables. */
export async function show(
  env: Emulators,
  artistIds: string[],
  startsAt: number,
  extra: Record<string, unknown> = {},
  id: string = unique('show'),
): Promise<string> {
  const at = Timestamp.now();
  await env.db.doc(`events/${id}`).set({
    title: `Show ${id}`,
    artistIds,
    city: 'Irará',
    state: 'BA',
    venue: null,
    startsAt: Timestamp.fromMillis(startsAt),
    startsAtLocal: '2026-11-21T22:00',
    timeZone: 'America/Bahia',
    photo: null,
    featured: false,
    status: 'published',
    publishedAt: at,
    createdAt: at,
    updatedAt: at,
    createdBy: 'teste',
    updatedBy: 'teste',
    schemaVersion: 1,
    ...extra,
  });
  return id;
}

/** Soma de um campo nos shards do painel dos dias dados. */
export async function statsSum(
  db: Firestore,
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
export const daysSince = (from: number): string[] => [dayKey(from), dayKey(Date.now())];

/** Soma de um campo dos shards das contagens de um post. */
export async function countShardSum(
  db: Firestore,
  postId: string,
  field: 'likes' | 'comments',
): Promise<number> {
  const shards = await db.collection(`postStats/${postId}/countShards`).get();
  return shards.docs.reduce((sum, doc) => sum + ((doc.get(field) as number) ?? 0), 0);
}

/** Espera a fila copiar as contagens esperadas para o post (com o countsAt). */
export async function waitForCounts(
  db: Firestore,
  postId: string,
  expected: { likeCount?: number; commentCount?: number },
): Promise<DocumentData> {
  let last: DocumentData | undefined;
  await waitFor(`as contagens ${JSON.stringify(expected)} em ${postId}`, async () => {
    last = (await db.doc(`posts/${postId}`).get()).data();
    return (
      last?.countsAt instanceof Timestamp &&
      (expected.likeCount === undefined || last.likeCount === expected.likeCount) &&
      (expected.commentCount === undefined || last.commentCount === expected.commentCount)
    );
  });
  return last!;
}
