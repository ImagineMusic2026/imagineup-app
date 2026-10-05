import { describe, expect, it } from 'vitest';

import { BLOCK_LIST_MAX, BLOCKS_PER_DAY, REPORTS_PER_DAY } from '../src/moderation';
import { dayKey } from '../src/points';
import {
  callable,
  central,
  countShardSum,
  http,
  post,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  waitForCounts,
  type Fan,
} from './support';

/**
 * A moderação mínima do bloco 6 nos emuladores (docs/arquitetura-api.md,
 * 21.8 e 21.15): denunciar e bloquear pela `api` de verdade, e a callable
 * moderateComment como o painel chama.
 */
const env = useEmulators('moderacao', [
  'api',
  'createUserProfile',
  'moderateComment',
  'queuePostCountSync',
  'syncPostCounts',
]);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();

const report = (fan: Fan, postId: string, commentId: string, reason: unknown = null) =>
  http(env, `/posts/${postId}/comments/${commentId}/report`, {
    method: 'POST',
    token: fan.token,
    key: unique('chave-denuncia-'),
    body: { reason },
  });

async function commentBy(fan: Fan, postId: string, text = 'Promoção no meu perfil!!!') {
  const result = await http(env, `/posts/${postId}/comments`, {
    method: 'POST',
    token: fan.token,
    key: unique('chave-comentar-'),
    body: { text },
  });
  return result.body.id as string;
}

const moderate = async (token: string, postId: string, commentId: string, action: string) =>
  callable<{ ok: true; status: string }>(
    env,
    'moderateComment',
    { postId, commentId, action },
    token,
  );

describe('denunciar um comentário', () => {
  it('cria a denúncia e o item da fila; a segunda do mesmo fã não muda nada; a de outro fã soma', async () => {
    const [author, alan, bia] = [
      await signUpFan(db, 'Enzo Rocha'),
      await signUpFan(db, 'Alan Ferreira'),
      await signUpFan(db, 'Bia Santos'),
    ];
    const artistId = await central(env);
    const postId = await post(env, artistId);
    const commentId = await commentBy(author, postId);

    expect(await report(alan, postId, commentId, 'spam')).toMatchObject({
      status: 200,
      body: { commentId, status: 'reported' },
    });
    expect(await read(`commentReports/${commentId}_${alan.uid}`)).toMatchObject({
      commentId,
      postId,
      artistId,
      commentAuthorUid: author.uid,
      reporterUid: alan.uid,
      reason: 'spam',
    });
    expect(await read(`moderationQueue/${commentId}`)).toMatchObject({
      authorUid: author.uid,
      commentText: 'Promoção no meu perfil!!!',
      reportCount: 1,
      reasons: { spam: 1, offensive: 0, harassment: 0, other: 0, none: 0 },
      status: 'open',
    });
    expect(await report(alan, postId, commentId, 'other')).toMatchObject({
      body: { status: 'already_reported' },
    });
    expect(await report(bia, postId, commentId)).toMatchObject({ body: { status: 'reported' } });
    expect(await read(`moderationQueue/${commentId}`)).toMatchObject({
      reportCount: 2,
      reasons: { spam: 1, none: 1 },
    });
    // A denúncia não esconde o comentário de ninguém.
    const list = await http(env, `/posts/${postId}/comments`, { token: alan.token });
    expect((list.body.items as { id: string }[]).map((item) => item.id)).toEqual([commentId]);
  });

  it('soma 1 no comment_report (a repetida não); no teto, 429 sem gravar a denúncia, o item nem a chave', async () => {
    const [author, fan] = [await signUpFan(db), await signUpFan(db)];
    const postId = await post(env, await central(env));
    const [first, second] = [
      await commentBy(author, postId, 'Um'),
      await commentBy(author, postId, 'Dois'),
    ];
    const day = dayKey(Date.now());
    const counted = async () =>
      (await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.comment_report as number | undefined;

    expect((await report(fan, postId, first)).body).toMatchObject({ status: 'reported' });
    expect((await report(fan, postId, first)).body).toMatchObject({ status: 'already_reported' });
    expect(await counted()).toBe(1);

    await db
      .doc(`wallets/${fan.uid}`)
      .update({ [`days.${day}.count.comment_report`]: REPORTS_PER_DAY });
    const capped = await report(fan, postId, second, 'spam');
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({
      code: 'too_many_requests',
      details: { limit: REPORTS_PER_DAY, action: 'report' },
    });
    expect(Number(capped.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await read(`commentReports/${second}_${fan.uid}`)).toBeUndefined();
    expect(await read(`moderationQueue/${second}`)).toBeUndefined();
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(2);
    expect(await counted()).toBe(REPORTS_PER_DAY);
  });

  it('o próprio comentário é 400; comentário oculto ou que não existe é 404; motivo fora da lista é 400', async () => {
    const [author, other] = [await signUpFan(db), await signUpFan(db)];
    const postId = await post(env, await central(env));
    const commentId = await commentBy(author, postId);
    expect(await report(author, postId, commentId)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { reason: 'own_comment' } },
    });
    expect(await report(other, postId, unique('naoexiste'))).toMatchObject({
      status: 404,
      body: { code: 'comment_not_found' },
    });
    expect(await report(other, postId, commentId, 'chato')).toMatchObject({
      status: 400,
      body: { details: { field: 'reason' } },
    });
    await db.doc(`posts/${postId}/postComments/${commentId}`).update({ status: 'hidden' });
    expect((await report(other, postId, commentId)).status).toBe(404);
  });
});

describe('a ação da equipe (moderateComment)', () => {
  it('keep resolve e uma denúncia nova reabre; hide tira da lista e da contagem; restore devolve', async () => {
    const [author, alan, bia] = [await signUpFan(db), await signUpFan(db), await signUpFan(db)];
    const moderator = await seedMember(env, 'Moderadora', 'editor', ['moderation']);
    const postId = await post(env, await central(env));
    const commentId = await commentBy(author, postId);
    await waitForCounts(db, postId, { commentCount: 1 });
    await report(alan, postId, commentId, 'spam');

    expect((await moderate(moderator.token, postId, commentId, 'keep')).result).toEqual({
      ok: true,
      status: 'visible',
    });
    expect(await read(`moderationQueue/${commentId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
      resolvedBy: { uid: moderator.uid, name: 'Moderadora' },
    });
    await report(bia, postId, commentId, 'offensive');
    expect(await read(`moderationQueue/${commentId}`)).toMatchObject({
      status: 'open',
      resolution: null,
      reportCount: 2,
    });

    expect((await moderate(moderator.token, postId, commentId, 'hide')).result).toEqual({
      ok: true,
      status: 'hidden',
    });
    expect(await read(`posts/${postId}/postComments/${commentId}`)).toMatchObject({
      status: 'hidden',
      hiddenBy: moderator.uid,
    });
    expect(await read(`moderationQueue/${commentId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
    });
    expect(await countShardSum(db, postId, 'comments')).toBe(0);
    await waitForCounts(db, postId, { commentCount: 0 });
    const hiddenList = await http(env, `/posts/${postId}/comments`, { token: alan.token });
    expect(hiddenList.body.items).toEqual([]);
    expect((await moderate(moderator.token, postId, commentId, 'keep')).error).toMatchObject({
      details: { reason: 'comment-hidden' },
    });

    expect((await moderate(moderator.token, postId, commentId, 'restore')).result).toEqual({
      ok: true,
      status: 'visible',
    });
    expect(await countShardSum(db, postId, 'comments')).toBe(1);
    await waitForCounts(db, postId, { commentCount: 1 });
    expect(await read(`moderationQueue/${commentId}`)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
    });

    const audit = await db.collection('staffAudit').where('actorUid', '==', moderator.uid).get();
    const actions = audit.docs.map((doc) => doc.get('action')).sort();
    expect(actions).toEqual(['comment.hidden', 'comment.kept', 'comment.restored']);
    for (const doc of audit.docs) {
      expect(JSON.stringify(doc.data())).not.toContain('Promoção');
    }
  });

  it('sem a seção moderation não modera; comentário sem item não se mantém', async () => {
    const author = await signUpFan(db);
    const artists = await seedMember(env, 'Só artistas', 'editor', ['artists']);
    const reader = await seedMember(env, 'Leitora', 'viewer', ['moderation']);
    const moderator = await seedMember(env, 'Moderadora', 'editor', ['moderation']);
    const postId = await post(env, await central(env));
    const commentId = await commentBy(author, postId);
    for (const token of [artists.token, reader.token, author.token]) {
      expect((await moderate(token, postId, commentId, 'hide')).error?.details?.reason).toMatch(
        /no-section|not-staff/,
      );
    }
    expect((await moderate(moderator.token, postId, commentId, 'keep')).error).toMatchObject({
      details: { reason: 'not-reported' },
    });
    expect((await moderate(moderator.token, postId, commentId, 'apagar')).error).toMatchObject({
      details: { reason: 'invalid-action' },
    });
  });
});

describe('bloquear um fã', () => {
  it('bloquear e desbloquear; o próprio uid é 400; fã que não existe é 404; a lista cheia é 409', async () => {
    const [fan, other] = [await signUpFan(db), await signUpFan(db)];
    const block = (id: string, method = 'PUT') =>
      http(env, `/me/blocks/${id}`, { method, token: fan.token, key: unique('chave-bloq-') });

    expect(await block(other.uid)).toMatchObject({
      status: 200,
      body: { fanId: other.uid, blocked: true },
    });
    expect(await block(other.uid)).toMatchObject({ status: 200, body: { blocked: true } });
    expect(await read(`blockLists/${fan.uid}`)).toMatchObject({ blocked: [other.uid] });
    expect(await block(fan.uid)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { reason: 'self' } },
    });
    expect(await block('naoexiste123')).toMatchObject({
      status: 404,
      body: { code: 'fan_not_found' },
    });
    expect(await block(other.uid, 'DELETE')).toMatchObject({
      status: 200,
      body: { fanId: other.uid, blocked: false },
    });
    expect(await read(`blockLists/${fan.uid}`)).toMatchObject({ blocked: [] });
    // O desbloqueio não confere o perfil (tira da lista uma conta excluída).
    expect((await block('naoexiste123', 'DELETE')).status).toBe(200);

    await db.doc(`blockLists/${fan.uid}`).set({
      uid: fan.uid,
      blocked: Array.from({ length: BLOCK_LIST_MAX }, (_, index) => `uid${index}`),
    });
    expect(await block(other.uid)).toMatchObject({
      status: 409,
      body: { code: 'block_list_full' },
    });
  });

  it('soma 1 no fan_block (o repetido não); no teto, 429 sem gravar a lista nem a chave; desbloquear passa', async () => {
    const [fan, first, second] = [await signUpFan(db), await signUpFan(db), await signUpFan(db)];
    const day = dayKey(Date.now());
    const block = (id: string, method = 'PUT') =>
      http(env, `/me/blocks/${id}`, { method, token: fan.token, key: unique('chave-bloq-') });
    const counted = async () =>
      (await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.fan_block as number | undefined;

    expect((await block(first.uid)).status).toBe(200);
    // Já bloqueado: sucesso sem efeito, sem contar.
    expect(await block(first.uid)).toMatchObject({ status: 200, body: { blocked: true } });
    expect(await counted()).toBe(1);

    await db.doc(`wallets/${fan.uid}`).update({ [`days.${day}.count.fan_block`]: BLOCKS_PER_DAY });
    const capped = await block(second.uid);
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({
      code: 'too_many_requests',
      details: { limit: BLOCKS_PER_DAY, action: 'block' },
    });
    expect(Number(capped.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await read(`blockLists/${fan.uid}`)).toMatchObject({ blocked: [first.uid] });
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(2);
    expect(await counted()).toBe(BLOCKS_PER_DAY);
    // Desbloquear nunca é recusado.
    expect(await block(first.uid, 'DELETE')).toMatchObject({
      status: 200,
      body: { blocked: false },
    });
  });
});
