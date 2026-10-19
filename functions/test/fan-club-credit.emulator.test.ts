import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { FAN_CLUB_RULES_VERSION } from '../src/fan-clubs';
import { DEFAULT_POINTS_CONFIG, staticConfigSource, type PointsConfig } from '../src/points';
import {
  callable,
  central,
  daysSince,
  http,
  localApi,
  seedMember,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  type Fan,
  type Member,
} from './support';

/**
 * A atribuição do fã-clube, a etapa 3 de 34.14 (docs/arquitetura-api.md,
 * seção 34, decisões 22 a 24, 34.13): o tipo de link `fanclub` no convite (o
 * link registrado só do fã-clube ativo, a visita e o cadastro pelo link), os
 * números do fã-clube em shards (`links`, `visits`, `signups` e `joins`), o
 * crédito da entrada trazida pelo código do gestor, na entrada (`PUT
 * /me/centrals/:artistId` e `POST /me/artists`) e no claim que chega depois,
 * com o `firstJoin` do vínculo e o marcador `fanClubCredits`, e o `GET
 * /me/fan-club/numbers`. O crédito de quem segue o fã-clube chega com a etapa 4.
 */
const env = useEmulators('fa-clube-atribuicao', ['api', 'createUserProfile', 'decideFanClub']);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Api = ReturnType<typeof localApi>;
type Numbers = { links: number; visits: number; signups: number; joins: number };

/**
 * O handler no processo com um relógio que o teste adianta (os 30 dias do
 * crédito) e, se pedido, outros valores de pontos (o `central_join` em 0).
 */
function clockApi(values: Partial<PointsConfig['values']> = {}) {
  const clock = { offset: 0 };
  const call = localApi(env, {
    now: () => Date.now() + clock.offset,
    config: staticConfigSource({
      points: { ...DEFAULT_POINTS_CONFIG, values: { ...DEFAULT_POINTS_CONFIG.values, ...values } },
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

const followArtists = (call: Api, fan: Fan, artistIds: string[]) =>
  call('POST', '/me/artists', {
    token: fan.token,
    key: unique('chave-escolha-'),
    body: { artistIds },
  });

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

const claimLink = (call: Api, fan: Fan, code: string, path: string) =>
  call('POST', '/invites/claim', {
    token: fan.token,
    key: unique('chave-claim-'),
    body: { code, via: 'link', link: { path }, utm: {}, openedAt: new Date().toISOString() },
  });

const visit = (call: Api, fan: Fan, code: string, path: string) =>
  call('POST', '/invites/visit', {
    token: fan.token,
    key: unique('chave-visita-'),
    body: { code, link: { path }, utm: {}, openedAt: new Date().toISOString() },
  });

const share = (call: Api, fan: Fan, linkId: string) =>
  call('PUT', `/me/invite/links/${linkId}`, { token: fan.token, key: unique('chave-link-') });

/** O gestor de um fã-clube ativo do artista: entra, se candidata e a equipe aprova. */
async function manager(
  call: Api,
  admin: Member,
  artistId: string,
): Promise<{ fan: Fan; clubId: string; code: string }> {
  const fan = await signUpFan(db, 'Camila Ribeiro');
  expect((await join(call, fan, artistId)).status).toBe(200);
  const applied = await call('POST', '/me/fan-club/application', {
    token: fan.token,
    key: unique('chave-candidata-'),
    body: {
      artistId,
      name: 'Turma do Netto',
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
  return { fan, clubId, code: await codeOf(call, fan) };
}

/** A soma dos shards do fã-clube, campo a campo, e quantos shards existem. */
async function clubNumbers(clubId: string): Promise<Numbers & { shards: number }> {
  const snap = await db.collection(`fanClubStats/${clubId}/fanClubShards`).get();
  const sum = (field: keyof Numbers) =>
    snap.docs.reduce((total, doc) => total + ((doc.get(field) as number | undefined) ?? 0), 0);
  return {
    links: sum('links'),
    visits: sum('visits'),
    signups: sum('signups'),
    joins: sum('joins'),
    shards: snap.size,
  };
}

const membership = (uid: string, artistId: string) => read(`users/${uid}/centrals/${artistId}`);
const creditOf = (uid: string, artistId: string) => read(`users/${uid}/fanClubCredits/${artistId}`);

describe('o crédito pelo código do gestor, na entrada (decisão 23)', () => {
  it('até 30 dias do cadastro: o vínculo com o fanClubId e o firstJoin, o marcador, joins +1 e o central_join de sempre; sair e voltar não credita', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    // A entrada do próprio gestor não credita nada (ele não foi trazido).
    expect(await membership(owner.fan.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: null,
    });

    const fan = await signUpFan(db, 'Bia Santos');
    expect(await claimCode(call, fan, owner.code)).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect(await join(call, fan, artistId)).toMatchObject({
      status: 200,
      body: { artistId, pointsAwarded: 10 },
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({
      uid: fan.uid,
      artistId,
      via: 'page',
      firstJoin: true,
      fanClubId: owner.clubId,
      schemaVersion: 1,
    });
    expect(await creditOf(fan.uid, artistId)).toEqual({
      artistId,
      clubId: owner.clubId,
      via: 'owner_code',
      at: expect.any(Timestamp),
      schemaVersion: 1,
    });
    expect(await clubNumbers(owner.clubId)).toEqual({
      links: 0,
      visits: 0,
      signups: 0,
      joins: 1,
      shards: 1,
    });
    const [shard] = (await db.collection(`fanClubStats/${owner.clubId}/fanClubShards`).get()).docs;
    expect(Number(shard!.id)).toBeGreaterThanOrEqual(0);
    expect(Number(shard!.id)).toBeLessThan(16);
    expect(shard!.data()).toEqual({ joins: 1, updatedAt: expect.any(Timestamp) });
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${artistId}`)).toBe(true);

    // Sair e voltar: o central_join sai `duplicate`, o vínculo novo não é a
    // primeira entrada da vida, e nada credita de novo.
    expect((await leave(call, fan, artistId)).status).toBe(200);
    expect(await join(call, fan, artistId)).toMatchObject({
      status: 200,
      body: { pointsAwarded: 0 },
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: false,
      fanClubId: null,
    });
    expect((await clubNumbers(owner.clubId)).joins).toBe(1);

    // O gestor vê o número no "Meu fã-clube" (os seguidores chegam na etapa 4).
    expect(await call('GET', '/me/fan-club/numbers', { token: owner.fan.token })).toEqual({
      status: 200,
      body: { followers: 0, followers30d: 0, links: 0, visits: 0, signups: 0, joins: 1 },
    });
  });

  it('depois de 30 dias do cadastro, a entrada não credita', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await claimCode(call, fan, owner.code)).status).toBe(200);

    clock.offset = 30 * DAY_MS + 60_000;
    expect((await join(call, fan, artistId)).status).toBe(200);
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: null,
    });
    expect(await exists(`users/${fan.uid}/fanClubCredits/${artistId}`)).toBe(false);
    expect(await clubNumbers(owner.clubId)).toMatchObject({ joins: 0, shards: 0 });
  });

  it('o fã-clube pausado não credita; o de outro artista não credita a entrada nesta central', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const otherArtist = await openArtist();
    const owner = await manager(call, admin, artistId);

    // Outro artista: o gestor do fã-clube do Netto não credita a entrada no Nenho.
    const first = await signUpFan(db, 'Bia Santos');
    expect((await claimCode(call, first, owner.code)).status).toBe(200);
    expect((await join(call, first, otherArtist)).status).toBe(200);
    expect(await membership(first.uid, otherArtist)).toMatchObject({ fanClubId: null });
    // A central do fã-clube dele, depois, credita.
    expect((await join(call, first, artistId)).status).toBe(200);
    expect(await membership(first.uid, artistId)).toMatchObject({ fanClubId: owner.clubId });

    // Pausado: a entrada trazida não conta.
    await ok(
      'decideFanClub',
      { subject: 'club', id: owner.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    const second = await signUpFan(db, 'Duda Lima');
    expect((await claimCode(call, second, owner.code)).status).toBe(200);
    expect((await join(call, second, artistId)).status).toBe(200);
    expect(await membership(second.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: null,
    });
    expect(await exists(`users/${second.uid}/fanClubCredits/${artistId}`)).toBe(false);
    expect((await clubNumbers(owner.clubId)).joins).toBe(1);
  });

  it('POST /me/artists: só a central do fã-clube do gestor leva o crédito, uma vez', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const otherArtist = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await claimCode(call, fan, owner.code)).status).toBe(200);

    expect(await followArtists(call, fan, [otherArtist, artistId])).toMatchObject({
      status: 200,
      body: { pointsAwarded: 20 },
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({
      via: 'onboarding',
      firstJoin: true,
      fanClubId: owner.clubId,
    });
    expect(await membership(fan.uid, otherArtist)).toMatchObject({
      via: 'onboarding',
      firstJoin: true,
      fanClubId: null,
    });
    expect(await creditOf(fan.uid, artistId)).toMatchObject({ via: 'owner_code' });
    expect(await exists(`users/${fan.uid}/fanClubCredits/${otherArtist}`)).toBe(false);
    expect((await clubNumbers(owner.clubId)).joins).toBe(1);
  });

  it('com o central_join em 0 (o extrato não guarda a entrada), o marcador segura: sair e voltar não credita de novo', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi({ central_join: 0 });
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await claimCode(call, fan, owner.code)).status).toBe(200);

    expect(await join(call, fan, artistId)).toMatchObject({
      status: 200,
      body: { pointsAwarded: 0 },
    });
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${artistId}`)).toBe(false);
    expect(await membership(fan.uid, artistId)).toMatchObject({ fanClubId: owner.clubId });
    expect((await leave(call, fan, artistId)).status).toBe(200);
    expect((await join(call, fan, artistId)).status).toBe(200);
    // O central_join de novo não sai `duplicate` (nada no extrato): o vínculo
    // diz que é a primeira entrada, e o marcador segura o crédito.
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: null,
    });
    expect((await clubNumbers(owner.clubId)).joins).toBe(1);
  });
});

describe('o crédito no claim que chega depois da entrada (decisão 23)', () => {
  it('a entrada do onboarding já pagou o central_join e o vínculo tem o firstJoin: o claim credita uma vez', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');

    expect((await followArtists(call, fan, [artistId])).status).toBe(200);
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: null,
    });
    expect(await exists(`wallets/${fan.uid}/ledger/central_join:${artistId}`)).toBe(true);

    expect(await claimCode(call, fan, owner.code)).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect(await membership(fan.uid, artistId)).toMatchObject({
      firstJoin: true,
      fanClubId: owner.clubId,
    });
    expect(await creditOf(fan.uid, artistId)).toMatchObject({
      clubId: owner.clubId,
      via: 'owner_code',
    });
    expect(await clubNumbers(owner.clubId)).toMatchObject({ joins: 1, signups: 0 });

    // O claim repetido (o use-invite-sync tenta de novo) não credita outra vez.
    expect(await claimCode(call, fan, owner.code)).toMatchObject({
      status: 200,
      body: { status: 'already_claimed' },
    });
    expect((await clubNumbers(owner.clubId)).joins).toBe(1);
  });

  it('o vínculo que não é a primeira entrada da vida não credita no claim', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const fan = await signUpFan(db, 'Bia Santos');

    expect((await join(call, fan, artistId)).status).toBe(200);
    expect((await leave(call, fan, artistId)).status).toBe(200);
    expect((await join(call, fan, artistId)).status).toBe(200);
    expect(await membership(fan.uid, artistId)).toMatchObject({ firstJoin: false });
    expect((await claimCode(call, fan, owner.code)).status).toBe(200);
    expect(await membership(fan.uid, artistId)).toMatchObject({ fanClubId: null });
    expect(await exists(`users/${fan.uid}/fanClubCredits/${artistId}`)).toBe(false);
    expect(await clubNumbers(owner.clubId)).toMatchObject({ joins: 0, shards: 0 });
  });

  it('quem convidou sem fã-clube, e o fã que nem entrou na central, não creditam', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const friend = await signUpFan(db, 'Enzo Rocha');
    const friendCode = await codeOf(call, friend);

    // Trazido por um fã sem fã-clube: nada.
    const first = await signUpFan(db, 'Bia Santos');
    expect((await followArtists(call, first, [artistId])).status).toBe(200);
    expect((await claimCode(call, first, friendCode)).status).toBe(200);
    expect(await membership(first.uid, artistId)).toMatchObject({ fanClubId: null });

    // Trazido pelo gestor, sem estar na central: nada no claim; a entrada depois credita.
    const second = await signUpFan(db, 'Duda Lima');
    expect((await claimCode(call, second, owner.code)).status).toBe(200);
    expect(await exists(`users/${second.uid}/fanClubCredits/${artistId}`)).toBe(false);
    expect((await join(call, second, artistId)).status).toBe(200);
    expect(await membership(second.uid, artistId)).toMatchObject({ fanClubId: owner.clubId });
    expect((await clubNumbers(owner.clubId)).joins).toBe(1);
  });
});

describe('o link do fã-clube no convite (decisão 22) e os números em shards (decisão 24)', () => {
  it('o link registrado: só do fã-clube ativo, um por fã; soma links no fã-clube e no byOrigin.kind.fanclub', async () => {
    const start = Date.now();
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const linkId = `fanclub:${owner.clubId}`;
    const days = () => daysSince(start);
    const fanclubLinks = () =>
      statsSum(db, days(), (data) => data.byOrigin?.kind?.fanclub?.links ?? 0);

    expect(await share(call, owner.fan, linkId)).toEqual({
      status: 200,
      body: { linkId, created: true },
    });
    expect(await read(`fanInvites/${owner.fan.uid}/inviteLinks/${linkId}`)).toMatchObject({
      kind: 'fanclub',
      targetId: owner.clubId,
    });
    expect(await share(call, owner.fan, linkId)).toMatchObject({ body: { created: false } });
    // Outro fã compartilha o mesmo fã-clube com o código dele: o fã-clube ganha a métrica.
    const friend = await signUpFan(db, 'Enzo Rocha');
    await codeOf(call, friend);
    expect(await share(call, friend, linkId)).toMatchObject({ body: { created: true } });
    expect((await clubNumbers(owner.clubId)).links).toBe(2);
    expect(await fanclubLinks()).toBe(2);

    // O fã-clube que não existe e o pausado não registram.
    expect(await share(call, friend, 'fanclub:clubeQueNaoExiste')).toMatchObject({
      status: 200,
      body: { created: false },
    });
    expect(await exists('fanClubStats/clubeQueNaoExiste')).toBe(false);
    await ok(
      'decideFanClub',
      { subject: 'club', id: owner.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    const third = await signUpFan(db, 'Duda Lima');
    await codeOf(call, third);
    expect(await share(call, third, linkId)).toMatchObject({ body: { created: false } });
    expect((await clubNumbers(owner.clubId)).links).toBe(2);
    expect(await fanclubLinks()).toBe(2);
    // O id fora do formato é 400, antes da transação.
    expect(await share(call, third, 'fanclub:__x__')).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { field: 'linkId' } },
    });
  });

  it('a visita e o cadastro pelo link do fã-clube somam visits e signups nele; o link de outro fã não credita a entrada', async () => {
    const start = Date.now();
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    const friend = await signUpFan(db, 'Enzo Rocha');
    const friendCode = await codeOf(call, friend);
    const path = `/fa-clube/${owner.clubId}`;

    // A visita de quem já tem conta: conta uma vez por pessoa.
    const visitor = await signUpFan(db, 'Bia Santos');
    expect((await visit(call, visitor, friendCode, path)).status).toBe(200);
    expect((await visit(call, visitor, friendCode, path)).status).toBe(200);
    expect(await clubNumbers(owner.clubId)).toMatchObject({ visits: 1, signups: 0 });

    // O cadastro pelo link: a origem `fanclub`, o cadastro e a visita (o marcador nasce no claim).
    const fan = await signUpFan(db, 'Duda Lima');
    expect(await claimLink(call, fan, friendCode, `${path}/?ref=${friendCode}`)).toMatchObject({
      status: 200,
      body: { status: 'claimed' },
    });
    expect(await read(`referrals/${fan.uid}`)).toMatchObject({
      inviterUid: friend.uid,
      link: { kind: 'fanclub', targetId: owner.clubId },
    });
    expect(await clubNumbers(owner.clubId)).toMatchObject({ visits: 2, signups: 1, joins: 0 });
    expect(
      await statsSum(db, daysSince(start), (data) => data.byOrigin?.kind?.fanclub?.signups ?? 0),
    ).toBe(1);
    expect(
      await statsSum(db, daysSince(start), (data) => data.byOrigin?.kind?.fanclub?.visits ?? 0),
    ).toBe(2);

    // Quem trouxe é o Enzo, que não é gestor: a entrada não credita o fã-clube.
    expect((await join(call, fan, artistId)).status).toBe(200);
    expect(await membership(fan.uid, artistId)).toMatchObject({ fanClubId: null });
    expect((await clubNumbers(owner.clubId)).joins).toBe(0);

    // O link de um fã-clube que não existe conta só na origem, sem shard nenhum.
    const lost = await signUpFan(db, 'Alan Ferreira');
    expect((await claimLink(call, lost, friendCode, '/fa-clube/clubeQueNaoExiste')).status).toBe(
      200,
    );
    expect(await read(`referrals/${lost.uid}`)).toMatchObject({
      link: { kind: 'fanclub', targetId: 'clubeQueNaoExiste' },
    });
    expect(await exists('fanClubStats/clubeQueNaoExiste')).toBe(false);
    expect((await db.collection('fanClubStats/clubeQueNaoExiste/fanClubShards').get()).empty).toBe(
      true,
    );
  });
});

describe('os números do gestor (GET /me/fan-club/numbers)', () => {
  it('pela api de verdade: a soma dos shards e os seguidores; sem fã-clube, 404', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const artistId = await openArtist();
    const owner = await manager(call, admin, artistId);
    expect((await share(call, owner.fan, `fanclub:${owner.clubId}`)).status).toBe(200);
    const fan = await signUpFan(db, 'Bia Santos');
    expect((await claimCode(call, fan, owner.code)).status).toBe(200);
    expect((await join(call, fan, artistId)).status).toBe(200);

    expect(await http(env, '/me/fan-club/numbers', { token: owner.fan.token })).toMatchObject({
      status: 200,
      body: { followers: 0, followers30d: 0, links: 1, visits: 0, signups: 0, joins: 1 },
    });
    expect(await http(env, '/me/fan-club/numbers', { token: fan.token })).toMatchObject({
      status: 404,
      body: { code: 'fan_club_not_found' },
    });
    // Encerrado, o gestor ainda vê o que o fã-clube fez.
    await ok(
      'decideFanClub',
      { subject: 'club', id: owner.clubId, decision: 'close', expected: 'active' },
      admin,
    );
    expect(await call('GET', '/me/fan-club/numbers', { token: owner.fan.token })).toMatchObject({
      status: 200,
      body: { links: 1, joins: 1 },
    });
  });
});
