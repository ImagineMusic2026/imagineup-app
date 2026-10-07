import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHandler, idempotencyDocId, type ApiRequest } from '../src/api';
import { seedCentrals } from '../src/centrals';
import {
  CAMILA_INVITE_CODE,
  EMULATOR_INVITE_KEY,
  personKey,
  seedCamilaInvite,
  seedInviteClaims,
  seedInviteVisits,
  SEED_INVITEES,
  SEED_VISITORS,
} from '../src/invites';
import { seedMissionsCatalog } from '../src/missions';
import {
  dayKey,
  DEFAULT_POINTS_CONFIG,
  seedCamilaWallet,
  staticConfigSource,
  type ConfigSource,
  type PointsConfig,
} from '../src/points';
import { seedPosts } from '../src/posts';
import { deleteUserData } from '../src/store';

/**
 * Convite com atribuição e origem do fã (bloco 5) nos emuladores. Rode com
 * `npm run test:functions`, na raiz do app. Duas frentes:
 * - a função `api` de verdade, pelo HTTP do emulador de Functions, com o ID
 *   token do emulador de Auth (o e-mail da chave da pessoa sai do token) e o
 *   INVITE_KEY_SECRET do functions/.secret.local (o EMULATOR_INVITE_KEY);
 * - o handler da API no processo do teste, com o relógio e a configuração
 *   fixos, para os limites do dia, o valor zero e o dia seguinte.
 */
const PROJECT_ID = 'demo-imagine-up-app';
const REGION = 'southamerica-east1';
const app = initializeApp({ projectId: PROJECT_ID }, 'convites');
const auth = getAuth(app);
const db = getFirestore(app);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let apiBase = '';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) throw new Error('Rode com npm run test:functions.');
  const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
    functions?: { host: string; port: number };
  };
  if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
  const { host, port } = emulators.functions;
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

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;
const size = async (path: string) => (await db.collection(path).get()).size;

async function waitFor(what: string, check: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando ${what}.`);
    await sleep(200);
  }
}

type Fan = { uid: string; token: string; email: string };

/** Fã que se cadastra pela API do Auth, como o app, e ganha o perfil pelo gatilho. */
async function signUpFan(
  email = `${unique('fa')}@teste.dev`,
  displayName = 'Fã de Teste',
): Promise<Fan> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'senha-do-fa-1',
        displayName,
        returnSecureToken: true,
      }),
    },
  );
  const body = (await response.json()) as { localId?: string; idToken?: string };
  if (!body.localId || !body.idToken) throw new Error(`Não criou ${email}.`);
  const uid = body.localId;
  await waitFor('o perfil do fã', () => exists(`users/${uid}`));
  return { uid, token: body.idToken, email };
}

/** A chave da pessoa como a api do emulador calcula (o mesmo segredo do .secret.local). */
const keyOf = (fan: { uid: string; email: string | null }) =>
  personKey(fan.email, fan.uid, EMULATOR_INVITE_KEY);

// --- HTTP: a função de verdade ---------------------------------------------------

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

const getInvite = (fan: Fan) => http('/me/invite', { token: fan.token });

/** O código do fã, criado pelo GET /me/invite. */
async function codeOf(fan: Fan): Promise<string> {
  const invite = await getInvite(fan);
  if (invite.status !== 200) throw new Error(`Sem código para ${fan.uid}: ${invite.status}`);
  return invite.body.code as string;
}

const linkBody = (code: string, path = '/', utm: Record<string, string> = {}) => ({
  code,
  via: 'link',
  link: { path },
  utm,
  openedAt: new Date().toISOString(),
});

const codeBody = (code: string) => ({ code, via: 'code', link: null, openedAt: null });

const claim = (fan: Fan, body: unknown, key = unique('invite-claim-')) =>
  http('/invites/claim', { method: 'POST', token: fan.token, key, body });

const visit = (fan: Fan, code: string, path = '/', key = unique('chave-visita-')) =>
  http('/invites/visit', {
    method: 'POST',
    token: fan.token,
    key,
    body: { code, link: { path }, utm: {}, openedAt: new Date().toISOString() },
  });

const share = (fan: Fan, linkId: string, key = unique('chave-link-')) =>
  http(`/me/invite/links/${encodeURIComponent(linkId)}`, { method: 'PUT', token: fan.token, key });

/** Soma de um campo nos shards do painel dos dias dados. */
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

/** Post no ar da central do Netto (do seed), direto pelo Admin SDK, como o painel deixaria. */
async function publishedPost(id: string, extra: Record<string, unknown> = {}): Promise<void> {
  const at = Timestamp.now();
  await db.doc(`posts/${id}`).set({
    artistId: 'nettobrito',
    kind: 'text',
    text: 'Post de teste',
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
}

/** O dia do claim que o servidor usou (`referrals/{uid}.day`). */
async function claimDay(uid: string): Promise<string> {
  const day = (await read(`referrals/${uid}`))?.day;
  if (typeof day !== 'string') throw new Error(`Sem referrals/${uid}.`);
  return day;
}

// --- O handler no processo, com relógio e configuração fixos ------------------------

type LocalResult = { status: number; body: Record<string, unknown> };

function localApi(options: { now?: () => number; config?: ConfigSource } = {}) {
  const startedAt = Date.now();
  const handler = createApiHandler({
    db,
    auth,
    now: options.now ?? (() => startedAt),
    config: options.config ?? staticConfigSource(),
    inviteKey: () => EMULATOR_INVITE_KEY,
  });
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
    const sent: LocalResult = { status: 0, body: {} };
    const res = {
      status(code: number) {
        sent.status = code;
        return res;
      },
      set() {
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

function configWith(change: {
  values?: Partial<PointsConfig['values']>;
  dailyLimits?: Partial<PointsConfig['dailyLimits']>;
}): ConfigSource {
  return staticConfigSource({
    points: {
      ...DEFAULT_POINTS_CONFIG,
      values: { ...DEFAULT_POINTS_CONFIG.values, ...change.values },
      dailyLimits: { ...DEFAULT_POINTS_CONFIG.dailyLimits, ...change.dailyLimits },
    },
  });
}

// --- Código do fã -------------------------------------------------------------------

describe('código do fã (GET /me/invite)', () => {
  it('cria o código no formato, com o ownerKey do e-mail do token, e devolve sempre o mesmo', async () => {
    const fan = await signUpFan('Camila.Ribeiro@Gmail.com', 'Camila Ribeiro');
    const first = await getInvite(fan);
    expect(first.status).toBe(200);
    const code = first.body.code as string;
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(first.body).toEqual({
      code,
      url: `https://imagineup-painel.vercel.app/?ref=${code}`,
      linkBase: 'https://imagineup-painel.vercel.app',
      pointsPerVisit: 2,
      pointsPerSignup: 10,
    });
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await read(`inviteCodes/${code}`)).toMatchObject({
      code,
      kind: 'fan',
      uid: fan.uid,
      // O e-mail do token, normalizado (sem pontos no Gmail, minúsculas).
      ownerKey: personKey('camilaribeiro@gmail.com', 'outro-uid', EMULATOR_INVITE_KEY),
      schemaVersion: 1,
    });
    expect(await read(`fanInvites/${fan.uid}`)).toMatchObject({ uid: fan.uid, code });

    const again = await getInvite(fan);
    expect(again.body.code).toBe(code);
    expect(await size('inviteCodes')).toBe(1);
  });

  it('dez chamadas em paralelo dão um código só', async () => {
    const fan = await signUpFan();
    const results = await Promise.all(Array.from({ length: 10 }, () => getInvite(fan)));
    expect(results.map((result) => result.status)).toEqual(Array(10).fill(200));
    expect(new Set(results.map((result) => result.body.code)).size).toBe(1);
    expect((await db.collection('inviteCodes').where('uid', '==', fan.uid).get()).size).toBe(1);
  });

  it('sem perfil: 503 profile_not_ready; conta só da equipe: 403 not_fan; nada criado', async () => {
    const fan = await signUpFan();
    await db.doc(`users/${fan.uid}`).delete();
    expect(await getInvite(fan)).toMatchObject({
      status: 503,
      body: { code: 'profile_not_ready' },
    });

    const uid = unique('equipe');
    await db
      .doc(`staff/${uid}`)
      .set({ uid, role: 'viewer', status: 'active', accountCreatedByInvite: true });
    await auth.createUser({ uid, email: `${uid}@teste.dev`, password: 'senha-da-equipe' });
    const token = await signIn(`${uid}@teste.dev`, 'senha-da-equipe');
    expect(await getInvite({ uid, token, email: `${uid}@teste.dev` })).toMatchObject({
      status: 403,
      body: { code: 'not_fan' },
    });
    expect(await size('inviteCodes')).toBe(0);
    expect(await size('fanInvites')).toBe(0);
  });

  it('os pontos por visita e por cadastro vêm da configuração', async () => {
    const fan = await signUpFan();
    const call = localApi({
      config: configWith({ values: { invite_visit: 5, invite_signup: 15 } }),
    });
    const result = await call('GET', '/me/invite', { token: fan.token });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ pointsPerVisit: 5, pointsPerSignup: 15 });
  });
});

// --- Claim ----------------------------------------------------------------------------

describe('claim (POST /invites/claim)', () => {
  it('paga 2 e 10 a quem convidou, grava a origem normalizada, o marcador e os agregados', async () => {
    const inviter = await signUpFan(undefined, 'Camila Ribeiro');
    const code = await codeOf(inviter);
    const invitee = await signUpFan(undefined, 'Bia Santos');
    const key = unique('invite-paga-');
    const body = linkBody(code.toLowerCase(), '/post/p-clipe', {
      source: 'Instagram',
      medium: 'story',
      campaign: 'São João',
      content: 'ana@exemplo.com',
      term: 'promo',
    });

    const result = await claim(invitee, body, key);
    expect(result).toMatchObject({ status: 200, body: { status: 'claimed' } });

    const person = keyOf(invitee);
    expect(await read(`wallets/${inviter.uid}`)).toMatchObject({ balance: 12, xp: 12 });
    expect(await read(`wallets/${inviter.uid}/ledger/invite_visit:${person}`)).toMatchObject({
      source: 'invite_visit',
      eventId: person,
      points: 2,
      artistId: null,
      subject: { type: 'invite', id: code },
      actor: { type: 'fan', uid: invitee.uid },
    });
    expect(await read(`wallets/${inviter.uid}/ledger/invite_signup:${person}`)).toMatchObject({
      points: 10,
      artistId: null,
    });
    // Os pontos são de quem convidou: o convidado só marca a atividade.
    expect(await read(`wallets/${invitee.uid}`)).toMatchObject({ balance: 0, xp: 0 });

    const referral = await read(`referrals/${invitee.uid}`);
    expect(referral).toMatchObject({
      uid: invitee.uid,
      inviterUid: inviter.uid,
      code,
      via: 'link',
      link: { kind: 'post', targetId: 'p-clipe' },
      utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
      award: { visit: 'applied', signup: 'applied' },
      inviterRemovedAt: null,
      schemaVersion: 1,
    });
    expect(referral?.openedAt).toBeInstanceOf(Timestamp);
    expect(referral?.signupAt).toBeInstanceOf(Timestamp);
    expect(referral?.claimedAt).toBeInstanceOf(Timestamp);
    // Sem o caminho cru e sem os utm_* que podem levar quem recebeu o link.
    expect(Object.keys(referral!.link as object).sort()).toEqual(['kind', 'targetId']);
    expect(Object.keys(referral!.utm as object).sort()).toEqual(['campaign', 'medium', 'source']);
    expect(await read(`fanInvites/${inviter.uid}/inviteVisitors/${person}`)).toMatchObject({
      via: 'claim',
    });

    const days = [await claimDay(invitee.uid)];
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.kind?.post?.signups ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.kind?.post?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.utmSource?.instagram?.signups ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.utmCampaign?.['sao-joao']?.signups ?? 0)).toBe(
      1,
    );
    expect(await statsSum(days, (d) => d.bySource?.invite_signup?.points ?? 0)).toBe(10);

    // A mesma chave devolve a resposta guardada, sem efeito.
    const replay = await claim(invitee, body, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ status: 'claimed' });
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(12);

    // Outro código depois: already_claimed, sem efeito para o outro convidante.
    const other = await signUpFan();
    const otherCode = await codeOf(other);
    expect(await claim(invitee, codeBody(otherCode))).toMatchObject({
      status: 200,
      body: { status: 'already_claimed' },
    });
    expect(await exists(`wallets/${other.uid}`)).toBe(false);
    expect((await read(`referrals/${invitee.uid}`))?.inviterUid).toBe(inviter.uid);
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(1);
  });

  it('autoconvite: a própria conta ouve 409 self; outra conta da dona, pelo apelido do e-mail, recebe a resposta de um claim comum e não rende nada', async () => {
    const owner = await signUpFan('nome@gmail.com', 'Dona do Código');
    const code = await codeOf(owner);
    expect(await claim(owner, codeBody(code))).toMatchObject({
      status: 409,
      body: { code: 'invite_not_allowed', details: { reason: 'self' } },
    });
    expect(await exists(`referrals/${owner.uid}`)).toBe(false);

    const plus = await signUpFan('nome+1@gmail.com', 'Dona do Código');
    const dots = await signUpFan('n.o.m.e@gmail.com', 'Dona do Código');
    for (const fan of [plus, dots]) {
      expect(await claim(fan, linkBody(code, '/agenda'))).toMatchObject({
        status: 200,
        body: { status: 'claimed' },
      });
      expect(await read(`referrals/${fan.uid}`)).toMatchObject({
        uid: fan.uid,
        inviterUid: null,
        code,
        via: 'link',
        link: { kind: 'agenda', targetId: null },
        award: { visit: 'self', signup: 'self' },
        inviterRemovedAt: null,
      });
    }
    // A conta gastou o claim único: outro código depois é already_claimed.
    const other = await signUpFan();
    expect(await claim(plus, codeBody(await codeOf(other)))).toMatchObject({
      status: 200,
      body: { status: 'already_claimed' },
    });
    expect(await exists(`wallets/${other.uid}`)).toBe(false);

    // Sem ponto, sem marcador, fora de "pessoas trazidas" e dos agregados.
    expect(await size(`wallets/${owner.uid}/ledger`)).toBe(0);
    expect((await read(`wallets/${owner.uid}`))?.balance ?? 0).toBe(0);
    expect(await size(`fanInvites/${owner.uid}/inviteVisitors`)).toBe(0);
    expect((await http('/me/progress', { token: owner.token })).body.stats as object).toMatchObject(
      { peopleBrought: 0 },
    );
    const days = [await claimDay(plus.uid), await claimDay(dots.uid)];
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(0);
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(0);
  });

  it('sondagem pelo apelido do e-mail: a dona, quem já visitou e quem nunca passou recebem as mesmas respostas', async () => {
    const owner = await signUpFan('dona@gmail.com', 'Dona do Código');
    const code = await codeOf(owner);
    const visited = await signUpFan('bia@gmail.com', 'Bia Santos');
    await visit(visited, code);

    // Contas novas com o apelido de cada e-mail (o Firebase não confere o e-mail).
    const probes = [
      await signUpFan('dona+sonda@gmail.com'),
      await signUpFan('bia+sonda@gmail.com'),
      await signUpFan('nova+sonda@gmail.com'),
    ];
    const visits: HttpResult[] = [];
    for (const probe of probes) visits.push(await visit(probe, code));
    const claims: HttpResult[] = [];
    for (const probe of probes) claims.push(await claim(probe, codeBody(code)));
    for (const result of [...visits, ...claims]) expect(result.status).toBe(200);
    for (const result of visits) expect(result.body).toEqual({ status: 'received' });
    for (const result of claims) expect(result.body).toEqual({ status: 'claimed' });

    // Por dentro, cada caso seguiu o seu caminho.
    const [ownerAlias, visitedAlias, fresh] = probes as [Fan, Fan, Fan];
    expect((await read(`referrals/${ownerAlias.uid}`))?.award).toEqual({
      visit: 'self',
      signup: 'self',
    });
    expect((await read(`referrals/${visitedAlias.uid}`))?.award).toEqual({
      visit: 'duplicate',
      signup: 'applied',
    });
    expect((await read(`referrals/${fresh.uid}`))?.award).toEqual({
      visit: 'duplicate',
      signup: 'applied',
    });
    expect(await size(`fanInvites/${owner.uid}/inviteVisitors`)).toBe(2);
  });

  it('conta com o perfil de 8 dias: 409 account_too_old, sem efeito', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    const old = await signUpFan();
    await db
      .doc(`users/${old.uid}`)
      .update({ createdAt: Timestamp.fromMillis(Date.now() - 8 * DAY_MS) });
    expect(await claim(old, linkBody(code))).toMatchObject({
      status: 409,
      body: { code: 'invite_not_allowed', details: { reason: 'account_too_old' } },
    });
    expect(await exists(`referrals/${old.uid}`)).toBe(false);
    expect(await exists(`wallets/${inviter.uid}`)).toBe(false);
  });

  it('código que não existe: 404, e a chave não fica (o app esquece o código)', async () => {
    const fan = await signUpFan();
    const key = unique('invite-sem-codigo-');
    expect(await claim(fan, codeBody('ZZZZZZZZ'), key)).toMatchObject({
      status: 404,
      body: { code: 'invite_not_found', message: 'Convite não encontrado.' },
    });
    expect(await exists(`idempotency/${idempotencyDocId(fan.uid, key)}`)).toBe(false);
    expect(await exists(`referrals/${fan.uid}`)).toBe(false);
  });

  it('cadastro acima do limite do dia de quem convidou sai capped, com o referrals gravado', async () => {
    const inviter = await signUpFan();
    const call = localApi({ config: configWith({ dailyLimits: { invite_signup: 2 } }) });
    const code = (await call('GET', '/me/invite', { token: inviter.token })).body.code as string;
    const invitees = [await signUpFan(), await signUpFan(), await signUpFan()];
    for (const invitee of invitees) {
      const result = await call('POST', '/invites/claim', {
        token: invitee.token,
        key: unique('invite-limite-'),
        body: codeBody(code),
      });
      expect(result).toMatchObject({ status: 200, body: { status: 'claimed' } });
    }
    expect((await read(`referrals/${invitees[2]!.uid}`))?.award).toEqual({
      visit: 'applied',
      signup: 'capped',
    });
    // Três visitas (2 cada) e dois cadastros (10 cada).
    expect(await read(`wallets/${inviter.uid}`)).toMatchObject({ balance: 26 });
    expect(await exists(`wallets/${inviter.uid}/ledger/invite_signup:${keyOf(invitees[2]!)}`)).toBe(
      false,
    );
    expect(await size('referrals')).toBe(3);
  });

  it('conta excluída e recriada com o mesmo e-mail registra o convite, mas não paga nem conta de novo', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    const first = await signUpFan('bia@gmail.com', 'Bia Santos');
    expect(await claim(first, linkBody(code, '/agenda'))).toMatchObject({ status: 200 });
    const day = await claimDay(first.uid);
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(12);

    // Excluir pelo Auth: o gatilho deleteUserData tira o referrals e o perfil.
    await auth.deleteUser(first.uid);
    await waitFor('a exclusão da conta', async () => !(await exists(`referrals/${first.uid}`)));

    const again = await signUpFan('bia@gmail.com', 'Bia Santos');
    expect(again.uid).not.toBe(first.uid);
    expect(await claim(again, linkBody(code, '/agenda'))).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect((await read(`referrals/${again.uid}`))?.award).toEqual({
      visit: 'duplicate',
      signup: 'duplicate',
    });
    // E com o apelido do e-mail, também não.
    const alias = await signUpFan('bia+1@gmail.com', 'Bia Santos');
    expect(await claim(alias, codeBody(code))).toMatchObject({ status: 200 });
    expect((await read(`referrals/${alias.uid}`))?.award).toEqual({
      visit: 'duplicate',
      signup: 'duplicate',
    });

    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(12);
    expect(await size(`wallets/${inviter.uid}/ledger`)).toBe(2);
    expect(await size(`fanInvites/${inviter.uid}/inviteVisitors`)).toBe(1);
    const days = [day, await claimDay(again.uid), await claimDay(alias.uid)];
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(3);
  });

  it('claim de quem antes visitou soma o cadastro, e não a visita', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    const fan = await signUpFan();
    const from = Date.now();
    expect(await visit(fan, code, '/artista/nettobrito')).toMatchObject({
      status: 200,
      body: { status: 'received' },
    });
    expect(await claim(fan, linkBody(code, '/artista/nettobrito'))).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect((await read(`referrals/${fan.uid}`))?.award).toEqual({
      visit: 'duplicate',
      signup: 'applied',
    });
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(12);
    expect(await read(`fanInvites/${inviter.uid}/inviteVisitors/${keyOf(fan)}`)).toMatchObject({
      via: 'visit',
    });
    const days = daysSince(from);
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.kind?.artist?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.kind?.artist?.signups ?? 0)).toBe(1);
  });

  it('quem convidou excluído no meio (perfil já saiu, código ainda não): skipped, sem marcador', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    await db.doc(`users/${inviter.uid}`).delete();
    const fan = await signUpFan();
    expect(await claim(fan, codeBody(code))).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect(await read(`referrals/${fan.uid}`)).toMatchObject({
      inviterUid: inviter.uid,
      award: { visit: 'skipped', signup: 'skipped' },
    });
    expect(await exists(`wallets/${inviter.uid}`)).toBe(false);
    expect(await size(`fanInvites/${inviter.uid}/inviteVisitors`)).toBe(0);
    const days = [await claimDay(fan.uid)];
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(0);
  });
});

// --- Visita -----------------------------------------------------------------------------

describe('visita (POST /invites/visit)', () => {
  it('paga 2 uma vez por par, com o marcador; a segunda visita da pessoa não conta de novo', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    const fan = await signUpFan();
    const from = Date.now();
    expect(await visit(fan, code, '/post/p-clipe')).toMatchObject({
      status: 200,
      body: { status: 'received' },
    });
    expect(await read(`wallets/${inviter.uid}/ledger/invite_visit:${keyOf(fan)}`)).toMatchObject({
      points: 2,
    });
    expect(await read(`fanInvites/${inviter.uid}/inviteVisitors/${keyOf(fan)}`)).toMatchObject({
      via: 'visit',
    });
    // A resposta é a mesma: quem conta é o marcador, e o shard não soma de novo.
    expect(await visit(fan, code, '/agenda')).toMatchObject({
      status: 200,
      body: { status: 'received' },
    });
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(2);
    const days = daysSince(from);
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.kind?.post?.visits ?? 0)).toBe(1);
    expect(await statsSum(days, (d) => d.byOrigin?.kind?.agenda?.visits ?? 0)).toBe(0);
    // Visita e link só pelo tipo: nada de utm_* nos shards.
    expect(await statsSum(days, (d) => Object.keys(d.byOrigin?.utmSource ?? {}).length)).toBe(0);
    // As visitas que a conta mandou no dia, na carteira dela.
    const sent = (await read(`wallets/${fan.uid}`))?.days as Record<
      string,
      { count: Record<string, number> }
    >;
    expect(
      Object.values(sent).reduce((sum, day) => sum + (day.count.invite_visit_sent ?? 0), 0),
    ).toBe(2);
  });

  it('o dono não conta, nem por uma segunda conta com o apelido do e-mail', async () => {
    const owner = await signUpFan('dona@gmail.com');
    const code = await codeOf(owner);
    const alias = await signUpFan('d.o.n.a+2@googlemail.com');
    for (const fan of [owner, alias]) {
      expect(await visit(fan, code)).toMatchObject({ status: 200, body: { status: 'received' } });
    }
    // Quem visita marca a própria atividade, mas o dono não ganha ponto nem marcador.
    expect(await size(`wallets/${owner.uid}/ledger`)).toBe(0);
    expect((await read(`wallets/${owner.uid}`))?.balance ?? 0).toBe(0);
    expect(await size(`fanInvites/${owner.uid}/inviteVisitors`)).toBe(0);
  });

  it('a 21ª visita do dia da mesma conta não conta nem paga', async () => {
    const first = await signUpFan();
    const firstCode = await codeOf(first);
    const second = await signUpFan();
    const secondCode = await codeOf(second);
    const fan = await signUpFan();
    const call = localApi();
    for (let index = 0; index < 20; index += 1) {
      const result = await call('POST', '/invites/visit', {
        token: fan.token,
        key: unique('visit-teto-'),
        body: { code: firstCode, link: { path: '/' } },
      });
      expect(result.status).toBe(200);
    }
    const last = await call('POST', '/invites/visit', {
      token: fan.token,
      key: unique('visit-teto-'),
      body: { code: secondCode, link: { path: '/' } },
    });
    expect(last).toMatchObject({ status: 200, body: { status: 'received' } });
    expect(await exists(`wallets/${second.uid}`)).toBe(false);
    expect(await size(`fanInvites/${second.uid}/inviteVisitors`)).toBe(0);
  });

  it('código que não existe: 404', async () => {
    const fan = await signUpFan();
    expect(await visit(fan, 'ZZZZZZZZ')).toMatchObject({
      status: 404,
      body: { code: 'invite_not_found' },
    });
  });

  it('acima do limite de quem convidou: conta, não paga; de novo no dia não conta; no dia seguinte paga', async () => {
    const inviter = await signUpFan();
    const visitors = [await signUpFan(), await signUpFan()];
    let clock = Date.now();
    const call = localApi({
      now: () => clock,
      config: configWith({ dailyLimits: { invite_visit: 1 } }),
    });
    const code = (await call('GET', '/me/invite', { token: inviter.token })).body.code as string;
    const send = (fan: Fan) =>
      call('POST', '/invites/visit', {
        token: fan.token,
        key: unique('visit-limite-'),
        body: { code, link: { path: '/' } },
      });
    const [first, second] = visitors as [Fan, Fan];
    const today = dayKey(clock);

    // Os dois contam (o marcador nasce), mas só o primeiro paga.
    expect(await send(first)).toMatchObject({ status: 200, body: { status: 'received' } });
    expect(await send(second)).toMatchObject({ status: 200, body: { status: 'received' } });
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(2);
    expect(await exists(`wallets/${inviter.uid}/ledger/invite_visit:${keyOf(second)}`)).toBe(false);
    expect(await statsSum([today], (d) => d.invites?.visits ?? 0)).toBe(2);

    expect(await send(second)).toMatchObject({ status: 200, body: { status: 'received' } });
    expect(await statsSum([today], (d) => d.invites?.visits ?? 0)).toBe(2);
    expect(await exists(`wallets/${inviter.uid}/ledger/invite_visit:${keyOf(second)}`)).toBe(false);

    clock += DAY_MS;
    expect(await send(second)).toMatchObject({ status: 200, body: { status: 'received' } });
    expect(await read(`wallets/${inviter.uid}/ledger/invite_visit:${keyOf(second)}`)).toMatchObject(
      {
        points: 2,
      },
    );
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(4);
    expect(await statsSum([dayKey(clock)], (d) => d.invites?.visits ?? 0)).toBe(0);
  });

  it('com a visita valendo 0: a primeira conta, as seguintes da mesma pessoa não', async () => {
    const inviter = await signUpFan();
    const fan = await signUpFan();
    const clock = Date.now();
    const call = localApi({
      now: () => clock,
      config: configWith({ values: { invite_visit: 0 } }),
    });
    const code = (await call('GET', '/me/invite', { token: inviter.token })).body.code as string;
    for (let index = 0; index < 3; index += 1) {
      const result = await call('POST', '/invites/visit', {
        token: fan.token,
        key: unique('visit-zero-'),
        body: { code, link: { path: '/' } },
      });
      expect(result).toMatchObject({ status: 200, body: { status: 'received' } });
      // A primeira já conta (o marcador nasce), e as seguintes não somam de novo.
      expect(await exists(`fanInvites/${inviter.uid}/inviteVisitors/${keyOf(fan)}`)).toBe(true);
      expect(await statsSum([dayKey(clock)], (d) => d.invites?.visits ?? 0)).toBe(1);
    }
    // Sem ponto nenhum: a carteira de quem convidou só nasce com o "Boca a boca"
    // (a primeira pessoa pelo link, bloco 7, 22.6), uma vez.
    const wallet = await read(`wallets/${inviter.uid}`);
    expect(wallet).toMatchObject({ balance: 0, xp: 0 });
    expect(Object.keys(wallet?.achievements ?? {})).toEqual(['boca-a-boca']);
    expect((await db.collection(`wallets/${inviter.uid}/ledger`).get()).size).toBe(0);
  });
});

// --- Links e números do perfil -----------------------------------------------------------

describe('links compartilhados e os números do perfil', () => {
  it('um por destino, 30 novos por dia; sem código, 404; o /me/progress conta links e pessoas', async () => {
    await seedCentrals(db);
    const fan = await signUpFan();
    const started = Date.now();
    const call = localApi();
    const put = (who: Fan, linkId: string) =>
      call('PUT', `/me/invite/links/${encodeURIComponent(linkId)}`, {
        token: who.token,
        key: unique('chave-link-'),
      });

    // Sem código ainda (nunca abriu "Gerar meu link"): 404, que o app ignora.
    expect(await put(fan, 'invite')).toMatchObject({
      status: 404,
      body: { code: 'invite_not_found' },
    });
    const code = (await call('GET', '/me/invite', { token: fan.token })).body.code as string;

    expect(await put(fan, 'invite')).toMatchObject({
      status: 200,
      body: { linkId: 'invite', created: true },
    });
    expect(await put(fan, 'invite')).toMatchObject({ body: { linkId: 'invite', created: false } });
    expect(await read(`fanInvites/${fan.uid}/inviteLinks/invite`)).toMatchObject({
      uid: fan.uid,
      linkId: 'invite',
      kind: 'invite',
      targetId: null,
    });
    expect(await put(fan, 'artist:nettobrito')).toMatchObject({ body: { created: true } });
    expect(await read(`fanInvites/${fan.uid}/inviteLinks/artist:nettobrito`)).toMatchObject({
      kind: 'artist',
      targetId: 'nettobrito',
    });
    // Central que não existe, em rascunho ou fora do ar: não vira link, nem no
    // teto do dia, nem nos agregados.
    for (const linkId of ['artist:naoexiste', 'artist:artista7', 'artist:artista8']) {
      expect(await put(fan, linkId)).toMatchObject({
        status: 200,
        body: { linkId, created: false },
      });
      expect(await exists(`fanInvites/${fan.uid}/inviteLinks/${linkId}`)).toBe(false);
    }
    expect(await statsSum(daysSince(started), (d) => d.byOrigin?.kind?.artist?.links ?? 0)).toBe(1);
    // O link de um post só nasce com o post visível (bloco 6, 21.2): post que
    // não existe, em rascunho ou de central fora do ar não vira link.
    for (const [id, extra] of [
      ['p-rascunho', { status: 'draft', publishedAt: null }],
      ['p-fora', { artistId: 'artista8' }],
    ] as const) {
      await publishedPost(id, extra);
      expect(await put(fan, `post:${id}`)).toMatchObject({ body: { created: false } });
    }
    expect(await put(fan, 'post:p-naoexiste')).toMatchObject({ body: { created: false } });
    for (let index = 0; index < 28; index += 1) {
      await publishedPost(`p${index}`);
      expect(await put(fan, `post:p${index}`)).toMatchObject({ body: { created: true } });
    }
    await publishedPost('p-trinta-e-um');
    // O 31º novo do dia não entra.
    expect(await put(fan, 'post:p-trinta-e-um')).toMatchObject({
      status: 200,
      body: { linkId: 'post:p-trinta-e-um', created: false },
    });
    expect(await size(`fanInvites/${fan.uid}/inviteLinks`)).toBe(30);

    const brought = await signUpFan();
    expect(
      await call('POST', '/invites/claim', {
        token: brought.token,
        key: unique('invite-perfil-'),
        body: codeBody(code),
      }),
    ).toMatchObject({ status: 200 });
    const progress = await http('/me/progress', { token: fan.token });
    expect(progress.status).toBe(200);
    expect(progress.body.stats).toMatchObject({ linksCreated: 30, peopleBrought: 1 });
  });

  it('pela api de verdade, o link vai com o : codificado', async () => {
    await seedCentrals(db);
    await publishedPost('p-clipe');
    const fan = await signUpFan();
    await codeOf(fan);
    const from = Date.now();
    expect(await share(fan, 'post:p-clipe')).toMatchObject({
      status: 200,
      body: { linkId: 'post:p-clipe', created: true },
    });
    expect(await statsSum(daysSince(from), (d) => d.invites?.links ?? 0)).toBe(1);
    expect(await statsSum(daysSince(from), (d) => d.byOrigin?.kind?.post?.links ?? 0)).toBe(1);
  });
});

// --- Concorrência -------------------------------------------------------------------------

describe('concorrência', () => {
  it('dez contas novas fazendo claim do mesmo código ao mesmo tempo', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    const fans = await Promise.all(
      Array.from({ length: 10 }, (_, index) => signUpFan(undefined, `Fã Número ${index + 1}`)),
    );
    const from = Date.now();
    // Como o app: falha de resultado incerto (503) tenta de novo com a mesma chave.
    const claimUntilDone = async (fan: Fan): Promise<HttpResult> => {
      const key = unique('invite-paralelo-');
      for (let attempt = 0; ; attempt += 1) {
        const result = await claim(fan, codeBody(code), key);
        if (result.status !== 503 || attempt >= 5) return result;
        await sleep(200);
      }
    };
    const results = await Promise.all(fans.map(claimUntilDone));
    expect(results.map((result) => result.status)).toEqual(Array(10).fill(200));
    expect(
      (await db.collection('referrals').where('inviterUid', '==', inviter.uid).get()).size,
    ).toBe(10);
    expect(await size(`fanInvites/${inviter.uid}/inviteVisitors`)).toBe(10);
    expect(await read(`wallets/${inviter.uid}`)).toMatchObject({ balance: 120, xp: 120 });
    expect(await size(`wallets/${inviter.uid}/ledger`)).toBe(20);
    const days = daysSince(from);
    expect(await statsSum(days, (d) => d.signups?.invited ?? 0)).toBe(10);
    expect(await statsSum(days, (d) => d.invites?.visits ?? 0)).toBe(10);
  });
});

// --- Exclusão de conta ---------------------------------------------------------------------

describe('exclusão de conta', () => {
  it('convidado excluído: sai de referrals, o número de quem convidou cai, os pontos e o marcador ficam', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    const fan = await signUpFan();
    await claim(fan, codeBody(code));
    expect(
      (await http('/me/progress', { token: inviter.token })).body.stats as object,
    ).toMatchObject({ peopleBrought: 1 });

    await deleteUserData(db, fan.uid);
    expect(await exists(`referrals/${fan.uid}`)).toBe(false);
    expect(
      (await http('/me/progress', { token: inviter.token })).body.stats as object,
    ).toMatchObject({ peopleBrought: 0 });
    expect((await read(`wallets/${inviter.uid}`))?.balance).toBe(12);
    expect(await size(`wallets/${inviter.uid}/ledger`)).toBe(2);
    expect(await exists(`fanInvites/${inviter.uid}/inviteVisitors/${keyOf(fan)}`)).toBe(true);
  });

  it('convidante excluído: o código para de valer, o convite dele some e os convidados ficam sem ele', async () => {
    const inviter = await signUpFan();
    const code = await codeOf(inviter);
    await share(inviter, 'invite');
    const brought = await signUpFan();
    await claim(brought, linkBody(code, '/post/p-clipe'));
    const visitor = await signUpFan();
    await visit(visitor, code);

    await deleteUserData(db, inviter.uid);
    expect(await exists(`inviteCodes/${code}`)).toBe(false);
    expect(await exists(`fanInvites/${inviter.uid}`)).toBe(false);
    expect(await size(`fanInvites/${inviter.uid}/inviteLinks`)).toBe(0);
    expect(await size(`fanInvites/${inviter.uid}/inviteVisitors`)).toBe(0);
    const referral = await read(`referrals/${brought.uid}`);
    expect(referral).toMatchObject({
      inviterUid: null,
      code,
      link: { kind: 'post', targetId: 'p-clipe' },
    });
    expect(referral?.inviterRemovedAt).toBeInstanceOf(Timestamp);

    const late = await signUpFan();
    expect(await claim(late, codeBody(code))).toMatchObject({
      status: 404,
      body: { code: 'invite_not_found' },
    });
    expect(await visit(late, code)).toMatchObject({ status: 404 });

    // Rodar de novo não muda nada.
    await deleteUserData(db, inviter.uid);
    expect(await read(`referrals/${brought.uid}`)).toEqual(referral);
  });
});

// --- Seed ------------------------------------------------------------------------------------

describe('seed do convite', () => {
  it('o código da Camila, os links e três convidados com as origens, sem mudar a carteira dela', async () => {
    // As centrais e os posts antes, como no scripts/seed-emulators.mjs: o link
    // da central do Netto exige a central no ar, e o do clipe, o post no ar.
    await seedCentrals(db);
    await seedPosts(db);
    const camila = await signUpFan('camila@teste.imagineup', 'Camila Ribeiro');
    await seedCamilaWallet(db, camila.uid);
    // Os números da carteira (as missões e as conquistas do bloco 7 mudam o resto).
    const numbers = async () => {
      const data = await read(`wallets/${camila.uid}`);
      return [data?.balance, data?.xp, data?.seasonPoints, data?.earnedTotal];
    };
    const wallet = await numbers();
    const invitees: Fan[] = [];
    for (const { email } of SEED_INVITEES) invitees.push(await signUpFan(email));
    const visitors: Fan[] = [];
    for (const email of SEED_VISITORS) visitors.push(await signUpFan(email));

    // A ordem do scripts/seed-emulators.mjs (22.13): a Duda e o Enzo antes do
    // catálogo de missões, a Bia depois, e as visitas do Alan e da Gabi.
    const seed = async () => {
      const links = await seedCamilaInvite(db, { uid: camila.uid, email: camila.email });
      const origin = (fan: Fan) => ({
        ...fan,
        origin: SEED_INVITEES.find((item) => item.email === fan.email)!.origin,
      });
      const [bia, duda, enzo] = invitees as [Fan, Fan, Fan];
      const first = await seedInviteClaims(db, [origin(duda), origin(enzo)]);
      await seedMissionsCatalog(db);
      const second = await seedInviteClaims(db, [origin(bia)]);
      const visits = await seedInviteVisits(db, visitors);
      return {
        links,
        statuses: [...second, ...first].map((outcome) => outcome.status),
        visits: visits.map((outcome) => outcome.counted),
      };
    };
    expect(await seed()).toEqual({
      links: 4,
      statuses: ['claimed', 'claimed', 'claimed'],
      visits: [true, true],
    });

    expect(await read(`inviteCodes/${CAMILA_INVITE_CODE}`)).toMatchObject({
      uid: camila.uid,
      ownerKey: keyOf(camila),
    });
    expect(await read(`fanInvites/${camila.uid}`)).toMatchObject({ code: CAMILA_INVITE_CODE });
    expect(
      (await db.collection(`fanInvites/${camila.uid}/inviteLinks`).get()).docs
        .map((d) => d.id)
        .sort(),
    ).toEqual(['agenda', 'artist:nettobrito', 'invite', 'post:p-clipe']);
    const [bia, duda, enzo] = invitees as [Fan, Fan, Fan];
    expect(await read(`referrals/${bia.uid}`)).toMatchObject({
      inviterUid: camila.uid,
      via: 'link',
      link: { kind: 'post', targetId: 'p-clipe' },
      utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
      award: { visit: 'zero', signup: 'zero' },
    });
    expect(await read(`referrals/${duda.uid}`)).toMatchObject({
      via: 'link',
      link: { kind: 'artist', targetId: 'nettobrito' },
      utm: { source: null, medium: null, campaign: null },
    });
    expect(await read(`referrals/${enzo.uid}`)).toMatchObject({ via: 'code', link: null });
    // Os três cadastros e as duas visitas (bloco 7): um marcador por pessoa.
    expect(await size(`fanInvites/${camila.uid}/inviteVisitors`)).toBe(5);
    // A carteira da Camila fica a do protótipo: o convite vale 0 no seed.
    expect(await numbers()).toEqual(wallet);

    const day = await claimDay(bia.uid);
    expect(await statsSum([day], (d) => d.signups?.invited ?? 0)).toBe(3);
    // 3 pelo tipo post (Bia, Alan e Gabi), 1 artist (Duda) e 1 code (Enzo).
    expect(await statsSum([day], (d) => d.invites?.visits ?? 0)).toBe(5);
    expect(await statsSum([day], (d) => d.byOrigin?.kind?.post?.visits ?? 0)).toBe(3);
    for (const kind of ['post', 'artist', 'code']) {
      expect(await statsSum([day], (d) => d.byOrigin?.kind?.[kind]?.signups ?? 0)).toBe(1);
    }
    expect(await statsSum([day], (d) => d.byOrigin?.utmSource?.instagram?.signups ?? 0)).toBe(1);
    expect(await statsSum([day], (d) => d.byOrigin?.utmSource?._none?.signups ?? 0)).toBe(2);
    expect(await statsSum([day], (d) => d.byOrigin?.utmCampaign?.['sao-joao']?.signups ?? 0)).toBe(
      1,
    );

    // Rodar de novo não muda nada.
    const settled = await read(`wallets/${camila.uid}`);
    expect(await seed()).toEqual({
      links: 0,
      statuses: ['already_claimed', 'already_claimed', 'already_claimed'],
      visits: [false, false],
    });
    expect(await size(`fanInvites/${camila.uid}/inviteLinks`)).toBe(4);
    expect(await statsSum([day], (d) => d.signups?.invited ?? 0)).toBe(3);
    expect(await statsSum([day], (d) => d.invites?.visits ?? 0)).toBe(5);
    expect(await read(`wallets/${camila.uid}`)).toEqual(settled);
    expect((await http('/me/progress', { token: camila.token })).body.stats).toMatchObject({
      linksCreated: 4,
      peopleBrought: 3,
    });

    // A Bia excluída e recriada com o mesmo e-mail, com claim pela api do
    // emulador: a mesma chave da pessoa (o seed e a api usam o mesmo segredo),
    // então o marcador de visita dela já existe e não conta de novo.
    await auth.deleteUser(bia.uid);
    await waitFor('a exclusão da Bia', async () => !(await exists(`referrals/${bia.uid}`)));
    const again = await signUpFan(bia.email);
    expect(await claim(again, linkBody(CAMILA_INVITE_CODE, '/post/p-clipe'))).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect(await size(`fanInvites/${camila.uid}/inviteVisitors`)).toBe(5);
    expect(keyOf(again)).toBe(keyOf(bia));
    expect(await statsSum([await claimDay(again.uid)], (d) => d.invites?.visits ?? 0)).toBe(
      (await claimDay(again.uid)) === day ? 5 : 0,
    );
  });
});

// --- Carga dos cadastros antigos ------------------------------------------------------------

describe('carga dos cadastros antigos (scripts/backfill-signups.mjs)', () => {
  const runScript = promisify(execFile);
  const script = resolve(__dirname, '../../scripts/backfill-signups.mjs');

  it('soma por dia só os perfis sem a marca e marca cada um; rodada de novo, só soma os novos e nunca desconta', async () => {
    const day = '2026-09-01';
    const createdAt = Timestamp.fromMillis(Date.parse(`${day}T15:00:00.000Z`));
    const legacy = (id: string, displayName: string) =>
      db.doc(`users/${id}`).set({ displayName, username: id.replace('-', ''), createdAt });
    // Perfis de antes do bloco 5, gravados sem a marca.
    await legacy('legado-1', 'Antiga Um');
    await legacy('legado-2', 'Antiga Dois');
    // Perfil novo, pelo gatilho: com a marca, já contado.
    const fresh = await signUpFan();
    expect((await read(`users/${fresh.uid}`))?.signupCounted).toBe(true);

    const dry = await runScript(process.execPath, [script, '--dry-run'], { env: process.env });
    expect(dry.stdout).toContain(`${day}: 2`);
    expect(await exists(`statsDaily/${day}/statsShards/backfill`)).toBe(false);

    const first = await runScript(process.execPath, [script], { env: process.env });
    expect(first.stdout).toContain(`${day}: 2`);
    expect(await read(`statsDaily/${day}/statsShards/backfill`)).toMatchObject({
      day,
      signups: { total: 2 },
      backfill: true,
    });
    expect((await read('users/legado-1'))?.signupCounted).toBe(true);
    expect((await read('users/legado-2'))?.signupCounted).toBe(true);
    const today = dayKey(Date.now());
    expect(await exists(`statsDaily/${today}/statsShards/backfill`)).toBe(false);

    // Entre as rodadas, um perfil contado sai (a conta foi excluída) e outro
    // nasce sem a marca (uma instância antiga na troca de versão).
    await db.doc('users/legado-1').delete();
    await legacy('legado-3', 'Antiga Três');
    const second = await runScript(process.execPath, [script], { env: process.env });
    expect(second.stdout).toContain(`${day}: 1`);
    expect((await read(`statsDaily/${day}/statsShards/backfill`))?.signups).toEqual({ total: 3 });
    expect(await exists('users/legado-1')).toBe(false);

    // Sem perfil novo sem a marca, nada muda.
    await runScript(process.execPath, [script], { env: process.env });
    expect((await read(`statsDaily/${day}/statsShards/backfill`))?.signups).toEqual({ total: 3 });
  });

  it('sem o emulador e sem --project, recusa antes de ler', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.FIRESTORE_EMULATOR_HOST;
    const refused = await runScript(process.execPath, [script], { env }).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code: number; stderr: string }) => error,
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--project');
  });
});

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
