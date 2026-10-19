import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { dayKey, shiftDay } from '../src/day';
import {
  FAN_CLUB_PRIZE_NOTICE,
  FAN_CLUB_RULES_VERSION,
  fanClubBoxes,
  removeFanClubData,
} from '../src/fan-clubs';
import { fanPhotoFiles, syncFanProfile } from '../src/fan-profile';
import { DEFAULT_POINTS_CONFIG, staticConfigSource } from '../src/points';
import {
  callable,
  central,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type CallError,
  type Fan,
  type Member,
} from './support';

/**
 * O fã-clube gerido pelo fã, na etapa 1 de 34.14 (docs/arquitetura-api.md,
 * seção 34, 34.13): a candidatura pela `api` (o estado, as centrais, as
 * recusas na ordem de 34.5, a rodada e o prazo, a desistência e o teto do
 * dia), a callable `decideFanClub` com a candidatura e o fã-clube (cada
 * decisão, o `stale-decision`, o `ok` sem auditar, o acesso, o encerrar só do
 * admin e o gestor suspenso), as caixas do `updateArtist`, o `has-content` do
 * `deleteArtist`, a suspensão que pausa, as cópias do perfil e a lápide da
 * exclusão. O WhatsApp da candidatura chega com o contato do fã (a UP-66).
 */
const env = useEmulators('fa-clubes', [
  'createUserProfile',
  'decideFanClub',
  'updateArtist',
  'deleteArtist',
  'setFanSuspended',
]);
const { db, bucket } = env;
const files = fanPhotoFiles(() => bucket);

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Caller = Pick<Member, 'token'>;

async function ok<T = Record<string, unknown>>(name: string, data: unknown, who: Caller) {
  const { result, error } = await callable<T>(env, name, data, who.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function failure(name: string, data: unknown, who?: Caller): Promise<CallError> {
  const { error } = await callable(env, name, data, who?.token);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error;
}

async function audits(action: string) {
  const snap = await db.collection('staffAudit').where('action', '==', action).get();
  return snap.docs.map((doc) => doc.data());
}

/**
 * O handler no processo com um relógio que o teste adianta (o prazo de 30
 * dias): o de verdade mais o `offset`, para a candidatura nunca vir antes da
 * central criada no teste (a aprovação recusa a central mais nova que ela).
 */
function clockApi() {
  const clock = { offset: 0 };
  const call = localApi(env, {
    now: () => Date.now() + clock.offset,
    config: staticConfigSource({ points: DEFAULT_POINTS_CONFIG }),
  });
  return { clock, call };
}

/** Uma central no ar com a autorização de imagem (as caixas valem ligadas, decisão 9). */
async function openArtist(
  privateExtra: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Promise<string> {
  const artistId = await central(env, extra);
  await db.doc(`artistPrivate/${artistId}`).set({
    email: null,
    phone: null,
    managerUid: null,
    managerName: null,
    imageRightsConfirmed: true,
    createdBy: 'semente',
    updatedBy: 'semente',
    updatedAt: Timestamp.now(),
    ...privateExtra,
  });
  return artistId;
}

const PITCH = 'Divulgo o artista nos stories e no grupo dos fãs da cidade.';

const applicationBody = (artistId: string, extra: Record<string, unknown> = {}) => ({
  artistId,
  name: 'Turma do Netto',
  instagram: 'camila.teste.up',
  tiktok: '@camila.teste.up',
  whatsapp: '(75) 99123-4567',
  pitch: PITCH,
  adult: true,
  rulesVersion: FAN_CLUB_RULES_VERSION,
  ...extra,
});

type Api = ReturnType<typeof localApi>;

const join = (call: Api, fan: Fan, artistId: string) =>
  call('PUT', `/me/centrals/${artistId}`, { token: fan.token, key: unique('chave-entra-') });

const apply = (call: Api, fan: Fan, body: unknown) =>
  call('POST', '/me/fan-club/application', {
    token: fan.token,
    key: unique('chave-candidata-'),
    body,
  });

const withdraw = (call: Api, fan: Fan) =>
  call('DELETE', '/me/fan-club/application', { token: fan.token, key: unique('chave-desiste-') });

const myFanClub = (call: Api, fan: Fan) => call('GET', '/me/fan-club', { token: fan.token });

/** Um fã que é da central e manda a candidatura (a rodada 1). */
async function candidate(call: Api, artistId: string, name = 'Camila Ribeiro') {
  const fan = await signUpFan(db, name);
  expect((await join(call, fan, artistId)).status).toBe(200);
  expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({ status: 200 });
  return fan;
}

const approve = (who: Caller, fan: Fan, extra: Record<string, unknown> = {}) =>
  ok(
    'decideFanClub',
    { subject: 'application', id: fan.uid, decision: 'approve', expected: 1, ...extra },
    who,
  );

const reject = (who: Caller, fan: Fan, round: number, reason = 'incomplete') =>
  ok(
    'decideFanClub',
    { subject: 'application', id: fan.uid, decision: 'reject', expected: round, reason },
    who,
  );

const clubOf = async (fan: Fan) => (await read(`fanClubApplications/${fan.uid}`))?.clubId as string;

const decideClub = (who: Caller, clubId: string, decision: string, expected: string, extra = {}) =>
  ok('decideFanClub', { subject: 'club', id: clubId, decision, expected, ...extra }, who);

const refusal = (reason: string, extra: Record<string, unknown> = {}) => ({
  status: 409,
  body: { code: 'fan_club_refused', details: { reason, ...extra } },
});

describe('a candidatura (34.3 e 34.5)', () => {
  it('sem candidatura, o programa; candidatar grava a pendente, o privado e as cópias; o GET a mostra', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const fan = await signUpFan(db, 'Camila Ribeiro');
    expect(await myFanClub(call, fan)).toEqual({
      status: 200,
      body: {
        open: true,
        rulesUrl: null,
        rulesVersion: FAN_CLUB_RULES_VERSION,
        notice: FAN_CLUB_PRIZE_NOTICE,
        application: null,
        club: null,
      },
    });
    expect((await join(call, fan, artistId)).status).toBe(200);
    expect(await call('GET', '/me/fan-club/artists', { token: fan.token })).toEqual({
      status: 200,
      body: {
        items: [
          {
            artistId,
            name: `Central ${artistId}`,
            shortName: null,
            thumbUrl: null,
            photosAllowed: true,
          },
        ],
      },
    });

    const applied = await apply(call, fan, applicationBody(artistId));
    expect(applied).toMatchObject({
      status: 200,
      body: {
        open: true,
        application: {
          status: 'pending',
          artistId,
          artistName: `Central ${artistId}`,
          proposedName: 'Turma do Netto',
          round: 1,
          rejectReason: null,
          canReapplyAt: null,
          canApply: false,
          history: [],
        },
        club: null,
      },
    });
    const profile = (await read(`users/${fan.uid}`))!;
    expect(await read(`fanClubApplications/${fan.uid}`)).toMatchObject({
      uid: fan.uid,
      artistId,
      program: 'fanclub',
      status: 'pending',
      round: 1,
      proposedName: 'Turma do Netto',
      rulesVersion: FAN_CLUB_RULES_VERSION,
      rulesAcceptedAt: expect.any(Timestamp),
      adultDeclared: true,
      decidedBy: null,
      clubId: null,
      closedByStaff: false,
      fanName: 'Camila Ribeiro',
      fanUsername: profile.username,
      fanPhotoURL: null,
      schemaVersion: 1,
    });
    expect(await read(`fanClubApplicationPrivate/${fan.uid}`)).toEqual({
      instagram: 'camila.teste.up',
      tiktok: 'camila.teste.up',
      pitch: PITCH,
      schemaVersion: 1,
    });
    // O WhatsApp vai para o contato do fã, e não para o privado (decisão 14).
    expect(await read(`users/${fan.uid}/contact/main`)).toEqual({
      whatsapp: '+5575991234567',
      source: 'fanclub',
      updatedAt: expect.any(Timestamp),
    });
    expect(await call('GET', '/me/contact', { token: fan.token })).toEqual({
      status: 200,
      body: { whatsapp: '+5575991234567' },
    });
    // Mandar de novo com a pendente: already_applied.
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('already_applied'),
    );
    expect((await myFanClub(call, fan)).body).toMatchObject({
      application: { status: 'pending', round: 1 },
      club: null,
    });
  });

  it('as recusas antes da candidatura: o @ automático, fora da central e o artista fechado', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const fan = await signUpFan(db, 'Duda Lima');
    // Fora da central.
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(refusal('not_member'));
    expect((await join(call, fan, artistId)).status).toBe(200);
    // O @ automático vem antes de tudo.
    const username = (await read(`users/${fan.uid}`))!.username as string;
    await db.doc(`users/${fan.uid}`).update({ username: 'fa12345678' });
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('username_required'),
    );
    await db.doc(`users/${fan.uid}`).update({ username });
    // O artista fechado para o fã-clube (a caixa desligada) e fora do ar.
    await db.doc(`artistPrivate/${artistId}`).update({ fanClubs: { enabled: false } });
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('artist_closed'),
    );
    expect((await call('GET', '/me/fan-club/artists', { token: fan.token })).body).toEqual({
      items: [],
    });
    await db.doc(`artistPrivate/${artistId}`).update({ fanClubs: { enabled: true } });
    await db.doc(`artists/${artistId}`).update({ status: 'unpublished' });
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('artist_closed'),
    );
    // Sem a autorização de imagem, as caixas não valem (o true gravado não passa por cima).
    await db.doc(`artists/${artistId}`).update({ status: 'published' });
    await db.doc(`artistPrivate/${artistId}`).update({ imageRightsConfirmed: false });
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('artist_closed'),
    );
    expect(await exists(`fanClubApplications/${fan.uid}`)).toBe(false);
  });

  it('desistir: a pendente vira withdrawn com a mesma rodada e sem prazo, o privado sai; sem pendente, o estado sem gravar', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const fan = await candidate(call, artistId);
    expect(await withdraw(call, fan)).toMatchObject({
      status: 200,
      body: { application: { status: 'withdrawn', round: 1, canApply: true, canReapplyAt: null } },
    });
    expect(await read(`fanClubApplications/${fan.uid}`)).toMatchObject({
      status: 'withdrawn',
      round: 1,
      canReapplyAt: null,
      decidedAt: expect.any(Timestamp),
      decidedBy: null,
    });
    expect(await exists(`fanClubApplicationPrivate/${fan.uid}`)).toBe(false);
    const before = (await db.doc(`fanClubApplications/${fan.uid}`).get()).updateTime;
    expect(await withdraw(call, fan)).toMatchObject({
      status: 200,
      body: { application: { status: 'withdrawn' } },
    });
    expect((await db.doc(`fanClubApplications/${fan.uid}`).get()).updateTime).toEqual(before);
    // De novo, na mesma rodada.
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({
      status: 200,
      body: { application: { status: 'pending', round: 1 } },
    });
    // O suspenso desiste (desfazer), mas não se candidata.
    const admin = await seedMember(env, 'Admin', 'admin');
    await ok('setFanSuspended', { uid: fan.uid, suspended: true, reason: 'spam' }, admin);
    expect((await withdraw(call, fan)).status).toBe(200);
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({
      status: 403,
      body: { code: 'account_suspended' },
    });
  });

  it('o teto do dia: a 4ª candidatura do dia é 429 com club_apply; o dia seguinte passa', async () => {
    const { clock, call } = clockApi();
    const artistId = await openArtist();
    const fan = await candidate(call, artistId);
    for (let n = 2; n <= 3; n += 1) {
      expect((await withdraw(call, fan)).status).toBe(200);
      expect((await apply(call, fan, applicationBody(artistId))).status).toBe(200);
    }
    expect((await withdraw(call, fan)).status).toBe(200);
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 3, action: 'club_apply' } },
    });
    clock.offset += DAY_MS;
    expect((await apply(call, fan, applicationBody(artistId))).status).toBe(200);
  });
});

describe('o WhatsApp da candidatura e o contato do fã (decisão 14)', () => {
  const putContact = (call: Api, fan: Fan, whatsapp: string | null) =>
    call('PUT', '/me/contact', {
      token: fan.token,
      key: unique('chave-contato-'),
      body: { whatsapp },
    });

  it('obrigatório e normalizado, com e sem o +55; o curto, o longo e o fixo recusados, sem gravar', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const fan = await signUpFan(db, 'Camila Ribeiro');
    expect((await join(call, fan, artistId)).status).toBe(200);
    for (const whatsapp of [
      '99123-4567',
      '(75) 99123-45678',
      '(75) 3221-4567',
      '+1 415 555 0100',
    ]) {
      expect(
        await apply(call, fan, applicationBody(artistId, { whatsapp })),
        whatsapp,
      ).toMatchObject({
        status: 400,
        body: { code: 'fan_club_invalid', details: { field: 'whatsapp' } },
      });
    }
    const { whatsapp: _whatsapp, ...without } = applicationBody(artistId);
    expect(await apply(call, fan, without)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { field: 'whatsapp' } },
    });
    expect(await exists(`fanClubApplications/${fan.uid}`)).toBe(false);
    expect(await exists(`users/${fan.uid}/contact/main`)).toBe(false);
    expect(
      await apply(call, fan, applicationBody(artistId, { whatsapp: '+55 75 98888-7777' })),
    ).toMatchObject({ status: 200 });
    expect(await read(`users/${fan.uid}/contact/main`)).toMatchObject({
      whatsapp: '+5575988887777',
      source: 'fanclub',
    });
  });

  it('o PUT /me/contact troca; apagar com a pendente ou o fã-clube ativo ou pausado é contact_required; retirada, recusada ou encerrado, apaga', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const admin = await seedMember(env, 'Admin', 'admin');
    const whatsappOf = async (fan: Fan) => (await read(`users/${fan.uid}/contact/main`))?.whatsapp;

    // Com a pendente, o número é obrigatório (a aprovação não o confere): troca, não apaga.
    const fan = await candidate(call, artistId);
    expect(await putContact(call, fan, null)).toMatchObject(refusal('contact_required'));
    expect(await whatsappOf(fan)).toBe('+5575991234567');
    expect(await putContact(call, fan, '(75) 98888-7777')).toMatchObject({
      status: 200,
      body: { whatsapp: '+5575988887777' },
    });
    // Retirada: apaga.
    expect((await withdraw(call, fan)).status).toBe(200);
    expect(await putContact(call, fan, null)).toMatchObject({
      status: 200,
      body: { whatsapp: null },
    });
    expect(await whatsappOf(fan)).toBeNull();
    // Recusada: apaga.
    expect((await apply(call, fan, applicationBody(artistId))).status).toBe(200);
    await reject(admin, fan, 1);
    expect(await putContact(call, fan, null)).toMatchObject({
      status: 200,
      body: { whatsapp: null },
    });

    // Com o fã-clube ativo ou pausado, o número é o canal dos prêmios.
    const owner = await candidate(call, artistId, 'Duda Lima');
    await approve(admin, owner);
    const clubId = await clubOf(owner);
    expect(await putContact(call, owner, null)).toMatchObject(refusal('contact_required'));
    expect(await putContact(call, owner, '75 98888-7777')).toMatchObject({
      status: 200,
      body: { whatsapp: '+5575988887777' },
    });
    expect(await read(`users/${owner.uid}/contact/main`)).toMatchObject({
      whatsapp: '+5575988887777',
      source: 'app',
    });
    await decideClub(admin, clubId, 'pause', 'active');
    expect(await putContact(call, owner, null)).toMatchObject(refusal('contact_required'));
    expect(await whatsappOf(owner)).toBe('+5575988887777');
    await decideClub(admin, clubId, 'close', 'paused', { reason: 'owner_request' });
    expect(await putContact(call, owner, null)).toMatchObject({
      status: 200,
      body: { whatsapp: null },
    });
    expect(await whatsappOf(owner)).toBeNull();
  });

  it('a candidatura recusada na transação não troca o número guardado', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const admin = await seedMember(env, 'Admin', 'admin');
    const other = { whatsapp: '(75) 98888-7777' };
    const fan = await signUpFan(db, 'Camila Ribeiro');
    // Fora da central: nada gravado, nem o contato.
    expect(await apply(call, fan, applicationBody(artistId, other))).toMatchObject(
      refusal('not_member'),
    );
    expect(await exists(`users/${fan.uid}/contact/main`)).toBe(false);
    expect((await join(call, fan, artistId)).status).toBe(200);
    expect((await apply(call, fan, applicationBody(artistId))).status).toBe(200);
    const stored = async () => (await read(`users/${fan.uid}/contact/main`))?.whatsapp;
    expect(await stored()).toBe('+5575991234567');
    expect(await apply(call, fan, applicationBody(artistId, other))).toMatchObject(
      refusal('already_applied'),
    );
    expect(await stored()).toBe('+5575991234567');
    await approve(admin, fan);
    expect(await apply(call, fan, applicationBody(artistId, other))).toMatchObject(
      refusal('has_fan_club'),
    );
    expect(await stored()).toBe('+5575991234567');

    const rejected = await candidate(call, artistId, 'Duda Lima');
    await reject(admin, rejected, 1);
    expect(await apply(call, rejected, applicationBody(artistId, other))).toMatchObject(
      refusal('cooldown'),
    );
    expect((await read(`users/${rejected.uid}/contact/main`))?.whatsapp).toBe('+5575991234567');
  });
});

describe('decideFanClub: a candidatura', () => {
  it('aprovar: o fã-clube ativo com as cópias, o texto de divulgação fora, a auditoria sem texto; o GET mostra o fã-clube', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const fan = await candidate(call, artistId);
    expect(await approve(editor, fan, { name: '  Turma do Netto Brito ' })).toEqual({
      ok: true,
      subject: 'application',
      id: fan.uid,
      status: 'approved',
    });
    const application = (await read(`fanClubApplications/${fan.uid}`))!;
    expect(application).toMatchObject({
      status: 'approved',
      decidedBy: { uid: editor.uid, name: 'Editora' },
      decidedAt: expect.any(Timestamp),
      clubId: expect.any(String),
      history: [{ round: 1, decision: 'approved', reason: null, at: expect.any(Timestamp) }],
    });
    const clubId = application.clubId as string;
    const profile = (await read(`users/${fan.uid}`))!;
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      artistId,
      artistName: `Central ${artistId}`,
      ownerUid: fan.uid,
      ownerName: 'Camila Ribeiro',
      ownerUsername: profile.username,
      ownerPhotoURL: null,
      name: 'Turma do Netto Brito',
      status: 'active',
      statusReason: null,
      accountDeleted: false,
      applicationRound: 1,
      approvedBy: { uid: editor.uid, name: 'Editora' },
      postCount: 0,
      pendingPosts: 0,
      counts: { followers: 0, joins: 0, at: null },
      featured: false,
      featuredUntil: null,
      lastReward: null,
      schemaVersion: 1,
    });
    expect(await read(`fanClubApplicationPrivate/${fan.uid}`)).toEqual({
      instagram: 'camila.teste.up',
      tiktok: 'camila.teste.up',
      pitch: null,
      schemaVersion: 1,
    });
    const [entry] = await audits('fanClub.application.approved');
    expect(entry).toMatchObject({
      actorUid: editor.uid,
      targetUid: null,
      targetEmail: '',
      section: 'fanClubs',
      details: { clubId, artistId, fanUid: fan.uid, round: 1, nameChanged: true },
      targets: [`artist:${artistId}`, `fanClub:${clubId}`, `fan:${fan.uid}`],
    });
    expect(JSON.stringify(entry)).not.toContain(PITCH);
    expect(JSON.stringify(entry)).not.toContain('camila.teste.up');

    expect((await myFanClub(call, fan)).body).toMatchObject({
      application: { status: 'approved', canApply: false },
      club: {
        id: clubId,
        name: 'Turma do Netto Brito',
        artistId,
        status: 'active',
        postCount: 0,
        pendingPosts: 0,
        photosAllowed: true,
        featuredUntil: null,
        lastReward: null,
        available: true,
        unavailableReason: null,
        rulesOutdated: false,
      },
    });
    // Com o fã-clube ativo, nova candidatura: has_fan_club.
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('has_fan_club'),
    );
    // Aprovar de novo: ok, sem auditar.
    expect((await approve(editor, fan)).status).toBe('approved');
    expect(await audits('fanClub.application.approved')).toHaveLength(1);
  });

  it('recusar: o motivo, o prazo de 30 dias e o privado apagado; o cooldown; três rodadas e o fim', async () => {
    const { clock, call } = clockApi();
    const artistId = await openArtist();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const fan = await candidate(call, artistId);
    expect((await reject(editor, fan, 1, 'not_fit')).status).toBe('rejected');
    const rejected = (await read(`fanClubApplications/${fan.uid}`))!;
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectReason: 'not_fit',
      canReapplyAt: expect.any(Timestamp),
      history: [{ round: 1, decision: 'rejected', reason: 'not_fit' }],
    });
    const canReapplyAt = (rejected.canReapplyAt as Timestamp).toMillis();
    expect(Math.abs(canReapplyAt - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000);
    expect(await exists(`fanClubApplicationPrivate/${fan.uid}`)).toBe(false);
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('cooldown', { canReapplyAt: new Date(canReapplyAt).toISOString() }),
    );
    expect((await myFanClub(call, fan)).body).toMatchObject({
      application: { status: 'rejected', rejectReason: 'not_fit', canApply: false },
    });
    const [entry] = await audits('fanClub.application.rejected');
    expect(entry).toMatchObject({
      details: { artistId, fanUid: fan.uid, round: 1, reason: 'not_fit' },
      targets: [`artist:${artistId}`, `fan:${fan.uid}`],
    });

    // A rodada 2 e a 3, cada uma depois do prazo, e a 3ª recusada sem prazo.
    for (const round of [2, 3]) {
      clock.offset = 31 * DAY_MS;
      expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({
        status: 200,
        body: { application: { round } },
      });
      expect((await reject(editor, fan, round)).status).toBe('rejected');
    }
    expect(await read(`fanClubApplications/${fan.uid}`)).toMatchObject({
      round: 3,
      canReapplyAt: null,
    });
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject(
      refusal('too_many_rounds'),
    );
  });

  it('o stale-decision, a retirada, o Leitor, quem não tem a seção e o próprio fã', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['fanClubs']);
    const other = await seedMember(env, 'Outra', 'editor', ['fans', 'artists']);
    const fan = await candidate(call, artistId);
    const data = { subject: 'application', id: fan.uid, decision: 'approve', expected: 2 };
    expect((await failure('decideFanClub', data, editor)).details?.reason).toBe('stale-decision');
    expect((await failure('decideFanClub', { ...data, expected: 1 }, viewer)).details?.reason).toBe(
      'no-section',
    );
    expect((await failure('decideFanClub', { ...data, expected: 1 }, other)).details?.reason).toBe(
      'no-section',
    );
    expect((await failure('decideFanClub', { ...data, expected: 1 })).details?.reason).toBe(
      'unauthenticated',
    );
    expect(
      (await failure('decideFanClub', { ...data, id: unique('semConta'), expected: 1 }, editor))
        .details?.reason,
    ).toBe('application-not-found');
    // A retirada no meio: a tela abriu com a pendente.
    expect((await withdraw(call, fan)).status).toBe(200);
    expect((await failure('decideFanClub', { ...data, expected: 1 }, editor)).details?.reason).toBe(
      'stale-decision',
    );
    // O membro da equipe que também é fã não decide a própria candidatura.
    await db.doc(`staff/${fan.uid}`).set({
      uid: fan.uid,
      email: fan.email,
      displayName: 'Fã da Equipe',
      role: 'editor',
      sections: ['fanClubs'],
      status: 'active',
    });
    expect((await failure('decideFanClub', { ...data, expected: 1 }, fan)).details?.reason).toBe(
      'self',
    );
    expect(await audits('fanClub.application.approved')).toEqual([]);
  });

  it('desistir e mandar de novo, na mesma rodada: o submittedAt da tela separa as duas candidaturas', async () => {
    const { clock, call } = clockApi();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const first = await openArtist();
    const second = await openArtist();
    const fan = await candidate(call, first);
    expect((await join(call, fan, second)).status).toBe(200);
    const shown = (
      (await read(`fanClubApplications/${fan.uid}`))!.submittedAt as Timestamp
    ).toMillis();
    // A tela abriu com a candidatura do primeiro artista; o fã desiste e manda outra.
    expect((await withdraw(call, fan)).status).toBe(200);
    clock.offset += 60_000;
    expect(await apply(call, fan, applicationBody(second, { name: 'Outra Turma' }))).toMatchObject({
      status: 200,
      body: { application: { round: 1, artistId: second } },
    });
    const old = { subject: 'application', id: fan.uid, expected: 1, submittedAt: shown };
    for (const decision of [
      { decision: 'approve' },
      { decision: 'reject', reason: 'incomplete' },
    ]) {
      expect(
        (await failure('decideFanClub', { ...old, ...decision }, editor)).details?.reason,
      ).toBe('stale-decision');
    }
    expect(await read(`fanClubApplications/${fan.uid}`)).toMatchObject({
      status: 'pending',
      artistId: second,
      canReapplyAt: null,
    });
    expect((await db.collection('fanClubs').where('ownerUid', '==', fan.uid).get()).empty).toBe(
      true,
    );
    // Com o submittedAt de agora, aprova; de novo, ok sem auditar outra vez.
    const now = (
      (await read(`fanClubApplications/${fan.uid}`))!.submittedAt as Timestamp
    ).toMillis();
    const fresh = { ...old, submittedAt: now, decision: 'approve' };
    expect((await ok('decideFanClub', fresh, editor)).status).toBe('approved');
    expect((await ok('decideFanClub', fresh, editor)).status).toBe('approved');
    expect(await audits('fanClub.application.approved')).toHaveLength(1);
    expect((await read(`fanClubs/${await clubOf(fan)}`))?.artistId).toBe(second);
    // A recusa repetida com outro motivo é outra decisão.
    const other = await candidate(call, first, 'Bia Santos');
    const reject = { subject: 'application', id: other.uid, expected: 1, decision: 'reject' };
    await ok('decideFanClub', { ...reject, reason: 'not_fit' }, editor);
    expect((await ok('decideFanClub', { ...reject, reason: 'not_fit' }, editor)).status).toBe(
      'rejected',
    );
    expect(
      (await failure('decideFanClub', { ...reject, reason: 'other' }, editor)).details?.reason,
    ).toBe('stale-decision');
    expect(await audits('fanClub.application.rejected')).toHaveLength(1);
  });
});

describe('decideFanClub: o fã-clube', () => {
  it('pausar, reativar e o stale-decision; o pausado sai do ar para o gestor; o artista fechado não reativa', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const fan = await candidate(call, artistId);
    await approve(editor, fan);
    const clubId = await clubOf(fan);
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision: 'pause', expected: 'paused' },
          editor,
        )
      ).details?.reason,
    ).toBe('stale-decision');
    expect(await decideClub(editor, clubId, 'pause', 'active')).toEqual({
      ok: true,
      subject: 'club',
      id: clubId,
      status: 'paused',
    });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      status: 'paused',
      statusReason: 'staff',
      pausedAt: expect.any(Timestamp),
      featured: false,
    });
    expect((await myFanClub(call, fan)).body).toMatchObject({
      club: { status: 'paused', available: false, unavailableReason: 'paused' },
    });
    // Pausar de novo, com a tela que já mostra o pausado ou com a mesma chamada
    // (a nova tentativa do painel): ok, sem auditar.
    expect((await decideClub(editor, clubId, 'pause', 'paused')).status).toBe('paused');
    expect((await decideClub(editor, clubId, 'pause', 'active')).status).toBe('paused');
    expect(await audits('fanClub.paused')).toHaveLength(1);
    expect((await audits('fanClub.paused'))[0]).toMatchObject({
      details: { clubId, artistId, fanUid: fan.uid },
      targets: [`artist:${artistId}`, `fanClub:${clubId}`, `fan:${fan.uid}`],
    });
    // O artista fora do ar segura o reativar.
    await db.doc(`artists/${artistId}`).update({ status: 'unpublished' });
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision: 'resume', expected: 'paused' },
          editor,
        )
      ).details?.reason,
    ).toBe('artist-not-open');
    await db.doc(`artists/${artistId}`).update({ status: 'published' });
    expect((await decideClub(editor, clubId, 'resume', 'paused')).status).toBe('active');
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      status: 'active',
      statusReason: null,
      pausedAt: null,
    });
    // A mesma chamada de novo: ok, sem auditar; a tela velha que pede reativar o ativo, também.
    expect((await decideClub(editor, clubId, 'resume', 'paused')).status).toBe('active');
    expect(await audits('fanClub.resumed')).toHaveLength(1);
    // O gestor fora da central: o fã-clube continua, e o "Meu fã-clube" diz por quê.
    expect(
      (
        await call('DELETE', `/me/centrals/${artistId}`, {
          token: fan.token,
          key: unique('chave-sai-'),
        })
      ).status,
    ).toBe(200);
    expect((await myFanClub(call, fan)).body).toMatchObject({
      club: { status: 'active', available: false, unavailableReason: 'not_member' },
    });
    // A caixa "Aceita fã-clubes" desligada fecha o fã-clube para o artista.
    expect((await join(call, fan, artistId)).status).toBe(200);
    await db.doc(`artistPrivate/${artistId}`).update({ fanClubs: { enabled: false } });
    expect((await myFanClub(call, fan)).body).toMatchObject({
      club: { available: false, unavailableReason: 'program_closed', photosAllowed: false },
    });
  });

  it('a suspensão pausa o fã-clube e tira o destaque; reativar e aprovar com o gestor suspenso: owner-suspended', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await candidate(call, artistId);
    await approve(admin, fan);
    const clubId = await clubOf(fan);
    const until = shiftDay(dayKey(Date.now()), 7);
    await decideClub(admin, clubId, 'feature', 'active', { featuredUntil: until });
    await ok('setFanSuspended', { uid: fan.uid, suspended: true, reason: 'spam' }, admin);
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      status: 'paused',
      statusReason: 'suspended',
      pausedAt: expect.any(Timestamp),
      featured: false,
      featuredUntil: null,
    });
    const [suspended] = await audits('fan.suspended');
    expect(suspended).toMatchObject({ details: { uid: fan.uid, clubId } });
    expect(suspended!.targets).toEqual([`fan:${fan.uid}`, `fanClub:${clubId}`]);
    // A tela que mostrava o ativo e pede pausar: a pausa pela suspensão é outra decisão.
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision: 'pause', expected: 'active' },
          admin,
        )
      ).details?.reason,
    ).toBe('stale-decision');
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ statusReason: 'suspended' });
    expect(await audits('fanClub.paused')).toEqual([]);
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision: 'resume', expected: 'paused' },
          admin,
        )
      ).details?.reason,
    ).toBe('owner-suspended');
    // Tirar a suspensão não reativa nada.
    await ok('setFanSuspended', { uid: fan.uid, suspended: false }, admin);
    expect((await read(`fanClubs/${clubId}`))?.status).toBe('paused');
    expect((await decideClub(admin, clubId, 'resume', 'paused')).status).toBe('active');

    // A candidatura pendente do suspenso não é aprovada.
    const other = await candidate(call, artistId, 'Bia Santos');
    await ok('setFanSuspended', { uid: other.uid, suspended: true, reason: 'spam' }, admin);
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'application', id: other.uid, decision: 'approve', expected: 1 },
          admin,
        )
      ).details?.reason,
    ).toBe('owner-suspended');
  });

  it('encerrar é só do admin: com staff, nunca mais; com owner_request, de novo depois de 30 dias na rodada 1', async () => {
    const { clock, call } = clockApi();
    const artistId = await openArtist();
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const fan = await candidate(call, artistId);
    await approve(editor, fan);
    const clubId = await clubOf(fan);
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision: 'close', expected: 'active' },
          editor,
        )
      ).details?.reason,
    ).toBe('admin-only');
    expect(
      await decideClub(admin, clubId, 'close', 'active', { reason: 'owner_request' }),
    ).toMatchObject({ status: 'closed' });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      status: 'closed',
      statusReason: 'owner_request',
      closedAt: expect.any(Timestamp),
      closedBy: { uid: admin.uid, name: 'Admin' },
      featured: false,
    });
    expect(await read(`fanClubApplications/${fan.uid}`)).toMatchObject({
      status: 'approved',
      round: 0,
      closedByStaff: false,
      canReapplyAt: expect.any(Timestamp),
    });
    expect(await exists(`fanClubApplicationPrivate/${fan.uid}`)).toBe(false);
    expect((await myFanClub(call, fan)).body).toMatchObject({
      club: { status: 'closed', available: false, unavailableReason: 'closed' },
      application: { canApply: false },
    });
    expect((await audits('fanClub.closed'))[0]).toMatchObject({
      details: { clubId, artistId, fanUid: fan.uid, reason: 'owner_request' },
    });
    // A mesma chamada de novo (a nova tentativa do painel): ok, sem auditar e sem
    // gravar na candidatura; com o outro motivo, é outra decisão.
    const canReapplyAt = (await read(`fanClubApplications/${fan.uid}`))?.canReapplyAt;
    expect(
      (await decideClub(admin, clubId, 'close', 'active', { reason: 'owner_request' })).status,
    ).toBe('closed');
    expect(
      (await decideClub(admin, clubId, 'close', 'closed', { reason: 'owner_request' })).status,
    ).toBe('closed');
    expect((await read(`fanClubApplications/${fan.uid}`))?.canReapplyAt).toEqual(canReapplyAt);
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision: 'close', expected: 'active', reason: 'staff' },
          admin,
        )
      ).details?.reason,
    ).toBe('stale-decision');
    expect((await read(`fanClubApplications/${fan.uid}`))?.closedByStaff).toBe(false);
    expect(await audits('fanClub.closed')).toHaveLength(1);
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({
      status: 409,
      body: { details: { reason: 'cooldown' } },
    });
    clock.offset = 31 * DAY_MS;
    expect(await apply(call, fan, applicationBody(artistId))).toMatchObject({
      status: 200,
      body: { application: { status: 'pending', round: 1 }, club: null },
    });

    // Encerrado pela equipe: nunca mais.
    const other = await candidate(call, artistId, 'Bia Santos');
    await approve(editor, other);
    const otherClub = await clubOf(other);
    await decideClub(admin, otherClub, 'close', 'active');
    expect(await read(`fanClubs/${otherClub}`)).toMatchObject({ statusReason: 'staff' });
    expect((await read(`fanClubApplications/${other.uid}`))?.closedByStaff).toBe(true);
    clock.offset = 365 * DAY_MS;
    expect(await apply(call, other, applicationBody(artistId))).toMatchObject(
      refusal('not_allowed'),
    );
    expect((await myFanClub(call, other)).body).toMatchObject({
      application: { canApply: false },
    });
    // O fã-clube que não existe.
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: unique('semClube'), decision: 'pause', expected: 'active' },
          editor,
        )
      ).details?.reason,
    ).toBe('fan-club-not-found');
  });

  it('o gestor que também é da equipe não decide o próprio fã-clube: self, antes do stale-decision', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const fan = await candidate(call, artistId);
    await approve(editor, fan);
    const clubId = await clubOf(fan);
    const member = (role: 'editor' | 'admin') =>
      db.doc(`staff/${fan.uid}`).set({
        uid: fan.uid,
        email: fan.email,
        displayName: 'Gestora da Equipe',
        role,
        sections: ['fanClubs'],
        status: 'active',
      });
    await member('editor');
    const until = shiftDay(dayKey(Date.now()), 7);
    const reasonOf = async (decision: string, expected: string, extra = {}) =>
      (
        await failure(
          'decideFanClub',
          { subject: 'club', id: clubId, decision, expected, ...extra },
          fan,
        )
      ).details?.reason;
    expect(await reasonOf('pause', 'active')).toBe('self');
    expect(await reasonOf('pause', 'paused')).toBe('self');
    expect(await reasonOf('unfeature', 'active')).toBe('self');
    expect(await reasonOf('feature', 'active', { featuredUntil: until })).toBe('self');
    // Encerrar pede o admin antes de tudo; o admin gestor recebe o self.
    expect(await reasonOf('close', 'active')).toBe('admin-only');
    await member('admin');
    expect(await reasonOf('close', 'active')).toBe('self');
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ status: 'active', featured: false });
    for (const action of ['fanClub.paused', 'fanClub.featured', 'fanClub.closed']) {
      expect(await audits(action)).toEqual([]);
    }
    // Outra pessoa da equipe decide.
    expect((await decideClub(editor, clubId, 'pause', 'active')).status).toBe('paused');
  });

  it('destacar: de amanhã a 31 dias, até 3 por artista (o vencido não conta), o mesmo prazo sem gravar e tirar o destaque', async () => {
    const { call } = clockApi();
    const artistId = await openArtist();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const today = dayKey(Date.now());
    const clubs: string[] = [];
    const fans: Fan[] = [];
    for (const name of ['Ana Souza', 'Bia Santos', 'Caio Lima', 'Davi Rocha']) {
      const fan = await candidate(call, artistId, name);
      await approve(editor, fan);
      fans.push(fan);
      clubs.push(await clubOf(fan));
    }
    const until = shiftDay(today, 31);
    for (const clubId of clubs.slice(0, 3)) {
      expect(
        (await decideClub(editor, clubId, 'feature', 'active', { featuredUntil: until })).status,
      ).toBe('active');
    }
    expect(await read(`fanClubs/${clubs[0]}`)).toMatchObject({
      featured: true,
      featuredAt: expect.any(Timestamp),
      featuredUntil: until,
      featuredBy: { uid: editor.uid, name: 'Editora' },
    });
    expect((await myFanClub(call, fans[0]!)).body).toMatchObject({
      club: { featuredUntil: until },
    });
    expect(
      (
        await failure(
          'decideFanClub',
          {
            subject: 'club',
            id: clubs[3],
            decision: 'feature',
            expected: 'active',
            featuredUntil: until,
          },
          editor,
        )
      ).details?.reason,
    ).toBe('feature-limit');
    // O mesmo prazo de novo: ok, sem auditar.
    await decideClub(editor, clubs[0]!, 'feature', 'active', { featuredUntil: until });
    expect(await audits('fanClub.featured')).toHaveLength(3);
    // O destaque vencido não conta no teto.
    await db.doc(`fanClubs/${clubs[2]}`).update({ featuredUntil: shiftDay(today, -1) });
    expect(
      (await decideClub(editor, clubs[3]!, 'feature', 'active', { featuredUntil: until })).status,
    ).toBe('active');
    // O fim de hoje ou de 32 dias: invalid-request.
    for (const featuredUntil of [today, shiftDay(today, 32)]) {
      expect(
        (
          await failure(
            'decideFanClub',
            {
              subject: 'club',
              id: clubs[0],
              decision: 'feature',
              expected: 'active',
              featuredUntil,
            },
            editor,
          )
        ).details,
      ).toMatchObject({ reason: 'invalid-request', field: 'featuredUntil' });
    }
    expect((await decideClub(editor, clubs[0]!, 'unfeature', 'active')).status).toBe('active');
    expect(await read(`fanClubs/${clubs[0]}`)).toMatchObject({
      featured: false,
      featuredUntil: null,
      featuredBy: null,
    });
    expect((await audits('fanClub.unfeatured'))[0]).toMatchObject({
      details: { clubId: clubs[0], artistId, fanUid: fans[0]!.uid },
    });
    // Tirar o destaque de quem não tem: ok, sem auditar.
    await decideClub(editor, clubs[0]!, 'unfeature', 'active');
    expect(await audits('fanClub.unfeatured')).toHaveLength(1);
    // O pausado não é destacado.
    await decideClub(editor, clubs[1]!, 'pause', 'active');
    expect(
      (
        await failure(
          'decideFanClub',
          {
            subject: 'club',
            id: clubs[1],
            decision: 'feature',
            expected: 'paused',
            featuredUntil: until,
          },
          editor,
        )
      ).details,
    ).toMatchObject({ reason: 'invalid-request', field: 'decision' });
  });
});

describe('o artista (decisão 9 e 34.14)', () => {
  it('as caixas no updateArtist: só a que muda vai, com o merge; o diálogo vale o imageRightsConfirmed sem elas', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await openArtist();
    const updatedAt = () =>
      db
        .doc(`artistPrivate/${artistId}`)
        .get()
        .then((snap) => snap.updateTime);
    const before = await updatedAt();
    // As duas ligadas, como já valem: nada a gravar.
    await ok(
      'updateArtist',
      { artistId, fanClubs: { enabled: true, photosAllowed: true } },
      editor,
    );
    expect(await updatedAt()).toEqual(before);
    await ok('updateArtist', { artistId, fanClubs: { photosAllowed: false } }, editor);
    expect((await read(`artistPrivate/${artistId}`))?.fanClubs).toEqual({ photosAllowed: false });
    await ok('updateArtist', { artistId, fanClubs: { enabled: false } }, editor);
    expect((await read(`artistPrivate/${artistId}`))?.fanClubs).toEqual({
      photosAllowed: false,
      enabled: false,
    });
    const changes = (await audits('artist.updated')).map((entry) => entry.details.changed);
    expect(changes).toEqual(
      expect.arrayContaining([['fanClubs.photosAllowed'], ['fanClubs.enabled']]),
    );
    expect(changes).toHaveLength(2);
    for (const fanClubs of [{ enabled: 'sim' }, { outra: true }, 'ligado', null]) {
      expect((await failure('updateArtist', { artistId, fanClubs }, editor)).details?.reason).toBe(
        'invalid-request',
      );
    }
  });

  it('as caixas com a autorização trocada no mesmo pedido valem o que a equipe mandou', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const draft = { status: 'draft', publishedAt: null };
    const boxesOf = async (artistId: string) =>
      fanClubBoxes(await read(`artistPrivate/${artistId}`));
    // Liga a autorização e desliga a caixa num pedido só: a caixa fica desligada.
    const first = await openArtist({ imageRightsConfirmed: false }, draft);
    await ok(
      'updateArtist',
      { artistId: first, imageRightsConfirmed: true, fanClubs: { enabled: false } },
      editor,
    );
    expect((await read(`artistPrivate/${first}`))?.fanClubs).toEqual({ enabled: false });
    expect(await boxesOf(first)).toEqual({ enabled: false, photosAllowed: true });
    expect(
      (await audits('artist.updated')).find((entry) => entry.details.artistId === first)?.details
        .changed,
    ).toEqual(['imageRightsConfirmed', 'fanClubs.enabled']);
    // Desliga a autorização e a caixa: a caixa fica gravada e não volta sozinha.
    const second = await openArtist({ imageRightsConfirmed: true }, draft);
    await ok(
      'updateArtist',
      { artistId: second, imageRightsConfirmed: false, fanClubs: { enabled: false } },
      editor,
    );
    expect((await read(`artistPrivate/${second}`))?.fanClubs).toEqual({ enabled: false });
    await ok('updateArtist', { artistId: second, imageRightsConfirmed: true }, editor);
    expect(await boxesOf(second)).toEqual({ enabled: false, photosAllowed: true });
    // Sem a autorização e sem mudar nada: não grava nem audita.
    const third = await openArtist({ imageRightsConfirmed: false }, draft);
    const before = (await db.doc(`artistPrivate/${third}`).get()).updateTime;
    await ok(
      'updateArtist',
      { artistId: third, imageRightsConfirmed: false, fanClubs: { enabled: false } },
      editor,
    );
    expect((await db.doc(`artistPrivate/${third}`).get()).updateTime).toEqual(before);
    expect(
      (await audits('artist.updated')).filter((entry) => entry.details.artistId === third),
    ).toEqual([]);
  });

  it('a candidatura pendente de uma central apagada não vira fã-clube da central nova com o mesmo @', async () => {
    const { call } = clockApi();
    const admin = await seedMember(env, 'Admin', 'admin');
    const artistId = await openArtist();
    const fan = await candidate(call, artistId);
    expect(
      (
        await call('DELETE', `/me/centrals/${artistId}`, {
          token: fan.token,
          key: unique('chave-sai-'),
        })
      ).status,
    ).toBe(200);
    // Sem fãs, posts, shows nem fã-clube no ar, a central sai; o @ volta numa nova.
    await ok('deleteArtist', { artistId }, admin);
    await central(env, {}, artistId);
    await db.doc(`artistPrivate/${artistId}`).set({ imageRightsConfirmed: true });
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
          admin,
        )
      ).details?.reason,
    ).toBe('artist-not-open');
    expect((await db.collection('fanClubs').where('ownerUid', '==', fan.uid).get()).empty).toBe(
      true,
    );
    // Recusar continua possível: a equipe fecha a candidatura que sobrou.
    expect((await reject(admin, fan, 1)).status).toBe('rejected');
  });

  it('deleteArtist recusa has-content com fã-clube ativo ou pausado; o encerrado não segura', async () => {
    const { call } = clockApi();
    const admin = await seedMember(env, 'Admin', 'admin');
    const artistId = await openArtist();
    const fan = await candidate(call, artistId);
    await approve(admin, fan);
    const clubId = await clubOf(fan);
    // Sem fãs na central (o gestor sai), quem segura é o fã-clube.
    expect(
      (
        await call('DELETE', `/me/centrals/${artistId}`, {
          token: fan.token,
          key: unique('chave-sai-'),
        })
      ).status,
    ).toBe(200);
    expect((await failure('deleteArtist', { artistId }, admin)).details?.reason).toBe(
      'has-content',
    );
    await decideClub(admin, clubId, 'pause', 'active');
    expect((await failure('deleteArtist', { artistId }, admin)).details?.reason).toBe(
      'has-content',
    );
    await decideClub(admin, clubId, 'close', 'paused');
    await ok('deleteArtist', { artistId }, admin);
    expect(await exists(`artists/${artistId}`)).toBe(false);
  });
});

describe('as cópias do perfil e a exclusão (34.5 e 34.7)', () => {
  it('a troca do nome e do @ regrava o fan* da candidatura e o owner* dos fã-clubes dele', async () => {
    const { call } = clockApi();
    const admin = await seedMember(env, 'Admin', 'admin');
    const artistId = await openArtist();
    const fan = await candidate(call, artistId);
    await approve(admin, fan);
    const clubId = await clubOf(fan);
    // A gravação direta também dispara o gatilho de verdade, que pode acertar
    // as cópias antes: a conta exata fica com o teste puro.
    await db.doc(`users/${fan.uid}`).update({ displayName: 'Camila R.', username: 'camilanova' });
    const result = await syncFanProfile(db, files, fan.uid, Date.now());
    expect(result).toMatchObject({ deleted: false, fanClubCopies: expect.any(Number) });
    expect(await read(`fanClubApplications/${fan.uid}`)).toMatchObject({
      fanName: 'Camila R.',
      fanUsername: 'camilanova',
    });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      ownerName: 'Camila R.',
      ownerUsername: 'camilanova',
    });
    expect((await syncFanProfile(db, files, fan.uid, Date.now())).fanClubCopies).toBe(0);
  });

  it('a exclusão do gestor: a candidatura e o privado saem, e cada fã-clube dele vira lápide', async () => {
    const { clock, call } = clockApi();
    const admin = await seedMember(env, 'Admin', 'admin');
    const artistId = await openArtist();
    const fan = await candidate(call, artistId);
    await approve(admin, fan);
    const oldClub = await clubOf(fan);
    await decideClub(admin, oldClub, 'close', 'active', { reason: 'owner_request' });
    clock.offset = 31 * DAY_MS;
    expect((await apply(call, fan, applicationBody(artistId))).status).toBe(200);
    await approve(admin, fan);
    const club = await clubOf(fan);
    const until = shiftDay(dayKey(Date.now()), 3);
    await decideClub(admin, club, 'feature', 'active', { featuredUntil: until });
    const closedAt = (await read(`fanClubs/${oldClub}`))?.closedAt as Timestamp;

    await db.doc(`users/${fan.uid}`).delete();
    await removeFanClubData(db, fan.uid);
    expect(await exists(`fanClubApplications/${fan.uid}`)).toBe(false);
    expect(await exists(`fanClubApplicationPrivate/${fan.uid}`)).toBe(false);
    for (const id of [oldClub, club]) {
      expect(await read(`fanClubs/${id}`)).toMatchObject({
        artistId,
        ownerUid: null,
        ownerName: null,
        ownerUsername: null,
        ownerPhotoURL: null,
        name: null,
        status: 'closed',
        statusReason: 'account_deleted',
        accountDeleted: true,
        featured: false,
        featuredUntil: null,
        counts: { followers: 0 },
      });
    }
    // O encerrado guarda o closedAt de antes; o ativo ganha o de agora.
    expect((await read(`fanClubs/${oldClub}`))?.closedAt).toEqual(closedAt);
    expect((await read(`fanClubs/${club}`))?.closedAt).toEqual(expect.any(Timestamp));
    // De novo: nada a fazer (a lápide já não tem dono).
    await removeFanClubData(db, fan.uid);
    expect((await db.collection('fanClubs').where('ownerUid', '==', fan.uid).get()).empty).toBe(
      true,
    );
  });
});
