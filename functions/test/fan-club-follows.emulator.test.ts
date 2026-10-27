import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { dayKey, shiftDay } from '../src/day';
import {
  copyFanClubCounts,
  FAN_CLUB_FOLLOWS_MAX,
  FAN_CLUB_MEMBER_NOTICE_VERSION,
  FAN_CLUB_RULES_VERSION,
  monthOf,
  readFanClubCounts,
  removeFanClubData,
} from '../src/fan-clubs';
import { runFanSuspension } from '../src/moderation';
import { DEFAULT_POINTS_CONFIG, staticConfigSource, type PointsConfig } from '../src/points';
import {
  callable,
  central,
  http,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
  type Member,
} from './support';

/**
 * Os seguidores do fã-clube e a cópia da noite, a etapa 4 de 34.14
 * (docs/arquitetura-api.md, seção 34, decisões 26 a 39, 34.13): seguir, que
 * faz entrar na central oficial quando falta (o `central_join` de sempre e o
 * crédito da entrada trazida, só na primeira entrada da vida), os três sinais
 * do vínculo, as recusas (`own_fan_club`, `follow_limit`, o teto e o 404),
 * deixar de seguir, o `count()` público da página e dos números, as cascatas
 * (sair da central, bloquear o gestor e a suspensão), "Fã-clubes que sigo", a
 * seção "Dos seus fã-clubes" da Início e a cópia da noite (os `counts`, os
 * retratos do mês, o destaque vencido, a ordem, o prazo e a falha de um que
 * não para os outros). Desde a Fase 2 (seção 37, "Estado"), a marca do aviso
 * de membro no vínculo novo: a versão do corpo e a data, ou null sem corpo.
 */
const env = useEmulators('fa-clube-seguidores', ['api', 'createUserProfile', 'decideFanClub']);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Api = ReturnType<typeof localApi>;

/**
 * O handler no processo com um relógio que o teste adianta (a ordem dos
 * vínculos) e, se pedido, outros valores de pontos (o `central_join` em 0) e
 * outros tetos do dia.
 */
function clockApi(
  values: Partial<PointsConfig['values']> = {},
  actionCaps: Partial<PointsConfig['actionCaps']> = {},
) {
  const clock = { offset: 0 };
  const call = localApi(env, {
    now: () => Date.now() + clock.offset,
    config: staticConfigSource({
      points: {
        ...DEFAULT_POINTS_CONFIG,
        values: { ...DEFAULT_POINTS_CONFIG.values, ...values },
        actionCaps: { ...DEFAULT_POINTS_CONFIG.actionCaps, ...actionCaps },
      },
    }),
  });
  return { clock, call };
}

async function ok(name: string, data: unknown, who: Pick<Member, 'token'>) {
  const { result, error } = await callable(env, name, data, who.token);
  if (error) throw new Error(`${name} falhou: ${error.status} ${error.details?.reason}`);
  return result;
}

/** Uma central no ar com a autorização de imagem (as caixas valem ligadas, decisão 9). */
async function openArtist(): Promise<string> {
  const artistId = await central(env);
  await db.doc(`artistPrivate/${artistId}`).set({ imageRightsConfirmed: true });
  return artistId;
}

const join = (call: Api, fan: Fan, artistId: string) =>
  call('PUT', `/me/centrals/${artistId}`, { token: fan.token, key: unique('chave-entra-') });

const leave = (call: Api, fan: Fan, artistId: string) =>
  call('DELETE', `/me/centrals/${artistId}`, { token: fan.token, key: unique('chave-sai-') });

/** Seguir; sem corpo, como o app de antes (o vínculo sem a marca do aviso de membro). */
const follow = (call: Api, fan: Fan, clubId: string, body?: unknown) =>
  call('PUT', `/me/fan-club-follows/${clubId}`, {
    token: fan.token,
    key: unique('chave-segue-'),
    body,
  });

const unfollow = (call: Api, fan: Fan, clubId: string) =>
  call('DELETE', `/me/fan-club-follows/${clubId}`, {
    token: fan.token,
    key: unique('chave-deixa-'),
  });

const block = (call: Api, fan: Fan, otherUid: string) =>
  call('PUT', `/me/blocks/${otherUid}`, { token: fan.token, key: unique('chave-bloqueia-') });

async function codeOf(call: Api, fan: Fan): Promise<string> {
  const invite = await call('GET', '/me/invite', { token: fan.token });
  expect(invite.status).toBe(200);
  return invite.body.code as string;
}

const claimCode = (call: Api, fan: Fan, code: string) =>
  call('POST', '/invites/claim', {
    token: fan.token,
    key: unique('chave-claim-'),
    body: { code, via: 'code', link: null, openedAt: null },
  });

type Owner = { fan: Fan; clubId: string };

/** O gestor de um fã-clube ativo do artista: entra, se candidata e a equipe aprova. */
async function manager(
  call: Api,
  admin: Member,
  artistId: string,
  name = 'Camila Ribeiro',
): Promise<Owner> {
  const fan = await signUpFan(db, name);
  expect((await join(call, fan, artistId)).status).toBe(200);
  const applied = await call('POST', '/me/fan-club/application', {
    token: fan.token,
    key: unique('chave-candidata-'),
    body: {
      artistId,
      name: unique('Turma '),
      instagram: 'camila.teste.up',
      whatsapp: '(75) 99123-4567',
      pitch: 'Divulgo o artista nos stories e no grupo dos fãs da cidade.',
      adult: true,
      rulesVersion: FAN_CLUB_RULES_VERSION,
    },
  });
  expect(applied.status).toBe(200);
  await ok(
    'decideFanClub',
    { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
    admin,
  );
  const clubId = (await read(`fanClubApplications/${fan.uid}`))?.clubId as string;
  expect(clubId).toEqual(expect.any(String));
  return { fan, clubId };
}

/** Uma publicação no ar do gestor: só texto, aprovada pela equipe. Devolve o id. */
async function publish(call: Api, admin: Member, owner: Owner, text: string): Promise<string> {
  const sent = await call('POST', '/me/fan-club/posts', {
    token: owner.fan.token,
    key: unique('chave-publica-'),
    body: { text, photo: false },
  });
  expect(sent.status).toBe(200);
  const postId = sent.body.id as string;
  await ok(
    'decideFanClub',
    { subject: 'post', id: postId, decision: 'approve', expected: 'pending' },
    admin,
  );
  return postId;
}

/** A soma de um número dos shards do fã-clube. */
async function clubNumber(clubId: string, field: 'joins' | 'links'): Promise<number> {
  const snap = await db.collection(`fanClubStats/${clubId}/fanClubShards`).get();
  return snap.docs.reduce((total, doc) => total + ((doc.get(field) as number | undefined) ?? 0), 0);
}

const followOf = (uid: string, clubId: string) => read(`users/${uid}/fanClubFollows/${clubId}`);
const membership = (uid: string, artistId: string) => read(`users/${uid}/centrals/${artistId}`);
const creditOf = (uid: string, artistId: string) => read(`users/${uid}/fanClubCredits/${artistId}`);

async function followCap(uid: string): Promise<number> {
  const wallet = await read(`wallets/${uid}`);
  return (wallet?.days?.[dayKey(Date.now())]?.count?.fanclub_follow as number | undefined) ?? 0;
}

describe('seguir (decisões 26, 31 e 39)', () => {
  it('fora da central: entra junto, com o central_join uma vez, o vínculo com os sinais e o crédito do seguir; o número público pelo count()', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');
    // Trazida pelo código da gestora: o sinal `byOwnerCode`. O crédito é o do seguir.
    expect((await claimCode(call, fan, await codeOf(call, owner.fan))).status).toBe(200);

    expect(await follow(call, fan, owner.clubId)).toMatchObject({
      status: 200,
      body: {
        clubId: owner.clubId,
        following: true,
        joined: true,
        pointsAwarded: 10,
        completedMissions: [],
        missionsChanged: expect.any(Boolean),
      },
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({
      via: 'page',
      firstJoin: true,
      fanClubId: owner.clubId,
    });
    expect(await creditOf(fan.uid, artistId)).toEqual({
      artistId,
      clubId: owner.clubId,
      via: 'follow',
      at: expect.any(Timestamp),
      schemaVersion: 1,
    });
    expect(await followOf(fan.uid, owner.clubId)).toEqual({
      uid: fan.uid,
      clubId: owner.clubId,
      artistId,
      followedAt: expect.any(Timestamp),
      newAccount: true,
      chosenUsername: true,
      byOwnerCode: true,
      // Sem corpo, o app de antes: o vínculo sem a marca do aviso de membro.
      memberNoticeVersion: null,
      memberNoticeAt: null,
      schemaVersion: 1,
    });
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${artistId}`)).toBe(true);
    expect(await clubNumber(owner.clubId, 'joins')).toBe(1);
    expect(await followCap(fan.uid)).toBe(1);

    // O número é público e exato; o gestor vê só o número.
    const other = await signUpFan(db, 'Duda Lima');
    expect(await call('GET', `/fan-clubs/${owner.clubId}`, { token: other.token })).toMatchObject({
      status: 200,
      body: { followerCount: 1, isFollowing: false, isMember: false },
    });
    expect(await call('GET', `/fan-clubs/${owner.clubId}`, { token: fan.token })).toMatchObject({
      status: 200,
      body: { followerCount: 1, isFollowing: true, isMember: true },
    });
    expect(await call('GET', '/me/fan-club/numbers', { token: owner.fan.token })).toMatchObject({
      status: 200,
      body: { followers: 1, followers30d: 1, joins: 1 },
    });

    // Já seguindo: a mesma resposta, sem gravar e sem contar no teto.
    expect(await follow(call, fan, owner.clubId)).toMatchObject({
      status: 200,
      body: { following: true, joined: false, pointsAwarded: 0 },
    });
    expect(await followCap(fan.uid)).toBe(1);

    // Deixar de seguir: o número cai; a central, os pontos e o crédito ficam.
    expect(await unfollow(call, fan, owner.clubId)).toEqual({
      status: 200,
      body: { clubId: owner.clubId, following: false },
    });
    expect(await exists(`users/${fan.uid}/fanClubFollows/${owner.clubId}`)).toBe(false);
    expect(await membership(fan.uid, artistId)).toMatchObject({ fanClubId: owner.clubId });
    expect(await creditOf(fan.uid, artistId)).toMatchObject({ via: 'follow' });
    expect(await call('GET', '/me/fan-club/numbers', { token: owner.fan.token })).toMatchObject({
      body: { followers: 0, followers30d: 0, joins: 1 },
    });
    expect(await unfollow(call, fan, owner.clubId)).toMatchObject({ status: 200 });

    // Seguir de novo, já da central: sem entrada, sem ponto e sem crédito novo.
    expect(await follow(call, fan, owner.clubId)).toMatchObject({
      status: 200,
      body: { joined: false, pointsAwarded: 0 },
    });
    expect(await clubNumber(owner.clubId, 'joins')).toBe(1);
    expect(await followCap(fan.uid)).toBe(2);
  });

  it('o crédito só na primeira entrada da vida: sair da central deixa de seguir, e voltar seguindo não credita', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');

    expect((await follow(call, fan, owner.clubId)).status).toBe(200);
    expect(await clubNumber(owner.clubId, 'joins')).toBe(1);
    expect((await leave(call, fan, artistId)).status).toBe(200);
    expect(await exists(`users/${fan.uid}/fanClubFollows/${owner.clubId}`)).toBe(false);
    expect(await exists(`users/${fan.uid}/centrals/${artistId}`)).toBe(false);

    // A volta: a entrada de novo (o central_join `duplicate`), sem crédito.
    expect(await follow(call, fan, owner.clubId)).toMatchObject({
      status: 200,
      body: { joined: true, pointsAwarded: 0 },
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: false,
      fanClubId: null,
    });
    expect(await clubNumber(owner.clubId, 'joins')).toBe(1);
  });

  it('com o central_join em 0 (o extrato não guarda a entrada), o marcador segura o crédito na volta', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi({ central_join: 0 });
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');

    expect(await follow(call, fan, owner.clubId)).toMatchObject({
      status: 200,
      body: { joined: true, pointsAwarded: 0 },
    });
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${artistId}`)).toBe(false);
    expect(await membership(fan.uid, artistId)).toMatchObject({ fanClubId: owner.clubId });
    expect((await leave(call, fan, artistId)).status).toBe(200);
    expect((await follow(call, fan, owner.clubId)).status).toBe(200);
    // O central_join não sai `duplicate` (nada no extrato): o vínculo diz que é
    // a primeira entrada, e o marcador segura o crédito.
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: null,
    });
    expect(await clubNumber(owner.clubId, 'joins')).toBe(1);
  });

  it('quem já é da central segue sem entrar e sem crédito; a conta antiga e o @ automático são sinais', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Enzo Rocha');
    expect((await join(call, fan, artistId)).status).toBe(200);
    await db.doc(`users/${fan.uid}`).update({
      createdAt: Timestamp.fromMillis(Date.now() - 8 * DAY_MS),
      username: 'fa12345678',
    });

    expect(await follow(call, fan, owner.clubId)).toMatchObject({
      status: 200,
      body: { joined: false, pointsAwarded: 0 },
    });
    expect(await followOf(fan.uid, owner.clubId)).toMatchObject({
      newAccount: false,
      chosenUsername: false,
      byOwnerCode: false,
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({ fanClubId: null });
    expect(await exists(`users/${fan.uid}/fanClubCredits/${artistId}`)).toBe(false);
    expect(await clubNumber(owner.clubId, 'joins')).toBe(0);
  });

  it('a marca do aviso de membro (seção 37, "Estado"): a versão e a data no vínculo novo; sem corpo, null; já seguindo não grava; outra versão é 400 sem gravar', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const notice = { memberNoticeVersion: FAN_CLUB_MEMBER_NOTICE_VERSION };

    // Com a versão do servidor: a versão e a data, o agora do pedido (o do `followedAt`).
    const fan = await signUpFan(db, 'Bia Santos');
    const before = Date.now();
    expect(await follow(call, fan, owner.clubId, notice)).toMatchObject({
      status: 200,
      body: { clubId: owner.clubId, following: true, joined: true },
    });
    const after = Date.now();
    const marked = (await followOf(fan.uid, owner.clubId))!;
    expect(marked).toMatchObject({
      memberNoticeVersion: FAN_CLUB_MEMBER_NOTICE_VERSION,
      memberNoticeAt: expect.any(Timestamp),
    });
    expect(marked.memberNoticeAt).toEqual(marked.followedAt);
    const markedAt = (marked.memberNoticeAt as Timestamp).toMillis();
    expect(markedAt).toBeGreaterThanOrEqual(before);
    expect(markedAt).toBeLessThanOrEqual(after);

    // Sem corpo (o app de antes): o vínculo sem a marca, as duas null.
    const old = await signUpFan(db, 'Duda Lima');
    expect((await follow(call, old, owner.clubId)).status).toBe(200);
    const unmarked = { memberNoticeVersion: null, memberNoticeAt: null };
    expect(await followOf(old.uid, owner.clubId)).toMatchObject(unmarked);

    // Já seguindo, agora com a versão: a mesma resposta, sem gravar a marca (36.5).
    expect(await follow(call, old, owner.clubId, notice)).toMatchObject({
      status: 200,
      body: { following: true, joined: false, pointsAwarded: 0 },
    });
    expect(await followOf(old.uid, owner.clubId)).toMatchObject(unmarked);
    expect(await followCap(old.uid)).toBe(1);

    // Outra versão: 400 antes da transação, sem vínculo, sem central e sem teto.
    const other = await signUpFan(db, 'Enzo Rocha');
    expect(
      await follow(call, other, owner.clubId, { memberNoticeVersion: 'membros-2027-01' }),
    ).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { field: 'memberNoticeVersion' } },
    });
    expect(await exists(`users/${other.uid}/fanClubFollows/${owner.clubId}`)).toBe(false);
    expect(await exists(`users/${other.uid}/centrals/${artistId}`)).toBe(false);
    expect(await followCap(other.uid)).toBe(0);
  });

  it('pela api de verdade: seguir, os seguidos e deixar de seguir', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');
    const path = `/me/fan-club-follows/${owner.clubId}`;

    expect(
      await http(env, path, { method: 'PUT', token: fan.token, key: unique('chave-http-') }),
    ).toMatchObject({ status: 200, body: { clubId: owner.clubId, following: true, joined: true } });
    // O PUT sem corpo de verdade (o app de antes): o vínculo sem a marca.
    expect(await followOf(fan.uid, owner.clubId)).toMatchObject({
      memberNoticeVersion: null,
      memberNoticeAt: null,
    });
    expect(await http(env, '/me/fan-club-follows', { token: fan.token })).toMatchObject({
      status: 200,
      body: { items: [{ id: owner.clubId, available: true }] },
    });
    expect(
      await http(env, path, { method: 'DELETE', token: fan.token, key: unique('chave-http-') }),
    ).toMatchObject({ status: 200, body: { following: false } });
    expect(await http(env, '/me/fan-club-feed', { token: fan.token })).toMatchObject({
      status: 200,
      body: { items: [], nextCursor: null },
    });

    // Com a versão do aviso no corpo JSON: o vínculo com a marca.
    const marked = await signUpFan(db, 'Duda Lima');
    expect(
      await http(env, path, {
        method: 'PUT',
        token: marked.token,
        key: unique('chave-http-'),
        body: { memberNoticeVersion: FAN_CLUB_MEMBER_NOTICE_VERSION },
      }),
    ).toMatchObject({ status: 200, body: { following: true } });
    expect(await followOf(marked.uid, owner.clubId)).toMatchObject({
      memberNoticeVersion: FAN_CLUB_MEMBER_NOTICE_VERSION,
      memberNoticeAt: expect.any(Timestamp),
    });
  });
});

describe('as recusas do seguir (34.5)', () => {
  it('o próprio é own_fan_club; o pausado, o de artista fora do ar ou fechado e o de gestor bloqueado são 404, sem gravar', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const notFound = { status: 404, body: { code: 'fan_club_not_found' } };

    expect(await follow(call, owner.fan, owner.clubId)).toMatchObject({
      status: 409,
      body: { code: 'fan_club_refused', details: { reason: 'own_fan_club' } },
    });
    const fan = await signUpFan(db, 'Bia Santos');
    expect(await follow(call, fan, 'clubeQueNaoExiste')).toMatchObject(notFound);

    // O fã-clube fechado para o artista e o artista fora do ar.
    await db
      .doc(`artistPrivate/${artistId}`)
      .set({ fanClubs: { enabled: false } }, { merge: true });
    expect(await follow(call, fan, owner.clubId)).toMatchObject(notFound);
    await db.doc(`artistPrivate/${artistId}`).set({ fanClubs: { enabled: true } }, { merge: true });
    await db.doc(`artists/${artistId}`).update({ status: 'hidden' });
    expect(await follow(call, fan, owner.clubId)).toMatchObject(notFound);
    await db.doc(`artists/${artistId}`).update({ status: 'published' });

    // O gestor que quem pede bloqueou.
    expect((await block(call, fan, owner.fan.uid)).status).toBe(200);
    expect(await follow(call, fan, owner.clubId)).toMatchObject(notFound);

    // O pausado.
    const other = await signUpFan(db, 'Duda Lima');
    await ok(
      'decideFanClub',
      { subject: 'club', id: owner.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    expect(await follow(call, other, owner.clubId)).toMatchObject(notFound);

    for (const uid of [fan.uid, other.uid, owner.fan.uid]) {
      expect((await db.collection(`users/${uid}/fanClubFollows`).get()).size).toBe(0);
    }
    expect(await exists(`users/${fan.uid}/centrals/${artistId}`)).toBe(false);
    expect(await exists(`users/${other.uid}/centrals/${artistId}`)).toBe(false);
  });

  it('o 51º seguir é follow_limit (os indisponíveis contam); o teto do dia é 429 club_follow', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi({}, { fanclub_follow: 1 });
    const artistId = await openArtist();
    const first = await manager(call, admin, artistId, 'Camila Ribeiro');
    const second = await manager(call, admin, artistId, 'Alan Ferreira');

    // O teto do dia em 1: o segundo seguir é 429; já seguindo não conta.
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await follow(call, fan, first.clubId)).status).toBe(200);
    expect(await follow(call, fan, second.clubId)).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { action: 'club_follow', limit: 1 } },
    });
    expect((await follow(call, fan, first.clubId)).status).toBe(200);

    // 50 seguidos, inclusive de fã-clubes que não existem mais: o 51º recusa.
    const full = await signUpFan(db, 'Duda Lima');
    const batch = db.batch();
    for (let index = 0; index < FAN_CLUB_FOLLOWS_MAX; index += 1) {
      batch.set(db.doc(`users/${full.uid}/fanClubFollows/clubeAntigo${index}`), {
        uid: full.uid,
        clubId: `clubeAntigo${index}`,
        artistId,
        followedAt: Timestamp.now(),
        newAccount: false,
        chosenUsername: true,
        byOwnerCode: false,
        schemaVersion: 1,
      });
    }
    await batch.commit();
    expect(await follow(call, full, first.clubId)).toMatchObject({
      status: 409,
      body: { code: 'fan_club_refused', details: { reason: 'follow_limit' } },
    });
    expect(await exists(`users/${full.uid}/centrals/${artistId}`)).toBe(false);
    // Liberar uma vaga pela lista dos seguidos deixa seguir.
    expect((await unfollow(call, full, 'clubeAntigo0')).status).toBe(200);
    expect((await follow(call, full, first.clubId)).status).toBe(200);
  });
});

describe('o seguir some com a central, o bloqueio e a suspensão (decisões 27, 32 e 33)', () => {
  it('sair da central apaga só os seguimentos daquele artista', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const netto = await openArtist();
    const nenho = await openArtist();
    const first = await manager(call, admin, netto, 'Camila Ribeiro');
    const second = await manager(call, admin, netto, 'Alan Ferreira');
    const third = await manager(call, admin, nenho, 'Gabi Souza');
    const fan = await signUpFan(db, 'Bia Santos');
    for (const owner of [first, second, third]) {
      expect((await follow(call, fan, owner.clubId)).status).toBe(200);
    }

    expect((await leave(call, fan, netto)).status).toBe(200);
    expect(await exists(`users/${fan.uid}/fanClubFollows/${first.clubId}`)).toBe(false);
    expect(await exists(`users/${fan.uid}/fanClubFollows/${second.clubId}`)).toBe(false);
    expect(await exists(`users/${fan.uid}/fanClubFollows/${third.clubId}`)).toBe(true);
    // Sair de novo, sem vínculo: nada a fazer, nunca recusa.
    expect((await leave(call, fan, netto)).status).toBe(200);
  });

  it('bloquear o gestor desfaz o seguir; o bloqueio feito pelo gestor não apaga nada', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await follow(call, fan, owner.clubId)).status).toBe(200);

    expect((await block(call, owner.fan, fan.uid)).status).toBe(200);
    expect(await exists(`users/${fan.uid}/fanClubFollows/${owner.clubId}`)).toBe(true);

    expect((await block(call, fan, owner.fan.uid)).status).toBe(200);
    expect(await exists(`users/${fan.uid}/fanClubFollows/${owner.clubId}`)).toBe(false);
    // A central fica: bloquear não tira ninguém da central oficial.
    expect(await exists(`users/${fan.uid}/centrals/${artistId}`)).toBe(true);
  });

  it('a suspensão apaga os seguimentos e pausa o fã-clube do gestor; tirar não devolve nada', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const first = await manager(call, admin, artistId, 'Camila Ribeiro');
    const second = await manager(call, admin, artistId, 'Alan Ferreira');
    // O Alan, gestor, segue o fã-clube da Camila; a Bia segue o dele.
    expect((await follow(call, second.fan, first.clubId)).status).toBe(200);
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await follow(call, fan, second.clubId)).status).toBe(200);
    const actor = { uid: admin.uid, name: 'Admin da Equipe' };

    await runFanSuspension(
      db,
      { uid: second.fan.uid, suspended: true, reason: 'spam', note: null },
      { actor },
    );
    expect((await db.collection(`users/${second.fan.uid}/fanClubFollows`).get()).size).toBe(0);
    expect(await read(`fanClubs/${second.clubId}`)).toMatchObject({
      status: 'paused',
      statusReason: 'suspended',
    });
    // Quem segue o fã-clube pausado continua com o vínculo (indisponível na lista).
    expect(await exists(`users/${fan.uid}/fanClubFollows/${second.clubId}`)).toBe(true);
    // O suspenso não segue; deixar de seguir vale para ele.
    expect(await follow(call, second.fan, first.clubId)).toMatchObject({
      status: 403,
      body: { code: 'account_suspended' },
    });
    expect((await unfollow(call, second.fan, first.clubId)).status).toBe(200);

    await runFanSuspension(
      db,
      { uid: second.fan.uid, suspended: false, reason: null, note: null },
      { actor },
    );
    expect((await db.collection(`users/${second.fan.uid}/fanClubFollows`).get()).size).toBe(0);
    expect(await read(`fanClubs/${second.clubId}`)).toMatchObject({ status: 'paused' });
  });
});

describe('as listas do fã: "Fã-clubes que sigo" e a Início (decisão 30)', () => {
  it('os seguidos, do mais novo, com o indisponível marcado: o pausado, o encerrado e o de artista fora do ar com o nome; a lápide e o de gestor bloqueado sem', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const netto = await openArtist();
    const nenho = await openArtist();
    const available = await manager(call, admin, netto, 'Camila Ribeiro');
    const paused = await manager(call, admin, netto, 'Alan Ferreira');
    const closed = await manager(call, admin, netto, 'Duda Lima');
    const tombstone = await manager(call, admin, netto, 'Gabi Souza');
    const artistOff = await manager(call, admin, nenho, 'Enzo Rocha');
    const fan = await signUpFan(db, 'Bia Santos');
    expect(await call('GET', '/me/fan-club-follows', { token: fan.token })).toEqual({
      status: 200,
      body: { items: [] },
    });
    for (const owner of [available, paused, closed, tombstone, artistOff]) {
      clock.offset += 1_000;
      expect((await follow(call, fan, owner.clubId)).status).toBe(200);
    }
    await ok(
      'decideFanClub',
      { subject: 'club', id: paused.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    // O encerrado pela equipe continua com o nome (só a lápide o perde).
    await ok(
      'decideFanClub',
      { subject: 'club', id: closed.clubId, decision: 'close', expected: 'active' },
      admin,
    );
    await removeFanClubData(db, tombstone.fan.uid);
    await db.doc(`artists/${nenho}`).update({ status: 'hidden' });

    const names = async (clubId: string) => (await read(`fanClubs/${clubId}`))?.name as string;
    const listed = await call('GET', '/me/fan-club-follows', { token: fan.token });
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      {
        id: artistOff.clubId,
        name: await names(artistOff.clubId),
        artistId: nenho,
        artistName: `Central ${nenho}`,
        owner: null,
        followedAt: expect.any(String),
        available: false,
        official: false,
      },
      expect.objectContaining({ id: tombstone.clubId, name: null, owner: null, available: false }),
      expect.objectContaining({
        id: closed.clubId,
        name: await names(closed.clubId),
        owner: null,
        available: false,
      }),
      expect.objectContaining({
        id: paused.clubId,
        name: await names(paused.clubId),
        owner: null,
        available: false,
      }),
      expect.objectContaining({
        id: available.clubId,
        name: await names(available.clubId),
        artistId: netto,
        owner: expect.objectContaining({ uid: available.fan.uid }),
        available: true,
      }),
    ]);

    // O gestor bloqueado (a lista gravada direto: o `blockFan` apagaria o
    // vínculo): a linha fica, para liberar a vaga, sem o nome e sem o gestor.
    await db.doc(`blockLists/${fan.uid}`).set({
      uid: fan.uid,
      blocked: [available.fan.uid],
      updatedAt: Timestamp.now(),
      schemaVersion: 1,
    });
    const blocked = await call('GET', '/me/fan-club-follows', { token: fan.token });
    expect((blocked.body.items as { id: string }[]).at(-1)).toEqual({
      id: available.clubId,
      name: null,
      artistId: netto,
      artistName: `Central ${netto}`,
      owner: null,
      followedAt: expect.any(String),
      available: false,
      official: false,
    });
  });

  it('a Início: as publicações no ar dos fã-clubes disponíveis, da mais nova, 10 por página; sem vínculo, vazia; sem o gestor bloqueado, o pausado, o artista fora do ar e o fã-clube fechado para o artista', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const first = await manager(call, admin, artistId, 'Camila Ribeiro');
    const second = await manager(call, admin, artistId, 'Alan Ferreira');
    const fan = await signUpFan(db, 'Bia Santos');
    expect(await call('GET', '/me/fan-club-feed', { token: fan.token })).toEqual({
      status: 200,
      body: { items: [], nextCursor: null },
    });

    const a1 = await publish(call, admin, first, 'Ensaio aberto hoje no centro, bora!');
    const b1 = await publish(call, admin, second, 'Faixa nova pintada para o show de sábado.');
    const a2 = await publish(call, admin, first, 'Contagem regressiva para o clipe novo.');
    // Uma em análise não aparece.
    expect(
      (
        await call('POST', '/me/fan-club/posts', {
          token: first.fan.token,
          key: unique('chave-publica-'),
          body: { text: 'Ainda em análise pela equipe.', photo: false },
        })
      ).status,
    ).toBe(200);
    for (const owner of [first, second]) {
      expect((await follow(call, fan, owner.clubId)).status).toBe(200);
    }

    const page = await call('GET', '/me/fan-club-feed', {
      token: fan.token,
      query: { limit: '2' },
    });
    expect(page.status).toBe(200);
    expect((page.body.items as { id: string }[]).map((item) => item.id)).toEqual([a2, b1]);
    expect(page.body.items).toEqual([
      expect.objectContaining({
        id: a2,
        clubId: first.clubId,
        clubName: (await read(`fanClubs/${first.clubId}`))?.name,
        author: expect.objectContaining({ uid: first.fan.uid }),
        kind: 'text',
      }),
      expect.objectContaining({ id: b1, clubId: second.clubId }),
    ]);
    const cursor = page.body.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    expect(
      await call('GET', '/me/fan-club-feed', { token: fan.token, query: { limit: '2', cursor } }),
    ).toMatchObject({ status: 200, body: { items: [{ id: a1 }], nextCursor: null } });
    const feedIds = async () =>
      (
        (await call('GET', '/me/fan-club-feed', { token: fan.token })).body.items as {
          id: string;
        }[]
      ).map((item) => item.id);

    // O gestor bloqueado sai da Início (a lista gravada direto: o `blockFan`
    // apagaria o vínculo).
    const blockList = db.doc(`blockLists/${fan.uid}`);
    await blockList.set({
      uid: fan.uid,
      blocked: [first.fan.uid],
      updatedAt: Timestamp.now(),
      schemaVersion: 1,
    });
    expect(await feedIds()).toEqual([b1]);
    await blockList.set({
      uid: fan.uid,
      blocked: [],
      updatedAt: Timestamp.now(),
      schemaVersion: 1,
    });

    // O fã-clube pausado sai da Início.
    await ok(
      'decideFanClub',
      { subject: 'club', id: second.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    expect(await feedIds()).toEqual([a2, a1]);

    // O fã-clube fechado para o artista e o artista fora do ar também.
    const boxes = db.doc(`artistPrivate/${artistId}`);
    await boxes.set({ fanClubs: { enabled: false } }, { merge: true });
    expect(await feedIds()).toEqual([]);
    await boxes.set({ fanClubs: { enabled: true } }, { merge: true });
    await db.doc(`artists/${artistId}`).update({ status: 'hidden' });
    expect(await feedIds()).toEqual([]);
    await db.doc(`artists/${artistId}`).update({ status: 'published' });
    expect(await feedIds()).toEqual([a2, a1]);
  });
});

describe('a cópia da noite (decisões 28, 35 e 37)', () => {
  it('os counts, o retrato do mês e o destaque vencido; a cópia do mês seguinte fecha o anterior', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId, 'Camila Ribeiro');
    const other = await manager(call, admin, artistId, 'Alan Ferreira');
    const code = await codeOf(call, owner.fan);
    // Três seguidores: uma trazida pela gestora, um de @ automático e um da
    // central antiga com a conta de mais de 7 dias.
    const brought = await signUpFan(db, 'Bia Santos');
    expect((await claimCode(call, brought, code)).status).toBe(200);
    expect((await follow(call, brought, owner.clubId)).status).toBe(200);
    const automatic = await signUpFan(db, 'Duda Lima');
    await db.doc(`users/${automatic.uid}`).update({ username: 'fa12345678' });
    expect((await follow(call, automatic, owner.clubId)).status).toBe(200);
    const old = await signUpFan(db, 'Enzo Rocha');
    expect((await join(call, old, artistId)).status).toBe(200);
    await db.doc(`users/${old.uid}`).update({
      createdAt: Timestamp.fromMillis(Date.now() - 8 * DAY_MS),
    });
    expect((await follow(call, old, owner.clubId)).status).toBe(200);
    // A Duda sai da central: deixa de seguir, e a entrada trazida não ficou.
    expect((await leave(call, automatic, artistId)).status).toBe(200);
    const again = await signUpFan(db, 'Gabi Souza');
    await db.doc(`users/${again.uid}`).update({ username: 'fa87654321' });
    expect((await follow(call, again, owner.clubId)).status).toBe(200);

    // O destaque vencido do Camila sai; o do Alan, no prazo, fica.
    const today = dayKey(Date.now());
    await db.doc(`fanClubs/${owner.clubId}`).update({
      featured: true,
      featuredUntil: shiftDay(today, -1),
    });
    await db.doc(`fanClubs/${other.clubId}`).update({
      featured: true,
      featuredUntil: shiftDay(today, 3),
    });

    const now = Date.now();
    const log = { info: vi.fn(), error: vi.fn() };
    expect(await copyFanClubCounts(db, { now, deadline: now + 60_000, log })).toEqual({
      selected: 2,
      copied: 2,
      failed: 0,
      deferred: 0,
      unfeatured: 1,
      monthsClosed: 0,
    });
    expect(log.error).not.toHaveBeenCalled();
    const copied = (await read(`fanClubs/${owner.clubId}`))!;
    expect(copied.counts).toEqual({
      followers: 3,
      followers30d: 3,
      newAccounts: 2,
      automaticUsername: 1,
      byOwnerCode: 1,
      joins: 3,
      retained: 2,
      signups: 0,
      visits: 0,
      links: 0,
      at: Timestamp.fromMillis(now),
    });
    expect(copied.monthStart).toEqual({
      month: monthOf(now),
      followers: 3,
      joins: 3,
      signups: 0,
      visits: 0,
      links: 0,
    });
    expect(copied.lastMonth).toBeNull();
    expect(copied).toMatchObject({
      featured: false,
      featuredUntil: null,
      featuredAt: null,
      featuredBy: null,
    });
    expect(await read(`fanClubs/${other.clubId}`)).toMatchObject({
      featured: true,
      featuredUntil: shiftDay(today, 3),
      counts: { followers: 0, at: Timestamp.fromMillis(now) },
    });

    // Um seguidor sai; a cópia do mês seguinte fecha o mês (o saldo de seguidores).
    expect((await unfollow(call, old, owner.clubId)).status).toBe(200);
    const next = now + 40 * DAY_MS;
    expect(
      await copyFanClubCounts(db, { now: next, deadline: Date.now() + 60_000, log }),
    ).toMatchObject({ copied: 2, monthsClosed: 2 });
    const closed = (await read(`fanClubs/${owner.clubId}`))!;
    expect(closed.lastMonth).toEqual({
      month: monthOf(now),
      followers: -1,
      joins: 0,
      signups: 0,
      visits: 0,
      links: 0,
    });
    expect(closed.monthStart).toMatchObject({ month: monthOf(next), followers: 2, joins: 3 });
    expect(closed.counts).toMatchObject({ followers: 2, followers30d: 0 });
    // Outra cópia no mesmo mês não fecha de novo.
    expect(
      await copyFanClubCounts(db, { now: next, deadline: Date.now() + 60_000, log }),
    ).toMatchObject({ copied: 2, monthsClosed: 0 });
  });

  it('o pausado é copiado e o encerrado não; os de cópia mais antiga primeiro; o prazo e a falha de um que não para os outros', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const first = await manager(call, admin, artistId, 'Camila Ribeiro');
    const second = await manager(call, admin, artistId, 'Alan Ferreira');
    const closed = await manager(call, admin, artistId, 'Gabi Souza');
    await ok(
      'decideFanClub',
      { subject: 'club', id: second.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    await ok(
      'decideFanClub',
      { subject: 'club', id: closed.clubId, decision: 'close', expected: 'active' },
      admin,
    );
    const log = { info: vi.fn(), error: vi.fn() };

    // A falha de um vai ao log e não para o outro.
    const now = Date.now();
    const failing = await copyFanClubCounts(db, {
      now,
      deadline: now + 60_000,
      log,
      readCounts: async (database, clubId, at) => {
        if (clubId === first.clubId) throw new Error('falha de teste');
        return readFanClubCounts(database, clubId, at);
      },
    });
    expect(failing).toMatchObject({ selected: 2, copied: 1, failed: 1, deferred: 0 });
    expect(log.error).toHaveBeenCalledWith('fan-clubs: a cópia da noite de um fã-clube falhou', {
      clubId: first.clubId,
      error: 'falha de teste',
    });
    expect((await read(`fanClubs/${first.clubId}`))?.counts.at).toBeNull();
    expect((await read(`fanClubs/${second.clubId}`))?.counts.at).toEqual(Timestamp.fromMillis(now));
    expect((await read(`fanClubs/${closed.clubId}`))?.counts.at).toBeNull();

    // Com uma vaga só, vai primeiro o que nunca foi copiado (o `null`).
    expect(
      await copyFanClubCounts(db, { now: now + 1_000, deadline: Date.now() + 60_000, log, max: 1 }),
    ).toMatchObject({ selected: 1, copied: 1 });
    expect((await read(`fanClubs/${first.clubId}`))?.counts.at).toEqual(
      Timestamp.fromMillis(now + 1_000),
    );
    expect((await read(`fanClubs/${second.clubId}`))?.counts.at).toEqual(Timestamp.fromMillis(now));

    // Depois do prazo, nenhum começa: ficam para a noite seguinte.
    expect(await copyFanClubCounts(db, { now: now + 2_000, deadline: 0, log })).toMatchObject({
      selected: 2,
      copied: 0,
      deferred: 2,
    });
  });
});
