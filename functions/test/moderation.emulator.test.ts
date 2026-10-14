import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  BLOCK_LIST_MAX,
  BLOCKS_PER_DAY,
  REPORTS_PER_DAY,
  resolveProfileReport,
} from '../src/moderation';
import { DEFAULT_POINTS_CONFIG, dayKey, staticConfigSource } from '../src/points';
import {
  callable,
  central,
  countShardSum,
  daysSince,
  http,
  localApi,
  post,
  seedMember,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  waitForCounts,
  type Fan,
  type Member,
} from './support';

/**
 * A moderação mínima do bloco 6 nos emuladores (docs/arquitetura-api.md,
 * 21.8 e 21.15): denunciar e bloquear pela `api` de verdade, e a callable
 * moderateComment como o painel chama. Desde as exigências das lojas (seção
 * 29, 29.12): a denúncia de perfil, na fila separada `profileReportQueue`, com
 * a rodada e a reabertura pelo resumo do perfil, e a lista de bloqueados.
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

// --- Exigências das lojas (seção 29, 29.12) ---------------------------------------------

const reportProfile = (
  fan: Fan,
  fanId: string,
  reason: unknown = null,
  key: string = unique('chave-perfil-'),
) =>
  http(env, `/fans/${fanId}/report`, { method: 'POST', token: fan.token, key, body: { reason } });

/** Quem chama no processo do teste, como o onCall entrega (a sessão de agora). */
const callerOf = (member: Member) => ({
  uid: member.uid,
  token: { auth_time: Math.floor(Date.now() / 1000) },
});

const profileItem = (uid: string) => read(`profileReportQueue/${uid}`);

/** As denúncias do dia na carteira (comentário e perfil somam no mesmo teto). */
const reportsToday = async (fan: Fan) =>
  (await read(`wallets/${fan.uid}`))?.days?.[dayKey(Date.now())]?.count?.comment_report as
    number | undefined;

/** O fã muda a bio pela api, como o app. */
async function changeBio(fan: Fan, bio: string): Promise<void> {
  const result = await http(env, '/me/profile', {
    method: 'PUT',
    token: fan.token,
    key: unique('chave-bio-'),
    body: { bio },
  });
  expect(result.status).toBe(200);
}

describe('denunciar um perfil (POST /fans/:fanId/report)', () => {
  it('cria a denúncia e o item na profileReportQueue; a segunda da mesma pessoa na rodada não conta; outra pessoa soma', async () => {
    const [promo, bia, duda] = [
      await signUpFan(db, 'Promo Seguidores'),
      await signUpFan(db, 'Bia Santos'),
      await signUpFan(db, 'Duda Lima'),
    ];
    const startedAt = Date.now();

    expect(await reportProfile(bia, promo.uid, 'spam')).toMatchObject({
      status: 200,
      body: { fanId: promo.uid, status: 'reported' },
    });
    const created = (await profileItem(promo.uid))!;
    expect(created).toMatchObject({
      uid: promo.uid,
      reportCount: 1,
      reasons: { spam: 1, offensive: 0, harassment: 0, other: 0, none: 0 },
      status: 'open',
      resolution: null,
      round: 1,
      resolvedAt: null,
      resolvedBy: null,
      resolvedDigest: null,
      schemaVersion: 1,
    });
    // O tipo é a coleção: sem `type`, sem post nem comentário.
    expect(created).not.toHaveProperty('type');
    expect(created).not.toHaveProperty('postId');
    expect(created.openedAt.toMillis()).toBe(created.firstReportedAt.toMillis());
    expect(created.lastReportedAt.toMillis()).toBe(created.firstReportedAt.toMillis());
    expect(await read(`profileReports/${promo.uid}_${bia.uid}`)).toMatchObject({
      targetUid: promo.uid,
      reporterUid: bia.uid,
      reason: 'spam',
      round: 1,
      day: dayKey(Date.now()),
      schemaVersion: 1,
    });
    expect(await reportsToday(bia)).toBe(1);

    // A segunda da mesma pessoa, com o item aberto: already_reported, sem contar no teto.
    expect(await reportProfile(bia, promo.uid, 'offensive')).toMatchObject({
      status: 200,
      body: { fanId: promo.uid, status: 'already_reported' },
    });
    expect(await reportsToday(bia)).toBe(1);
    expect(await profileItem(promo.uid)).toMatchObject({
      reportCount: 1,
      reasons: { spam: 1, offensive: 0 },
    });

    // Outra pessoa soma, sem motivo.
    expect((await reportProfile(duda, promo.uid)).body).toMatchObject({ status: 'reported' });
    expect(await profileItem(promo.uid)).toMatchObject({
      reportCount: 2,
      reasons: { spam: 1, none: 1 },
      round: 1,
      status: 'open',
    });
    expect(await read(`profileReports/${promo.uid}_${duda.uid}`)).toMatchObject({
      reason: null,
      round: 1,
    });
    // A fila de comentários não ganha nada (o painel publicado lê post e comentário de todo item dela).
    expect((await db.collection('moderationQueue').get()).size).toBe(0);
    // O total de denúncias dos agregados, sem central (a repetida não conta).
    expect(await statsSum(db, daysSince(startedAt), (d) => d.totals?.reports ?? 0)).toBe(2);
  });

  it('depois do resolveProfileReport, a mesma pessoa só reabre com o perfil mudado; outra pessoa reabre sempre', async () => {
    const moderator = await seedMember(env, 'Moderadora', 'editor', ['moderation']);
    const [promo, bia, duda] = [
      await signUpFan(db, 'Promo Seguidores'),
      await signUpFan(db, 'Bia Santos'),
      await signUpFan(db, 'Duda Lima'),
    ];
    const resolve = (round: number, resolution = 'kept') =>
      resolveProfileReport({ db }, callerOf(moderator), { uid: promo.uid, resolution, round });

    expect((await reportProfile(bia, promo.uid, 'spam')).body).toMatchObject({
      status: 'reported',
    });
    const first = (await profileItem(promo.uid))!;
    expect(await resolve(1)).toEqual({ ok: true, resolution: 'kept' });
    const resolved = (await profileItem(promo.uid))!;
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
      round: 1,
      resolvedBy: { uid: moderator.uid, name: 'Moderadora' },
    });
    expect(resolved.resolvedDigest).toMatch(/^[0-9a-f]{64}$/);

    // A mesma pessoa, com o perfil igual: already_reported, sem reabrir nem contar no teto.
    expect((await reportProfile(bia, promo.uid, 'spam')).body).toMatchObject({
      status: 'already_reported',
    });
    expect(await profileItem(promo.uid)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
      round: 1,
      resolvedDigest: resolved.resolvedDigest,
    });
    expect(await reportsToday(bia)).toBe(1);

    // A bio nova, pelo PUT /me/profile: a mesma pessoa reabre, na rodada 2, com a contagem do zero.
    await changeBio(promo, 'Agora com link novo no perfil!');
    expect((await reportProfile(bia, promo.uid, 'offensive')).body).toMatchObject({
      status: 'reported',
    });
    const reopened = (await profileItem(promo.uid))!;
    expect(reopened).toMatchObject({
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      resolvedDigest: null,
      round: 2,
      reportCount: 1,
      reasons: { spam: 0, offensive: 1, harassment: 0, other: 0, none: 0 },
    });
    expect(reopened.firstReportedAt.toMillis()).toBe(first.firstReportedAt.toMillis());
    expect(reopened.openedAt.toMillis()).toBeGreaterThanOrEqual(first.openedAt.toMillis());
    expect(await read(`profileReports/${promo.uid}_${bia.uid}`)).toMatchObject({
      round: 2,
      reason: 'offensive',
    });
    expect(await reportsToday(bia)).toBe(2);

    // Resolvida a rodada 2, outra pessoa reabre com o perfil igual.
    expect(await resolve(2, 'actioned')).toEqual({ ok: true, resolution: 'actioned' });
    expect((await reportProfile(duda, promo.uid, 'spam')).body).toMatchObject({
      status: 'reported',
    });
    expect(await profileItem(promo.uid)).toMatchObject({
      status: 'open',
      round: 3,
      reportCount: 1,
      reasons: { spam: 1, offensive: 0 },
    });
    // A denúncia da Bia é da rodada 2: na 3, ela soma de novo.
    expect((await reportProfile(bia, promo.uid)).body).toMatchObject({ status: 'reported' });
    expect(await profileItem(promo.uid)).toMatchObject({ round: 3, reportCount: 2 });
  });

  it('o perfil privado, o suspenso e o que bloqueou quem pede aceitam com o mesmo corpo; o próprio é 400; sem perfil, 404', async () => {
    const target = await signUpFan(db, 'Thalita Santos');
    const [a, b, c] = [await signUpFan(db), await signUpFan(db), await signUpFan(db)];

    await db.doc(`users/${target.uid}`).update({ privateAccount: true });
    const asPrivate = await reportProfile(a, target.uid, 'spam');
    expect(asPrivate).toMatchObject({
      status: 200,
      body: { fanId: target.uid, status: 'reported' },
    });
    await db
      .doc(`users/${target.uid}`)
      .update({ privateAccount: false, suspendedAt: Timestamp.now(), suspensionReason: 'spam' });
    const asSuspended = await reportProfile(b, target.uid, 'spam');
    await db.doc(`users/${target.uid}`).update({ suspendedAt: null, suspensionReason: null });
    const blocked = await http(env, `/me/blocks/${c.uid}`, {
      method: 'PUT',
      token: target.token,
      key: unique('chave-bloq-'),
    });
    expect(blocked.status).toBe(200);
    const asBlocked = await reportProfile(c, target.uid, 'spam');
    // O bloqueado não fica sabendo: a mesma resposta nos três.
    for (const result of [asSuspended, asBlocked]) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual(asPrivate.body);
    }
    expect(await profileItem(target.uid)).toMatchObject({ reportCount: 3, reasons: { spam: 3 } });

    expect(await reportProfile(a, a.uid)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { reason: 'own_profile' } },
    });
    expect(await profileItem(a.uid)).toBeUndefined();

    const gone = await signUpFan(db, 'Sem Perfil');
    await db.doc(`users/${gone.uid}`).delete();
    const staff = await seedMember(env, 'Equipe', 'admin');
    for (const fanId of [gone.uid, staff.uid, 'naoExiste1']) {
      expect(await reportProfile(a, fanId)).toMatchObject({
        status: 404,
        body: { code: 'fan_not_found' },
      });
      expect(await profileItem(fanId)).toBeUndefined();
    }
  });

  it('o teto somado com a denúncia de comentário (aqui report 2): o 429 com a ação e o Retry-After, sem gravar', async () => {
    const points = {
      ...DEFAULT_POINTS_CONFIG,
      actionCaps: { ...DEFAULT_POINTS_CONFIG.actionCaps, comment_report: 2 },
    };
    const call = localApi(env, {
      now: () => Date.now(),
      config: staticConfigSource({ points }),
      withHeaders: true,
    });
    const [author, fan, first, second] = [
      await signUpFan(db),
      await signUpFan(db),
      await signUpFan(db),
      await signUpFan(db),
    ];
    const postId = await post(env, await central(env));
    const commentId = await commentBy(author, postId);
    const send = (path: string, body: unknown = { reason: 'spam' }) =>
      call('POST', path, { token: fan.token, key: unique('chave-teto-'), body });

    expect((await send(`/posts/${postId}/comments/${commentId}/report`)).status).toBe(200);
    expect((await send(`/fans/${first.uid}/report`)).status).toBe(200);
    const capped = await send(`/fans/${second.uid}/report`);
    expect(capped).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 2, action: 'report' } },
    });
    expect(Number(capped.headers!['Retry-After'])).toBeGreaterThan(0);
    expect(await profileItem(second.uid)).toBeUndefined();
    expect(await read(`profileReports/${second.uid}_${fan.uid}`)).toBeUndefined();
    expect(await reportsToday(fan)).toBe(2);
    // A repetida segue respondendo no teto, sem contar.
    expect((await send(`/fans/${first.uid}/report`, {})).body).toMatchObject({
      status: 'already_reported',
    });
  });

  it('a mesma chave devolve a resposta guardada; o suspenso recebe 403 sem gravar', async () => {
    const [promo, bia, duda] = [
      await signUpFan(db, 'Promo Seguidores'),
      await signUpFan(db, 'Bia Santos'),
      await signUpFan(db, 'Duda Lima'),
    ];
    const key = unique('chave-repetida-');
    const first = await reportProfile(bia, promo.uid, 'spam', key);
    expect(first.status).toBe(200);
    const again = await reportProfile(bia, promo.uid, 'spam', key);
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(again.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await profileItem(promo.uid)).toMatchObject({ reportCount: 1 });

    await db
      .doc(`users/${duda.uid}`)
      .update({ suspendedAt: Timestamp.now(), suspensionReason: 'spam' });
    expect(await reportProfile(duda, promo.uid, 'spam')).toMatchObject({
      status: 403,
      body: { code: 'account_suspended' },
    });
    expect(await read(`profileReports/${promo.uid}_${duda.uid}`)).toBeUndefined();
    expect(await profileItem(promo.uid)).toMatchObject({ reportCount: 1 });
  });
});

describe('a lista de bloqueados (GET /me/blocks)', () => {
  /** Perfis direto pelo Admin SDK, com os campos que a lista nunca mostra. */
  async function profiles(n: number): Promise<string[]> {
    const uids: string[] = [];
    for (let index = 0; index < n; index += 1) {
      const uid = unique('bloqueado');
      await db.doc(`users/${uid}`).set({
        displayName: `Fã ${uid}`,
        username: uid.toLowerCase(),
        photoURL: null,
        bio: 'Bio que a lista não mostra.',
        city: 'Salvador, BA',
        gender: 'woman',
        privateAccount: true,
        socials: { instagram: 'nao.mostra' },
        createdAt: Timestamp.now(),
      });
      uids.push(uid);
    }
    return uids;
  }

  const ids = (result: { body: Record<string, unknown> }) =>
    (result.body.items as { uid: string }[]).map((item) => item.uid);

  it('do mais novo ao mais antigo; desbloquear um já lido junto com o do cursor não pula ninguém; um bloqueio novo no meio não repete', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const uids = await profiles(8);
    await db.doc(`blockLists/${fan.uid}`).set({
      uid: fan.uid,
      blocked: uids,
      updatedAt: Timestamp.now(),
      schemaVersion: 1,
    });
    const call = localApi(env, { now: () => Date.now() });
    const list = (query: Record<string, string>) =>
      call('GET', '/me/blocks', { token: fan.token, query });

    const first = await list({ limit: '3' });
    expect(first.status).toBe(200);
    expect(ids(first)).toEqual([uids[7], uids[6], uids[5]]);
    expect(first.body.nextCursor).toBe(`5:${uids[5]}`);
    // Só o uid, o nome, o @ e a foto: nunca a bio, as redes, o gênero, a cidade nem a privada.
    expect((first.body.items as Record<string, unknown>[])[0]).toEqual({
      uid: uids[7],
      displayName: `Fã ${uids[7]}`,
      username: uids[7]!.toLowerCase(),
      photoURL: null,
    });

    // Na própria tela: desbloqueia um já lido (o 6) e o do cursor (o 5).
    for (const uid of [uids[6], uids[5]]) {
      const unblocked = await call('DELETE', `/me/blocks/${uid}`, {
        token: fan.token,
        key: unique('chave-desbloq-'),
      });
      expect(unblocked.status).toBe(200);
    }
    const second = await list({ limit: '3', cursor: first.body.nextCursor as string });
    expect(ids(second)).toEqual([uids[4], uids[3], uids[2]]);
    expect(second.body.nextCursor).toBe(`2:${uids[2]}`);

    // Outro aparelho bloqueia alguém no meio: entra no fim e não repete ninguém.
    const [extra] = await profiles(1);
    const blocked = await call('PUT', `/me/blocks/${extra}`, {
      token: fan.token,
      key: unique('chave-bloq-'),
    });
    expect(blocked.status).toBe(200);
    const third = await list({ limit: '3', cursor: second.body.nextCursor as string });
    expect(ids(third)).toEqual([uids[1], uids[0]]);
    expect(third.body.nextCursor).toBeNull();

    // Sem cursor nem limit: o novo primeiro, de uma vez (até 20).
    const all = await list({});
    expect(ids(all)).toEqual([extra, uids[7], uids[4], uids[3], uids[2], uids[1], uids[0]]);
    expect(all.body.nextCursor).toBeNull();
  });

  it('o perfil que sumiu sai da página, com o cursor; a conta só da equipe recebe a lista vazia; o suspenso lê', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const uids = await profiles(4);
    await db.doc(`blockLists/${fan.uid}`).set({
      uid: fan.uid,
      blocked: uids,
      updatedAt: Timestamp.now(),
      schemaVersion: 1,
    });
    await db.doc(`users/${uids[2]}`).delete();
    const call = localApi(env, { now: () => Date.now() });

    // A página pede o 3 e o 2; o 2 não tem perfil, e ela vem menor, com o cursor.
    const first = await call('GET', '/me/blocks', { token: fan.token, query: { limit: '2' } });
    expect(ids(first)).toEqual([uids[3]]);
    expect(first.body.nextCursor).toBe(`2:${uids[2]}`);
    const second = await call('GET', '/me/blocks', {
      token: fan.token,
      query: { limit: '2', cursor: first.body.nextCursor as string },
    });
    expect(ids(second)).toEqual([uids[1], uids[0]]);
    expect(second.body.nextCursor).toBeNull();

    const staff = await seedMember(env, 'Equipe', 'admin');
    expect(await call('GET', '/me/blocks', { token: staff.token })).toEqual({
      status: 200,
      body: { items: [], nextCursor: null },
    });

    // O suspenso lê (desbloquear é livre), pela api de verdade.
    await db
      .doc(`users/${fan.uid}`)
      .update({ suspendedAt: Timestamp.now(), suspensionReason: 'spam' });
    const asSuspended = await http(env, '/me/blocks', { token: fan.token });
    expect(asSuspended.status).toBe(200);
    expect((asSuspended.body.items as { uid: string }[]).map((item) => item.uid)).toEqual([
      uids[3],
      uids[1],
      uids[0],
    ]);
  });
});
