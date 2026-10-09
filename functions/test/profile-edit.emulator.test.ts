import { Timestamp } from 'firebase-admin/firestore';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import {
  fanPhotoFiles,
  releaseUsername,
  runFanProfileSync,
  SEED_FAN_DETAILS,
  seedFanDetails,
  seedFanDetailsChanges,
  seedFanPhoto,
  syncFanProfile,
  UsernameReleaseError,
  type FanPhotoFiles,
} from '../src/fan-profile';
import { DEFAULT_POINTS_CONFIG, dayKey, nextDayStart, staticConfigSource } from '../src/points';
import { deleteUserData } from '../src/store';
import {
  callable,
  central,
  http,
  localApi,
  post,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  waitFor,
  type Fan,
} from './support';

/**
 * O perfil editável do bloco 9 nos emuladores (docs/arquitetura-api.md,
 * 24.14): a `api` de verdade pelo HTTP do emulador, com o ID token do Auth, e
 * o handler no processo, com o relógio fixo (os 30 dias do @ e a idade da
 * foto). Desde o perfil novo (seção 28, 28.12), também a edição inteira
 * (`PUT /me/profile`, com os tetos do dia) e o perfil público
 * (`GET /fans/:fanId`). O gatilho queueFanProfileSync roda no emulador de Functions e a
 * tarefa syncFanProfile no do Cloud Tasks (lá, uma tarefa por gravação, na
 * hora): os testes esperam o efeito. Os arquivos sobem pelo Admin SDK, que
 * passa por cima das regras (as regras ficam nos testes de regras). O Storage
 * não é limpo entre os testes: cada fã é novo, e a pasta dele também.
 */
const env = useEmulators('profile-edit', [
  'api',
  'createUserProfile',
  'deleteUserProfile',
  'queueFanProfileSync',
  'syncFanProfile',
  'createArtist',
]);
const { db, bucket } = env;
const files = fanPhotoFiles(() => bucket);

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

/** JPEG de verdade de 1 × 1 (o servidor só lê o começo: os bytes FF D8 FF e o SOF). */
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAV7/2Q==',
  'base64',
);

/** Só o cabeçalho de um JPEG de 2000 × 2000 (o SOF diz o tamanho; a imagem inteira não precisa). */
const JPEG_2000_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0xd0, 0x07, 0xd0, 0x03, 0x01, 0x22,
  0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Ids únicos de arquivo, no formato que o app gera (photo-<id>.jpg).
let fileCounter = 0;
const photoPath = (uid: string) =>
  `fans/${uid}/photo-t${Date.now().toString(36)}-${(++fileCounter).toString(36).padStart(4, '0')}.jpg`;

/** Sobe um arquivo pelo Admin SDK e devolve o caminho e o carimbo do Storage. */
async function upload(
  path: string,
  bytes: Buffer = JPEG_1X1,
  contentType = 'image/jpeg',
): Promise<{ path: string; createdAt: number }> {
  await bucket.file(path).save(bytes, { resumable: false, contentType });
  const [metadata] = await bucket.file(path).getMetadata();
  return { path, createdAt: Date.parse(String(metadata.timeCreated)) };
}

const fileExists = async (path: string) => (await bucket.file(path).exists())[0];
const folder = async (uid: string) =>
  (await bucket.getFiles({ prefix: `fans/${uid}/` }))[0].map((file) => file.name).sort();

/** O handler no processo com um relógio que o teste move. */
function clockApi(
  start: number,
  options: {
    photoCap?: number;
    uploadCap?: number;
    profileCap?: number;
    nameCap?: number;
    withHeaders?: boolean;
  } = {},
) {
  const clock = { now: start };
  const points = {
    ...DEFAULT_POINTS_CONFIG,
    actionCaps: {
      ...DEFAULT_POINTS_CONFIG.actionCaps,
      ...(options.photoCap ? { photo_set: options.photoCap } : {}),
      ...(options.uploadCap ? { photo_upload: options.uploadCap } : {}),
      ...(options.profileCap ? { profile_save: options.profileCap } : {}),
      ...(options.nameCap ? { name_change: options.nameCap } : {}),
    },
  };
  const call = localApi(env, {
    now: () => clock.now,
    config: staticConfigSource({ points }),
    withHeaders: options.withHeaders === true,
  });
  return { clock, call };
}

const putUsername = (
  call: ReturnType<typeof localApi>,
  fan: Fan,
  username: string,
  key = unique('chave-arroba-'),
) => call('PUT', '/me/username', { token: fan.token, key, body: { username } });

const putPhoto = (
  call: ReturnType<typeof localApi>,
  fan: Fan,
  path: string,
  key = unique('chave-foto-'),
) => call('PUT', '/me/photo', { token: fan.token, key, body: { path } });

const availability = (fan: Fan, username: string) =>
  http(env, `/me/username/availability?username=${encodeURIComponent(username)}`, {
    token: fan.token,
  });

/** A reserva de uma central (sem uid), como o createArtist grava. */
async function centralReservation(handle: string): Promise<void> {
  await central(env, {}, handle);
  await db.doc(`usernames/${handle}`).set({ artistId: handle, createdAt: Timestamp.now() });
}

/** Dá ao fã um @ automático direto (o que o gerador daria a quem ficou sem nome). */
async function makeAutomatic(fan: Fan, automatic: string): Promise<void> {
  const current = (await read(`users/${fan.uid}`))!.username as string;
  await db.doc(`usernames/${current}`).delete();
  await db.doc(`usernames/${automatic}`).set({ uid: fan.uid, createdAt: Timestamp.now() });
  await db.doc(`users/${fan.uid}`).update({ username: automatic });
}

describe('disponibilidade do @ (GET /me/username/availability)', () => {
  it('livre, o de agora, de outro fã, de uma central, reservado e fora do formato', async () => {
    const camila = await signUpFan(db, 'Camila Ribeiro');
    const alan = await signUpFan(db, 'Alan Ferreira');
    const camilaAt = (await read(`users/${camila.uid}`))!.username as string;
    const alanAt = (await read(`users/${alan.uid}`))!.username as string;
    const handle = unique('centralarroba');
    await centralReservation(handle);

    const free = unique('camilanova');
    expect((await availability(camila, free)).body).toEqual({
      username: free,
      status: 'available',
    });
    expect((await availability(camila, camilaAt)).body).toEqual({
      username: camilaAt,
      status: 'current',
    });
    expect((await availability(camila, alanAt)).body).toMatchObject({ status: 'taken' });
    expect((await availability(camila, handle)).body).toMatchObject({ status: 'taken' });
    for (const reserved of ['admin', 'adm1n', 'ajuda', 'fa123456']) {
      expect((await availability(camila, reserved)).body).toEqual({
        username: reserved,
        status: 'reserved',
      });
    }
    expect((await availability(camila, 'ab')).body).toEqual({ username: 'ab', status: 'invalid' });
    // O @ e as maiúsculas são normalizados.
    expect((await availability(camila, ` @${free.toUpperCase()} `)).body).toEqual({
      username: free,
      status: 'available',
    });
    const missing = await http(env, '/me/username/availability', { token: camila.token });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: 'invalid_request', details: { field: 'username' } });
  });

  it('o automático de agora é current, e o de outro fã é reserved', async () => {
    const fan = await signUpFan(db, 'Fã Automática');
    const automatic = `fa${String(Date.now()).slice(-6)}`;
    await makeAutomatic(fan, automatic);
    expect((await availability(fan, automatic)).body).toEqual({
      username: automatic,
      status: 'current',
    });
    const other = await signUpFan(db, 'Outra Fã');
    expect((await availability(other, automatic)).body).toMatchObject({ status: 'reserved' });
  });
});

describe('troca do @ (PUT /me/username)', () => {
  it('a reserva nova, a antiga apagada e o perfil, juntos; o mesmo @ responde sem mexer no prazo', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const before = (await read(`users/${fan.uid}`))!.username as string;
    const start = Date.now();
    const { clock, call } = clockApi(start);
    const chosen = unique('camilaescolhida');

    const changed = await putUsername(call, fan, ` @${chosen} `);
    expect(changed).toEqual({
      status: 200,
      body: {
        username: chosen,
        changedAt: new Date(start).toISOString(),
        changeableAt: new Date(start + 30 * DAY).toISOString(),
      },
    });
    expect(await read(`usernames/${chosen}`)).toMatchObject({ uid: fan.uid });
    expect(await exists(`usernames/${before}`)).toBe(false);
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile.username).toBe(chosen);
    expect((profile.usernameChangedAt as Timestamp).toMillis()).toBe(start);
    expect((profile.usernameChangeableAt as Timestamp).toMillis()).toBe(start + 30 * DAY);
    // O servidor nunca grava o carimbo de edição do fã.
    expect(profile.updatedAt).toBeUndefined();

    // O mesmo @, com outra chave e mais tarde: a resposta de agora, sem gravar.
    clock.now = start + DAY;
    expect(await putUsername(call, fan, chosen)).toEqual(changed);
    expect(((await read(`users/${fan.uid}`))!.usernameChangeableAt as Timestamp).toMillis()).toBe(
      start + 30 * DAY,
    );
  });

  it('a primeira troca a partir do automático é livre; a segunda antes de 30 dias é 409, e depois passa', async () => {
    const fan = await signUpFan(db, 'Fã Automática');
    await makeAutomatic(fan, `fa${String(Date.now() + 7).slice(-6)}`);
    const start = Date.now();
    const { clock, call } = clockApi(start);
    expect((await putUsername(call, fan, unique('primeira'))).status).toBe(200);

    clock.now = start + 30 * DAY - 1;
    const early = await putUsername(call, fan, unique('segunda'));
    expect(early).toEqual({
      status: 409,
      body: {
        code: 'username_change_too_soon',
        message: 'Você trocou o @ há pouco. Tente de novo mais tarde.',
        details: { changeableAt: new Date(start + 30 * DAY).toISOString() },
      },
    });
    clock.now = start + 30 * DAY;
    expect((await putUsername(call, fan, unique('segunda'))).status).toBe(200);
  });

  it('o @ antigo fica livre na hora para outro fã', async () => {
    const camila = await signUpFan(db, 'Camila Ribeiro');
    const alan = await signUpFan(db, 'Alan Ferreira');
    const old = (await read(`users/${camila.uid}`))!.username as string;
    const { call } = clockApi(Date.now());
    expect((await putUsername(call, camila, unique('camilanova'))).status).toBe(200);
    expect((await availability(alan, old)).body).toMatchObject({ status: 'available' });
    expect((await putUsername(call, alan, old)).status).toBe(200);
    expect(await read(`usernames/${old}`)).toMatchObject({ uid: alan.uid });
  });

  it('recusas: reservado, automático, de outro fã, de uma central; a reserva da central nunca sai', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const other = await signUpFan(db, 'Alan Ferreira');
    const otherAt = (await read(`users/${other.uid}`))!.username as string;
    const handle = unique('centralrecusa');
    await centralReservation(handle);
    const { call } = clockApi(Date.now());

    expect((await putUsername(call, fan, 'adm1n')).body).toMatchObject({
      code: 'username_invalid',
      details: { reason: 'reserved' },
    });
    expect((await putUsername(call, fan, 'fa123456')).body).toMatchObject({
      code: 'username_invalid',
      details: { reason: 'automatic' },
    });
    expect((await putUsername(call, fan, 'ca')).body).toMatchObject({
      code: 'username_invalid',
      details: { reason: 'format' },
    });
    for (const taken of [otherAt, handle]) {
      expect(await putUsername(call, fan, taken)).toEqual({
        status: 409,
        body: { code: 'username_taken', message: 'Este @ já tem dono.' },
      });
    }

    // Um perfil antigo com o @ igual ao de uma central (reserva sem uid): a troca não a apaga.
    const legacy = await signUpFan(db, 'Fã Antiga');
    const legacyAt = (await read(`users/${legacy.uid}`))!.username as string;
    await db.doc(`usernames/${legacyAt}`).delete();
    const shared = unique('centralantiga');
    await centralReservation(shared);
    await db.doc(`users/${legacy.uid}`).update({ username: shared });
    expect((await putUsername(call, legacy, unique('legadonovo'))).status).toBe(200);
    expect(await read(`usernames/${shared}`)).toMatchObject({ artistId: shared });
  });

  it('dois fãs pelo mesmo @ em paralelo: um 200, um 409 e uma reserva só', async () => {
    const [a, b] = await Promise.all([signUpFan(db, 'Ana Paula'), signUpFan(db, 'Bia Santos')]);
    const { call } = clockApi(Date.now());
    const disputed = unique('disputado');
    const results = await Promise.all([
      putUsername(call, a, disputed),
      putUsername(call, b, disputed),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results[0]!.status === 200 ? a : b;
    expect(await read(`usernames/${disputed}`)).toMatchObject({ uid: winner.uid });
    const loser = winner === a ? b : a;
    expect((await read(`users/${loser.uid}`))!.username).not.toBe(disputed);
  });

  it('o mesmo fã com duas chaves e dois @ em paralelo: um 200, um too_soon e uma reserva só', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const old = (await read(`users/${fan.uid}`))!.username as string;
    const { call } = clockApi(Date.now());
    const [x, y] = [unique('paralelox'), unique('paraleloy')];
    const results = await Promise.all([putUsername(call, fan, x), putUsername(call, fan, y)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)!.body).toMatchObject({
      code: 'username_change_too_soon',
    });
    const reservations = await db.collection('usernames').where('uid', '==', fan.uid).get();
    expect(reservations.size).toBe(1);
    expect([x, y]).toContain(reservations.docs[0]!.id);
    expect(await exists(`usernames/${old}`)).toBe(false);
  });

  it('o mesmo fã com duas chaves e o mesmo @ em paralelo: os dois 200, uma reserva e o prazo gravado uma vez', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const start = Date.now();
    const { call } = clockApi(start);
    const chosen = unique('mesmoarroba');
    const results = await Promise.all([
      putUsername(call, fan, chosen),
      putUsername(call, fan, chosen),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    const reservations = await db.collection('usernames').where('uid', '==', fan.uid).get();
    expect(reservations.docs.map((doc) => doc.id)).toEqual([chosen]);
    expect(((await read(`users/${fan.uid}`))!.usernameChangedAt as Timestamp).toMillis()).toBe(
      start,
    );
  });

  it('a mesma chave repetida devolve a resposta guardada (a api de verdade)', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const key = unique('chave-repetida-');
    const chosen = unique('repetida');
    const first = await http(env, '/me/username', {
      method: 'PUT',
      token: fan.token,
      key,
      body: { username: chosen },
    });
    expect(first.status).toBe(200);
    const again = await http(env, '/me/username', {
      method: 'PUT',
      token: fan.token,
      key,
      body: { username: chosen },
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('sem perfil, 503; conta só da equipe, 403', async () => {
    const fan = await signUpFan(db, 'Sem Perfil');
    await db.doc(`users/${fan.uid}`).delete();
    const { call } = clockApi(Date.now());
    const chosen = unique('semperfil');
    expect((await putUsername(call, fan, chosen)).body).toMatchObject({
      code: 'profile_not_ready',
    });
    expect(await exists(`usernames/${chosen}`)).toBe(false);
    const staff = await seedMember(env, 'Equipe', 'admin');
    const asStaff = await call('PUT', '/me/username', {
      token: staff.token,
      key: unique('chave-equipe-'),
      body: { username: unique('equipe') },
    });
    expect(asStaff).toMatchObject({ status: 403, body: { code: 'not_fan' } });
  });

  it('o releaseUsername dá ao fã um fa novo sem prazo e solta o @ para a central', async () => {
    const fan = await signUpFan(db, 'Fã do Trio');
    const { call } = clockApi(Date.now());
    const handle = unique('trioforro');
    expect((await putUsername(call, fan, handle)).status).toBe(200);
    const admin = await seedMember(env, 'Admin', 'admin');
    const blocked = await callable(
      env,
      'createArtist',
      { handle, name: 'Trio Forró', verified: false, imageRightsConfirmed: false },
      admin.token,
    );
    expect(blocked.error?.details?.reason).toBe('handle-taken');

    const released = await releaseUsername(db, handle);
    expect(released).toMatchObject({ uid: fan.uid, previous: handle });
    expect(released.username).toMatch(/^fa\d+$/);
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile.username).toBe(released.username);
    expect(profile.usernameChangeableAt).toBeNull();
    expect(profile.usernameChangedAt).toBeInstanceOf(Timestamp);
    expect(await exists(`usernames/${handle}`)).toBe(false);
    expect(await read(`usernames/${released.username}`)).toMatchObject({ uid: fan.uid });

    const createdArtist = await callable<{ artistId: string }>(
      env,
      'createArtist',
      { handle, name: 'Trio Forró', verified: false, imageRightsConfirmed: false },
      admin.token,
    );
    expect(createdArtist.result?.artistId).toBe(handle);
    // A reserva de central e a que não existe são recusadas sem gravar.
    await expect(releaseUsername(db, handle)).rejects.toMatchObject({ reason: 'central' });
    await expect(releaseUsername(db, unique('naoexiste'))).rejects.toBeInstanceOf(
      UsernameReleaseError,
    );
    // Sem prazo: o fã escolhe outro @ na hora.
    expect((await putUsername(call, fan, unique('trionovo'))).status).toBe(200);
  });
});

describe('foto (PUT e DELETE /me/photo)', () => {
  it('grava a URL, o caminho e o photoUpdatedAt; o mesmo caminho responde sem contar no teto', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const file = await upload(photoPath(fan.uid));
    const { clock, call } = clockApi(file.createdAt + 1_000);
    const set = await putPhoto(call, fan, file.path);
    expect(set.status).toBe(200);
    expect(set.body.photoURL).toEqual(expect.stringContaining(encodeURIComponent(file.path)));
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile).toMatchObject({ photoURL: set.body.photoURL, photoPath: file.path });
    expect((profile.photoUpdatedAt as Timestamp).toMillis()).toBe(clock.now);
    expect(profile.updatedAt).toBeUndefined();
    const today = dayKey(clock.now);
    expect((await read(`wallets/${fan.uid}`))!.days[today].count.photo_set).toBe(1);

    // O mesmo caminho: a URL de agora, sem gravar e sem contar.
    clock.now += 1_000;
    expect(await putPhoto(call, fan, file.path)).toEqual(set);
    expect((await read(`wallets/${fan.uid}`))!.days[today].count.photo_set).toBe(1);
  });

  it('recusas: outro uid, arquivo que não existe, velho ou de antes da troca, png, grande, bytes e dimensões', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const other = await signUpFan(db, 'Alan Ferreira');
    const first = await upload(photoPath(fan.uid));
    const { clock, call } = clockApi(first.createdAt + 1_000);

    const otherFile = await upload(photoPath(other.uid));
    expect((await putPhoto(call, fan, otherFile.path)).body).toMatchObject({
      code: 'photo_invalid',
      details: { reason: 'path' },
    });
    expect((await putPhoto(call, fan, photoPath(fan.uid))).body).toMatchObject({
      code: 'photo_not_found',
    });
    // Mais de 10 min.
    clock.now = first.createdAt + 10 * MIN + 1;
    expect(await putPhoto(call, fan, first.path)).toEqual({
      status: 404,
      body: { code: 'photo_not_found', message: 'Foto não encontrada. Envie de novo.' },
    });

    const png = await upload(photoPath(fan.uid), PNG, 'image/png');
    const big = await upload(
      photoPath(fan.uid),
      Buffer.concat([JPEG_1X1, Buffer.alloc(1024 * 1024)]),
    );
    const notJpeg = await upload(photoPath(fan.uid), PNG);
    const huge = await upload(photoPath(fan.uid), JPEG_2000_HEADER);
    clock.now = huge.createdAt + 1_000;
    for (const [file, reason] of [
      [png, 'type'],
      [big, 'size'],
      [notJpeg, 'content'],
      [huge, 'dimensions'],
    ] as const) {
      expect(await putPhoto(call, fan, file.path)).toEqual({
        status: 400,
        body: {
          code: 'photo_invalid',
          message: 'Foto fora do formato. Escolha outra.',
          details: { reason },
        },
      });
    }

    // O de antes da última troca de foto não vira a foto.
    const older = await upload(photoPath(fan.uid));
    const newer = await upload(photoPath(fan.uid));
    clock.now = newer.createdAt + 1_000;
    expect((await putPhoto(call, fan, newer.path)).status).toBe(200);
    clock.now += 1_000;
    expect((await putPhoto(call, fan, older.path)).body).toMatchObject({ code: 'photo_not_found' });
  });

  it('o teto do dia (aqui 2): a 3ª troca é 429, e remover continua passando', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const uploads: { path: string; createdAt: number }[] = [];
    for (let index = 0; index < 3; index += 1) uploads.push(await upload(photoPath(fan.uid)));
    const { clock, call } = clockApi(uploads[0]!.createdAt + 1, { photoCap: 2 });
    for (const file of uploads.slice(0, 2)) {
      clock.now = Math.max(clock.now, file.createdAt) + 1;
      expect((await putPhoto(call, fan, file.path)).status).toBe(200);
    }
    clock.now = Math.max(clock.now, uploads[2]!.createdAt) + 1;
    expect(await putPhoto(call, fan, uploads[2]!.path)).toEqual({
      status: 429,
      body: {
        code: 'too_many_requests',
        message: 'Tentativas demais por hoje. Tente amanhã.',
        details: { limit: 2, action: 'photo' },
      },
    });
    clock.now += 1;
    expect(
      await call('DELETE', '/me/photo', { token: fan.token, key: unique('chave-remover-') }),
    ).toEqual({ status: 200, body: { photoURL: null } });
  });

  it('a mesma chave repetida depois de outra troca devolve a resposta guardada', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const a = await upload(photoPath(fan.uid));
    const { clock, call } = clockApi(a.createdAt + 1);
    const key = unique('chave-foto-a-');
    const first = await putPhoto(call, fan, a.path, key);
    expect(first.status).toBe(200);
    // A foto seguinte é enviada depois da troca (a de antes não viraria a foto).
    const b = await upload(photoPath(fan.uid));
    clock.now = Math.max(clock.now, b.createdAt) + 1;
    expect((await putPhoto(call, fan, b.path)).status).toBe(200);
    clock.now += 1_000;
    expect(await putPhoto(call, fan, a.path, key)).toEqual(first);
    expect((await read(`users/${fan.uid}`))!.photoPath).toBe(b.path);
  });

  it('trocar apaga a foto antiga e o envio de antes da troca; o de depois fica até os 15 min', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const first = await upload(photoPath(fan.uid));
    const { clock, call } = clockApi(first.createdAt + 1);
    expect((await putPhoto(call, fan, first.path)).status).toBe(200);

    // O envio que falhou e a foto nova, enviados antes da troca.
    const failed = await upload(photoPath(fan.uid));
    const second = await upload(photoPath(fan.uid));
    clock.now = second.createdAt + 1;
    expect((await putPhoto(call, fan, second.path)).status).toBe(200);
    // O gatilho apaga a antiga; a tarefa da troca varre o envio que falhou.
    await waitFor('a foto antiga e o envio que falhou saírem', async () => {
      const names = await folder(fan.uid);
      return !names.includes(first.path) && !names.includes(failed.path);
    });
    expect(await fileExists(second.path)).toBe(true);

    // O envio de depois da troca (ainda pode chegar ao PUT) fica com menos de 15 min.
    const later = await upload(photoPath(fan.uid));
    await syncFanProfile(db, files, fan.uid, Date.now());
    expect(await folder(fan.uid)).toEqual([second.path, later.path].sort());
    // Com o "agora" 16 min à frente (o timeCreated não é forjável), sai.
    await syncFanProfile(db, files, fan.uid, Date.now() + 16 * MIN);
    expect(await folder(fan.uid)).toEqual([second.path]);
  });

  it('DELETE limpa os três campos e o arquivo sai; sem foto, a mesma resposta', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const file = await upload(photoPath(fan.uid));
    const { clock, call } = clockApi(file.createdAt + 1);
    expect((await putPhoto(call, fan, file.path)).status).toBe(200);
    clock.now += 1_000;
    const removed = await call('DELETE', '/me/photo', {
      token: fan.token,
      key: unique('chave-remover-'),
    });
    expect(removed).toEqual({ status: 200, body: { photoURL: null } });
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile).toMatchObject({ photoURL: null, photoPath: null });
    expect((profile.photoUpdatedAt as Timestamp).toMillis()).toBe(clock.now);
    await waitFor('o arquivo da foto removida sair', async () => !(await fileExists(file.path)));
    expect(
      await call('DELETE', '/me/photo', { token: fan.token, key: unique('chave-remover-') }),
    ).toEqual({ status: 200, body: { photoURL: null } });
  });
});

describe('vaga de envio da foto (POST /me/photo/upload, 27.4)', () => {
  const reserve = (
    call: ReturnType<typeof localApi>,
    fan: Fan,
    path: string,
    key = unique('chave-vaga-'),
  ) => call('POST', '/me/photo/upload', { token: fan.token, key, body: { path } });

  const slotOf = (uid: string) => read(`users/${uid}/uploads/photo`);
  const uploadsToday = async (uid: string, now: number) =>
    ((await read(`wallets/${uid}`))?.days?.[dayKey(now)]?.count?.photo_upload as
      number | undefined) ?? 0;

  it('grava a vaga com o nome do arquivo e o prazo de 10 min, e conta 1 no dia', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const now = Date.now();
    const { call } = clockApi(now);
    const path = photoPath(fan.uid);
    const sent = await reserve(call, fan, path);
    expect(sent).toEqual({
      status: 200,
      body: { path, expiresAt: new Date(now + 10 * MIN).toISOString() },
    });
    const slot = await slotOf(fan.uid);
    expect(slot!.fileName).toBe(path.split('/').at(-1));
    expect((slot!.expiresAt as Timestamp).toMillis()).toBe(now + 10 * MIN);
    expect(await uploadsToday(fan.uid, now)).toBe(1);
  });

  it('a vaga do mesmo arquivo de novo renova o prazo sem contar; outro arquivo troca a vaga e conta', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const now = Date.now();
    const { clock, call } = clockApi(now);
    const first = photoPath(fan.uid);
    expect((await reserve(call, fan, first)).status).toBe(200);
    clock.now += 5 * MIN;
    expect(await reserve(call, fan, first)).toMatchObject({
      status: 200,
      body: { expiresAt: new Date(now + 15 * MIN).toISOString() },
    });
    expect(await uploadsToday(fan.uid, now)).toBe(1);
    const second = photoPath(fan.uid);
    expect((await reserve(call, fan, second)).status).toBe(200);
    expect((await slotOf(fan.uid))!.fileName).toBe(second.split('/').at(-1));
    expect(await uploadsToday(fan.uid, now)).toBe(2);
  });

  it('a renovação vale até 30 min depois da vaga que contou; depois, o mesmo arquivo conta de novo', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const now = Date.now();
    const { clock, call } = clockApi(now);
    const path = photoPath(fan.uid);
    expect((await reserve(call, fan, path)).status).toBe(200);
    // Renovar perto do fim da janela não muda o instante da vaga que contou.
    clock.now = now + 29 * MIN;
    expect((await reserve(call, fan, path)).status).toBe(200);
    expect(((await slotOf(fan.uid))!.createdAt as Timestamp).toMillis()).toBe(now);
    expect(await uploadsToday(fan.uid, now)).toBe(1);
    clock.now = now + 30 * MIN;
    expect(await reserve(call, fan, path)).toMatchObject({
      status: 200,
      body: { expiresAt: new Date(now + 40 * MIN).toISOString() },
    });
    expect(((await slotOf(fan.uid))!.createdAt as Timestamp).toMillis()).toBe(now + 30 * MIN);
    expect(await uploadsToday(fan.uid, clock.now)).toBe(dayKey(clock.now) === dayKey(now) ? 2 : 1);
  });

  it('o teto do dia (aqui 2): a 3ª vaga de arquivo novo é 429, e renovar a de agora continua passando', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const { clock, call } = clockApi(Date.now(), { uploadCap: 2 });
    const second = photoPath(fan.uid);
    expect((await reserve(call, fan, photoPath(fan.uid))).status).toBe(200);
    clock.now += 1;
    expect((await reserve(call, fan, second)).status).toBe(200);
    clock.now += 1;
    expect(await reserve(call, fan, photoPath(fan.uid))).toEqual({
      status: 429,
      body: {
        code: 'too_many_requests',
        message: 'Tentativas demais por hoje. Tente amanhã.',
        details: { limit: 2, action: 'upload' },
      },
    });
    expect((await slotOf(fan.uid))!.fileName).toBe(second.split('/').at(-1));
    clock.now += 1;
    expect((await reserve(call, fan, second)).status).toBe(200);
    // No dia seguinte de São Paulo, o teto começa de novo.
    clock.now += DAY;
    expect((await reserve(call, fan, photoPath(fan.uid))).status).toBe(200);
  });

  it('recusas: caminho de outro fã ou fora da pasta, suspenso, sem perfil e a conta só da equipe', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const other = await signUpFan(db, 'Alan');
    const { call } = clockApi(Date.now());
    expect(await reserve(call, fan, photoPath(other.uid))).toMatchObject({
      status: 400,
      body: { code: 'photo_invalid', details: { reason: 'path' } },
    });
    expect(await reserve(call, fan, `fans/${fan.uid}/avatar.png`)).toMatchObject({
      status: 400,
      body: { code: 'photo_invalid' },
    });
    expect(await exists(`users/${fan.uid}/uploads/photo`)).toBe(false);

    await db.doc(`users/${other.uid}`).update({
      suspendedAt: Timestamp.now(),
      suspensionReason: 'spam',
    });
    expect(await reserve(call, other, photoPath(other.uid))).toMatchObject({
      status: 403,
      body: { code: 'account_suspended' },
    });
    expect(await exists(`users/${other.uid}/uploads/photo`)).toBe(false);

    const staff = await seedMember(env, 'Equipe', 'admin');
    expect(await reserve(call, staff, photoPath(staff.uid))).toMatchObject({
      status: 403,
      body: { code: 'not_fan' },
    });
  });

  it('a mesma chave repetida devolve a vaga guardada (a api de verdade), e a exclusão de conta a leva', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const path = photoPath(fan.uid);
    const key = unique('chave-vaga-');
    const first = await http(env, '/me/photo/upload', {
      method: 'POST',
      token: fan.token,
      key,
      body: { path },
    });
    expect(first.status).toBe(200);
    const again = await http(env, '/me/photo/upload', {
      method: 'POST',
      token: fan.token,
      key,
      body: { path },
    });
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(again.headers.get('Idempotency-Replayed')).toBe('true');
    await deleteUserData(db, fan.uid, { files });
    expect(await exists(`users/${fan.uid}/uploads/photo`)).toBe(false);
  });
});

describe('cópias do nome e da foto nos comentários', () => {
  /** Comentário pela api de verdade, como o app. */
  async function comment(fan: Fan, postId: string, text: string): Promise<string> {
    const result = await http(env, `/posts/${postId}/comments`, {
      method: 'POST',
      token: fan.token,
      key: unique('chave-comentario-'),
      body: { text },
    });
    expect(result.status).toBe(200);
    return result.body.id as string;
  }

  const copyOf = async (postId: string, commentId: string) => {
    const data = (await read(`posts/${postId}/postComments/${commentId}`))!;
    return { authorName: data.authorName, authorPhotoURL: data.authorPhotoURL };
  };

  /**
   * Grava o perfil pelo Admin SDK, como a API grava (sem o `updatedAt`): estes
   * testes são do gatilho e da fila, não do caminho. O nome pela API de verdade
   * está em "perfil novo: PUT /me/profile".
   */
  const change = (fan: Fan, data: Record<string, unknown>) =>
    db.doc(`users/${fan.uid}`).update(data);

  it('o nome trocado chega a todos os comentários do fã, inclusive o oculto, e não aos de outro fã', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const other = await signUpFan(db, 'Alan Ferreira');
    const artist = await central(env);
    const [p1, p2] = [await post(env, artist), await post(env, artist)];
    const c1 = await comment(fan, p1, 'Que show!');
    const c2 = await comment(fan, p2, 'Arrasou');
    const hidden = await comment(fan, p2, 'Oculto pela Moderação');
    const others = await comment(other, p1, 'Também acho');
    await db.doc(`posts/${p2}/postComments/${hidden}`).update({ status: 'hidden' });

    // Um resultado de temporada fechada guarda o nome da virada.
    const seasonId = unique('temporada');
    await db.doc(`seasons/${seasonId}/standings/${fan.uid}`).set({
      position: 1,
      points: 10,
      displayName: 'Camila Ribeiro',
      photoURL: null,
      city: null,
    });

    await change(fan, { displayName: 'Camila Nova' });
    await waitFor('as cópias do nome novo', async () => {
      const copies = await Promise.all([copyOf(p1, c1), copyOf(p2, c2), copyOf(p2, hidden)]);
      return copies.every((copy) => copy.authorName === 'Camila Nova');
    });
    expect(await copyOf(p1, others)).toEqual({ authorName: 'Alan Ferreira', authorPhotoURL: null });
    expect((await read(`seasons/${seasonId}/standings/${fan.uid}`))!.displayName).toBe(
      'Camila Ribeiro',
    );
    // O orçamento do dia fica no perfil.
    expect(await read(`users/${fan.uid}/profileSync/budget`)).toMatchObject({
      day: dayKey(Date.now()),
      windows: expect.any(Number),
    });

    // A foto trocada e a removida; o nome null vira "Fã". Duas trocas seguidas terminam com a última.
    await change(fan, { photoURL: 'https://example.test/a.jpg' });
    await change(fan, { photoURL: 'https://example.test/b.jpg', displayName: null });
    await waitFor('a última troca nas cópias', async () => {
      const copy = await copyOf(p1, c1);
      return copy.authorName === 'Fã' && copy.authorPhotoURL === 'https://example.test/b.jpg';
    });
    await change(fan, { photoURL: null, displayName: 'Camila' });
    await waitFor('a foto removida nas cópias', async () => {
      const copies = await Promise.all([copyOf(p1, c1), copyOf(p2, hidden)]);
      return copies.every((copy) => copy.authorName === 'Camila' && copy.authorPhotoURL === null);
    });

    // A tarefa repetida não grava de novo (a cópia igual).
    const again = await syncFanProfile(db, files, fan.uid, Date.now());
    expect(again).toMatchObject({ deleted: false, read: 3, updated: 0 });
  });

  it('duas tarefas em paralelo, uma com o perfil antigo lido no começo, terminam com o perfil de agora', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const postId = await post(env, await central(env));
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) ids.push(await comment(fan, postId, `Oi ${index}`));
    await change(fan, { displayName: 'Primeiro Nome' });
    const early = syncFanProfile(db, files, fan.uid, Date.now());
    await change(fan, { displayName: 'Nome Final' });
    await Promise.all([early, syncFanProfile(db, files, fan.uid, Date.now())]);
    await waitFor('o nome de agora em todas as cópias', async () => {
      const copies = await Promise.all(ids.map((id) => copyOf(postId, id)));
      return copies.every((copy) => copy.authorName === 'Nome Final');
    });
  });

  it('a pasta que não lista não segura as cópias: o Storage não ligado conta como vazio, e outra falha lança no fim', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const postId = await post(env, await central(env));
    const commentId = await comment(fan, postId, 'Antes da troca');
    const commentRef = db.doc(`posts/${postId}/postComments/${commentId}`);
    const listFails = (code: unknown): FanPhotoFiles => ({
      ...files,
      listWithTimes: async () => {
        throw Object.assign(new Error(`listagem: ${String(code)}`), { code });
      },
    });
    const fresh = { authorName: 'Camila Ribeiro', authorPhotoURL: null };

    // A cópia velha vai direto no comentário: mudar o perfil poria a tarefa de
    // verdade na fila, que acertaria a cópia por conta própria.
    for (const code of [404, 'storage/invalid-argument']) {
      await commentRef.update({ authorName: 'Nome Velho' });
      await expect(syncFanProfile(db, listFails(code), fan.uid, Date.now())).resolves.toMatchObject(
        { deleted: false, read: 1, updated: 1, removed: 0 },
      );
      expect(await copyOf(postId, commentId)).toEqual(fresh);
    }
    await commentRef.update({ authorName: 'Nome Velho' });
    await expect(syncFanProfile(db, listFails(503), fan.uid, Date.now())).rejects.toThrow(
      'listagem: 503',
    );
    expect(await copyOf(postId, commentId)).toEqual(fresh);
  });

  it('a cidade e o @ sozinhos não põem tarefa (o orçamento não nasce)', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    await change(fan, { city: 'Irará, BA' });
    await db.doc(`users/${fan.uid}`).update({ username: unique('soarroba') });
    await sleep(3_000);
    expect(await exists(`users/${fan.uid}/profileSync/budget`)).toBe(false);
  });

  it('a tarefa com o perfil apagado não grava nos comentários e esvazia a pasta', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const postId = await post(env, await central(env));
    const commentId = await comment(fan, postId, 'Antes de sair');
    await upload(photoPath(fan.uid));
    await db.doc(`users/${fan.uid}`).delete();
    const result = await runFanProfileSync(db, files, { uid: fan.uid });
    expect(result).toMatchObject({ deleted: true, removed: 1 });
    expect(await folder(fan.uid)).toEqual([]);
    expect(await copyOf(postId, commentId)).toEqual({
      authorName: 'Camila Ribeiro',
      authorPhotoURL: null,
    });
  });
});

describe('exclusão de conta', () => {
  it('a pasta fica vazia, a reserva do @ trocado sai e a antiga não volta; a troca depois é 503', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const old = (await read(`users/${fan.uid}`))!.username as string;
    const photo = await upload(photoPath(fan.uid));
    const { clock, call } = clockApi(photo.createdAt + 1);
    const chosen = unique('antesdesair');
    expect((await putUsername(call, fan, chosen)).status).toBe(200);
    expect((await putPhoto(call, fan, photo.path)).status).toBe(200);
    const abandoned = await upload(photoPath(fan.uid));
    await db.doc(`users/${fan.uid}`).update({ displayName: 'Camila R.' });
    await waitFor('o orçamento da fila', () => exists(`users/${fan.uid}/profileSync/budget`));
    expect(await fileExists(abandoned.path)).toBe(true);

    await deleteUserData(db, fan.uid, { files });
    expect(await folder(fan.uid)).toEqual([]);
    expect(await exists(`usernames/${chosen}`)).toBe(false);
    expect(await exists(`usernames/${old}`)).toBe(false);
    expect(await exists(`users/${fan.uid}/profileSync/budget`)).toBe(false);

    // Um envio que a regra liberou antes e terminou depois: a segunda limpeza leva.
    const late = await upload(photoPath(fan.uid));
    expect(await fileExists(late.path)).toBe(true);
    await runFanProfileSync(db, files, { uid: fan.uid });
    expect(await folder(fan.uid)).toEqual([]);

    // A troca do @ depois da exclusão (o token ainda vale): 503, sem reserva.
    clock.now += 1_000;
    const after = unique('depoisdesair');
    expect((await putUsername(call, fan, after)).body).toMatchObject({ code: 'profile_not_ready' });
    expect(await exists(`usernames/${after}`)).toBe(false);
    // Repetir a exclusão não falha.
    await expect(deleteUserData(db, fan.uid, { files })).resolves.toBeUndefined();
  });

  it('pelo gatilho: excluir a conta no Auth apaga a foto e libera o @', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const photo = await upload(photoPath(fan.uid));
    const { call } = clockApi(photo.createdAt + 1);
    const chosen = unique('pelogatilho');
    expect((await putUsername(call, fan, chosen)).status).toBe(200);
    expect((await putPhoto(call, fan, photo.path)).status).toBe(200);
    await env.auth.deleteUser(fan.uid);
    await waitFor(
      'a exclusão pelo gatilho',
      async () => !(await exists(`users/${fan.uid}`)),
      60_000,
    );
    await waitFor(
      'a pasta e a reserva saírem',
      async () => (await folder(fan.uid)).length === 0 && !(await exists(`usernames/${chosen}`)),
    );
  });
});

describe('seed', () => {
  it('o seedFanPhoto dá ao fã a foto, com o arquivo na pasta, e rodar de novo não muda nada', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const save = (path: string, bytes: Uint8Array) =>
      bucket.file(path).save(Buffer.from(bytes), { resumable: false, contentType: 'image/jpeg' });
    expect(await seedFanPhoto(db, files, save, fan.uid, JPEG_1X1)).toBe('created');
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile.photoPath).toBe(`fans/${fan.uid}/photo-seed-camila.jpg`);
    expect(profile.photoURL).toEqual(expect.stringContaining('photo-seed-camila.jpg'));
    expect(await fileExists(profile.photoPath as string)).toBe(true);
    // O ator de sistema não conta no teto do dia.
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);
    expect(await seedFanPhoto(db, files, save, fan.uid, JPEG_1X1)).toBe('exists');
    expect((await read(`users/${fan.uid}`))!.photoURL).toBe(profile.photoURL);
  });
});

// --- Perfil novo (seção 28, 28.12) ------------------------------------------------

const putProfile = (
  call: ReturnType<typeof localApi>,
  fan: Fan,
  body: unknown,
  key = unique('chave-perfil-'),
) => call('PUT', '/me/profile', { token: fan.token, key, body });

/** Os contadores do dia de São Paulo do fã (os tetos `profile_save` e `name_change`). */
const dayCounts = async (uid: string, now: number) =>
  ((await read(`wallets/${uid}`))?.days?.[dayKey(now)]?.count ?? {}) as Record<string, number>;

const NO_SOCIALS = { instagram: null, tiktok: null, linkedin: null, x: null };

describe('perfil novo: PUT /me/profile', () => {
  it('grava só o que mudou, num update, sem o updatedAt; o mesmo valor responde sem gravar e sem contar', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const before = (await read(`users/${fan.uid}`))!;
    const start = Date.now();
    const { clock, call } = clockApi(start);

    const body = {
      bio: '  Feira de Santana.  \n  Fã do Netto desde o primeiro show. ',
      gender: 'woman',
      socials: { instagram: 'https://www.instagram.com/camila.teste.up/', x: null },
    };
    const saved = await putProfile(call, fan, body);
    expect(saved).toEqual({
      status: 200,
      body: {
        displayName: 'Camila Ribeiro',
        username: before.username,
        usernameChangeableAt: null,
        bio: 'Feira de Santana.\nFã do Netto desde o primeiro show.',
        city: null,
        gender: 'woman',
        privateAccount: false,
        socials: { ...NO_SOCIALS, instagram: 'camila.teste.up' },
      },
    });
    const after = (await db.doc(`users/${fan.uid}`).get())!;
    expect(after.data()).toEqual({
      ...before,
      bio: 'Feira de Santana.\nFã do Netto desde o primeiro show.',
      gender: 'woman',
      socials: { ...NO_SOCIALS, instagram: 'camila.teste.up' },
    });
    // O servidor nunca grava o carimbo do primeiro nome; a privada igual ao padrão não sai.
    expect(after.get('updatedAt')).toBeUndefined();
    expect(after.get('privateAccount')).toBeUndefined();
    expect(await dayCounts(fan.uid, start)).toMatchObject({ profile_save: 1 });
    expect((await dayCounts(fan.uid, start)).name_change).toBeUndefined();

    // O mesmo corpo com outra chave: a mesma resposta, sem gravar e sem contar.
    clock.now = start + MIN;
    expect(await putProfile(call, fan, body)).toEqual(saved);
    expect(await putProfile(call, fan, { privateAccount: false, socials: { tiktok: '' } })).toEqual(
      saved,
    );
    const again = await db.doc(`users/${fan.uid}`).get();
    expect(again.updateTime!.isEqual(after.updateTime!)).toBe(true);
    expect((await dayCounts(fan.uid, start)).profile_save).toBe(1);
  });

  it('nome, @, bio, cidade e redes numa transação: as reservas trocadas e o perfil num update', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const old = (await read(`users/${fan.uid}`))!.username as string;
    const start = Date.now();
    const { call } = clockApi(start);
    const chosen = unique('camilaperfil');

    const saved = await putProfile(call, fan, {
      displayName: ' Camila Nova ',
      username: ` @${chosen.toUpperCase()} `,
      bio: 'Oi!',
      city: ' Irará, BA ',
      privateAccount: true,
      socials: { x: 'https://x.com/CamilaTesteUp', linkedin: 'br.linkedin.com/in/jo%C3%A3o-teste' },
    });
    expect(saved).toEqual({
      status: 200,
      body: {
        displayName: 'Camila Nova',
        username: chosen,
        usernameChangeableAt: new Date(start + 30 * DAY).toISOString(),
        bio: 'Oi!',
        city: 'Irará, BA',
        gender: null,
        privateAccount: true,
        socials: { ...NO_SOCIALS, linkedin: 'joão-teste', x: 'camilatesteup' },
      },
    });
    expect(await read(`usernames/${chosen}`)).toMatchObject({ uid: fan.uid });
    expect(await exists(`usernames/${old}`)).toBe(false);
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile).toMatchObject({
      displayName: 'Camila Nova',
      username: chosen,
      bio: 'Oi!',
      city: 'Irará, BA',
      privateAccount: true,
      socials: { ...NO_SOCIALS, linkedin: 'joão-teste', x: 'camilatesteup' },
    });
    expect((profile.usernameChangedAt as Timestamp).toMillis()).toBe(start);
    expect((profile.usernameChangeableAt as Timestamp).toMillis()).toBe(start + 30 * DAY);
    expect(profile.updatedAt).toBeUndefined();
    expect(await dayCounts(fan.uid, start)).toMatchObject({ profile_save: 1, name_change: 1 });

    // Tirar as redes todas grava o mapa como null; a bio vazia vira null.
    const cleared = await putProfile(call, fan, {
      bio: '  ',
      socials: { linkedin: null, x: '' },
    });
    expect(cleared.body).toMatchObject({ bio: null, socials: NO_SOCIALS });
    expect(await read(`users/${fan.uid}`)).toMatchObject({ bio: null, socials: null });
  });

  it('o @ com dono é 409 e nada grava (nem a bio); o de uma central também; o automático e o reservado são 400', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const other = await signUpFan(db, 'Alan Ferreira');
    const otherAt = (await read(`users/${other.uid}`))!.username as string;
    const handle = unique('centralperfil');
    await centralReservation(handle);
    const before = await db.doc(`users/${fan.uid}`).get();
    const start = Date.now();
    const { call } = clockApi(start);

    for (const taken of [otherAt, handle]) {
      expect(await putProfile(call, fan, { username: taken, bio: 'Não grava' })).toEqual({
        status: 409,
        body: { code: 'username_taken', message: 'Este @ já tem dono.' },
      });
    }
    expect(
      (await putProfile(call, fan, { username: 'fa123456', bio: 'Não grava' })).body,
    ).toMatchObject({ code: 'username_invalid', details: { reason: 'automatic' } });
    expect(
      (await putProfile(call, fan, { username: 'adm1n', bio: 'Não grava' })).body,
    ).toMatchObject({ code: 'username_invalid', details: { reason: 'reserved' } });
    expect((await putProfile(call, fan, { username: 'ca', bio: 'Não grava' })).body).toMatchObject({
      code: 'username_invalid',
      details: { reason: 'format' },
    });

    const after = await db.doc(`users/${fan.uid}`).get();
    expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(after.get('bio')).toBeUndefined();
    expect(await read(`usernames/${handle}`)).toMatchObject({ artistId: handle });
    expect(await read(`usernames/${otherAt}`)).toMatchObject({ uid: other.uid });
    // Nada contou: a recusa não grava a carteira nem a chave.
    expect((await dayCounts(fan.uid, start)).profile_save).toBeUndefined();
    const keys = await db.collection('idempotency').where('uid', '==', fan.uid).get();
    expect(keys.size).toBe(0);
  });

  it('o prazo do @: o 409 com a data segura a bio; o @ igual ao de agora sai do corpo; depois dos 30 dias, passa', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const start = Date.now();
    const { clock, call } = clockApi(start);
    const first = unique('primeiroperfil');
    expect((await putProfile(call, fan, { username: first })).status).toBe(200);

    clock.now = start + 30 * DAY - 1;
    expect(await putProfile(call, fan, { username: unique('segundo'), bio: 'Não grava' })).toEqual({
      status: 409,
      body: {
        code: 'username_change_too_soon',
        message: 'Você trocou o @ há pouco. Tente de novo mais tarde.',
        details: { changeableAt: new Date(start + 30 * DAY).toISOString() },
      },
    });
    expect((await read(`users/${fan.uid}`))!.bio).toBeUndefined();
    // O @ de agora junto com a bio: o @ não difere e sai; a bio grava.
    const withCurrent = await putProfile(call, fan, { username: first, bio: 'Grava' });
    expect(withCurrent.body).toMatchObject({ username: first, bio: 'Grava' });
    expect(((await read(`users/${fan.uid}`))!.usernameChangeableAt as Timestamp).toMillis()).toBe(
      start + 30 * DAY,
    );

    // O PUT /me/username de antes divide o mesmo prazo.
    expect((await putUsername(call, fan, unique('pelarota'))).body).toMatchObject({
      code: 'username_change_too_soon',
    });

    clock.now = start + 30 * DAY;
    expect((await putProfile(call, fan, { username: unique('segundo') })).status).toBe(200);
  });

  it('os tetos do dia (aqui profile_save 2 e name_change 1): o 429 com a ação e o Retry-After; o mesmo valor não conta; o dia seguinte passa', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    // Meio-dia em São Paulo, para o dia seguinte ficar a 12 h.
    const start = Date.parse('2026-10-08T15:00:00.000Z');
    const { clock, call } = clockApi(start, { profileCap: 2, nameCap: 1, withHeaders: true });
    const retryAfter = String(Math.ceil((nextDayStart(start) - start) / 1000));

    expect((await putProfile(call, fan, { displayName: 'Nome Um' })).status).toBe(200);
    const name = await putProfile(call, fan, { displayName: 'Nome Dois' });
    expect(name).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 1, action: 'name' } },
      headers: { 'Retry-After': retryAfter },
    });
    expect((await putProfile(call, fan, { bio: 'Um' })).status).toBe(200);
    const profile = await putProfile(call, fan, { bio: 'Dois' });
    expect(profile).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 2, action: 'profile' } },
      headers: { 'Retry-After': retryAfter },
    });
    // O mesmo valor, já no teto: responde sem contar (a nova tentativa com outra chave).
    expect((await putProfile(call, fan, { displayName: 'Nome Um', bio: 'Um' })).status).toBe(200);
    expect(await dayCounts(fan.uid, start)).toMatchObject({ profile_save: 2, name_change: 1 });
    expect((await read(`users/${fan.uid}`))!).toMatchObject({ displayName: 'Nome Um', bio: 'Um' });

    clock.now = nextDayStart(start);
    expect((await putProfile(call, fan, { displayName: 'Nome Dois' })).status).toBe(200);
    expect(await dayCounts(fan.uid, clock.now)).toMatchObject({ profile_save: 1, name_change: 1 });
  });

  it('os tetos contam o nome de null para um nome (name_change) e o @ sozinho (profile_save), como a decisão 9', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    // O perfil sem nome (a gravação do cadastro não aconteceu): o ✓ manda o nome da sessão.
    await db.doc(`users/${fan.uid}`).update({ displayName: null });
    const start = Date.parse('2026-10-08T15:00:00.000Z');
    const { call } = clockApi(start, { profileCap: 3, nameCap: 1 });

    expect((await putProfile(call, fan, { displayName: 'Camila Ribeiro' })).status).toBe(200);
    expect(await dayCounts(fan.uid, start)).toMatchObject({ profile_save: 1, name_change: 1 });
    expect(await putProfile(call, fan, { displayName: 'Camila Nova' })).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 1, action: 'name' } },
    });

    // O @ sozinho grava e conta no profile_save, e não no name_change.
    const chosen = unique('soarroba');
    expect((await putProfile(call, fan, { username: chosen })).body).toMatchObject({
      username: chosen,
    });
    expect(await dayCounts(fan.uid, start)).toMatchObject({ profile_save: 2, name_change: 1 });
  });

  it('no teto do dia, o @ de outro fã é 429, e não 409: os tetos vêm antes de ler as reservas', async () => {
    // Uma fã sem prazo do @ correndo (senão o 409 do prazo, que vem antes dos tetos, responderia).
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const other = await signUpFan(db, 'Alan Ferreira');
    const otherAt = (await read(`users/${other.uid}`))!.username as string;
    const start = Date.parse('2026-10-08T15:00:00.000Z');
    const { clock, call } = clockApi(start, { profileCap: 1 });

    expect((await putProfile(call, fan, { bio: 'Um' })).status).toBe(200);
    expect(await putProfile(call, fan, { username: otherAt, bio: 'Dois' })).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 1, action: 'profile' } },
    });
    // No dia seguinte, abaixo do teto, o mesmo pedido é o 409 de sempre.
    clock.now = nextDayStart(start);
    expect(await putProfile(call, fan, { username: otherAt, bio: 'Dois' })).toMatchObject({
      status: 409,
      body: { code: 'username_taken' },
    });
    expect((await read(`users/${fan.uid}`))!.bio).toBe('Um');
  });

  it('duas edições do mesmo fã em paralelo, com chaves diferentes: as duas redes ficam e o dia conta 2', async () => {
    // A transação que perde roda de novo com o perfil novo (28.4): o socials é gravado inteiro,
    // e um retrato lido fora dela apagaria a rede da outra.
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const start = Date.now();
    const { call } = clockApi(start);

    const [instagram, x] = await Promise.all([
      putProfile(call, fan, { socials: { instagram: 'a.teste.up' } }),
      putProfile(call, fan, { socials: { x: 'bteste' } }),
    ]);
    expect([instagram.status, x.status]).toEqual([200, 200]);
    expect((await read(`users/${fan.uid}`))!.socials).toEqual({
      ...NO_SOCIALS,
      instagram: 'a.teste.up',
      x: 'bteste',
    });
    expect((await dayCounts(fan.uid, start)).profile_save).toBe(2);
  });

  it('a troca de nome pela api de verdade chega às cópias dos comentários pela fila; a da bio não põe tarefa', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const artist = await central(env);
    const postId = await post(env, artist);
    const commented = await http(env, `/posts/${postId}/comments`, {
      method: 'POST',
      token: fan.token,
      key: unique('chave-comentario-'),
      body: { text: 'Que show!' },
    });
    expect(commented.status).toBe(200);
    const commentPath = `posts/${postId}/postComments/${String(commented.body.id)}`;

    const renamed = await http(env, '/me/profile', {
      method: 'PUT',
      token: fan.token,
      key: unique('chave-perfil-'),
      body: { displayName: 'Camila Nova' },
    });
    expect(renamed.status).toBe(200);
    await waitFor(
      'o nome novo na cópia do comentário',
      async () => (await read(commentPath))?.authorName === 'Camila Nova',
    );

    // Outro fã, só a bio e as redes: o orçamento da fila não nasce.
    const other = await signUpFan(db, 'Bia Santos');
    const bio = await http(env, '/me/profile', {
      method: 'PUT',
      token: other.token,
      key: unique('chave-perfil-'),
      body: { bio: 'Salvador.', socials: { instagram: 'bia.teste.up' }, privateAccount: true },
    });
    expect(bio.status).toBe(200);
    await sleep(3_000);
    expect(await exists(`users/${other.uid}/profileSync/budget`)).toBe(false);
  });

  it('a mesma chave repetida devolve a resposta guardada (a api de verdade)', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const key = unique('chave-perfil-repetida-');
    const body = { bio: 'Feira de Santana.', gender: 'woman' };
    const first = await http(env, '/me/profile', { method: 'PUT', token: fan.token, key, body });
    expect(first.status).toBe(200);
    const again = await http(env, '/me/profile', { method: 'PUT', token: fan.token, key, body });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('o suspenso recebe 403 sem gravar; sem perfil, 503; a conta só da equipe, 403', async () => {
    const fan = await signUpFan(db, 'Promo Seguidores');
    await db
      .doc(`users/${fan.uid}`)
      .update({ suspendedAt: Timestamp.now(), suspensionReason: 'spam' });
    const { call } = clockApi(Date.now());
    expect(await putProfile(call, fan, { privateAccount: true, bio: null })).toEqual({
      status: 403,
      body: {
        code: 'account_suspended',
        message: 'Sua conta está suspensa. Fale com a equipe do ImagineUP.',
      },
    });
    expect((await read(`users/${fan.uid}`))!.privateAccount).toBeUndefined();

    const gone = await signUpFan(db, 'Sem Perfil');
    await db.doc(`users/${gone.uid}`).delete();
    expect((await putProfile(call, gone, { bio: 'Oi' })).body).toMatchObject({
      code: 'profile_not_ready',
    });
    expect(await exists(`users/${gone.uid}`)).toBe(false);

    const staff = await seedMember(env, 'Equipe', 'admin');
    const asStaff = await call('PUT', '/me/profile', {
      token: staff.token,
      key: unique('chave-equipe-'),
      body: { bio: 'Oi' },
    });
    expect(asStaff).toMatchObject({ status: 403, body: { code: 'not_fan' } });
  });
});

describe('perfil novo: GET /fans/:fanId', () => {
  const THALITA = SEED_FAN_DETAILS.find((details) => details.email === 'rank-01@teste.imagineup')!;

  /** A Thalita do seed: bio, gênero, as quatro redes e a cidade (que nunca sai). */
  async function thalita(): Promise<Fan> {
    const fan = await signUpFan(db, 'Thalita Santos');
    expect(await seedFanDetails(db, fan.uid, seedFanDetailsChanges(THALITA))).toBe('written');
    await db.doc(`users/${fan.uid}`).update({ city: 'Irará, BA' });
    return fan;
  }

  const getFan = (call: ReturnType<typeof localApi>, viewer: Fan, fanId: string) =>
    call('GET', `/fans/${fanId}`, { token: viewer.token });

  it('a completa pela api de verdade: foto, nome, @, bio e redes; nunca o gênero, a cidade nem a privada', async () => {
    const target = await thalita();
    const viewer = await signUpFan(db, 'Camila Ribeiro');
    const username = (await read(`users/${target.uid}`))!.username;
    const result = await http(env, `/fans/${target.uid}`, { token: viewer.token });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      uid: target.uid,
      displayName: 'Thalita Santos',
      username,
      photoURL: null,
      restricted: false,
      bio: THALITA.bio,
      socials: {
        instagram: 'thalita.teste.up',
        tiktok: 'thalita.teste.up',
        linkedin: 'thalita-teste-imagineup',
        x: 'thalitatesteup',
      },
    });
    // Só lê: sem chave e sem exigir o perfil de quem pede (a conta só da equipe também lê).
    const staff = await seedMember(env, 'Equipe', 'admin');
    expect((await http(env, `/fans/${target.uid}`, { token: staff.token })).status).toBe(200);
  });

  it('fechada na conta privada, na suspensa e para quem o alvo bloqueou, com o mesmo corpo', async () => {
    const target = await thalita();
    const viewer = await signUpFan(db, 'Camila Ribeiro');
    const call = localApi(env, { now: () => Date.now() });
    const username = (await read(`users/${target.uid}`))!.username;
    const closed = {
      uid: target.uid,
      displayName: 'Thalita Santos',
      username,
      photoURL: null,
      restricted: true,
      bio: null,
      socials: null,
    };

    await db.doc(`users/${target.uid}`).update({ privateAccount: true });
    const asPrivate = await getFan(call, viewer, target.uid);
    expect(asPrivate).toEqual({ status: 200, body: closed });

    await db
      .doc(`users/${target.uid}`)
      .update({ privateAccount: false, suspendedAt: Timestamp.now() });
    const asSuspended = await getFan(call, viewer, target.uid);
    expect(asSuspended.body).toEqual(asPrivate.body);

    await db.doc(`users/${target.uid}`).update({ suspendedAt: null });
    expect((await getFan(call, viewer, target.uid)).body).toMatchObject({ restricted: false });
    const blocked = await call('PUT', `/me/blocks/${viewer.uid}`, {
      token: target.token,
      key: unique('chave-bloqueio-'),
    });
    expect(blocked.status).toBe(200);
    const asBlocked = await getFan(call, viewer, target.uid);
    // O bloqueado não fica sabendo: o corpo é o mesmo da conta privada.
    expect(asBlocked.body).toEqual(asPrivate.body);
    // Um terceiro, que não foi bloqueado, segue vendo a completa.
    const third = await signUpFan(db, 'Bia Santos');
    expect((await getFan(call, third, target.uid)).body).toMatchObject({ restricted: false });
  });

  it('quem bloqueou o alvo vê a completa; o próprio fã vê a completa mesmo com a privada', async () => {
    const target = await thalita();
    const viewer = await signUpFan(db, 'Camila Ribeiro');
    const call = localApi(env, { now: () => Date.now() });
    expect(
      (
        await call('PUT', `/me/blocks/${target.uid}`, {
          token: viewer.token,
          key: unique('chave-bloqueio-'),
        })
      ).status,
    ).toBe(200);
    expect((await getFan(call, viewer, target.uid)).body).toMatchObject({
      restricted: false,
      bio: THALITA.bio,
    });

    await db.doc(`users/${target.uid}`).update({ privateAccount: true });
    expect((await getFan(call, target, target.uid)).body).toMatchObject({
      restricted: false,
      bio: THALITA.bio,
    });
  });

  it('404 sem perfil, para a conta só da equipe e para o id fora do formato', async () => {
    const viewer = await signUpFan(db, 'Camila Ribeiro');
    const gone = await signUpFan(db, 'Sem Perfil');
    await db.doc(`users/${gone.uid}`).delete();
    const staff = await seedMember(env, 'Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    for (const fanId of [gone.uid, staff.uid, 'naoExiste1', 'fa-rank-01']) {
      expect(await getFan(call, viewer, fanId)).toEqual({
        status: 404,
        body: { code: 'fan_not_found', message: 'Fã não encontrado.' },
      });
    }
  });

  it('a rede gravada fora do padrão (pelo Admin SDK) não sai; só ela, as outras seguem', async () => {
    const target = await thalita();
    const viewer = await signUpFan(db, 'Camila Ribeiro');
    const call = localApi(env, { now: () => Date.now() });
    await db.doc(`users/${target.uid}`).update({
      socials: {
        instagram: 'https://golpe.example/thalita',
        tiktok: 'Thalita Teste',
        linkedin: null,
        x: 'thalitatesteup',
        facebook: 'thalita',
      },
    });
    expect((await getFan(call, viewer, target.uid)).body).toMatchObject({
      restricted: false,
      socials: { instagram: null, tiktok: null, linkedin: null, x: 'thalitatesteup' },
    });
    await db.doc(`users/${target.uid}`).update({ socials: { instagram: 'Fora Do Padrão' } });
    expect((await getFan(call, viewer, target.uid)).body).toMatchObject({ socials: null });
  });
});

describe('seed do perfil novo (28.10)', () => {
  it('o seedFanDetails grava pelo runAsFan com o ator de sistema; a segunda vez não grava (o plano vazio)', async () => {
    const fan = await signUpFan(db, 'Aline Ferreira');
    const aline = SEED_FAN_DETAILS.find((details) => details.email === 'rank-05@teste.imagineup')!;
    expect(await seedFanDetails(db, fan.uid, seedFanDetailsChanges(aline))).toBe('written');
    const first = await db.doc(`users/${fan.uid}`).get();
    expect(first.data()).toMatchObject({
      bio: aline.bio,
      gender: 'undisclosed',
      privateAccount: true,
      socials: { instagram: 'aline.teste.up', tiktok: null, linkedin: null, x: 'alinetesteup' },
    });
    expect(first.get('updatedAt')).toBeUndefined();
    // O ator de sistema não conta no teto do dia, e o plano vazio não grava a carteira.
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);

    expect(await seedFanDetails(db, fan.uid, seedFanDetailsChanges(aline))).toBe('unchanged');
    const second = await db.doc(`users/${fan.uid}`).get();
    expect(second.updateTime!.isEqual(first.updateTime!)).toBe(true);
    // O corpo fora da regra é recusado como na rota.
    await expect(seedFanDetails(db, fan.uid, { bio: 'x'.repeat(201) })).rejects.toMatchObject({
      reason: 'profile_invalid',
    });
  });
});
