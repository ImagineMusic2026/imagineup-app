import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { seedEvents } from '../src/agenda';
import { seedCentrals } from '../src/centrals';
import { COMMENTS_PER_DAY, LIKES_PER_DAY } from '../src/moderation';
import {
  DEFAULT_POINTS_CONFIG,
  dayKey,
  staticConfigSource,
  type PointsConfig,
} from '../src/points';
import { seedEngagement, seedPosts } from '../src/posts';
import { deleteUserData } from '../src/store';
import {
  central,
  countShardSum,
  daysSince,
  http,
  localApi,
  post,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  waitForCounts,
  type Fan,
} from './support';

/**
 * O mural do bloco 6 nos emuladores (docs/arquitetura-api.md, 21.15): a `api`
 * de verdade pelo HTTP do emulador, com o ID token do Auth, e o handler no
 * processo, com o relógio e os valores fixos. O gatilho queuePostCountSync
 * roda no emulador de Functions e a tarefa syncPostCounts no do Cloud Tasks
 * (lá, uma tarefa por gravação, na hora): os testes esperam a cópia.
 */
const env = useEmulators('mural', [
  'api',
  'createUserProfile',
  'deleteUserProfile',
  'queuePostCountSync',
  'syncPostCounts',
]);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

function configWith(change: {
  values?: Partial<PointsConfig['values']>;
  dailyLimits?: Partial<PointsConfig['dailyLimits']>;
}) {
  return staticConfigSource({
    points: {
      ...DEFAULT_POINTS_CONFIG,
      values: { ...DEFAULT_POINTS_CONFIG.values, ...change.values },
      dailyLimits: { ...DEFAULT_POINTS_CONFIG.dailyLimits, ...change.dailyLimits },
    },
  });
}

/** O fã vira membro da central direto, como o vínculo do bloco 4 deixaria. */
async function follow(fan: Fan, artistId: string): Promise<void> {
  await db.doc(`users/${fan.uid}/centrals/${artistId}`).set({
    uid: fan.uid,
    artistId,
    via: 'page',
    joinedAt: Timestamp.now(),
    schemaVersion: 1,
  });
}

const like = (fan: Fan, postId: string, key = unique('chave-curtir-')) =>
  http(env, `/posts/${postId}/like`, { method: 'PUT', token: fan.token, key });
const unlike = (fan: Fan, postId: string, key = unique('chave-descurtir-')) =>
  http(env, `/posts/${postId}/like`, { method: 'DELETE', token: fan.token, key });

const ago = (minutes: number) => Timestamp.fromMillis(Date.now() - minutes * 60_000);

describe('mural (GET /feed), grade e detalhe', () => {
  it('só as centrais do fã, em ordem, sem rascunho nem central fora do ar, de 2 em 2', async () => {
    const fan = await signUpFan(db);
    const [a, b, off, other] = [
      await central(env),
      await central(env),
      await central(env, { status: 'unpublished' }),
      await central(env),
    ];
    for (const id of [a, b, off]) await follow(fan, id);
    const p1 = await post(env, a, { publishedAt: ago(1) });
    const p2 = await post(env, b, { publishedAt: ago(2) });
    const p3 = await post(env, a, { publishedAt: ago(3) });
    await post(env, a, { status: 'draft', publishedAt: null });
    const offPost = await post(env, off, { publishedAt: ago(0) });
    await post(env, other, { publishedAt: ago(0) });

    const call = localApi(env);
    const first = await call('GET', '/feed', { token: fan.token, query: { limit: '2' } });
    expect(first.status).toBe(200);
    expect((first.body.items as { id: string }[]).map((item) => item.id)).toEqual([p1, p2]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await call('GET', '/feed', {
      token: fan.token,
      query: { limit: '2', cursor: first.body.nextCursor as string },
    });
    expect((second.body.items as { id: string }[]).map((item) => item.id)).toEqual([p3]);
    expect(second.body.nextCursor).toBeNull();

    // O detalhe: 404 no rascunho e no post da central fora do ar.
    expect((await http(env, `/posts/${offPost}`, { token: fan.token })).status).toBe(404);
    const detail = await http(env, `/posts/${p1}`, { token: fan.token });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: p1,
      kind: 'text',
      artist: { id: a, name: `Central ${a}` },
      media: null,
      event: null,
      likeCount: 0,
      commentCount: 0,
      likedByMe: false,
      sharePointsPerVisit: 2,
    });

    // A grade de uma central não exige ser membro; central fora do ar é 404.
    const grid = await http(env, `/artists/${other}/posts`, { token: fan.token });
    expect((grid.body.items as unknown[]).length).toBe(1);
    expect((await http(env, `/artists/${off}/posts`, { token: fan.token })).status).toBe(404);

    // Fã sem central: o mural vazio.
    const lonely = await signUpFan(db);
    expect((await http(env, '/feed', { token: lonely.token })).body).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('com mais de 30 centrais, junta os blocos do in na mesma ordem', async () => {
    const fan = await signUpFan(db);
    const ids: string[] = [];
    for (let index = 0; index < 32; index += 1) ids.push(await central(env));
    for (const id of ids) await follow(fan, id);
    const newest = await post(env, ids[31]!, { publishedAt: ago(1) });
    const middle = await post(env, ids[0]!, { publishedAt: ago(2) });
    const oldest = await post(env, ids[30]!, { publishedAt: ago(3) });
    const feed = await http(env, '/feed', { token: fan.token });
    expect((feed.body.items as { id: string }[]).map((item) => item.id)).toEqual([
      newest,
      middle,
      oldest,
    ]);
  });

  it('o postCount da página da central é o count() dos posts no ar', async () => {
    const fan = await signUpFan(db);
    const id = await central(env);
    await post(env, id);
    await post(env, id);
    await post(env, id, { status: 'unpublished' });
    const page = await http(env, `/artists/${id}`, { token: fan.token });
    expect(page.body).toMatchObject({ postCount: 2 });
  });
});

describe('curtir e descurtir', () => {
  it('paga like:<postId> uma vez na vida; a mesma chave repete a resposta; descurtir não tira', async () => {
    const fan = await signUpFan(db);
    const artistId = await central(env);
    const postId = await post(env, artistId);
    const call = localApi(env, { config: configWith({ values: { like: 3 } }) });
    const key = unique('chave-curtir-');
    const put = (k = unique('chave-k-')) =>
      call('PUT', `/posts/${postId}/like`, { token: fan.token, key: k });
    const del = (k = unique('chave-k-')) =>
      call('DELETE', `/posts/${postId}/like`, { token: fan.token, key: k });

    expect(await put(key)).toMatchObject({ status: 200, body: { pointsAwarded: 3 } });
    expect(await put(key)).toMatchObject({ status: 200, body: { pointsAwarded: 3 } });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 3 });
    expect(await read(`wallets/${fan.uid}/ledger/like:${postId}`)).toMatchObject({
      points: 3,
      artistId,
      subject: { type: 'post', id: postId },
    });
    const first = await read(`users/${fan.uid}/postLikes/${postId}`);
    expect(first).toMatchObject({ liked: true, artistId, postId });

    expect(await del()).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    const undone = await read(`users/${fan.uid}/postLikes/${postId}`);
    expect(undone).toMatchObject({ liked: false });
    expect(undone!.firstLikedAt).toEqual(first!.firstLikedAt);
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 3 });

    expect(await put()).toMatchObject({ body: { pointsAwarded: 0 } });
    const again = await read(`users/${fan.uid}/postLikes/${postId}`);
    expect(again).toMatchObject({ liked: true });
    expect(again!.firstLikedAt).toEqual(first!.firstLikedAt);
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 3 });
  });

  it('o shard e o teto só mexem na troca de estado; a fila copia o likeCount', async () => {
    const fan = await signUpFan(db);
    const postId = await post(env, await central(env));
    const started = Date.now();
    await like(fan, postId);
    await like(fan, postId);
    expect(await countShardSum(db, postId, 'likes')).toBe(1);
    const day = dayKey(Date.now());
    expect((await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.like_set).toBe(1);
    await waitForCounts(db, postId, { likeCount: 1 });
    await unlike(fan, postId);
    await unlike(fan, postId);
    expect(await countShardSum(db, postId, 'likes')).toBe(0);
    await waitForCounts(db, postId, { likeCount: 0 });
    expect(await statsSum(db, daysSince(started), (d) => d.totals?.likes ?? 0)).toBe(1);
    expect(await statsSum(db, daysSince(started), (d) => d.totals?.unlikes ?? 0)).toBe(1);
  });

  it('antes da cópia, o detalhe já conta a curtida de quem chama', async () => {
    const fan = await signUpFan(db);
    const artistId = await central(env);
    const postId = await post(env, artistId, {
      likeCount: 5,
      countsAt: Timestamp.fromMillis(Date.now() - 60_000),
    });
    await db.doc(`users/${fan.uid}/postLikes/${postId}`).set({
      uid: fan.uid,
      postId,
      artistId,
      liked: true,
      firstLikedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      schemaVersion: 1,
    });
    const detail = await http(env, `/posts/${postId}`, { token: fan.token });
    expect(detail.body).toMatchObject({ likeCount: 6, likedByMe: true });
    const other = await signUpFan(db);
    expect((await http(env, `/posts/${postId}`, { token: other.token })).body).toMatchObject({
      likeCount: 5,
      likedByMe: false,
    });
  });

  it('a cópia lida entre o começo do pedido e o commit não esconde a curtida nem o comentário de quem chama', async () => {
    const fan = await signUpFan(db);
    const postId = await post(env, await central(env));
    const started = Date.now();
    // O pedido "começou" 1 min antes: o updatedAt da curtida e o createdAt do
    // comentário (o "agora" do pedido) ficam antes da leitura da cópia abaixo.
    const call = localApi(env, { now: () => started - 60_000 });
    await call('PUT', `/posts/${postId}/like`, { token: fan.token, key: unique('chave-curtir-') });
    await call('POST', `/posts/${postId}/comments`, {
      token: fan.token,
      key: unique('chave-comentar-'),
      body: { text: 'Chegou!' },
    });
    await waitForCounts(db, postId, { likeCount: 1, commentCount: 1 });
    // A cópia que leu os shards depois do começo do pedido e antes do commit: sem as duas ações.
    await db.doc(`posts/${postId}`).update({
      likeCount: 0,
      commentCount: 0,
      countsAt: Timestamp.fromMillis(started - 30_000),
    });
    expect((await http(env, `/posts/${postId}`, { token: fan.token })).body).toMatchObject({
      likeCount: 1,
      commentCount: 1,
      likedByMe: true,
    });
    expect((await read(`users/${fan.uid}/postLikes/${postId}`))?.countedAt).toBeInstanceOf(
      Timestamp,
    );
  });

  it('dez fãs curtindo o mesmo post em paralelo deixam 10', async () => {
    const postId = await post(env, await central(env));
    const fans = await Promise.all(Array.from({ length: 10 }, () => signUpFan(db)));
    const results = await Promise.all(fans.map((fan) => like(fan, postId)));
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(await countShardSum(db, postId, 'likes')).toBe(10);
    await waitForCounts(db, postId, { likeCount: 10 });
  });

  it('o teto do dia dá 429 com o Retry-After, sem gravar; descurtir passa', async () => {
    const fan = await signUpFan(db);
    const postId = await post(env, await central(env));
    await like(fan, postId);
    await unlike(fan, postId);
    const day = dayKey(Date.now());
    await db.doc(`wallets/${fan.uid}`).update({ [`days.${day}.count.like_set`]: LIKES_PER_DAY });
    const capped = await like(fan, postId);
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({
      code: 'too_many_requests',
      details: { limit: LIKES_PER_DAY, action: 'like' },
    });
    expect(Number(capped.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await read(`users/${fan.uid}/postLikes/${postId}`)).toMatchObject({ liked: false });
    expect((await unlike(fan, postId)).status).toBe(200);
  });

  it('post invisível: 404; descurtir vale em qualquer status', async () => {
    const fan = await signUpFan(db);
    const postId = await post(env, await central(env));
    await like(fan, postId);
    await db.doc(`posts/${postId}`).update({ status: 'unpublished' });
    expect(await like(fan, unique('nao-existe'))).toMatchObject({
      status: 404,
      body: { code: 'post_not_found' },
    });
    expect((await unlike(fan, postId)).status).toBe(200);
    expect(await read(`users/${fan.uid}/postLikes/${postId}`)).toMatchObject({ liked: false });
  });
});

describe('comentar e a lista de comentários', () => {
  it('grava com o nome do perfil, paga 2, passa do limite do dia sem pagar e recusa os inválidos', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const artistId = await central(env);
    const postId = await post(env, artistId);
    // O relógio anda entre os dois comentários: no mesmo instante, a ordem sairia pelo id sorteado.
    let at = Date.now();
    const call = localApi(env, {
      config: configWith({ dailyLimits: { comment: 1 } }),
      now: () => at,
    });
    const send = (text: string, key = unique('chave-comentar-')) =>
      call('POST', `/posts/${postId}/comments`, { token: fan.token, key, body: { text } });

    const first = await send('  Que música boa!  ');
    expect(first).toMatchObject({
      status: 200,
      body: {
        postId,
        authorId: fan.uid,
        authorName: 'Camila Ribeiro',
        authorIsArtist: false,
        text: 'Que música boa!',
        pointsAwarded: 2,
      },
    });
    const commentId = first.body.id as string;
    expect(await read(`posts/${postId}/postComments/${commentId}`)).toMatchObject({
      authorUid: fan.uid,
      artistId,
      status: 'visible',
    });
    expect(await read(`wallets/${fan.uid}/ledger/comment:${commentId}`)).toMatchObject({
      points: 2,
    });
    // O segundo do dia passa do limite (1 nesta configuração): entra e rende 0.
    at += 1_000;
    expect(await send('De novo!')).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 2 });

    for (const [text, reason] of [
      ['  \n ', 'empty'],
      ['a'.repeat(501), 'too_long'],
      ['oi\n​', 'invisible'],
    ] as const) {
      const key = unique('chave-ruim-');
      expect(await send(text, key)).toMatchObject({
        status: 400,
        body: { code: 'comment_invalid', details: { reason } },
      });
      expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(2);
    }
    await waitForCounts(db, postId, { commentCount: 2 });
    // O detalhe conta os comentários do fã; a lista os traz do mais novo ao mais antigo.
    const list = await http(env, `/posts/${postId}/comments`, { token: fan.token });
    expect((list.body.items as { text: string }[]).map((item) => item.text)).toEqual([
      'De novo!',
      'Que música boa!',
    ]);
  });

  it('comentar soma 1 no comment_sent (a repetição da chave não); no teto, 429 sem gravar o comentário nem a chave', async () => {
    const fan = await signUpFan(db);
    const postId = await post(env, await central(env));
    const day = dayKey(Date.now());
    const send = (key = unique('chave-comentar-')) =>
      http(env, `/posts/${postId}/comments`, {
        method: 'POST',
        token: fan.token,
        key,
        body: { text: 'Oi, Netto!' },
      });
    const sent = (await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.comment_sent;
    expect(sent).toBeUndefined();
    const key = unique('chave-comentar-');
    expect((await send(key)).status).toBe(200);
    expect(await send(key)).toMatchObject({ status: 200 });
    expect((await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.comment_sent).toBe(1);

    await db
      .doc(`wallets/${fan.uid}`)
      .update({ [`days.${day}.count.comment_sent`]: COMMENTS_PER_DAY });
    const capped = await send();
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({
      code: 'too_many_requests',
      details: { limit: COMMENTS_PER_DAY, action: 'comment' },
    });
    expect(Number(capped.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await db.collection(`posts/${postId}/postComments`).get()).size).toBe(1);
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(1);
    expect((await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.comment_sent).toBe(
      COMMENTS_PER_DAY,
    );
  });

  it('os comentários do bloqueado somem para quem bloqueou, atravessando páginas, e não para os outros', async () => {
    const [reader, blocked, other, third] = [
      await signUpFan(db, 'Leitora'),
      await signUpFan(db, 'Bloqueado'),
      await signUpFan(db, 'Outra'),
      await signUpFan(db, 'Terceira'),
    ];
    const postId = await post(env, await central(env));
    const call = localApi(env);
    const at = (minutes: number) => Timestamp.fromMillis(Date.now() - minutes * 60_000);
    // Do mais novo ao mais antigo: 1 da outra, 45 do bloqueado, 1 da terceira.
    const write = (id: string, uid: string, minutes: number) =>
      db.doc(`posts/${postId}/postComments/${id}`).set({
        postId,
        artistId: 'x',
        authorUid: uid,
        authorName: 'Fã',
        authorPhotoURL: null,
        text: id,
        status: 'visible',
        createdAt: at(minutes),
        hiddenAt: null,
        hiddenBy: null,
        schemaVersion: 1,
      });
    await write('c-outra', other.uid, 1);
    for (let index = 0; index < 45; index += 1)
      await write(`c-bloq-${index}`, blocked.uid, 2 + index);
    await write('c-terceira', third.uid, 100);

    expect(
      await call('PUT', `/me/blocks/${blocked.uid}`, {
        token: reader.token,
        key: unique('chave-bloq-'),
      }),
    ).toMatchObject({ status: 200, body: { fanId: blocked.uid, blocked: true } });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let round = 0; round < 10; round += 1) {
      const page = await call('GET', `/posts/${postId}/comments`, {
        token: reader.token,
        query: { limit: '5', ...(cursor ? { cursor } : {}) },
      });
      expect(page.status).toBe(200);
      seen.push(...(page.body.items as { id: string }[]).map((item) => item.id));
      cursor = page.body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(seen).toEqual(['c-outra', 'c-terceira']);
    const others = await call('GET', `/posts/${postId}/comments`, {
      token: other.token,
      query: { limit: '50' },
    });
    expect((others.body.items as unknown[]).length).toBe(47);
  });
});

describe('exclusão de conta (21.12)', () => {
  it('desconta as contagens pelo que estava ativo, resolve a fila e tira o uid das listas dos outros', async () => {
    const [fan, other, reporter] = [
      await signUpFan(db, 'Excluída'),
      await signUpFan(db, 'Outra'),
      await signUpFan(db, 'Denunciante'),
    ];
    const artistId = await central(env);
    const p1 = await post(env, artistId);
    const p2 = await post(env, artistId);
    const call = localApi(env);
    const key = () => unique('chave-exclusao-');
    await call('PUT', `/posts/${p1}/like`, { token: fan.token, key: key() });
    await call('PUT', `/posts/${p2}/like`, { token: fan.token, key: key() });
    await call('DELETE', `/posts/${p2}/like`, { token: fan.token, key: key() });
    await call('PUT', `/posts/${p1}/like`, { token: other.token, key: key() });
    const mine = await call('POST', `/posts/${p1}/comments`, {
      token: fan.token,
      key: key(),
      body: { text: 'Meu comentário' },
    });
    await call('POST', `/posts/${p1}/comments`, {
      token: fan.token,
      key: key(),
      body: { text: 'Outro meu' },
    });
    const theirs = await call('POST', `/posts/${p1}/comments`, {
      token: other.token,
      key: key(),
      body: { text: 'Da outra' },
    });
    const third = await call('POST', `/posts/${p2}/comments`, {
      token: other.token,
      key: key(),
      body: { text: 'Mais um da outra' },
    });
    const mineId = mine.body.id as string;
    const theirsId = theirs.body.id as string;
    const thirdId = third.body.id as string;
    // A denúncia contra o comentário dela e as denúncias que ela fez.
    await call('POST', `/posts/${p1}/comments/${mineId}/report`, {
      token: reporter.token,
      key: key(),
      body: { reason: 'spam' },
    });
    await call('POST', `/posts/${p1}/comments/${theirsId}/report`, {
      token: fan.token,
      key: key(),
      body: { reason: 'offensive' },
    });
    await call('POST', `/posts/${p2}/comments/${thirdId}/report`, {
      token: fan.token,
      key: key(),
      body: {},
    });
    await call('POST', `/posts/${p2}/comments/${thirdId}/report`, {
      token: reporter.token,
      key: key(),
      body: { reason: 'spam' },
    });
    await call('PUT', `/me/blocks/${other.uid}`, { token: fan.token, key: key() });
    await call('PUT', `/me/blocks/${fan.uid}`, { token: other.token, key: key() });
    await waitForCounts(db, p1, { likeCount: 2, commentCount: 3 });

    await deleteUserData(db, fan.uid);
    await deleteUserData(db, fan.uid);

    expect(await countShardSum(db, p1, 'likes')).toBe(1);
    expect(await countShardSum(db, p2, 'likes')).toBe(0);
    expect(await countShardSum(db, p1, 'comments')).toBe(1);
    expect(await countShardSum(db, p2, 'comments')).toBe(1);
    await waitForCounts(db, p1, { likeCount: 1, commentCount: 1 });
    expect(await exists(`posts/${p1}/postComments/${mineId}`)).toBe(false);
    expect(await read(`moderationQueue/${mineId}`)).toMatchObject({
      commentText: null,
      status: 'resolved',
      resolution: 'author_deleted',
    });
    expect(await read(`moderationQueue/${theirsId}`)).toMatchObject({
      reportCount: 0,
      status: 'resolved',
      resolution: 'withdrawn',
    });
    expect(await read(`moderationQueue/${thirdId}`)).toMatchObject({
      reportCount: 1,
      reasons: { spam: 1, none: 0 },
      status: 'open',
    });
    expect(await exists(`blockLists/${fan.uid}`)).toBe(false);
    expect(await read(`blockLists/${other.uid}`)).toMatchObject({ blocked: [] });
    expect((await db.collection(`users/${fan.uid}/postLikes`).get()).size).toBe(0);

    // Comentar depois de o perfil sair: 503, sem gravar.
    const late = await call('POST', `/posts/${p1}/comments`, {
      token: fan.token,
      key: key(),
      body: { text: 'Tarde demais' },
    });
    expect(late).toMatchObject({ status: 503, body: { code: 'profile_not_ready' } });
  });
});

describe('seed do mural e da agenda (21.14)', () => {
  it('shows, posts e o engajamento dos fãs de teste, sem mudar carteira; rodar de novo não muda nada', async () => {
    await seedCentrals(db);
    expect(await seedEvents(db)).toBe(10);
    expect(await seedPosts(db)).toBe(11);
    const fans = {
      alan: (await signUpFan(db, 'Alan Ferreira')).uid,
      bia: (await signUpFan(db, 'Bia Santos')).uid,
      duda: (await signUpFan(db, 'Duda Lima')).uid,
      enzo: (await signUpFan(db, 'Enzo Rocha')).uid,
    };
    expect(await seedEngagement(db, fans)).toEqual({ likes: 7, comments: 7, rsvps: 2, reports: 1 });
    await waitForCounts(db, 'p-clipe', { likeCount: 3, commentCount: 4 });
    await waitForCounts(db, 'p-show', { likeCount: 2, commentCount: 2 });
    for (const uid of Object.values(fans)) expect(await exists(`wallets/${uid}`)).toBe(false);
    expect(await read('moderationQueue/seed-c-show-enzo')).toMatchObject({
      status: 'open',
      reportCount: 1,
      reasons: { spam: 1 },
      authorUid: fans.enzo,
    });

    const camila = await signUpFan(db, 'Camila Ribeiro');
    await follow(camila, 'nettobrito');
    await follow(camila, 'nenho');
    const clip = await http(env, '/posts/p-clipe', { token: camila.token });
    expect(clip.body).toMatchObject({
      kind: 'video',
      media: { url: null, thumbnailUrl: null, width: 1920, height: 1080 },
      likeCount: 3,
      commentCount: 4,
      likedByMe: false,
    });
    const showPost = await http(env, '/posts/p-show', { token: camila.token });
    expect(showPost.body.event).toMatchObject({
      id: 'arrocha-na-praia',
      title: 'Arrocha na Praia',
      city: 'Aracaju, SE',
    });
    const feed = await http(env, '/feed', { token: camila.token });
    expect((feed.body.items as { id: string }[]).slice(0, 2).map((item) => item.id)).toEqual([
      'p-clipe',
      'p-show',
    ]);
    const comments = await http(env, '/posts/p-clipe/comments', { token: camila.token });
    expect((comments.body.items as { id: string }[]).map((item) => item.id)).toEqual([
      'seed-c-clipe-bia',
      'seed-c-clipe-duda',
      'seed-c-clipe-enzo',
      'seed-c-clipe-alan',
    ]);
    const agenda = await http(env, '/agenda', { token: camila.token });
    expect((agenda.body.featured as { id: string }).id).toBe('sao-joao-irara');
    expect((agenda.body.items as unknown[]).length).toBe(9);
    expect((await http(env, '/artists/nettobrito', { token: camila.token })).body).toMatchObject({
      postCount: 6,
    });

    // Rodar de novo não muda nada.
    expect(await seedEvents(db)).toBe(0);
    expect(await seedPosts(db)).toBe(0);
    expect(await seedEngagement(db, fans)).toEqual({ likes: 0, comments: 0, rsvps: 0, reports: 0 });
    expect(await countShardSum(db, 'p-clipe', 'likes')).toBe(3);
    expect(await countShardSum(db, 'p-clipe', 'comments')).toBe(4);
  });
});
