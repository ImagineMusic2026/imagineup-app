import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { idempotencyDocId } from '../src/api';
import { FAN_CLUB_RULES_VERSION, refreshPostMedia } from '../src/fan-clubs';
import { fanPhotoFiles, syncFanProfile } from '../src/fan-profile';
import { DEFAULT_POINTS_CONFIG, staticConfigSource, type PointsConfig } from '../src/points';
import { deleteUserData } from '../src/store';
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
 * As publicações do fã-clube, na etapa 2 de 34.14 (docs/arquitetura-api.md,
 * seção 34, 34.13): a vaga e os bytes da foto (o JPEG falso, o grande e o de
 * dimensão errada), a pré-moderação, o teto de 3 em análise e os do dia,
 * retirar e tirar do ar com o `pendingPosts` e o `postCount` certos, o
 * `rules_outdated` e o novo aceite, a `decideFanClub` com a publicação e a
 * denúncia (o token trocado no ocultar: a URL velha deixa de abrir; a nova do
 * reexibir abre), a página, a lista do artista e o bloqueio, a denúncia com a
 * fila e a rodada, as cópias do autor e a exclusão da conta do gestor.
 */
const env = useEmulators('fa-clube-publicacoes', [
  'createUserProfile',
  'decideFanClub',
  'setFanSuspended',
]);
const { db, bucket } = env;
const files = fanPhotoFiles(() => bucket);

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;
const fileExists = async (path: string) => (await bucket.file(path).exists())[0];

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

/** O handler no processo, com o relógio de verdade e a configuração dada. */
function api(points: PointsConfig = DEFAULT_POINTS_CONFIG) {
  return localApi(env, {
    now: () => Date.now(),
    config: staticConfigSource({ points }),
  });
}

type Api = ReturnType<typeof localApi>;

/** Uma central no ar com a autorização de imagem (as caixas valem ligadas, decisão 9). */
async function openArtist(privateExtra: Record<string, unknown> = {}): Promise<string> {
  const artistId = await central(env);
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

const join = (call: Api, fan: Fan, artistId: string) =>
  call('PUT', `/me/centrals/${artistId}`, { token: fan.token, key: unique('chave-entra-') });

/** Um gestor aprovado num artista novo: o fã entra, se candidata e a editora aprova. */
async function gestor(
  call: Api,
  staff: Caller,
  options: { privateExtra?: Record<string, unknown>; name?: string } = {},
) {
  const artistId = await openArtist(options.privateExtra);
  const fan = await signUpFan(db, options.name ?? 'Camila Ribeiro');
  expect((await join(call, fan, artistId)).status).toBe(200);
  const applied = await call('POST', '/me/fan-club/application', {
    token: fan.token,
    key: unique('chave-candidata-'),
    body: {
      artistId,
      name: 'Turma do Netto',
      instagram: 'camila.teste.up',
      whatsapp: '(75) 99123-4567',
      pitch: PITCH,
      adult: true,
      rulesVersion: FAN_CLUB_RULES_VERSION,
    },
  });
  expect(applied.status).toBe(200);
  await ok(
    'decideFanClub',
    { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
    staff,
  );
  const clubId = (await read(`fanClubApplications/${fan.uid}`))!.clubId as string;
  return { fan, artistId, clubId };
}

const publish = (call: Api, fan: Fan, body: unknown) =>
  call('POST', '/me/fan-club/posts', { token: fan.token, key: unique('chave-publica-'), body });

const removePost = (call: Api, fan: Fan, postId: string) =>
  call('DELETE', `/me/fan-club/posts/${postId}`, {
    token: fan.token,
    key: unique('chave-retira-'),
  });

const openSlot = (call: Api, fan: Fan) =>
  call('POST', '/me/fan-club/upload', { token: fan.token, key: unique('chave-vaga-') });

type Slot = { photoPath: string; thumbPath: string; expiresAt: string };

/**
 * Bytes de JPEG com o SOI, um APP0 e o SOF0 com a largura e a altura, até o
 * tamanho dado: o servidor confere os bytes do começo, sem decodificar.
 */
function jpeg(width: number, height: number, size = 4_096): Buffer {
  const head = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  const bytes = Buffer.alloc(Math.max(size, head.length + 2));
  head.copy(bytes);
  bytes[bytes.length - 2] = 0xff;
  bytes[bytes.length - 1] = 0xd9;
  return bytes;
}

const put = (path: string, bytes: Buffer, contentType = 'image/jpeg') =>
  bucket.file(path).save(bytes, { contentType });

/** Uma vaga nova com a foto (1080x1350) e a miniatura (480x600) já enviadas. */
async function uploaded(call: Api, fan: Fan): Promise<Slot> {
  const opened = await openSlot(call, fan);
  expect(opened.status).toBe(200);
  const slot = opened.body as Slot;
  await put(slot.photoPath, jpeg(1080, 1350, 200_000));
  await put(slot.thumbPath, jpeg(480, 600, 40_000));
  return slot;
}

const refusal = (reason: string) => ({
  status: 409,
  body: { code: 'fan_club_refused', details: { reason } },
});

const decidePost = (who: Caller, postId: string, decision: string, expected: string, extra = {}) =>
  ok('decideFanClub', { subject: 'post', id: postId, decision, expected, ...extra }, who);

/** O status da URL de download sem login: 200 abre; a regra fecha o resto. */
const opens = async (url: string) => (await fetch(url)).status === 200;

describe('publicar (34.5)', () => {
  it('só texto: nasce em análise, soma no pendingPosts e aparece em Minhas publicações, não na página', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId, artistId } = await gestor(call, editor);
    const published = await publish(call, fan, {
      text: '  Show de ontem foi lindo!  ',
      photo: false,
    });
    expect(published).toMatchObject({
      status: 200,
      body: {
        clubId,
        artistId,
        kind: 'text',
        text: 'Show de ontem foi lindo!',
        photo: null,
        thumb: null,
        status: 'pending',
        rejectReason: null,
        publishedAt: null,
        reviewedAt: null,
      },
    });
    const postId = published.body.id as string;
    const profile = (await read(`users/${fan.uid}`))!;
    expect(await read(`fanClubPosts/${postId}`)).toEqual({
      clubId,
      artistId,
      authorUid: fan.uid,
      authorName: 'Camila Ribeiro',
      authorUsername: profile.username,
      authorPhotoURL: null,
      kind: 'text',
      text: 'Show de ontem foi lindo!',
      media: null,
      status: 'pending',
      rejectReason: null,
      submittedAt: expect.any(Timestamp),
      publishedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      schemaVersion: 1,
    });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ pendingPosts: 1, postCount: 0 });
    expect(await call('GET', '/me/fan-club/posts', { token: fan.token })).toMatchObject({
      status: 200,
      body: { items: [{ id: postId, status: 'pending' }], nextCursor: null },
    });
    // A pré-moderação: em análise não vai à página.
    expect(await call('GET', `/fan-clubs/${clubId}/posts`, { token: fan.token })).toEqual({
      status: 200,
      body: { items: [], nextCursor: null },
    });
    expect((await call('GET', '/me/fan-club', { token: fan.token })).body).toMatchObject({
      club: { pendingPosts: 1, postCount: 0, rulesOutdated: false },
    });
  });

  it('com foto: a vaga, os bytes de cada arquivo, as URLs, a vaga apagada e os arquivos da vaga de antes', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    const text = { text: 'Com foto', photo: true };
    // Sem vaga.
    expect(await publish(call, fan, text)).toMatchObject(refusal('upload_missing'));

    const first = (await openSlot(call, fan)).body as Slot;
    expect(first.photoPath).toMatch(/^fanClubMedia\/[A-Za-z0-9]+\/club-photo-[a-z0-9-]{36}\.jpg$/);
    expect(first.thumbPath).toBe(first.photoPath.replace('club-photo-', 'club-thumb-'));
    expect(await read(`users/${fan.uid}/uploads/fanClubPost`)).toEqual({
      fileNames: [first.photoPath.split('/').at(-1), first.thumbPath.split('/').at(-1)],
      expiresAt: expect.any(Timestamp),
      createdAt: expect.any(Timestamp),
      schemaVersion: 1,
    });
    // Os arquivos que não chegaram.
    expect(await publish(call, fan, text)).toMatchObject(refusal('upload_missing'));
    await put(first.photoPath, jpeg(1080, 1350));
    expect(await publish(call, fan, text)).toMatchObject(refusal('upload_missing'));

    // O JPEG falso (os bytes de um PNG com image/jpeg).
    await put(first.thumbPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(await publish(call, fan, text)).toMatchObject({
      status: 400,
      body: {
        code: 'fan_club_invalid',
        details: { field: 'thumb', reason: 'format', problem: 'content' },
      },
    });

    // A vaga nova apaga os arquivos da de antes, que não viraram publicação.
    const second = (await openSlot(call, fan)).body as Slot;
    expect(await fileExists(first.photoPath)).toBe(false);
    expect(await fileExists(first.thumbPath)).toBe(false);
    // A grande (2 MiB e 1 byte) e a de dimensão errada.
    await put(second.photoPath, jpeg(1080, 1350, 2 * 1024 * 1024 + 1));
    await put(second.thumbPath, jpeg(700, 875));
    expect(await publish(call, fan, text)).toMatchObject({
      status: 400,
      body: { details: { field: 'photo', problem: 'size' } },
    });

    const third = (await openSlot(call, fan)).body as Slot;
    await put(third.photoPath, jpeg(1080, 1350, 200_000));
    await put(third.thumbPath, jpeg(700, 875));
    expect(await publish(call, fan, text)).toMatchObject({
      status: 400,
      body: { details: { field: 'thumb', problem: 'dimensions' } },
    });

    // A miniatura com outra forma (quadrada): não é a mesma imagem da foto.
    const fourth = (await openSlot(call, fan)).body as Slot;
    await put(fourth.photoPath, jpeg(1080, 1350, 200_000));
    await put(fourth.thumbPath, jpeg(480, 480));
    expect(await publish(call, fan, text)).toMatchObject({
      status: 400,
      body: { details: { field: 'thumb', problem: 'dimensions' } },
    });

    const slot = await uploaded(call, fan);
    const published = await publish(call, fan, text);
    expect(published).toMatchObject({
      status: 200,
      body: {
        kind: 'photo',
        status: 'pending',
        photo: { width: 1080, height: 1350 },
        thumb: { width: 480, height: 600 },
      },
    });
    const body = published.body as { photo: { url: string }; thumb: { url: string } };
    expect(await opens(body.photo.url)).toBe(true);
    expect(await opens(body.thumb.url)).toBe(true);
    expect(await read(`fanClubPosts/${published.body.id as string}`)).toMatchObject({
      kind: 'photo',
      media: {
        photo: { path: slot.photoPath, width: 1080, height: 1350 },
        thumb: { path: slot.thumbPath, width: 480, height: 600 },
      },
    });
    // A vaga sai com a publicação: a mesma não serve duas vezes.
    expect(await exists(`users/${fan.uid}/uploads/fanClubPost`)).toBe(false);
    expect(await publish(call, fan, text)).toMatchObject(refusal('upload_missing'));
  });

  it('o artista só com texto recusa a foto e a vaga; o texto passa', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor, {
      privateExtra: { fanClubs: { photosAllowed: false } },
    });
    expect(await openSlot(call, fan)).toMatchObject(refusal('photos_not_allowed'));
    expect(await publish(call, fan, { text: 'Foto?', photo: true })).toMatchObject(
      refusal('photos_not_allowed'),
    );
    expect((await publish(call, fan, { text: 'Só texto', photo: false })).status).toBe(200);
  });

  it('as recusas de quem não publica: sem fã-clube, pausado, fora da central e o artista fechado', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const stranger = await signUpFan(db, 'Bia Santos');
    expect(await publish(call, stranger, { text: 'Oi', photo: false })).toMatchObject(
      refusal('club_not_active'),
    );
    const { fan, clubId, artistId } = await gestor(call, editor);
    await ok(
      'decideFanClub',
      { subject: 'club', id: clubId, decision: 'pause', expected: 'active' },
      editor,
    );
    expect(await publish(call, fan, { text: 'Oi', photo: false })).toMatchObject(
      refusal('club_not_active'),
    );
    await ok(
      'decideFanClub',
      { subject: 'club', id: clubId, decision: 'resume', expected: 'paused' },
      editor,
    );
    await db.doc(`artistPrivate/${artistId}`).update({ 'fanClubs.enabled': false });
    expect(await publish(call, fan, { text: 'Oi', photo: false })).toMatchObject(
      refusal('artist_closed'),
    );
    await db.doc(`artistPrivate/${artistId}`).update({ 'fanClubs.enabled': true });
    expect(
      (
        await call('DELETE', `/me/centrals/${artistId}`, {
          token: fan.token,
          key: unique('chave-sai-'),
        })
      ).status,
    ).toBe(200);
    expect(await publish(call, fan, { text: 'Oi', photo: false })).toMatchObject(
      refusal('not_member'),
    );
  });

  it('o regulamento numa versão velha: rules_outdated, e o novo aceite libera', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    await db.doc(`fanClubApplications/${fan.uid}`).update({ rulesVersion: 'termos-2026-09' });
    expect((await call('GET', '/me/fan-club', { token: fan.token })).body).toMatchObject({
      club: { rulesOutdated: true },
    });
    expect(await publish(call, fan, { text: 'Oi', photo: false })).toMatchObject(
      refusal('rules_outdated'),
    );
    const accepted = await call('PUT', '/me/fan-club/rules', {
      token: fan.token,
      key: unique('chave-aceite-'),
      body: { rulesVersion: FAN_CLUB_RULES_VERSION },
    });
    expect(accepted).toMatchObject({ status: 200, body: { club: { rulesOutdated: false } } });
    const application = (await read(`fanClubApplications/${fan.uid}`))!;
    expect(application.rulesVersion).toBe(FAN_CLUB_RULES_VERSION);
    // O aceite já feito responde o mesmo, sem gravar.
    const again = await call('PUT', '/me/fan-club/rules', {
      token: fan.token,
      key: unique('chave-aceite-'),
      body: { rulesVersion: FAN_CLUB_RULES_VERSION },
    });
    expect(again).toMatchObject({ status: 200, body: { club: { rulesOutdated: false } } });
    expect((await read(`fanClubApplications/${fan.uid}`))!.rulesAcceptedAt).toEqual(
      application.rulesAcceptedAt,
    );
    expect((await publish(call, fan, { text: 'Oi', photo: false })).status).toBe(200);
    // Sem fã-clube: club_not_active.
    const stranger = await signUpFan(db, 'Bia Santos');
    expect(
      await call('PUT', '/me/fan-club/rules', {
        token: stranger.token,
        key: unique('chave-aceite-'),
        body: { rulesVersion: FAN_CLUB_RULES_VERSION },
      }),
    ).toMatchObject(refusal('club_not_active'));
  });
});

describe('os tetos (decisão 11)', () => {
  it('3 em análise; três retiradas não prendem o gestor; a 6ª publicação do dia é 429 club_post', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId } = await gestor(call, editor);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const sent = await publish(call, fan, { text: `Publicação ${index}`, photo: false });
      expect(sent.status).toBe(200);
      ids.push(sent.body.id as string);
    }
    expect(await publish(call, fan, { text: 'A quarta', photo: false })).toMatchObject(
      refusal('too_many_pending'),
    );
    for (const id of ids) expect((await removePost(call, fan, id)).status).toBe(200);
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ pendingPosts: 0 });
    for (let index = 0; index < 2; index += 1) {
      expect((await publish(call, fan, { text: `Mais ${index}`, photo: false })).status).toBe(200);
    }
    expect(await publish(call, fan, { text: 'A sexta', photo: false })).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 5, action: 'club_post' } },
    });
  });

  it('a 11ª vaga do dia é 429 club_upload', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    for (let index = 0; index < 10; index += 1) {
      expect((await openSlot(call, fan)).status).toBe(200);
    }
    expect(await openSlot(call, fan)).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 10, action: 'club_upload' } },
    });
  });
});

describe('retirar e tirar do ar (decisão 20)', () => {
  it('a em análise vira retirada e os arquivos saem; a no ar vira tirada do ar, o token muda e os arquivos ficam', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId } = await gestor(call, editor);

    const pendingSlot = await uploaded(call, fan);
    const pending = await publish(call, fan, { text: 'Retiro esta', photo: true });
    const withdrawn = await removePost(call, fan, pending.body.id as string);
    expect(withdrawn).toMatchObject({
      status: 200,
      body: { status: 'withdrawn', photo: null, thumb: null },
    });
    expect(await fileExists(pendingSlot.photoPath)).toBe(false);
    expect(await fileExists(pendingSlot.thumbPath)).toBe(false);
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ pendingPosts: 0 });

    await uploaded(call, fan);
    const live = await publish(call, fan, { text: 'Esta vai ao ar', photo: true });
    const liveId = live.body.id as string;
    const oldUrl = (live.body as { photo: { url: string } }).photo.url;
    await decidePost(editor, liveId, 'approve', 'pending');
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ pendingPosts: 0, postCount: 1 });
    expect(await opens(oldUrl)).toBe(true);
    const removeKey = unique('chave-tira-do-ar-');
    const removeOnce = () =>
      call('DELETE', `/me/fan-club/posts/${liveId}`, { token: fan.token, key: removeKey });
    const removed = await removeOnce();
    expect(removed).toMatchObject({ status: 200, body: { status: 'removed', photo: null } });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ postCount: 0 });
    // Os arquivos ficam com a equipe, e a URL guardada nos aparelhos deixa de abrir.
    const media = (await read(`fanClubPosts/${liveId}`))!.media as {
      photo: { path: string };
      thumb: { path: string };
    };
    expect(await fileExists(media.photo.path)).toBe(true);
    expect(await opens(oldUrl)).toBe(false);
    // O trabalho fica guardado na chave, e a repetição pela mesma chave o refaz
    // (a troca que falhou ou se perdeu tem outra chance): o token muda de novo.
    const saved = await read(`idempotency/${idempotencyDocId(fan.uid, removeKey)}`);
    expect(saved?.storageWork).toEqual({
      remove: [],
      rotate: [media.photo.path, media.thumb.path],
    });
    const between = await files.downloadUrl(media.photo.path);
    expect(await opens(between)).toBe(true);
    expect(await removeOnce()).toMatchObject({ status: 200, body: { status: 'removed' } });
    expect(await opens(between)).toBe(false);
    // Outro status ou outro autor: 404.
    expect(await removePost(call, fan, liveId)).toMatchObject({
      status: 404,
      body: { code: 'fan_club_post_not_found' },
    });
    const other = await signUpFan(db, 'Bia Santos');
    const textPost = await publish(call, fan, { text: 'Só minha', photo: false });
    expect(await removePost(call, other, textPost.body.id as string)).toMatchObject({
      status: 404,
      body: { code: 'fan_club_post_not_found' },
    });
  });

  it('o gestor suspenso ainda retira (desfazer), mas não publica', async () => {
    const call = api();
    const admin = await seedMember(env, 'Admin', 'admin');
    const { fan } = await gestor(call, admin);
    const sent = await publish(call, fan, { text: 'Antes da suspensão', photo: false });
    await ok('setFanSuspended', { uid: fan.uid, suspended: true, reason: 'spam' }, admin);
    expect(await publish(call, fan, { text: 'Depois', photo: false })).toMatchObject({
      status: 403,
      body: { code: 'account_suspended' },
    });
    expect((await removePost(call, fan, sent.body.id as string)).status).toBe(200);
  });
});

describe('a decideFanClub com a publicação (34.3 e 34.5)', () => {
  it('aprovar, recusar, ocultar e reexibir, com os contadores, os arquivos, o token e a auditoria', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId, artistId } = await gestor(call, editor);

    // Recusar apaga os arquivos.
    const rejectedSlot = await uploaded(call, fan);
    const toReject = await publish(call, fan, { text: 'Foto de terceiro', photo: true });
    const rejectId = toReject.body.id as string;
    expect(
      await decidePost(editor, rejectId, 'reject', 'pending', { reason: 'image_rights' }),
    ).toEqual({ ok: true, subject: 'post', id: rejectId, status: 'rejected' });
    expect(await read(`fanClubPosts/${rejectId}`)).toMatchObject({
      status: 'rejected',
      rejectReason: 'image_rights',
      reviewedBy: { uid: editor.uid, name: 'Editora' },
    });
    expect(await fileExists(rejectedSlot.photoPath)).toBe(false);
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ pendingPosts: 0, postCount: 0 });
    expect((await call('GET', '/me/fan-club/posts', { token: fan.token })).body).toMatchObject({
      items: [{ id: rejectId, status: 'rejected', rejectReason: 'image_rights', photo: null }],
    });

    // Aprovar.
    await uploaded(call, fan);
    const sent = await publish(call, fan, { text: 'Show lindo', photo: true });
    const postId = sent.body.id as string;
    const oldUrl = (sent.body as { photo: { url: string } }).photo.url;
    expect(await decidePost(editor, postId, 'approve', 'pending')).toEqual({
      ok: true,
      subject: 'post',
      id: postId,
      status: 'published',
    });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      pendingPosts: 0,
      postCount: 1,
      lastPostAt: expect.any(Timestamp),
    });
    expect(await call('GET', `/fan-clubs/${clubId}/posts`, { token: fan.token })).toMatchObject({
      status: 200,
      body: {
        items: [
          {
            id: postId,
            clubId,
            clubName: 'Turma do Netto',
            artistId,
            author: { uid: fan.uid, name: 'Camila Ribeiro' },
            kind: 'photo',
            text: 'Show lindo',
            photo: { url: oldUrl, width: 1080, height: 1350 },
          },
        ],
        nextCursor: null,
      },
    });
    // A mesma decisão de novo: ok, sem gravar nem auditar.
    await decidePost(editor, postId, 'approve', 'pending');
    expect(await audits('fanClub.post.approved')).toHaveLength(1);
    const [approved] = await audits('fanClub.post.approved');
    expect(approved).toMatchObject({
      section: 'fanClubs',
      details: { fanClubPostId: postId, clubId, artistId, authorUid: fan.uid, reason: null },
    });
    expect(approved!.targets).toEqual([
      `artist:${artistId}`,
      `fan:${fan.uid}`,
      `fanClub:${clubId}`,
      `fanClubPost:${postId}`,
    ]);
    expect(JSON.stringify(approved)).not.toContain('Show lindo');

    // Ocultar: o token muda (a URL velha deixa de abrir) e sai da página.
    const stale = await failure(
      'decideFanClub',
      { subject: 'post', id: postId, decision: 'hide', expected: 'pending' },
      editor,
    );
    expect(stale.details).toEqual({ reason: 'stale-decision' });
    await decidePost(editor, postId, 'hide', 'published');
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ postCount: 0 });
    expect(await opens(oldUrl)).toBe(false);
    // A mesma decisão de novo (a nova tentativa do painel) troca o token de novo,
    // sem gravar nem auditar.
    const hiddenPath = (
      (await read(`fanClubPosts/${postId}`))!.media as { photo: { path: string } }
    ).photo.path;
    const between = await files.downloadUrl(hiddenPath);
    await decidePost(editor, postId, 'hide', 'published');
    expect(await opens(between)).toBe(false);
    expect((await call('GET', `/fan-clubs/${clubId}/posts`, { token: fan.token })).body).toEqual({
      items: [],
      nextCursor: null,
    });

    // Reexibir grava as URLs novas, que abrem.
    await decidePost(editor, postId, 'restore', 'hidden');
    const restored = (await read(`fanClubPosts/${postId}`))!.media as {
      photo: { url: string };
      thumb: { url: string };
    };
    expect(restored.photo.url).not.toBe(oldUrl);
    expect(await opens(restored.photo.url)).toBe(true);
    expect(await opens(restored.thumb.url)).toBe(true);
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ postCount: 1 });
    for (const action of [
      'fanClub.post.rejected',
      'fanClub.post.hidden',
      'fanClub.post.restored',
    ]) {
      expect(await audits(action), action).toHaveLength(1);
    }
    // A decisão que não cabe no status: invalid-request com o campo decision.
    const wrong = await failure(
      'decideFanClub',
      { subject: 'post', id: postId, decision: 'reject', expected: 'published', reason: 'quality' },
      editor,
    );
    expect(wrong.details).toEqual({ reason: 'invalid-request', field: 'decision' });
  });

  it('o autor da equipe é self; o Leitor e quem não tem a seção não decidem; a que não existe', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const viewer = await seedMember(env, 'Leitora', 'viewer', ['fanClubs']);
    const other = await seedMember(env, 'Outra', 'editor', ['fans']);
    const { fan } = await gestor(call, editor);
    const sent = await publish(call, fan, { text: 'Oi', photo: false });
    const postId = sent.body.id as string;
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'post', id: postId, decision: 'approve', expected: 'pending' },
          viewer,
        )
      ).details,
    ).toEqual({ reason: 'no-section' });
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'post', id: postId, decision: 'approve', expected: 'pending' },
          other,
        )
      ).details,
    ).toEqual({ reason: 'no-section' });
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'post', id: 'naoexiste', decision: 'approve', expected: 'pending' },
          editor,
        )
      ).details,
    ).toEqual({ reason: 'fan-club-post-not-found' });
    // O gestor que também é da equipe não decide a própria publicação.
    await db.doc(`staff/${fan.uid}`).set({
      uid: fan.uid,
      email: fan.email,
      displayName: 'Camila',
      role: 'editor',
      sections: ['fanClubs'],
      status: 'active',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedBy: null,
    });
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'post', id: postId, decision: 'approve', expected: 'pending' },
          fan,
        )
      ).details,
    ).toEqual({ reason: 'self' });
  });
});

describe('a corrida do reexibir com a troca do token (34.5)', () => {
  it('a troca que termina depois do reexibir deixa a URL morta, e a releitura acerta a media', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    await uploaded(call, fan);
    const sent = await publish(call, fan, { text: 'Corrida', photo: true });
    const postId = sent.body.id as string;
    await decidePost(editor, postId, 'approve', 'pending');
    const stale = (await read(`fanClubPosts/${postId}`))!.media as {
      photo: { url: string; path: string };
      thumb: { url: string; path: string };
    };
    // A troca de um ocultar de antes que só terminou agora.
    await files.rotateDownloadToken(stale.photo.path);
    await files.rotateDownloadToken(stale.thumb.path);
    expect(await opens(stale.photo.url)).toBe(false);
    expect(await refreshPostMedia(db, files, postId)).toBe(true);
    const fresh = (await read(`fanClubPosts/${postId}`))!.media as {
      photo: { url: string };
      thumb: { url: string };
    };
    expect(await opens(fresh.photo.url)).toBe(true);
    expect(await opens(fresh.thumb.url)).toBe(true);
    // Com as URLs em dia, ou a publicação fora do ar, nada muda.
    expect(await refreshPostMedia(db, files, postId)).toBe(false);
    await decidePost(editor, postId, 'hide', 'published');
    expect(await refreshPostMedia(db, files, postId)).toBe(false);
  });
});

describe('a página, a lista do artista e o bloqueio (decisão 19)', () => {
  it('a página do fã-clube ativo, com o gestor, o artista e os vínculos de quem pede', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId, artistId } = await gestor(call, editor);
    const profile = (await read(`users/${fan.uid}`))!;
    const visitor = await signUpFan(db, 'Bia Santos');
    expect(await call('GET', `/fan-clubs/${clubId}`, { token: visitor.token })).toEqual({
      status: 200,
      body: {
        id: clubId,
        name: 'Turma do Netto',
        artist: { id: artistId, name: `Central ${artistId}`, shortName: null, thumbUrl: null },
        owner: { uid: fan.uid, name: 'Camila Ribeiro', username: profile.username, photoURL: null },
        followerCount: 0,
        postCount: 0,
        featured: false,
        isFollowing: false,
        isOwner: false,
        isMember: false,
      },
    });
    expect((await call('GET', `/fan-clubs/${clubId}`, { token: fan.token })).body).toMatchObject({
      isOwner: true,
      isMember: true,
    });
  });

  it('404 para o pausado, o de artista fora do ar, sem o fã-clube aberto e o de gestor bloqueado', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId, artistId } = await gestor(call, editor);
    const visitor = await signUpFan(db, 'Bia Santos');
    const notFound = { status: 404, body: { code: 'fan_club_not_found' } };
    const page = () => call('GET', `/fan-clubs/${clubId}`, { token: visitor.token });
    const posts = () => call('GET', `/fan-clubs/${clubId}/posts`, { token: visitor.token });

    await ok(
      'decideFanClub',
      { subject: 'club', id: clubId, decision: 'pause', expected: 'active' },
      editor,
    );
    expect(await page()).toMatchObject(notFound);
    await ok(
      'decideFanClub',
      { subject: 'club', id: clubId, decision: 'resume', expected: 'paused' },
      editor,
    );
    expect((await page()).status).toBe(200);

    await db.doc(`artists/${artistId}`).update({ status: 'draft' });
    expect(await page()).toMatchObject(notFound);
    expect(await posts()).toMatchObject(notFound);
    await db.doc(`artists/${artistId}`).update({ status: 'published' });
    await db.doc(`artistPrivate/${artistId}`).update({ 'fanClubs.enabled': false });
    expect(await page()).toMatchObject(notFound);
    expect(await call('GET', `/artists/${artistId}/fan-clubs`, { token: visitor.token })).toEqual({
      status: 200,
      body: { items: [], nextCursor: null },
    });
    await db.doc(`artistPrivate/${artistId}`).update({ 'fanClubs.enabled': true });

    // Quem bloqueia o gestor deixa de ver o fã-clube e as publicações dele.
    expect(
      (
        await call('PUT', `/me/blocks/${fan.uid}`, {
          token: visitor.token,
          key: unique('chave-bloqueio-'),
        })
      ).status,
    ).toBe(200);
    expect(await page()).toMatchObject(notFound);
    expect(await posts()).toMatchObject(notFound);
    expect(
      (await call('GET', `/artists/${artistId}/fan-clubs`, { token: visitor.token })).body,
    ).toEqual({ items: [], nextCursor: null });
    // O próprio gestor e outro fã continuam vendo.
    expect((await call('GET', `/fan-clubs/${clubId}`, { token: fan.token })).status).toBe(200);
    const third = await signUpFan(db, 'Duda Lima');
    expect((await call('GET', `/fan-clubs/${clubId}`, { token: third.token })).status).toBe(200);
  });

  it('a lista do artista: os destacados primeiro, depois pelos seguidores da cópia, em páginas', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const artistId = await openArtist();
    const clubs: string[] = [];
    // Nomes com o @ escolhido pelo gerador (um "Fã 0" cairia no @ automático).
    const names = ['Ana Clara', 'Bruno Alves', 'Carla Dias'];
    for (const [index, followers] of [5, 30, 12].entries()) {
      const fan = await signUpFan(db, names[index]);
      expect((await join(call, fan, artistId)).status).toBe(200);
      expect(
        (
          await call('POST', '/me/fan-club/application', {
            token: fan.token,
            key: unique('chave-candidata-'),
            body: {
              artistId,
              name: `Fã-clube ${index}`,
              instagram: `fa.teste.${index}`,
              whatsapp: '(75) 99123-4567',
              pitch: PITCH,
              adult: true,
              rulesVersion: FAN_CLUB_RULES_VERSION,
            },
          })
        ).status,
      ).toBe(200);
      await ok(
        'decideFanClub',
        { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
        editor,
      );
      const clubId = (await read(`fanClubApplications/${fan.uid}`))!.clubId as string;
      await db.doc(`fanClubs/${clubId}`).update({ 'counts.followers': followers });
      clubs.push(clubId);
    }
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await ok(
      'decideFanClub',
      {
        subject: 'club',
        id: clubs[0],
        decision: 'feature',
        expected: 'active',
        featuredUntil: tomorrow,
      },
      editor,
    );
    const visitor = await signUpFan(db, 'Bia Santos');
    const first = await call('GET', `/artists/${artistId}/fan-clubs`, {
      token: visitor.token,
      query: { limit: '2' },
    });
    expect(first).toMatchObject({
      status: 200,
      body: {
        items: [
          { id: clubs[0], featured: true, followers: 5, isFollowing: false },
          { id: clubs[1], featured: false, followers: 30 },
        ],
      },
    });
    const cursor = first.body.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    expect(
      await call('GET', `/artists/${artistId}/fan-clubs`, {
        token: visitor.token,
        query: { limit: '2', cursor },
      }),
    ).toMatchObject({ status: 200, body: { items: [{ id: clubs[2], followers: 12 }] } });

    // Com mais destacados que o limit, a faixa vai em páginas e nunca passa dele.
    await ok(
      'decideFanClub',
      {
        subject: 'club',
        id: clubs[2],
        decision: 'feature',
        expected: 'active',
        featuredUntil: tomorrow,
      },
      editor,
    );
    const pages: string[][] = [];
    let next: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const sent = await call('GET', `/artists/${artistId}/fan-clubs`, {
        token: visitor.token,
        query: next ? { limit: '1', cursor: next } : { limit: '1' },
      });
      pages.push((sent.body.items as { id: string }[]).map((item) => item.id));
      next = sent.body.nextCursor as string | null;
      expect(next).toEqual(expect.any(String));
    }
    // Os destacados pelos seguidores (12 e 5), depois os outros do topo (30).
    expect(pages).toEqual([[clubs[2]], [clubs[0]], [clubs[1]]]);
  });
});

describe('a denúncia da publicação (decisão 18)', () => {
  it('a rodada, o already_reported, a própria, a fora do ar, e o Manter e o Ocultar com a fila', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId, artistId } = await gestor(call, editor);
    await uploaded(call, fan);
    const sent = await publish(call, fan, { text: 'Foto do show', photo: true });
    const postId = sent.body.id as string;
    const oldUrl = (sent.body as { photo: { url: string } }).photo.url;
    const bia = await signUpFan(db, 'Bia Santos');
    const duda = await signUpFan(db, 'Duda Lima');
    const report = (who: Fan, body: unknown = { reason: 'image_misuse' }) =>
      call('POST', `/fan-club-posts/${postId}/report`, {
        token: who.token,
        key: unique('chave-denuncia-'),
        body,
      });

    // Em análise: não está no ar.
    expect(await report(bia)).toMatchObject({
      status: 404,
      body: { code: 'fan_club_post_not_found' },
    });
    await decidePost(editor, postId, 'approve', 'pending');
    expect(await report(fan)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { reason: 'own_post' } },
    });
    expect(await report(bia)).toEqual({
      status: 200,
      body: { postId, status: 'reported' },
    });
    expect(await read(`fanClubReportQueue/${postId}`)).toMatchObject({
      postId,
      clubId,
      artistId,
      authorUid: fan.uid,
      reportCount: 1,
      reasons: { spam: 0, offensive: 0, harassment: 0, image_misuse: 1, other: 0, none: 0 },
      status: 'open',
      resolution: null,
      round: 1,
    });
    expect(await read(`fanClubReports/${bia.uid}_${postId}`)).toMatchObject({
      postId,
      clubId,
      reporterUid: bia.uid,
      reason: 'image_misuse',
      round: 1,
    });
    expect(await report(bia)).toMatchObject({ status: 200, body: { status: 'already_reported' } });

    // Manter resolve; outra pessoa reabre na rodada 2.
    const keep = { subject: 'report', id: postId, decision: 'keep', expected: 1 };
    expect(await ok('decideFanClub', keep, editor)).toEqual({
      ok: true,
      subject: 'report',
      id: postId,
      status: 'resolved',
    });
    expect(await read(`fanClubReportQueue/${postId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
    });
    // A mesma pessoa, na rodada já resolvida: nada muda.
    expect(await report(bia)).toMatchObject({ status: 200, body: { status: 'already_reported' } });
    expect(await report(duda, { reason: null })).toMatchObject({
      status: 200,
      body: { status: 'reported' },
    });
    expect(await read(`fanClubReportQueue/${postId}`)).toMatchObject({
      status: 'open',
      round: 2,
      reportCount: 1,
      reasons: { none: 1, image_misuse: 0 },
    });
    expect((await failure('decideFanClub', keep, editor)).details).toEqual({
      reason: 'stale-decision',
    });

    // Ocultar resolve e tira a publicação do ar, com o token trocado.
    await ok(
      'decideFanClub',
      { subject: 'report', id: postId, decision: 'action', expected: 2 },
      editor,
    );
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ status: 'hidden' });
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({ postCount: 0 });
    expect(await opens(oldUrl)).toBe(false);
    const resolved = await audits('fanClub.report.resolved');
    expect(resolved).toHaveLength(2);
    expect(
      resolved.find((entry) => (entry.details as { resolution: string }).resolution === 'actioned'),
    ).toMatchObject({
      details: { fanClubPostId: postId, clubId, reportCount: 1, round: 2, postHidden: true },
      targets: [`fanClub:${clubId}`, `fanClubPost:${postId}`],
    });
    // Oculta, não se denuncia.
    expect(await report(bia)).toMatchObject({ status: 404 });
  });

  it('o teto é o report de sempre, somado com a denúncia de perfil', async () => {
    const caps = { ...DEFAULT_POINTS_CONFIG.actionCaps, comment_report: 2 };
    const call = api({ ...DEFAULT_POINTS_CONFIG, actionCaps: caps });
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    const ids: string[] = [];
    for (const text of ['Um', 'Dois']) {
      const sent = await publish(call, fan, { text, photo: false });
      await decidePost(editor, sent.body.id as string, 'approve', 'pending');
      ids.push(sent.body.id as string);
    }
    const bia = await signUpFan(db, 'Bia Santos');
    expect(
      (
        await call('POST', `/fans/${fan.uid}/report`, {
          token: bia.token,
          key: unique('chave-perfil-'),
          body: {},
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', `/fan-club-posts/${ids[0]}/report`, {
          token: bia.token,
          key: unique('chave-denuncia-'),
          body: {},
        })
      ).status,
    ).toBe(200);
    expect(
      await call('POST', `/fan-club-posts/${ids[1]}/report`, {
        token: bia.token,
        key: unique('chave-denuncia-'),
        body: {},
      }),
    ).toMatchObject({ status: 429, body: { details: { action: 'report', limit: 2 } } });
  });

  it('a retirada pelo gestor resolve o item aberto com withdrawn, e a equipe não decide mais', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    const sent = await publish(call, fan, { text: 'Vou tirar', photo: false });
    const postId = sent.body.id as string;
    await decidePost(editor, postId, 'approve', 'pending');
    const bia = await signUpFan(db, 'Bia Santos');
    await call('POST', `/fan-club-posts/${postId}/report`, {
      token: bia.token,
      key: unique('chave-denuncia-'),
      body: { reason: 'spam' },
    });
    expect((await removePost(call, fan, postId)).status).toBe(200);
    expect(await read(`fanClubReportQueue/${postId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'withdrawn',
      resolvedBy: null,
    });
    expect(
      (
        await failure(
          'decideFanClub',
          { subject: 'report', id: postId, decision: 'keep', expected: 1 },
          editor,
        )
      ).details,
    ).toEqual({ reason: 'fan-club-report-not-found' });
  });
});

describe('as cópias do autor e a exclusão da conta (34.5 e 34.7)', () => {
  it('a troca do nome regrava o author das publicações do gestor', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan } = await gestor(call, editor);
    const sent = await publish(call, fan, { text: 'Oi', photo: false });
    await db.doc(`users/${fan.uid}`).update({ displayName: 'Camila R.' });
    // A gravação direta também dispara o gatilho de verdade, que pode acertar
    // as cópias antes: a conta exata fica com o teste puro.
    const result = await syncFanProfile(db, files, fan.uid, Date.now());
    expect(result).toMatchObject({ deleted: false, fanClubCopies: expect.any(Number) });
    expect(await read(`fanClubPosts/${sent.body.id as string}`)).toMatchObject({
      authorName: 'Camila R.',
    });
    expect((await syncFanProfile(db, files, fan.uid, Date.now())).fanClubCopies).toBe(0);
  });

  it('a exclusão do gestor apaga as publicações, as denúncias dele e a pasta, com os itens da fila', async () => {
    const call = api();
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs']);
    const { fan, clubId } = await gestor(call, editor);
    const other = await gestor(call, editor, { name: 'Duda Lima' });
    // Uma publicação com foto, no ar e denunciada, e uma em análise.
    const slot = await uploaded(call, fan);
    const live = await publish(call, fan, { text: 'No ar', photo: true });
    const liveId = live.body.id as string;
    await decidePost(editor, liveId, 'approve', 'pending');
    await publish(call, fan, { text: 'Em análise', photo: false });
    const bia = await signUpFan(db, 'Bia Santos');
    await call('POST', `/fan-club-posts/${liveId}/report`, {
      token: bia.token,
      key: unique('chave-denuncia-'),
      body: { reason: 'harassment' },
    });
    // A gestora denuncia a publicação de outro fã-clube.
    const otherPost = await publish(call, other.fan, { text: 'Do outro', photo: false });
    const otherId = otherPost.body.id as string;
    await decidePost(editor, otherId, 'approve', 'pending');
    await call('POST', `/fan-club-posts/${otherId}/report`, {
      token: fan.token,
      key: unique('chave-denuncia-'),
      body: { reason: 'image_misuse' },
    });

    await deleteUserData(db, fan.uid, { files });

    const posts = await db.collection('fanClubPosts').where('authorUid', '==', fan.uid).get();
    expect(posts.empty).toBe(true);
    expect(await read(`fanClubReportQueue/${liveId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'author_deleted',
    });
    expect(await exists(`fanClubReports/${fan.uid}_${otherId}`)).toBe(false);
    expect(await read(`fanClubReportQueue/${otherId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'withdrawn',
      reportCount: 0,
      reasons: { image_misuse: 0 },
    });
    expect(await fileExists(slot.photoPath)).toBe(false);
    expect((await bucket.getFiles({ prefix: `fanClubMedia/${fan.uid}/` }))[0]).toEqual([]);
    expect(await read(`fanClubs/${clubId}`)).toMatchObject({
      status: 'closed',
      statusReason: 'account_deleted',
      ownerUid: null,
    });
    // A denúncia de quem denunciou fica (é de quem denunciou).
    expect(await exists(`fanClubReports/${bia.uid}_${liveId}`)).toBe(true);
  });
});
