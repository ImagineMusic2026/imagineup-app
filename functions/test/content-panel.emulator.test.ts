import { describe, expect, it } from 'vitest';

import {
  callable,
  central,
  post,
  seedMember,
  show,
  signUpFan,
  unique,
  useEmulators,
  type Member,
} from './support';

/**
 * As callables de conteúdo do bloco 6 nos emuladores (docs/arquitetura-api.md,
 * 21.9 e 21.15): posts e shows com a seção artists, a mídia conferida no
 * emulador do Storage e a auditoria em staffAudit; e o has-content do
 * deleteArtist.
 */
const POST_FUNCTIONS = ['createPost', 'updatePost', 'setPostStatus', 'deletePost'];
const EVENT_FUNCTIONS = ['createEvent', 'updateEvent', 'setEventStatus', 'deleteEvent'];
const env = useEmulators('conteudo', [
  'createUserProfile',
  'deleteArtist',
  ...POST_FUNCTIONS,
  ...EVENT_FUNCTIONS,
]);
const { db, bucket } = env;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

async function ok<T = Record<string, unknown>>(name: string, data: unknown, member: Member) {
  const { result, error } = await callable<T>(env, name, data, member.token);
  if (error)
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  return result as T;
}

async function fails(name: string, data: unknown, member?: Member) {
  const { error } = await callable(env, name, data, member?.token);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error.details?.reason;
}

async function upload(
  path: string,
  contentType = 'image/webp',
  size?: { width: number; height: number },
): Promise<void> {
  await bucket.file(path).save(Buffer.from(`arquivo ${path}`), {
    resumable: false,
    contentType,
    metadata: size ? { metadata: { width: String(size.width), height: String(size.height) } } : {},
  });
}

async function folder(prefix: string): Promise<string[]> {
  const [files] = await bucket.getFiles({ prefix });
  return files.map((file) => file.name).sort();
}

async function auditOf(action: string) {
  const entries = await db.collection('staffAudit').where('action', '==', action).get();
  return entries.docs.map((doc) => doc.data());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Uma data local daqui a `days` dias, às 21 h, no formato do painel. */
function localIn(days: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  return `${date.toISOString().slice(0, 10)}T21:00`;
}

describe('quem usa as callables de conteúdo', () => {
  it('admin e editor com artists criam; leitor, outra seção, desativado e fã não', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['artists']);
    const moderation = await seedMember(env, 'Moderação', 'editor', ['moderation']);
    const disabled = await seedMember(env, 'Desativada', 'editor', ['artists'], 'disabled');
    const fan = await signUpFan(db);
    const artistId = await central(env);
    const input = { artistId, kind: 'text', text: 'Bora!' };

    for (const member of [admin, editor]) {
      const { postId } = await ok<{ postId: string }>('createPost', input, member);
      expect(await read(`posts/${postId}`)).toMatchObject({
        artistId,
        kind: 'text',
        status: 'draft',
        publishedAt: null,
        likeCount: 0,
        commentCount: 0,
        countsAt: null,
        createdBy: member.uid,
      });
    }
    expect(await fails('createPost', input, viewer)).toBe('no-section');
    expect(await fails('createPost', input, moderation)).toBe('no-section');
    expect(await fails('createPost', input, disabled)).toBe('not-staff');
    expect(await fails('createPost', input, { ...admin, token: fan.token, uid: fan.uid })).toBe(
      'not-staff',
    );
    expect(await fails('createPost', input)).toBe('unauthenticated');
    expect(await auditOf('post.created')).toHaveLength(2);
  });
});

describe('posts (createPost, updatePost, setPostStatus, deletePost)', () => {
  it('texto vazio recusado no post de texto; foto e vídeo sem legenda aceitos', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await central(env);
    expect(await fails('createPost', { artistId, kind: 'text', text: '  ' }, editor)).toBe(
      'invalid-text',
    );
    expect(await fails('createPost', { artistId, kind: 'gif', text: 'oi' }, editor)).toBe(
      'invalid-kind',
    );
    expect(
      await fails('createPost', { artistId: 'naoexiste', kind: 'text', text: 'oi' }, editor),
    ).toBe('artist-not-found');
    const photo = await ok<{ postId: string }>('createPost', { artistId, kind: 'photo' }, editor);
    const video = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'video', text: '' },
      editor,
    );
    expect(await read(`posts/${photo.postId}`)).toMatchObject({ text: '', kind: 'photo' });
    expect(await read(`posts/${video.postId}`)).toMatchObject({ text: '', kind: 'video' });
  });

  it('a mídia conferida no Storage, a pasta limpa depois da troca; publicar exige a mídia', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await central(env);
    const { postId } = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'video', text: 'Clipe' },
      editor,
    );
    expect(await fails('setPostStatus', { postId, status: 'published' }, editor)).toBe(
      'missing-media',
    );

    const stamp = unique('');
    const first = {
      photoPath: `posts/${postId}/photo-${stamp}-1440.webp`,
      thumbPath: `posts/${postId}/thumb-${stamp}-480.webp`,
      videoPath: `posts/${postId}/video-${stamp}.mp4`,
    };
    await upload(first.photoPath, 'image/webp', { width: 1920, height: 1080 });
    await upload(first.thumbPath);
    await upload(first.videoPath, 'video/mp4');
    expect(
      await fails(
        'updatePost',
        { postId, media: { ...first, videoPath: first.photoPath } },
        editor,
      ),
    ).toBe('invalid-media');
    expect(
      await fails(
        'updatePost',
        { postId, media: { ...first, photoPath: `posts/${postId}/nao-subiu.webp` } },
        editor,
      ),
    ).toBe('media-not-found');
    expect(
      await fails(
        'updatePost',
        { postId, media: { ...first, thumbPath: first.videoPath } },
        editor,
      ),
    ).toBe('invalid-media');
    await ok('updatePost', { postId, media: first }, editor);
    const stored = await read(`posts/${postId}`);
    expect(stored?.media).toMatchObject({
      photo: { path: first.photoPath, width: 1920, height: 1080, url: expect.any(String) },
      thumb: { path: first.thumbPath, width: 480, height: 270 },
      video: { path: first.videoPath, url: expect.any(String) },
    });
    await ok('setPostStatus', { postId, status: 'published' }, editor);
    const published = await read(`posts/${postId}`);
    expect(published).toMatchObject({ status: 'published' });

    const next = {
      photoPath: `posts/${postId}/photo-${unique('')}-1440.webp`,
      thumbPath: `posts/${postId}/thumb-${unique('')}-480.webp`,
    };
    await upload(next.photoPath);
    await upload(next.thumbPath);
    await upload(`posts/${postId}/abandonado.webp`);
    // Bloco 11 (26.5): a capa trocada sem `videoPath` mantém o mp4 (no post e na pasta).
    await ok('updatePost', { postId, media: next }, editor);
    expect(await folder(`posts/${postId}/`)).toEqual(
      [next.photoPath, next.thumbPath, first.videoPath].sort(),
    );
    expect((await read(`posts/${postId}`))?.media).toMatchObject({
      photo: { path: next.photoPath },
      thumb: { path: next.thumbPath },
      video: { path: first.videoPath, url: expect.any(String) },
    });
    expect(await auditOf('post.updated')).toHaveLength(2);
    // A mesma capa de novo, sem `videoPath`: nada muda.
    await ok('updatePost', { postId, media: next }, editor);
    expect(await auditOf('post.updated')).toHaveLength(2);
    // `videoPath: null` tira o vídeo.
    await ok('updatePost', { postId, media: { ...next, videoPath: null } }, editor);
    expect((await read(`posts/${postId}`))?.media?.video).toBeNull();
    expect(await folder(`posts/${postId}/`)).toEqual([next.photoPath, next.thumbPath].sort());
    expect(await fails('updatePost', { postId, media: null }, editor)).toBe(
      'published-needs-media',
    );

    // Republicar mantém a primeira publicação.
    await ok('setPostStatus', { postId, status: 'unpublished' }, editor);
    await ok('setPostStatus', { postId, status: 'published' }, editor);
    expect((await read(`posts/${postId}`))?.publishedAt).toEqual(published?.publishedAt);
    expect(await fails('updatePost', { postId, media: first }, { ...editor })).toBe(
      'media-not-found',
    );
    expect(await auditOf('post.published')).toHaveLength(2);
    expect(await auditOf('post.unpublished')).toHaveLength(1);
  });

  it('o post de show: o show precisa ter a central e estar no ar para publicar', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const [nenho, netto] = [await central(env), await central(env)];
    const { eventId } = await ok<{ eventId: string }>(
      'createEvent',
      {
        title: 'Arrocha na Praia',
        artistIds: [nenho],
        city: 'Aracaju',
        state: 'SE',
        startsAtLocal: localIn(10),
        timeZone: 'America/Maceio',
      },
      editor,
    );
    expect(
      await fails('createPost', { artistId: netto, kind: 'event', text: 'Show!', eventId }, editor),
    ).toBe('event-artist-mismatch');
    expect(
      await fails('createPost', { artistId: nenho, kind: 'event', text: 'Show!' }, editor),
    ).toBe('event-not-found');
    const { postId } = await ok<{ postId: string }>(
      'createPost',
      { artistId: nenho, kind: 'event', text: 'Sábado tem show!', eventId },
      editor,
    );
    expect(await fails('setPostStatus', { postId, status: 'published' }, editor)).toBe(
      'event-not-published',
    );
    await ok('setEventStatus', { eventId, status: 'published' }, editor);
    await ok('setPostStatus', { postId, status: 'published' }, editor);
    // O updateEvent não tira a central de um post que aponta para o show.
    expect(await fails('updateEvent', { eventId, artistIds: [netto] }, editor)).toBe(
      'event-has-posts',
    );
    await ok('updateEvent', { eventId, artistIds: [nenho, netto] }, editor);
    await ok('updateEvent', { eventId, artistIds: [nenho] }, editor);
    expect(await fails('deleteEvent', { eventId }, editor)).toBe('was-published');
  });

  it('o updateEvent acha o post da central que sai mesmo depois do 20º post do show', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const [nenho, netto] = [await central(env), await central(env)];
    const eventId = await show(env, [nenho, netto], Date.now() + 10 * DAY_MS);
    // Na ordem do id, os 20 do Nenho vêm antes do único do Netto.
    const prefix = unique('p21-');
    for (let index = 0; index < 20; index += 1) {
      await post(env, nenho, { kind: 'event', eventId }, `${prefix}-a${index + 10}`);
    }
    const nettoPost = await post(env, netto, { kind: 'event', eventId }, `${prefix}-z`);

    const { error } = await callable(
      env,
      'updateEvent',
      { eventId, artistIds: [nenho] },
      editor.token,
    );
    expect(error?.details).toEqual({ reason: 'event-has-posts', postIds: [nettoPost] });
    expect(await read(`events/${eventId}`)).toMatchObject({ artistIds: [nenho, netto] });
    // Tirar a central que não tem post passa, com os 21 posts no show.
    const third = await central(env);
    await ok('updateEvent', { eventId, artistIds: [nenho, netto, third] }, editor);
    await ok('updateEvent', { eventId, artistIds: [nenho, netto] }, editor);
  });

  it('deletePost e deleteEvent apagam o rascunho que nunca foi ao ar, com a pasta', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await central(env);
    const { postId } = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'photo' },
      editor,
    );
    await upload(`posts/${postId}/photo-1.webp`);
    await ok('deletePost', { postId }, editor);
    expect(await exists(`posts/${postId}`)).toBe(false);
    expect(await folder(`posts/${postId}/`)).toEqual([]);
    expect(await auditOf('post.deleted')).toMatchObject([
      { details: { postId, artistId, kind: 'photo' } },
    ]);

    const { postId: aired } = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'text', text: 'No ar' },
      editor,
    );
    await ok('setPostStatus', { postId: aired, status: 'published' }, editor);
    await ok('setPostStatus', { postId: aired, status: 'unpublished' }, editor);
    expect(await fails('deletePost', { postId: aired }, editor)).toBe('was-published');

    const { eventId } = await ok<{ eventId: string }>(
      'createEvent',
      {
        title: 'Rascunho',
        artistIds: [artistId],
        city: 'Salvador',
        state: 'BA',
        startsAtLocal: localIn(20),
        timeZone: 'America/Bahia',
      },
      editor,
    );
    const { postId: showPost } = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'event', text: 'Vem!', eventId },
      editor,
    );
    expect(await fails('deleteEvent', { eventId }, editor)).toBe('event-has-posts');
    await ok('deletePost', { postId: showPost }, editor);
    await upload(`events/${eventId}/photo-1.webp`);
    await ok('deleteEvent', { eventId }, editor);
    expect(await exists(`events/${eventId}`)).toBe(false);
    expect(await folder(`events/${eventId}/`)).toEqual([]);
  });

  it('nada mudou: ok sem gravar nem auditar', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await central(env);
    const { postId } = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'text', text: 'Oi' },
      editor,
    );
    const before = await read(`posts/${postId}`);
    await ok('updatePost', { postId, text: '  Oi  ' }, editor);
    expect(await read(`posts/${postId}`)).toEqual(before);
    expect(await auditOf('post.updated')).toHaveLength(0);
    await ok('updatePost', { postId, text: 'Oi de novo' }, editor);
    expect(await auditOf('post.updated')).toMatchObject([
      { details: { postId, artistId, changed: ['text'] } },
    ]);
  });
});

describe('o id do painel no createPost e no createEvent (bloco 11)', () => {
  it('o mesmo id não cria outro rascunho nem audita de novo; sem ele, o servidor gera', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await central(env);
    const postId = unique('postpainel');
    const input = { postId, artistId, kind: 'text', text: 'Bora!' };
    expect(await ok<{ postId: string }>('createPost', input, editor)).toEqual({ postId });
    // A resposta perdida: o painel repete com o mesmo id (até com outro texto).
    expect(await ok('createPost', { ...input, text: 'Outro' }, editor)).toEqual({ postId });
    expect((await read(`posts/${postId}`))?.text).toBe('Bora!');
    expect(await auditOf('post.created')).toHaveLength(1);
    const generated = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'text', text: 'Sem id' },
      editor,
    );
    expect(generated.postId).not.toBe(postId);
    for (const bad of ['', 'com espaço', '__reservado__', 'a'.repeat(129), 42]) {
      const { error } = await callable(env, 'createPost', { ...input, postId: bad }, editor.token);
      expect(error?.details).toEqual({ reason: 'invalid-request', field: 'postId' });
    }

    const eventId = unique('showpainel');
    const show = {
      eventId,
      title: 'São João de Irará',
      artistIds: [artistId],
      city: 'Irará',
      state: 'BA',
      startsAtLocal: '2027-06-23T22:00',
      timeZone: 'America/Bahia',
    };
    expect(await ok('createEvent', show, editor)).toEqual({ eventId });
    expect(await ok('createEvent', { ...show, title: 'Outro' }, editor)).toEqual({ eventId });
    expect((await read(`events/${eventId}`))?.title).toBe('São João de Irará');
    expect(await auditOf('event.created')).toHaveLength(1);
    const { error } = await callable(
      env,
      'createEvent',
      { ...show, eventId: 'barra/no-meio' },
      editor.token,
    );
    expect(error?.details).toEqual({ reason: 'invalid-request', field: 'eventId' });
  });

  it('o id de outro documento recusa: o publicado, o de outra pessoa, de outra central ou de outro tipo', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const admin = await seedMember(env, 'Admin', 'admin');
    const artistId = await central(env);
    const other = await central(env);
    const postId = unique('postpainel');
    const input = { postId, artistId, kind: 'text', text: 'Bora!' };
    await ok('createPost', input, editor);
    const refused = async (data: Record<string, unknown>, who: Member) => {
      const { error } = await callable(env, 'createPost', data, who.token);
      expect(error?.details).toEqual({ reason: 'invalid-request', field: 'postId' });
    };
    await refused(input, admin);
    await refused({ ...input, artistId: other }, editor);
    await refused({ postId, artistId, kind: 'photo' }, editor);
    await ok('setPostStatus', { postId, status: 'published' }, editor);
    // O post no ar com o mesmo id: nada de "criei", e a trilha não segue para a mídia.
    await refused(input, editor);
    expect((await read(`posts/${postId}`))?.status).toBe('published');
    expect(await auditOf('post.created')).toHaveLength(1);

    const eventId = unique('showpainel');
    const show = {
      eventId,
      title: 'São João de Irará',
      artistIds: [artistId],
      city: 'Irará',
      state: 'BA',
      startsAtLocal: '2027-06-23T22:00',
      timeZone: 'America/Bahia',
    };
    await ok('createEvent', show, editor);
    for (const [data, who] of [
      [show, admin],
      [{ ...show, artistIds: [other] }, editor],
      [{ ...show, artistIds: [artistId, other] }, editor],
    ] as const) {
      const { error } = await callable(env, 'createEvent', data, who.token);
      expect(error?.details).toEqual({ reason: 'invalid-request', field: 'eventId' });
    }
    expect(await auditOf('event.created')).toHaveLength(1);
  });
});

describe('shows (createEvent, updateEvent)', () => {
  it('o fuso grava o instante certo; data no passado e fuso fora da lista recusam', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['artists']);
    const artistId = await central(env);
    const input = {
      title: 'São João de Irará',
      artistIds: [artistId],
      city: 'Irará',
      state: 'BA',
      venue: 'Praça da Matriz',
      startsAtLocal: '2027-06-23T22:00',
      timeZone: 'America/Bahia',
      featured: true,
    };
    const { eventId } = await ok<{ eventId: string }>('createEvent', input, editor);
    const stored = await read(`events/${eventId}`);
    expect(stored?.startsAt.toDate().toISOString()).toBe('2027-06-24T01:00:00.000Z');
    expect(stored).toMatchObject({
      startsAtLocal: '2027-06-23T22:00',
      timeZone: 'America/Bahia',
      featured: true,
      status: 'draft',
      venue: 'Praça da Matriz',
      photo: null,
    });
    await ok('updateEvent', { eventId, timeZone: 'America/Manaus' }, editor);
    expect((await read(`events/${eventId}`))?.startsAt.toDate().toISOString()).toBe(
      '2027-06-24T02:00:00.000Z',
    );
    expect(
      await fails('createEvent', { ...input, startsAtLocal: '2020-01-01T20:00' }, editor),
    ).toBe('event-in-past');
    expect(await fails('createEvent', { ...input, timeZone: 'Europe/Lisbon' }, editor)).toBe(
      'invalid-time-zone',
    );
    expect(await fails('createEvent', { ...input, state: 'XX' }, editor)).toBe('invalid-state');
    expect(await fails('createEvent', { ...input, artistIds: ['naoexiste'] }, editor)).toBe(
      'artist-not-found',
    );
    await ok('updateEvent', { eventId, venue: '' }, editor);
    expect((await read(`events/${eventId}`))?.venue).toBeNull();
  });
});

describe('deleteArtist com post ou show (has-content)', () => {
  it('recusa a central com conteúdo, também rascunho, e passa depois de apagar o rascunho', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const artistId = await central(env, { status: 'unpublished' });
    const { postId } = await ok<{ postId: string }>(
      'createPost',
      { artistId, kind: 'text', text: 'Rascunho' },
      admin,
    );
    expect(await fails('deleteArtist', { artistId }, admin)).toBe('has-content');
    await ok('deletePost', { postId }, admin);
    const { eventId } = await ok<{ eventId: string }>(
      'createEvent',
      {
        title: 'Show',
        artistIds: [artistId],
        city: 'Salvador',
        state: 'BA',
        startsAtLocal: localIn(30),
        timeZone: 'America/Bahia',
      },
      admin,
    );
    expect(await fails('deleteArtist', { artistId }, admin)).toBe('has-content');
    await ok('deleteEvent', { eventId }, admin);
    await ok('deleteArtist', { artistId }, admin);
    expect(await exists(`artists/${artistId}`)).toBe(false);
  });
});
