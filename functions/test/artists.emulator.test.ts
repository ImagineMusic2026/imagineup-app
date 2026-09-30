import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SECTION_IDS } from '../src/staff/model';
import { createProfile } from '../src/store';

/**
 * Artistas e centrais nos emuladores: as callables de verdade, chamadas como
 * o painel chama (POST com { data } e o ID token), com as fotos no emulador do
 * Storage. Rode com `npm run test:functions`, na raiz do app.
 */
const PROJECT_ID = 'demo-imagine-up-app';
const REGION = 'southamerica-east1';
// Bucket padrão do projeto demo no emulador (o FIREBASE_CONFIG das funções).
const BUCKET = `${PROJECT_ID}.appspot.com`;
const app = initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET }, 'artistas');
const auth = getAuth(app);
const db = getFirestore(app);
const bucket = getStorage(app).bucket(BUCKET);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let functionsOrigin = '';

const ARTIST_FUNCTIONS = [
  'checkArtistHandle',
  'createArtist',
  'updateArtist',
  'setArtistStatus',
  'reorderArtists',
  'deleteArtist',
];

beforeAll(async () => {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub || !process.env.STORAGE_EMULATOR_HOST)
    throw new Error('Rode com npm run test:functions.');
  const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
    functions?: { host: string; port: number };
    storage?: unknown;
  };
  if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
  if (!emulators.storage) throw new Error('O emulador de Storage não está rodando.');
  const { host, port } = emulators.functions;
  functionsOrigin = `http://${host}:${port}`;
  const { backends } = (await (await fetch(`${functionsOrigin}/backends`)).json()) as {
    backends: { functionTriggers: { entryPoint: string }[] }[];
  };
  const loaded = backends.flatMap((backend) => backend.functionTriggers.map((t) => t.entryPoint));
  const missing = ['createUserProfile', ...ARTIST_FUNCTIONS].filter(
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

// Ids, @ e e-mails únicos na execução inteira: o Storage não é limpo entre os
// testes, e um gatilho atrasado nunca acerta os dados do teste seguinte.
let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}`;
const newHandle = () => unique('trio_');

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

// artists/{id}: só o que o app mostra (o fã logado lê o documento inteiro).
const PUBLIC_FIELDS = [
  'bio',
  'city',
  'createdAt',
  'fanCount',
  'genre',
  'handle',
  'name',
  'order',
  'photo',
  'publishedAt',
  'shortName',
  'status',
  'thumb',
  'updatedAt',
  'verified',
];
// artistPrivate/{id}: o que só a equipe com a seção artists vê.
const PRIVATE_FIELDS = [
  'createdBy',
  'email',
  'imageRightsConfirmed',
  'managerName',
  'managerUid',
  'phone',
  'updatedAt',
  'updatedBy',
];
const STAFF_ONLY_FIELDS = PRIVATE_FIELDS.filter((field) => field !== 'updatedAt');

/**
 * Lê um documento pela API REST do Firestore com o ID token, como o SDK do app
 * e do painel: passa pelo firestore.rules (o Admin SDK dos testes não passa).
 */
async function readWithRules(
  idToken: string,
  path: string,
): Promise<{ status: number; fields: string[] }> {
  const response = await fetch(
    `http://${firestoreHost}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  const body = (await response.json()) as { fields?: Record<string, unknown> };
  return { status: response.status, fields: Object.keys(body.fields ?? {}).sort() };
}

async function auditOf(action: string): Promise<DocumentData[]> {
  const entries = await db.collection('staffAudit').where('action', '==', action).get();
  return entries.docs.map((doc) => doc.data());
}

/** Entra pela API do Auth, como o SDK do painel, e devolve o ID token. */
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

type CallError = { status: string; message: string; details?: { reason?: string } };
type CallResponse<T> = { result?: T; error?: CallError };

/** Chama a callable como o SDK do painel: POST { data } com o ID token. */
async function call<T>(name: string, data: unknown, idToken?: string): Promise<CallResponse<T>> {
  const response = await fetch(`${functionsOrigin}/${PROJECT_ID}/${REGION}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return (await response.json()) as CallResponse<T>;
}

async function ok<T = Record<string, unknown>>(
  name: string,
  data: unknown,
  idToken?: string,
): Promise<T> {
  const { result, error } = await call<T>(name, data, idToken);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function fails(name: string, data: unknown, idToken?: string): Promise<CallError> {
  const { error } = await call(name, data, idToken);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error;
}

const reason = (status: string, why: string) => ({ status, details: { reason: why } });

type Member = { uid: string; email: string; password: string; token: string };

/** Claims do ID token (o emulador não assina, mas o formato é o de sempre). */
function authTimeOf(idToken: string): number {
  return JSON.parse(Buffer.from(idToken.split('.')[1]!, 'base64url').toString('utf8')).auth_time;
}

/**
 * Membro gravado direto, como o aceite do convite deixaria: a marca em
 * staff/{uid} vem antes da conta, então o gatilho não cria perfil de fã.
 */
async function seedMember(
  displayName: string,
  role: 'admin' | 'editor' | 'viewer',
  sections: string[] = [],
): Promise<Member> {
  const uid = unique(role);
  const email = `${uid}@teste.dev`;
  const password = 'senha-da-equipe';
  const now = Timestamp.now();
  await db.doc(`staff/${uid}`).set({
    uid,
    email,
    displayName,
    role,
    sections: role === 'admin' ? [...SECTION_IDS] : sections,
    status: 'active',
    accountCreatedByInvite: true,
    inviteId: 'semente',
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  await auth.createUser({ uid, email, password, displayName, emailVerified: true });
  return { uid, email, password, token: await signIn(email, password) };
}

/** Fã que se cadastra pelo app e ganha o perfil (e o @) pelo gatilho. */
async function signUpFan(displayName: string): Promise<Member & { username: string }> {
  const email = `${unique('fa')}@teste.dev`;
  const password = 'senha-do-fa-1';
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    },
  );
  const { localId, idToken } = (await response.json()) as { localId: string; idToken: string };
  const deadline = Date.now() + 30_000;
  for (;;) {
    const profile = await read(`users/${localId}`);
    if (profile) {
      return { uid: localId, email, password, token: idToken, username: profile.username };
    }
    if (Date.now() > deadline) throw new Error('O perfil do fã não apareceu.');
    await sleep(200);
  }
}

/** Central mínima, como o painel manda ao salvar o rascunho. */
const draft = (handle: string, extra: Record<string, unknown> = {}) => ({
  handle,
  name: `Central ${handle}`,
  verified: false,
  imageRightsConfirmed: false,
  ...extra,
});

async function createArtist(member: Member, extra: Record<string, unknown> = {}): Promise<string> {
  const handle = newHandle();
  const { artistId } = await ok<{ artistId: string }>(
    'createArtist',
    draft(handle, extra),
    member.token,
  );
  return artistId;
}

/** Arquivo no Storage como o painel sobe (tipo, cache e largura e altura no metadado). */
async function uploadFile(
  path: string,
  options: { contentType?: string; width?: number; height?: number } = {},
): Promise<Buffer> {
  const content = Buffer.from(`foto de teste ${path}`);
  const custom =
    options.width === undefined
      ? undefined
      : { width: String(options.width), height: String(options.height) };
  await bucket.file(path).save(content, {
    resumable: false,
    contentType: options.contentType ?? 'image/webp',
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      ...(custom ? { metadata: custom } : {}),
    },
  });
  return content;
}

/** As duas versões da foto de uma central, com o nome novo de cada envio. */
async function uploadPhotos(artistId: string): Promise<{ photoPath: string; thumbPath: string }> {
  const stamp = unique('');
  const photoPath = `artists/${artistId}/photo-${stamp}-1200.webp`;
  const thumbPath = `artists/${artistId}/thumb-${stamp}-480.webp`;
  await uploadFile(photoPath, { width: 1200, height: 1600 });
  await uploadFile(thumbPath, { width: 480, height: 640 });
  return { photoPath, thumbPath };
}

async function fileExists(path: string): Promise<boolean> {
  const [found] = await bucket.file(path).exists();
  return found;
}

/** Central pronta para publicar: fotos e autorização de imagem. */
async function readyArtist(member: Member): Promise<string> {
  const artistId = await createArtist(member, { imageRightsConfirmed: true });
  await ok('updateArtist', { artistId, photo: await uploadPhotos(artistId) }, member.token);
  return artistId;
}

describe('criar central (createArtist)', () => {
  it('cria o rascunho: @ reservado sem uid, parte da equipe em artistPrivate, fim da ordem e auditoria', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const manager = await seedMember('Gestora', 'editor', ['artists']);
    const handle = newHandle();

    const result = await ok(
      'createArtist',
      {
        handle,
        name: '  Trio Bem Bahia ',
        shortName: 'Trio Bem',
        genre: 'Axé',
        city: 'Salvador, BA',
        bio: 'Primeira linha\r\n\r\n\r\nSegunda linha',
        verified: true,
        managerUid: manager.uid,
        imageRightsConfirmed: false,
        contactEmail: 'Contato@TrioBem.COM',
        contactPhone: '+55 (71) 99876-5432',
      },
      admin.token,
    );
    expect(result).toEqual({ artistId: handle });

    const artist = await read(`artists/${handle}`);
    expect(artist).toMatchObject({
      handle,
      name: 'Trio Bem Bahia',
      shortName: 'Trio Bem',
      genre: 'Axé',
      city: 'Salvador, BA',
      bio: 'Primeira linha\n\nSegunda linha',
      verified: true,
      photo: null,
      thumb: null,
      order: 0,
      status: 'draft',
      fanCount: 0,
      publishedAt: null,
    });
    expect(artist!.createdAt).toBeInstanceOf(Timestamp);
    // Contato, gestor, autorização e autoria ficam fora do doc que o fã lê.
    expect(Object.keys(artist!).sort()).toEqual(PUBLIC_FIELDS);
    const internal = await read(`artistPrivate/${handle}`);
    expect(internal).toEqual({
      email: 'contato@triobem.com',
      phone: '+5571998765432',
      managerUid: manager.uid,
      managerName: 'Gestora',
      imageRightsConfirmed: false,
      createdBy: admin.uid,
      updatedBy: admin.uid,
      updatedAt: artist!.createdAt,
    });
    const reservation = await read(`usernames/${handle}`);
    expect(reservation).toMatchObject({ artistId: handle });
    expect(reservation).not.toHaveProperty('uid');

    const [entry, ...others] = await auditOf('artist.created');
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      actorUid: admin.uid,
      actorName: 'Admin Um',
      targetEmail: '',
      targetUid: null,
      details: { artistId: handle, name: 'Trio Bem Bahia' },
    });

    // A editora com a seção também cria, e a central nova vai para o fim.
    const second = await createArtist(manager);
    expect(await read(`artists/${second}`)).toMatchObject({ order: 1 });
    expect(await read(`artistPrivate/${second}`)).toMatchObject({
      email: null,
      phone: null,
      managerUid: null,
      managerName: null,
      imageRightsConfirmed: false,
      createdBy: manager.uid,
      updatedBy: manager.uid,
    });
  });

  it('@ de fã, de outra central, reservado ou fora do formato: recusado, e o checkArtistHandle diz por quê', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const fan = await signUpFan('Camila Ribeiro');
    const taken = await createArtist(admin);
    const artistsBefore = (await db.collection('artists').get()).size;

    const cases: [string, string, string, string][] = [
      [fan.username, 'ALREADY_EXISTS', 'handle-taken', 'taken'],
      [taken, 'ALREADY_EXISTS', 'handle-taken', 'taken'],
      ['imagine', 'ALREADY_EXISTS', 'handle-reserved', 'reserved'],
      ['contato', 'ALREADY_EXISTS', 'handle-reserved', 'reserved'],
      ['Trio Bem', 'INVALID_ARGUMENT', 'invalid-handle', 'invalid'],
      ['ab', 'INVALID_ARGUMENT', 'invalid-handle', 'invalid'],
      // Cabe no formato, mas o Firestore reserva ids __.*__: nem chega ao banco.
      ['__trio__', 'INVALID_ARGUMENT', 'invalid-handle', 'invalid'],
      ['____', 'INVALID_ARGUMENT', 'invalid-handle', 'invalid'],
    ];
    for (const [handle, status, why, checkReason] of cases) {
      expect(await fails('createArtist', draft(handle), admin.token)).toMatchObject(
        reason(status, why),
      );
      expect(await ok('checkArtistHandle', { handle }, admin.token)).toEqual({
        available: false,
        reason: checkReason,
      });
    }
    expect(await ok('checkArtistHandle', { handle: newHandle() }, admin.token)).toEqual({
      available: true,
      reason: null,
    });
    expect((await db.collection('artists').get()).size).toBe(artistsBefore);
    // A reserva da fã continua dela.
    expect(await read(`usernames/${fan.username}`)).toMatchObject({ uid: fan.uid });
  });

  it('gestor precisa ser da equipe ativa', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const disabled = await seedMember('Desativada', 'editor', ['artists']);
    await db.doc(`staff/${disabled.uid}`).update({ status: 'disabled' });
    const fan = await signUpFan('Camila Ribeiro');
    for (const managerUid of [fan.uid, disabled.uid, 'ninguem', 'a/b']) {
      expect(
        await fails('createArtist', draft(newHandle(), { managerUid }), admin.token),
      ).toMatchObject(reason('INVALID_ARGUMENT', 'invalid-manager'));
    }
    expect((await db.collection('artists').get()).size).toBe(0);
    expect((await db.collection('artistPrivate').get()).size).toBe(0);
    expect((await db.collection('usernames').where('artistId', '!=', null).get()).size).toBe(0);
  });

  it('pedido inválido volta com o motivo, sem gravar nada', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const cases: [unknown, string][] = [
      ['texto', 'invalid-request'],
      [draft(newHandle(), { name: '' }), 'invalid-name'],
      [draft(newHandle(), { name: 'Duas\nlinhas' }), 'invalid-name'],
      [draft(newHandle(), { shortName: 'x'.repeat(21) }), 'invalid-short-name'],
      [draft(newHandle(), { genre: 'Rock' }), 'invalid-genre'],
      [draft(newHandle(), { city: '\u200B' }), 'invalid-city'],
      [draft(newHandle(), { bio: 'x'.repeat(501) }), 'invalid-bio'],
      [draft(newHandle(), { contactEmail: 'contato' }), 'invalid-email'],
      [draft(newHandle(), { contactPhone: '9876-5432' }), 'invalid-phone'],
      [draft(newHandle(), { verified: 'sim' }), 'invalid-request'],
      [{ handle: newHandle(), name: 'Sem marcas' }, 'invalid-request'],
    ];
    for (const [data, why] of cases) {
      expect(await fails('createArtist', data, admin.token)).toMatchObject(
        reason('INVALID_ARGUMENT', why),
      );
    }
    expect((await db.collection('artists').get()).size).toBe(0);
  });

  it('dois pedidos com o mesmo @ ao mesmo tempo: uma central só', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const editor = await seedMember('Editora', 'editor', ['artists']);
    const handle = newHandle();
    const results = await Promise.all([
      call('createArtist', draft(handle, { name: 'Primeira' }), admin.token),
      call('createArtist', draft(handle, { name: 'Segunda' }), editor.token),
    ]);
    const succeeded = results.filter((result) => result.result);
    const failed = results.filter((result) => result.error);
    expect(succeeded).toHaveLength(1);
    expect(failed.map((result) => result.error)).toMatchObject([
      reason('ALREADY_EXISTS', 'handle-taken'),
    ]);
    expect((await db.collection('artists').get()).size).toBe(1);
    expect((await db.collection('artistPrivate').get()).size).toBe(1);
    expect(await read(`usernames/${handle}`)).toMatchObject({ artistId: handle });
    expect(await auditOf('artist.created')).toHaveLength(1);
  });

  it('fã com o nome de um @ reservado das centrais não fica com ele', async () => {
    for (const name of ['Contato', 'Ajuda']) {
      const fan = await signUpFan(name);
      expect(fan.username).toMatch(/^fa\d+$/);
      expect(await exists(`usernames/${name.toLowerCase()}`)).toBe(false);
    }
  });

  it('o gerador de @ dos fãs pula o @ de uma central', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    await ok('createArtist', draft('camilarib'), admin.token);
    const fan = await signUpFan('Camila Ribeiro');
    expect(fan.username).not.toBe('camilarib');
    expect(fan.username).toMatch(/^camilarib\d+$/);
    expect(await read('usernames/camilarib')).toMatchObject({ artistId: 'camilarib' });
  });

  it('@ de fã gerado ao mesmo tempo que a central: o @ fica com um só', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    // O gerador de @ tenta primeiro a base pura: "Trio Bem" vira triobem. A fã
    // sai com atrasos diferentes, para a corrida cair ora de um lado, ora do outro.
    for (const [displayName, handle, delayMs] of [
      ['Trio Bem', 'triobem', 0],
      ['Duo Luz', 'duoluz', 60],
      ['Banda Mar', 'bandamar', 150],
      ['Sol Lua', 'sollua', 400],
    ] as const) {
      const fanUid = unique('fa-corrida');
      const [profile, central] = await Promise.all([
        sleep(delayMs).then(() => createProfile(db, { uid: fanUid, displayName })),
        call('createArtist', draft(handle), admin.token),
      ]);
      const username = profile.status === 'created' ? profile.username : undefined;
      const reservation = await read(`usernames/${handle}`);
      if (central.result) {
        expect(reservation).toMatchObject({ artistId: handle });
        expect(username).not.toBe(handle);
        expect(await exists(`artists/${handle}`)).toBe(true);
      } else {
        expect(central.error).toMatchObject(reason('ALREADY_EXISTS', 'handle-taken'));
        expect(reservation).toMatchObject({ uid: fanUid });
        expect(username).toBe(handle);
        expect(await exists(`artists/${handle}`)).toBe(false);
      }
      expect(await read(`usernames/${username}`)).toMatchObject({ uid: fanUid });
    }
  });
});

describe('editar a central (updateArtist)', () => {
  it('campo ausente não muda, null limpa, e pedido sem mudança não grava nem audita', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const manager = await seedMember('Gestora', 'viewer', ['artists']);
    const artistId = await createArtist(admin, {
      shortName: 'Trio',
      genre: 'Axé',
      city: 'Salvador, BA',
      contactEmail: 'contato@trio.com',
      contactPhone: '71998765432',
    });
    const before = await read(`artists/${artistId}`);
    const editor = await seedMember('Editora', 'editor', ['artists']);

    await ok(
      'updateArtist',
      { artistId, city: null, genre: 'Piseiro', contactPhone: null, managerUid: manager.uid },
      editor.token,
    );
    const after = await read(`artists/${artistId}`);
    expect(after).toMatchObject({
      name: before!.name,
      shortName: 'Trio',
      genre: 'Piseiro',
      city: null,
    });
    expect(Object.keys(after!).sort()).toEqual(PUBLIC_FIELDS);
    expect(after!.updatedAt).not.toEqual(before!.updatedAt);
    const internalAfter = await read(`artistPrivate/${artistId}`);
    expect(internalAfter).toMatchObject({
      email: 'contato@trio.com',
      phone: null,
      managerUid: manager.uid,
      managerName: 'Gestora',
      createdBy: admin.uid,
      updatedBy: editor.uid,
    });
    // Os dois mudaram: updatedAt nos dois.
    expect(internalAfter!.updatedAt).toEqual(after!.updatedAt);
    const [entry] = await auditOf('artist.updated');
    expect(entry).toMatchObject({
      actorUid: editor.uid,
      targetEmail: '',
      targetUid: null,
      details: { artistId, changed: ['genre', 'city', 'managerUid', 'contactPhone'] },
    });
    // O contato não vai para a auditoria, que outra seção lê.
    expect(JSON.stringify(entry)).not.toContain('contato@trio.com');

    // Os mesmos valores de novo: nada muda, nem o updatedAt.
    await ok(
      'updateArtist',
      { artistId, city: '', genre: 'Piseiro', managerUid: manager.uid, contactPhone: '' },
      admin.token,
    );
    expect(await read(`artists/${artistId}`)).toEqual(after);
    expect(await read(`artistPrivate/${artistId}`)).toEqual(internalAfter);
    expect(await auditOf('artist.updated')).toHaveLength(1);

    // Só a parte da equipe: artists/ fica como estava (nem o updatedAt muda).
    await ok('updateArtist', { artistId, managerUid: null }, admin.token);
    expect(await read(`artists/${artistId}`)).toEqual(after);
    const onlyPrivate = await read(`artistPrivate/${artistId}`);
    expect(onlyPrivate).toMatchObject({
      managerUid: null,
      managerName: null,
      email: 'contato@trio.com',
      updatedBy: admin.uid,
    });
    expect(onlyPrivate!.updatedAt).not.toEqual(internalAfter!.updatedAt);

    // Só o que o app mostra: artists/ ganha o updatedAt e quem mexeu vai para
    // o artistPrivate/, sem apagar o resto dele.
    await ok('updateArtist', { artistId, name: 'Trio Novo' }, editor.token);
    const renamed = await read(`artists/${artistId}`);
    expect(renamed).toMatchObject({ name: 'Trio Novo' });
    expect(Object.keys(renamed!).sort()).toEqual(PUBLIC_FIELDS);
    expect(await read(`artistPrivate/${artistId}`)).toEqual({
      ...onlyPrivate,
      updatedBy: editor.uid,
      updatedAt: renamed!.updatedAt,
    });
    expect((await auditOf('artist.updated')).map((item) => item.details.changed)).toEqual(
      expect.arrayContaining([['managerUid'], ['name']]),
    );
  });

  it('fotos: caminhos da própria central, com o tamanho do upload e URL de download', async () => {
    const editor = await seedMember('Editora', 'editor', ['artists']);
    const artistId = await createArtist(editor);
    const photoPath = `artists/${artistId}/photo-${unique('')}-1200.webp`;
    const thumbPath = `artists/${artistId}/thumb-${unique('')}-480.jpg`;
    const photoBytes = await uploadFile(photoPath, { width: 1200, height: 1600 });
    // Sem largura e altura no metadado: fica o tamanho padrão da miniatura.
    await uploadFile(thumbPath, { contentType: 'image/jpeg' });

    await ok('updateArtist', { artistId, photo: { photoPath, thumbPath } }, editor.token);
    const artist = await read(`artists/${artistId}`);
    expect(artist!.photo).toMatchObject({ path: photoPath, width: 1200, height: 1600 });
    expect(artist!.thumb).toMatchObject({ path: thumbPath, width: 480, height: 640 });
    const url = new URL(artist!.photo.url);
    expect(url.pathname).toBe(`/v0/b/${BUCKET}/o/${encodeURIComponent(photoPath)}`);
    expect(url.searchParams.get('alt')).toBe('media');
    expect(url.searchParams.get('token')).toBeTruthy();
    // A URL baixa a foto, sem login.
    const download = await fetch(artist!.photo.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(photoBytes);
    expect((await auditOf('artist.updated'))[0]).toMatchObject({
      details: { artistId, changed: ['photo'] },
    });

    // Foto nova: nome novo, e os arquivos antigos ficam (cache dos aparelhos).
    const next = await uploadPhotos(artistId);
    await ok('updateArtist', { artistId, photo: next }, editor.token);
    expect((await read(`artists/${artistId}`))!.photo.path).toBe(next.photoPath);
    expect(await fileExists(photoPath)).toBe(true);
    expect(await fileExists(thumbPath)).toBe(true);
  });

  it('foto de outra central, que não existe ou que não é imagem: recusada', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await createArtist(admin);
    const other = await createArtist(admin);
    const otherPhotos = await uploadPhotos(other);
    const own = await uploadPhotos(artistId);
    const textPath = `artists/${artistId}/photo-${unique('')}-1200.webp`;
    await uploadFile(textPath, { contentType: 'text/plain' });

    const cases: [unknown, string, string][] = [
      [otherPhotos, 'INVALID_ARGUMENT', 'invalid-photo'],
      [
        { photoPath: own.photoPath, thumbPath: otherPhotos.thumbPath },
        'INVALID_ARGUMENT',
        'invalid-photo',
      ],
      [
        { photoPath: `artists/${artistId}/sub/x.webp`, thumbPath: own.thumbPath },
        'INVALID_ARGUMENT',
        'invalid-photo',
      ],
      [{ photoPath: own.photoPath }, 'INVALID_ARGUMENT', 'invalid-photo'],
      [
        { photoPath: `artists/${artistId}/nao-subiu.webp`, thumbPath: own.thumbPath },
        'NOT_FOUND',
        'photo-not-found',
      ],
      [{ photoPath: textPath, thumbPath: own.thumbPath }, 'INVALID_ARGUMENT', 'invalid-photo'],
    ];
    for (const [photo, status, why] of cases) {
      expect(await fails('updateArtist', { artistId, photo }, admin.token)).toMatchObject(
        reason(status, why),
      );
    }
    expect(await read(`artists/${artistId}`)).toMatchObject({ photo: null, thumb: null });
    expect(await auditOf('artist.updated')).toHaveLength(0);
    expect(
      await fails('updateArtist', { artistId: 'nao_existe', name: 'X' }, admin.token),
    ).toMatchObject(reason('NOT_FOUND', 'artist-not-found'));
  });

  it('central no ar não perde a foto nem a autorização; fora do ar, perde', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await readyArtist(admin);
    await ok('setArtistStatus', { artistId, status: 'published' }, admin.token);

    expect(await fails('updateArtist', { artistId, photo: null }, admin.token)).toMatchObject(
      reason('FAILED_PRECONDITION', 'published-needs-photo'),
    );
    expect(
      await fails('updateArtist', { artistId, imageRightsConfirmed: false }, admin.token),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'published-needs-image-rights'));
    expect((await read(`artists/${artistId}`))!.photo).not.toBeNull();

    expect(await read(`artistPrivate/${artistId}`)).toMatchObject({ imageRightsConfirmed: true });

    await ok('setArtistStatus', { artistId, status: 'unpublished' }, admin.token);
    await ok('updateArtist', { artistId, photo: null, imageRightsConfirmed: false }, admin.token);
    expect(await read(`artists/${artistId}`)).toMatchObject({
      photo: null,
      thumb: null,
      status: 'unpublished',
    });
    expect(await read(`artistPrivate/${artistId}`)).toMatchObject({ imageRightsConfirmed: false });
  });

  it('gestor removido da equipe: as centrais dele ficam sem gestor, e a remoção lista quais', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const manager = await seedMember('Gestora', 'editor', ['artists']);
    const other = await seedMember('Outra Gestora', 'viewer', ['artists']);
    const first = await createArtist(admin, { managerUid: manager.uid });
    const second = await createArtist(admin, { managerUid: manager.uid });
    const kept = await createArtist(admin, {
      managerUid: other.uid,
      contactEmail: 'contato@kept.com',
    });
    const publicBefore = await read(`artists/${first}`);
    const before = await read(`artistPrivate/${first}`);
    const keptBefore = await read(`artistPrivate/${kept}`);

    await ok('removeStaffMember', { uid: manager.uid }, admin.token);
    expect(await exists(`staff/${manager.uid}`)).toBe(false);
    for (const artistId of [first, second]) {
      expect(await read(`artistPrivate/${artistId}`)).toMatchObject({
        managerUid: null,
        managerName: null,
        imageRightsConfirmed: false,
        createdBy: admin.uid,
        updatedBy: admin.uid,
      });
    }
    expect((await read(`artistPrivate/${first}`))!.updatedAt).not.toEqual(before!.updatedAt);
    // O gestor fica no artistPrivate/: o doc que o app mostra não muda.
    expect(await read(`artists/${first}`)).toEqual(publicBefore);
    // A central de outro gestor não muda.
    expect(await read(`artistPrivate/${kept}`)).toEqual(keptBefore);
    const [entry, ...others] = await auditOf('member.removed');
    expect(others).toEqual([]);
    expect([...entry!.details.managedArtistIds].sort()).toEqual([first, second].sort());

    // O uid removido não volta como gestor.
    expect(
      await fails('updateArtist', { artistId: first, managerUid: manager.uid }, admin.token),
    ).toMatchObject(reason('INVALID_ARGUMENT', 'invalid-manager'));

    // Quem não geria nada sai sem a lista na auditoria.
    await ok('removeStaffMember', { uid: other.uid }, admin.token);
    expect(await read(`artistPrivate/${kept}`)).toMatchObject({
      managerUid: null,
      managerName: null,
      email: 'contato@kept.com',
    });
    const removedWithout = await seedMember('Sem centrais', 'viewer', ['artists']);
    await ok('removeStaffMember', { uid: removedWithout.uid }, admin.token);
    const last = (await auditOf('member.removed')).find(
      (item) => item.targetUid === removedWithout.uid,
    );
    expect(last!.details).not.toHaveProperty('managedArtistIds');
  });
});

describe('publicar (setArtistStatus)', () => {
  it('publicar exige foto e autorização; publishedAt só na primeira vez', async () => {
    const editor = await seedMember('Editora', 'editor', ['artists']);
    const artistId = await createArtist(editor);

    expect(
      await fails('setArtistStatus', { artistId, status: 'published' }, editor.token),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'missing-photo'));
    await ok('updateArtist', { artistId, photo: await uploadPhotos(artistId) }, editor.token);
    expect(
      await fails('setArtistStatus', { artistId, status: 'published' }, editor.token),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'missing-image-rights'));
    await ok('updateArtist', { artistId, imageRightsConfirmed: true }, editor.token);

    await ok('setArtistStatus', { artistId, status: 'published' }, editor.token);
    const published = await read(`artists/${artistId}`);
    expect(published).toMatchObject({ status: 'published' });
    expect(published!.publishedAt).toBeInstanceOf(Timestamp);
    expect(Object.keys(published!).sort()).toEqual(PUBLIC_FIELDS);
    expect(await read(`artistPrivate/${artistId}`)).toMatchObject({
      updatedBy: editor.uid,
      updatedAt: published!.updatedAt,
    });
    expect(await auditOf('artist.published')).toMatchObject([
      { actorUid: editor.uid, details: { artistId, from: 'draft' } },
    ]);

    // O mesmo status de novo: ok, sem auditoria.
    await ok('setArtistStatus', { artistId, status: 'published' }, editor.token);
    expect(await auditOf('artist.published')).toHaveLength(1);

    await ok('setArtistStatus', { artistId, status: 'unpublished' }, editor.token);
    expect(await read(`artists/${artistId}`)).toMatchObject({ status: 'unpublished' });
    expect(await auditOf('artist.unpublished')).toHaveLength(1);

    await ok('setArtistStatus', { artistId, status: 'published' }, editor.token);
    const again = await read(`artists/${artistId}`);
    expect(again!.publishedAt).toEqual(published!.publishedAt);
    expect(await auditOf('artist.published')).toHaveLength(2);
  });

  it('a autorização vem do artistPrivate/: uma cópia perdida no doc público não conta', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await createArtist(admin);
    await ok('updateArtist', { artistId, photo: await uploadPhotos(artistId) }, admin.token);
    // Estado que o fluxo não produz: o campo antigo no doc público.
    await db.doc(`artists/${artistId}`).update({ imageRightsConfirmed: true });
    expect(
      await fails('setArtistStatus', { artistId, status: 'published' }, admin.token),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'missing-image-rights'));
    // artistPrivate/ sumiu (estado que o fluxo não produz): sem autorização.
    await db.doc(`artists/${artistId}`).update({ imageRightsConfirmed: FieldValue.delete() });
    await db.doc(`artistPrivate/${artistId}`).delete();
    expect(
      await fails('setArtistStatus', { artistId, status: 'published' }, admin.token),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'missing-image-rights'));
    expect(await read(`artists/${artistId}`)).toMatchObject({ status: 'draft', publishedAt: null });
    expect(await auditOf('artist.published')).toHaveLength(0);
  });

  it('fã lê a central publicada sem nada da equipe; artistPrivate só para a equipe com a seção', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const manager = await seedMember('Gestora', 'editor', ['artists']);
    const viewer = await seedMember('Leitor', 'viewer', ['artists']);
    const withoutSection = await seedMember('Leitor sem seção', 'viewer', ['fans']);
    const fan = await signUpFan('Camila Ribeiro');
    const artistId = await createArtist(admin, {
      managerUid: manager.uid,
      imageRightsConfirmed: true,
      contactEmail: 'contato@trio.com',
      contactPhone: '71998765432',
    });
    await ok('updateArtist', { artistId, photo: await uploadPhotos(artistId) }, admin.token);

    // Rascunho: o fã não lê nem a central.
    expect((await readWithRules(fan.token, `artists/${artistId}`)).status).toBe(403);

    await ok('setArtistStatus', { artistId, status: 'published' }, admin.token);
    const seenByFan = await readWithRules(fan.token, `artists/${artistId}`);
    expect(seenByFan.status).toBe(200);
    expect(seenByFan.fields).toEqual(PUBLIC_FIELDS);
    for (const field of STAFF_ONLY_FIELDS) expect(seenByFan.fields).not.toContain(field);
    for (const outsider of [fan, withoutSection]) {
      expect((await readWithRules(outsider.token, `artistPrivate/${artistId}`)).status).toBe(403);
    }

    for (const member of [admin, manager, viewer]) {
      const seenByStaff = await readWithRules(member.token, `artistPrivate/${artistId}`);
      expect(seenByStaff.status).toBe(200);
      expect(seenByStaff.fields).toEqual(PRIVATE_FIELDS);
    }
  });

  it('tirar do ar um rascunho não muda nada; status e central inválidos voltam com o motivo', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await createArtist(admin);
    await ok('setArtistStatus', { artistId, status: 'unpublished' }, admin.token);
    expect(await read(`artists/${artistId}`)).toMatchObject({ status: 'draft' });
    expect(await auditOf('artist.unpublished')).toHaveLength(0);

    expect(
      await fails('setArtistStatus', { artistId, status: 'draft' }, admin.token),
    ).toMatchObject(reason('INVALID_ARGUMENT', 'invalid-request'));
    expect(
      await fails('setArtistStatus', { artistId: 'nao_existe', status: 'published' }, admin.token),
    ).toMatchObject(reason('NOT_FOUND', 'artist-not-found'));
    // Id que o Firestore reserva (__.*__): central que não existe, não erro interno.
    const reservedId = '__trio__';
    for (const [name, data] of [
      ['updateArtist', { artistId: reservedId, name: 'X' }],
      ['setArtistStatus', { artistId: reservedId, status: 'published' }],
      ['deleteArtist', { artistId: reservedId }],
    ] as const) {
      expect(await fails(name, data, admin.token)).toMatchObject(
        reason('NOT_FOUND', 'artist-not-found'),
      );
    }
  });
});

describe('ordem das centrais (reorderArtists)', () => {
  it('order = posição, só de quem mudou, numa auditoria; a mesma ordem não grava', async () => {
    const editor = await seedMember('Editora', 'editor', ['artists']);
    const [a, b, c] = [
      await createArtist(editor),
      await createArtist(editor),
      await createArtist(editor),
    ];
    const updatedAtOfA = (await read(`artists/${a}`))!.updatedAt;

    const admin = await seedMember('Admin Um', 'admin');
    await ok('reorderArtists', { artistIds: [c, a, b] }, admin.token);
    expect((await read(`artists/${c}`))!.order).toBe(0);
    expect((await read(`artists/${a}`))!.order).toBe(1);
    expect((await read(`artists/${b}`))!.order).toBe(2);
    // As três mudaram de lugar: quem mexeu vai para o artistPrivate/ de cada uma.
    for (const id of [a, b, c]) {
      expect(await read(`artistPrivate/${id}`)).toMatchObject({
        createdBy: editor.uid,
        updatedBy: admin.uid,
      });
      expect(Object.keys((await read(`artists/${id}`))!).sort()).toEqual(PUBLIC_FIELDS);
    }
    expect(await auditOf('artist.reordered')).toMatchObject([
      { actorUid: admin.uid, details: { artistIds: [c, a, b] } },
    ]);

    await ok('reorderArtists', { artistIds: [c, a, b] }, editor.token);
    expect(await auditOf('artist.reordered')).toHaveLength(1);
    // Só quem muda de lugar ganha a marca: trocar b e c de volta não toca em a.
    await ok('reorderArtists', { artistIds: [b, a, c] }, editor.token);
    expect(await read(`artistPrivate/${a}`)).toMatchObject({ updatedBy: admin.uid });
    expect(await read(`artistPrivate/${b}`)).toMatchObject({ updatedBy: editor.uid });
    expect(await read(`artistPrivate/${c}`)).toMatchObject({ updatedBy: editor.uid });
    expect((await read(`artists/${a}`))!.updatedAt).not.toEqual(updatedAtOfA);
  });

  it('id que não existe e lista incompleta: recusadas, e a ordem fica', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const [a, b] = [await createArtist(admin), await createArtist(admin)];
    expect(
      await fails('reorderArtists', { artistIds: [b, a, 'nao_existe'] }, admin.token),
    ).toMatchObject(reason('INVALID_ARGUMENT', 'unknown-artist'));
    expect(await fails('reorderArtists', { artistIds: [b] }, admin.token)).toMatchObject(
      reason('FAILED_PRECONDITION', 'incomplete-list'),
    );
    expect(await fails('reorderArtists', { artistIds: [a, a] }, admin.token)).toMatchObject(
      reason('INVALID_ARGUMENT', 'invalid-request'),
    );
    expect((await read(`artists/${a}`))!.order).toBe(0);
    expect((await read(`artists/${b}`))!.order).toBe(1);
    expect(await auditOf('artist.reordered')).toHaveLength(0);
  });
});

describe('apagar (deleteArtist)', () => {
  it('admin apaga o rascunho: somem a central, o artistPrivate, a reserva do @ e as fotos', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const editor = await seedMember('Editora', 'editor', ['artists']);
    const artistId = await createArtist(editor, { contactEmail: 'contato@trio.com' });
    const photos = await uploadPhotos(artistId);
    await ok('updateArtist', { artistId, photo: photos }, editor.token);
    const orphan = `artists/${artistId}/photo-abandonada.webp`;
    await uploadFile(orphan);
    const neighbour = await createArtist(editor);
    const neighbourPhotos = await uploadPhotos(neighbour);

    expect(await fails('deleteArtist', { artistId }, editor.token)).toMatchObject(
      reason('PERMISSION_DENIED', 'not-admin'),
    );
    expect(await exists(`artists/${artistId}`)).toBe(true);

    await ok('deleteArtist', { artistId }, admin.token);
    expect(await exists(`artists/${artistId}`)).toBe(false);
    expect(await exists(`artistPrivate/${artistId}`)).toBe(false);
    // A vizinha continua inteira.
    expect(await exists(`artistPrivate/${neighbour}`)).toBe(true);
    expect(await exists(`usernames/${artistId}`)).toBe(false);
    const [left] = await bucket.getFiles({ prefix: `artists/${artistId}/` });
    expect(left).toEqual([]);
    // A central vizinha fica com as fotos dela.
    expect(await fileExists(neighbourPhotos.photoPath)).toBe(true);
    expect(await auditOf('artist.deleted')).toMatchObject([
      { actorUid: admin.uid, targetEmail: '', details: { artistId, name: `Central ${artistId}` } },
    ]);
    // O @ volta a ficar livre.
    expect(await ok('checkArtistHandle', { handle: artistId }, admin.token)).toEqual({
      available: true,
      reason: null,
    });
    expect(await fails('deleteArtist', { artistId }, admin.token)).toMatchObject(
      reason('NOT_FOUND', 'artist-not-found'),
    );
  });

  it('central que já foi publicada não se apaga, mesmo fora do ar', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await readyArtist(admin);
    await ok('setArtistStatus', { artistId, status: 'published' }, admin.token);
    await ok('setArtistStatus', { artistId, status: 'unpublished' }, admin.token);
    const photo = (await read(`artists/${artistId}`))!.photo.path;

    expect(await fails('deleteArtist', { artistId }, admin.token)).toMatchObject(
      reason('FAILED_PRECONDITION', 'was-published'),
    );
    expect(await exists(`artists/${artistId}`)).toBe(true);
    expect(await exists(`artistPrivate/${artistId}`)).toBe(true);
    expect(await exists(`usernames/${artistId}`)).toBe(true);
    expect(await fileExists(photo)).toBe(true);
    expect(await auditOf('artist.deleted')).toHaveLength(0);
  });

  it('a reserva do @ só sai se for desta central', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await createArtist(admin);
    // Estado que o fluxo não produz: a reserva é de outra pessoa.
    await db.doc(`usernames/${artistId}`).set({ uid: 'outra-pessoa', createdAt: Timestamp.now() });
    await ok('deleteArtist', { artistId }, admin.token);
    expect(await exists(`artists/${artistId}`)).toBe(false);
    expect(await read(`usernames/${artistId}`)).toMatchObject({ uid: 'outra-pessoa' });
  });
});

describe('quem usa as funções de artistas', () => {
  it('leitor só consulta o @; sem a seção, fã, desativado e sem login não usam nada', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const artistId = await readyArtist(admin);
    const viewer = await seedMember('Leitor', 'viewer', ['artists']);
    const editorWithout = await seedMember('Editor sem seção', 'editor', ['fans', 'missions']);
    const viewerWithout = await seedMember('Leitor sem seção', 'viewer', ['audit']);
    const disabled = await seedMember('Admin Desativado', 'admin');
    await db.doc(`staff/${disabled.uid}`).update({ status: 'disabled' });
    const fan = await signUpFan('Camila Ribeiro');
    const before = await read(`artists/${artistId}`);
    const internalBefore = await read(`artistPrivate/${artistId}`);
    const photos = await uploadPhotos(artistId);

    const changes: [string, unknown][] = [
      ['createArtist', draft(newHandle())],
      ['updateArtist', { artistId, name: 'Outro nome', photo: photos }],
      ['setArtistStatus', { artistId, status: 'published' }],
      ['reorderArtists', { artistIds: [artistId] }],
    ];
    const check: [string, unknown] = ['checkArtistHandle', { handle: newHandle() }];
    const remove: [string, unknown] = ['deleteArtist', { artistId }];

    // Leitor com a seção: consulta o @, e só.
    expect(await ok(check[0], check[1], viewer.token)).toMatchObject({ available: true });
    for (const [name, data] of changes) {
      expect(await fails(name, data, viewer.token)).toMatchObject(
        reason('PERMISSION_DENIED', 'no-section'),
      );
    }
    expect(await fails(remove[0], remove[1], viewer.token)).toMatchObject(
      reason('PERMISSION_DENIED', 'not-admin'),
    );

    // Equipe sem a seção: nem consulta.
    for (const member of [editorWithout, viewerWithout]) {
      for (const [name, data] of [check, ...changes]) {
        expect(await fails(name, data, member.token)).toMatchObject(
          reason('PERMISSION_DENIED', 'no-section'),
        );
      }
      expect(await fails(remove[0], remove[1], member.token)).toMatchObject(
        reason('PERMISSION_DENIED', 'not-admin'),
      );
    }

    // Fora da equipe ativa e sem login.
    for (const [name, data] of [check, ...changes, remove]) {
      for (const outsider of [fan, disabled]) {
        expect(await fails(name, data, outsider.token)).toMatchObject(
          reason('PERMISSION_DENIED', 'not-staff'),
        );
      }
      expect(await fails(name, data)).toMatchObject(reason('UNAUTHENTICATED', 'unauthenticated'));
    }

    expect(await read(`artists/${artistId}`)).toEqual(before);
    expect(await read(`artistPrivate/${artistId}`)).toEqual(internalBefore);
    expect((await db.collection('artists').get()).size).toBe(1);
    expect(await auditOf('artist.updated')).toHaveLength(1);
  });

  it('conta ligada à equipe: a sessão de antes do login que ligou não usa o acesso', async () => {
    const editor = await seedMember('Editora', 'editor', ['artists']);
    const loggedAt = authTimeOf(editor.token);
    await db.doc(`staff/${editor.uid}`).update({ authValidAfter: loggedAt + 60 });
    expect(await fails('createArtist', draft(newHandle()), editor.token)).toMatchObject(
      reason('PERMISSION_DENIED', 'not-staff'),
    );
    expect(await fails('checkArtistHandle', { handle: newHandle() }, editor.token)).toMatchObject(
      reason('PERMISSION_DENIED', 'not-staff'),
    );
    await db.doc(`staff/${editor.uid}`).update({ authValidAfter: loggedAt });
    await ok('createArtist', draft(newHandle()), editor.token);
  });
});
