import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { dayKey } from '../src/day';
import { FAN_CLUB_RULES_VERSION } from '../src/fan-clubs';
import { catalogDoc, type MissionRecord } from '../src/missions';
import { runFanSuspension } from '../src/moderation';
import {
  createConfigSource,
  DEFAULT_POINTS_CONFIG,
  staticConfigSource,
  type PointsConfig,
} from '../src/points';
import {
  callable,
  central,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
  type LocalResult,
  type Member,
} from './support';

/**
 * As reações e os comentários do fã-clube, a etapa 1 de 37.13
 * (docs/arquitetura-api.md, seção 37, 37.2, 37.3, 37.5 e 37.11): reagir,
 * trocar e tirar, com os números na publicação e na resposta; o teto com a
 * troca; o `not_following`; o gestor, que reage e comenta sem seguir, sem
 * lançar ponto e sem contar no dia da taxa; o suspenso recusado e o desfazer
 * aceito; os comentários de cima e as respostas de um nível (a resposta a uma
 * resposta indo para o de cima), com os contadores e as páginas; o bloqueio na
 * lista; a publicação fora do ar; o 0 ponto sem extrato e sem missão, e o
 * valor acima de 0 sem central; o dia contado só na primeira reação e nunca
 * para o gestor; as vistas da página, da Início e de "Minhas publicações".
 */
const env = useEmulators('fa-clube-comentarios', ['api', 'createUserProfile', 'decideFanClub']);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Api = ReturnType<typeof localApi>;

const NO_REWARDS = {
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
};

const ZERO_COUNTS = { heart: 0, fire: 0, laugh: 0, wow: 0, clap: 0 };

/**
 * O handler no processo com um relógio que o teste adianta (a ordem dos
 * comentários) e, se pedido, outros valores de pontos e outros tetos do dia.
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

const follow = (call: Api, fan: Fan, clubId: string) =>
  call('PUT', `/me/fan-club-follows/${clubId}`, { token: fan.token, key: unique('chave-segue-') });

const react = (call: Api, fan: Fan, postId: string, reaction: string) =>
  call('PUT', `/fan-club-posts/${postId}/reaction`, {
    token: fan.token,
    key: unique('chave-reage-'),
    body: { reaction },
  });

const unreact = (call: Api, fan: Fan, postId: string) =>
  call('DELETE', `/fan-club-posts/${postId}/reaction`, {
    token: fan.token,
    key: unique('chave-tira-'),
  });

const comment = (call: Api, fan: Fan, postId: string, text: string, replyToId?: string) =>
  call('POST', `/fan-club-posts/${postId}/comments`, {
    token: fan.token,
    key: unique('chave-comenta-'),
    body: replyToId === undefined ? { text } : { text, replyToId },
  });

const comments = (call: Api, fan: Fan, postId: string, query: Record<string, string> = {}) =>
  call('GET', `/fan-club-posts/${postId}/comments`, { token: fan.token, query });

type Owner = { fan: Fan; clubId: string; artistId: string };

/** O gestor de um fã-clube ativo de um artista novo: entra, se candidata e a equipe aprova. */
async function manager(call: Api, admin: Member, name = 'Camila Ribeiro'): Promise<Owner> {
  const artistId = await openArtist();
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
  return { fan, clubId, artistId };
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

/** Um fã que segue o fã-clube (e entra junto na central). */
async function follower(call: Api, owner: Owner, name: string): Promise<Fan> {
  const fan = await signUpFan(db, name);
  expect((await follow(call, fan, owner.clubId)).status).toBe(200);
  return fan;
}

/** A soma de um dia da taxa nos 16 shards do fã-clube (37.11). */
async function dayCount(clubId: string, field: 'reactions' | 'comments'): Promise<number> {
  const snap = await db.collection(`fanClubStats/${clubId}/fanClubShards`).get();
  const today = dayKey(Date.now());
  return snap.docs.reduce(
    (total, doc) => total + ((doc.get(`days.${today}.${field}`) as number | undefined) ?? 0),
    0,
  );
}

/** O contador do teto do dia na carteira. */
async function capCount(uid: string, key: string): Promise<number> {
  const wallet = await read(`wallets/${uid}`);
  return (wallet?.days?.[dayKey(Date.now())]?.count?.[key] as number | undefined) ?? 0;
}

const reactionOf = (uid: string, postId: string) => read(`fanClubReactions/${uid}_${postId}`);

const ids = (sent: LocalResult) => (sent.body.items as { id: string }[]).map((item) => item.id);

describe('reagir, trocar e tirar (R1, 37.3 e 37.11)', () => {
  it('os números na publicação e na resposta, o documento da reação e o dia só na primeira reação da vida', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Bora para o show de sábado?');
    const bia = await follower(call, owner, 'Bia Santos');

    expect(await react(call, bia, postId, 'heart')).toEqual({
      status: 200,
      body: {
        postId,
        reaction: 'heart',
        reactionCount: 1,
        reactionCounts: { ...ZERO_COUNTS, heart: 1 },
        ...NO_REWARDS,
      },
    });
    const first = await reactionOf(bia.uid, postId);
    expect(first).toEqual({
      uid: bia.uid,
      clubId: owner.clubId,
      postId,
      reaction: 'heart',
      firstReactedAt: expect.any(Timestamp),
      updatedAt: expect.any(Timestamp),
      schemaVersion: 1,
    });
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({
      reactionCount: 1,
      reactionCounts: { heart: 1 },
    });
    expect(await dayCount(owner.clubId, 'reactions')).toBe(1);
    expect(await capCount(bia.uid, 'fanclub_reaction_set')).toBe(1);

    // A mesma reação: os números, sem gravar e sem contar no teto.
    expect((await react(call, bia, postId, 'heart')).body).toMatchObject({
      reaction: 'heart',
      reactionCount: 1,
    });
    expect(await capCount(bia.uid, 'fanclub_reaction_set')).toBe(1);

    // Trocar de emoji: o total fica, e o teto conta.
    expect((await react(call, bia, postId, 'fire')).body).toMatchObject({
      reaction: 'fire',
      reactionCount: 1,
      reactionCounts: { ...ZERO_COUNTS, fire: 1 },
    });
    expect(await capCount(bia.uid, 'fanclub_reaction_set')).toBe(2);

    // Tirar: `reaction: null`, o documento fica, e o teto não conta.
    expect(await unreact(call, bia, postId)).toEqual({
      status: 200,
      body: {
        postId,
        reaction: null,
        reactionCount: 0,
        reactionCounts: ZERO_COUNTS,
        ...NO_REWARDS,
      },
    });
    expect(await reactionOf(bia.uid, postId)).toMatchObject({
      reaction: null,
      firstReactedAt: first!.firstReactedAt,
    });
    expect(await capCount(bia.uid, 'fanclub_reaction_set')).toBe(2);
    // Tirar de novo não muda nada.
    expect((await unreact(call, bia, postId)).body).toMatchObject({ reactionCount: 0 });

    // Reagir de novo: os números voltam, e o dia da taxa não conta outra vez.
    expect((await react(call, bia, postId, 'clap')).body).toMatchObject({ reactionCount: 1 });
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({
      reactionCount: 1,
      reactionCounts: { heart: 0, fire: 0, clap: 1 },
    });
    expect(await dayCount(owner.clubId, 'reactions')).toBe(1);

    // Outro seguidor soma no total e no dia.
    const duda = await follower(call, owner, 'Duda Lima');
    expect((await react(call, duda, postId, 'clap')).body).toMatchObject({
      reactionCount: 2,
      reactionCounts: { ...ZERO_COUNTS, clap: 2 },
    });
    expect(await dayCount(owner.clubId, 'reactions')).toBe(2);
  });

  it('as vistas: a página, a Início e a publicação com os contadores e a reação de quem pede; "Minhas publicações" com os totais', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Contagem regressiva para o clipe!');
    const bia = await follower(call, owner, 'Bia Santos');
    expect((await react(call, bia, postId, 'wow')).status).toBe(200);
    expect((await comment(call, bia, postId, 'Já salvei o lembrete.')).status).toBe(200);
    const counts = {
      reactionCount: 1,
      reactionCounts: { ...ZERO_COUNTS, wow: 1 },
      commentCount: 1,
      mentions: [],
    };

    const page = await call('GET', `/fan-clubs/${owner.clubId}/posts`, { token: bia.token });
    expect(page.body.items).toEqual([
      expect.objectContaining({ id: postId, ...counts, myReaction: 'wow' }),
    ]);
    const feed = await call('GET', '/me/fan-club-feed', { token: bia.token });
    expect(feed.body.items).toEqual([
      expect.objectContaining({ id: postId, ...counts, myReaction: 'wow' }),
    ]);
    // Quem não segue vê os números, sem reação dele; quem reagiu nunca aparece.
    const visitor = await signUpFan(db, 'Enzo Rocha');
    const seen = await call('GET', `/fan-clubs/${owner.clubId}/posts`, { token: visitor.token });
    expect(seen.body.items).toEqual([
      expect.objectContaining({ id: postId, ...counts, myReaction: null }),
    ]);
    expect(JSON.stringify(seen.body)).not.toContain(bia.uid);

    expect(await call('GET', `/fan-club-posts/${postId}`, { token: bia.token })).toMatchObject({
      status: 200,
      body: {
        id: postId,
        clubId: owner.clubId,
        artistId: owner.artistId,
        text: 'Contagem regressiva para o clipe!',
        ...counts,
        myReaction: 'wow',
        isOwner: false,
        isFollowing: true,
        isMember: true,
        artistName: `Central ${owner.artistId}`,
      },
    });
    expect(
      (await call('GET', `/fan-club-posts/${postId}`, { token: visitor.token })).body,
    ).toMatchObject({ myReaction: null, isOwner: false, isFollowing: false, isMember: false });
    expect(
      (await call('GET', `/fan-club-posts/${postId}`, { token: owner.fan.token })).body,
    ).toMatchObject({ isOwner: true, isFollowing: false, isMember: true });

    const own = await call('GET', '/me/fan-club/posts', { token: owner.fan.token });
    expect(own.body.items).toEqual([
      expect.objectContaining({ id: postId, status: 'published', ...counts }),
    ]);
  });

  it('o teto `club_react` conta dar e trocar; a mesma reação não conta, e tirar nunca é recusado', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi({}, { fanclub_reaction_set: 2 });
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem no ensaio?');
    const bia = await follower(call, owner, 'Bia Santos');

    expect((await react(call, bia, postId, 'heart')).status).toBe(200);
    expect((await react(call, bia, postId, 'heart')).status).toBe(200);
    expect((await react(call, bia, postId, 'fire')).status).toBe(200);
    const capped = await react(call, bia, postId, 'clap');
    expect(capped).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 2, action: 'club_react' } },
    });
    expect(await reactionOf(bia.uid, postId)).toMatchObject({ reaction: 'fire' });
    expect((await unreact(call, bia, postId)).body).toMatchObject({ reaction: null });
    expect((await react(call, bia, postId, 'heart')).status).toBe(429);
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ reactionCount: 0 });
  });
});

describe('quem reage e comenta (decisão 10 de 36.1 e 37.5)', () => {
  it('sem seguir e sem ser o gestor: 409 `not_following`; ler, a publicação e os comentários valem', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Fizemos uma faixa nova!');
    const visitor = await signUpFan(db, 'Enzo Rocha');

    for (const sent of [
      await react(call, visitor, postId, 'heart'),
      await comment(call, visitor, postId, 'Que lindo!'),
    ]) {
      expect(sent).toMatchObject({
        status: 409,
        body: { code: 'fan_club_refused', details: { reason: 'not_following' } },
      });
    }
    expect(await exists(`fanClubReactions/${visitor.uid}_${postId}`)).toBe(false);
    expect((await db.collection('fanClubComments').where('postId', '==', postId).get()).size).toBe(
      0,
    );
    expect(await capCount(visitor.uid, 'fanclub_reaction_set')).toBe(0);
    expect((await call('GET', `/fan-club-posts/${postId}`, { token: visitor.token })).status).toBe(
      200,
    );
    // A primeira página dos de cima traz o `ownHidden` (etapa 3 de 37.13), vazio aqui.
    expect(await comments(call, visitor, postId)).toEqual({
      status: 200,
      body: { items: [], nextCursor: null, ownHidden: [] },
    });

    // Deixar de seguir também tira a vez de comentar e reagir; o que ficou, fica.
    const bia = await follower(call, owner, 'Bia Santos');
    expect((await react(call, bia, postId, 'heart')).status).toBe(200);
    expect(
      (
        await call('DELETE', `/me/fan-club-follows/${owner.clubId}`, {
          token: bia.token,
          key: unique('chave-deixa-'),
        })
      ).status,
    ).toBe(200);
    expect((await comment(call, bia, postId, 'Ainda dá?')).body).toMatchObject({
      details: { reason: 'not_following' },
    });
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ reactionCount: 1 });
  });

  it('o gestor reage e comenta sem seguir, sem lançar ponto e sem contar no dia da taxa; o teto vale para ele', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    // Com os valores acima de 0, para o "sem lançar" aparecer.
    const { call } = clockApi({ fanclub_like: 5, fanclub_comment: 3 });
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Ensaio aberto no domingo!');
    const before = (await read(`wallets/${owner.fan.uid}`))?.balance as number;

    expect((await react(call, owner.fan, postId, 'heart')).body).toMatchObject({
      reaction: 'heart',
      reactionCount: 1,
    });
    const sent = await comment(call, owner.fan, postId, 'Vai ser lindo, turma!');
    expect(sent).toMatchObject({
      status: 200,
      body: { isManager: true, author: { uid: owner.fan.uid }, ...NO_REWARDS },
    });
    expect(await exists(`wallets/${owner.fan.uid}/ledger/fanclub_like:${postId}`)).toBe(false);
    expect(
      await exists(`wallets/${owner.fan.uid}/ledger/fanclub_comment:${sent.body.id as string}`),
    ).toBe(false);
    expect((await read(`wallets/${owner.fan.uid}`))?.balance).toBe(before);
    expect(await dayCount(owner.clubId, 'reactions')).toBe(0);
    expect(await dayCount(owner.clubId, 'comments')).toBe(0);
    expect(await capCount(owner.fan.uid, 'fanclub_reaction_set')).toBe(1);
    expect(await capCount(owner.fan.uid, 'fanclub_comment_sent')).toBe(1);
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({
      reactionCount: 1,
      commentCount: 1,
    });

    // O seguidor, com o valor acima de 0: o extrato sem central e sem assunto.
    const bia = await follower(call, owner, 'Bia Santos');
    const centralPoints = await read(`wallets/${bia.uid}/centralPoints/${owner.artistId}`);
    expect((await react(call, bia, postId, 'fire')).status).toBe(200);
    const said = await comment(call, bia, postId, 'Vou levar a faixa!');
    expect(await read(`wallets/${bia.uid}/ledger/fanclub_like:${postId}`)).toMatchObject({
      source: 'fanclub_like',
      points: 5,
      artistId: null,
      subject: null,
      centralTotalDelta: 0,
    });
    expect(
      await read(`wallets/${bia.uid}/ledger/fanclub_comment:${said.body.id as string}`),
    ).toMatchObject({ source: 'fanclub_comment', points: 3, artistId: null, subject: null });
    expect(await read(`wallets/${bia.uid}/centralPoints/${owner.artistId}`)).toEqual(centralPoints);
    // Uma vez na vida por publicação: tirar e reagir de novo não paga outra vez.
    await unreact(call, bia, postId);
    await react(call, bia, postId, 'heart');
    const ledger = await db
      .collection(`wallets/${bia.uid}/ledger`)
      .where('source', '==', 'fanclub_like')
      .get();
    expect(ledger.size).toBe(1);
    expect(await dayCount(owner.clubId, 'reactions')).toBe(1);
    expect(await dayCount(owner.clubId, 'comments')).toBe(1);
  });

  it('o suspenso não reage nem comenta (403), mas tira a reação', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Show confirmado!');
    const bia = await follower(call, owner, 'Bia Santos');
    expect((await react(call, bia, postId, 'heart')).status).toBe(200);

    await runFanSuspension(
      db,
      { uid: bia.uid, suspended: true, reason: 'spam', note: null },
      { actor: { uid: admin.uid, name: 'Admin da Equipe' } },
    );
    for (const sent of [
      await react(call, bia, postId, 'fire'),
      await comment(call, bia, postId, 'Oi'),
    ]) {
      expect(sent).toMatchObject({ status: 403, body: { code: 'account_suspended' } });
    }
    expect(await unreact(call, bia, postId)).toMatchObject({
      status: 200,
      body: { reaction: null, reactionCount: 0 },
    });
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ reactionCount: 0 });
  });

  it('o 0 ponto: sem extrato e sem saldo, e as missões de curtir e de comentar não andam', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const mission = (extra: Partial<MissionRecord> & Pick<MissionRecord, 'id'>): MissionRecord => ({
      title: `Missão ${extra.id}`,
      action: 'like',
      target: null,
      goal: 1,
      period: 'daily',
      rewardPoints: 10,
      featured: false,
      startsAt: Date.parse('2026-01-01T00:00:00.000Z'),
      endsAt: null,
      status: 'active',
      activatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
      updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      ...extra,
    });
    await db.doc('config/missions').set({
      ...catalogDoc(
        [mission({ id: 'm-curtir' }), mission({ id: 'm-comentar', action: 'comment' })],
        null,
      ),
      version: 1,
      updatedAt: Timestamp.now(),
      updatedBy: null,
    });
    const call = localApi(env, {
      now: () => Date.now(),
      config: createConfigSource(db, { ttlMs: 0 }),
    });
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Bora assistir juntos?');
    const bia = await follower(call, owner, 'Bia Santos');
    const before = await read(`wallets/${bia.uid}`);

    expect((await react(call, bia, postId, 'heart')).body).toMatchObject(NO_REWARDS);
    const said = await comment(call, bia, postId, 'Bora!');
    expect(said.body).toMatchObject(NO_REWARDS);
    expect(await exists(`wallets/${bia.uid}/ledger/fanclub_like:${postId}`)).toBe(false);
    expect(
      await exists(`wallets/${bia.uid}/ledger/fanclub_comment:${said.body.id as string}`),
    ).toBe(false);
    const after = await read(`wallets/${bia.uid}`);
    expect(after).toMatchObject({
      balance: before?.balance,
      xp: before?.xp,
      seasonPoints: before?.seasonPoints,
    });
    const missions = await call('GET', '/missions', { token: bia.token });
    expect(
      (missions.body.missions as { id: string; progress: { current: number } }[]).map((item) => [
        item.id,
        item.progress.current,
      ]),
    ).toEqual([
      ['m-curtir', 0],
      ['m-comentar', 0],
    ]);
  });
});

describe('os comentários e as respostas (37.3, R7)', () => {
  it('comentar e responder: o documento, a resposta da rota, os contadores, a ordem e a resposta a uma resposta no de cima', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem no sábado?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');

    const first = await comment(call, bia, postId, '  Eu vou!  ');
    const profile = (await read(`users/${bia.uid}`))!;
    expect(first).toEqual({
      status: 200,
      body: {
        id: expect.any(String),
        postId,
        clubId: owner.clubId,
        author: {
          uid: bia.uid,
          name: 'Bia Santos',
          username: profile.username,
          photoURL: null,
        },
        isManager: false,
        text: 'Eu vou!',
        mentions: [],
        replyToId: null,
        replyCount: 0,
        createdAt: expect.any(String),
        hidden: null,
        review: null,
        ...NO_REWARDS,
      },
    });
    const c1 = first.body.id as string;
    expect(await read(`fanClubComments/${c1}`)).toEqual({
      clubId: owner.clubId,
      postId,
      artistId: owner.artistId,
      authorUid: bia.uid,
      authorName: 'Bia Santos',
      authorUsername: profile.username,
      authorPhotoURL: null,
      text: 'Eu vou!',
      mentions: [],
      mentionUids: [],
      replyToId: null,
      replyCount: 0,
      managerHiddenReplyCount: 0,
      status: 'visible',
      hiddenAt: null,
      hiddenBy: null,
      restoredByStaffAt: null,
      reviewRequestedAt: null,
      reviewOutcome: null,
      createdAt: expect.any(Timestamp),
      schemaVersion: 1,
    });

    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Eu também!')).body.id as string;
    clock.offset += 1_000;
    const r1 = await comment(call, duda, postId, 'Bora juntas!', c1);
    expect(r1.body).toMatchObject({ replyToId: c1, replyCount: 0 });
    clock.offset += 1_000;
    // A resposta a uma resposta vai para o comentário de cima dela (R7).
    const r2 = await comment(call, owner.fan, postId, 'Guardo um lugar!', r1.body.id as string);
    expect(r2.body).toMatchObject({ replyToId: c1, isManager: true });

    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ commentCount: 4 });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({ replyCount: 2 });
    expect(await read(`fanClubComments/${c2}`)).toMatchObject({ replyCount: 0 });
    expect(await read(`fanClubComments/${r1.body.id as string}`)).toMatchObject({
      replyToId: c1,
      replyCount: 0,
    });
    // O dia da taxa: os três dos fãs; o do gestor fica de fora (37.11).
    expect(await dayCount(owner.clubId, 'comments')).toBe(3);
    expect(await capCount(bia.uid, 'fanclub_comment_sent')).toBe(1);
    expect(await capCount(duda.uid, 'fanclub_comment_sent')).toBe(2);

    // Os de cima, do mais novo; as respostas, só pelo `replyTo`, da mais antiga.
    const top = await comments(call, bia, postId);
    expect(top.status).toBe(200);
    expect(ids(top)).toEqual([c2, c1]);
    expect(top.body.items).toEqual([
      expect.objectContaining({ id: c2, replyCount: 0, replyToId: null }),
      expect.objectContaining({ id: c1, replyCount: 2, replyToId: null }),
    ]);
    expect(top.body.nextCursor).toBeNull();
    const replies = await comments(call, bia, postId, { replyTo: c1 });
    expect(ids(replies)).toEqual([r1.body.id, r2.body.id]);
    expect(replies.body.items).toEqual([
      expect.objectContaining({ replyToId: c1, isManager: false }),
      expect.objectContaining({ replyToId: c1, isManager: true }),
    ]);
    // Uma resposta não tem respostas: o `replyTo` é só de comentário de cima.
    for (const replyTo of [r1.body.id as string, 'naoexiste']) {
      expect(await comments(call, bia, postId, { replyTo })).toMatchObject({
        status: 404,
        body: { code: 'fan_club_comment_not_found' },
      });
    }

    // As páginas, com o cursor `[createdAt, id]`.
    const one = await comments(call, bia, postId, { limit: '1' });
    expect(ids(one)).toEqual([c2]);
    const two = await comments(call, bia, postId, {
      limit: '1',
      cursor: one.body.nextCursor as string,
    });
    expect(ids(two)).toEqual([c1]);
    expect(two.body.nextCursor).toBeNull();
    const firstReply = await comments(call, bia, postId, { replyTo: c1, limit: '1' });
    expect(ids(firstReply)).toEqual([r1.body.id]);
    const lastReply = await comments(call, bia, postId, {
      replyTo: c1,
      limit: '1',
      cursor: firstReply.body.nextCursor as string,
    });
    expect(ids(lastReply)).toEqual([r2.body.id]);
    expect(lastReply.body.nextCursor).toBeNull();
  });

  it('o comentário respondido de outra publicação, que não existe ou fora do formato: 404, sem gravar', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Primeira publicação');
    const otherPost = await publish(call, admin, owner, 'Segunda publicação');
    const bia = await follower(call, owner, 'Bia Santos');
    const elsewhere = (await comment(call, bia, otherPost, 'Aqui!')).body.id as string;

    for (const replyToId of [elsewhere, 'naoexiste', '__c1__']) {
      expect(await comment(call, bia, postId, 'Respondendo', replyToId)).toMatchObject({
        status: 404,
        body: { code: 'fan_club_comment_not_found' },
      });
    }
    expect(await read(`fanClubPosts/${postId}`)).not.toHaveProperty('commentCount');
    expect(await read(`fanClubComments/${elsewhere}`)).toMatchObject({ replyCount: 0 });
    expect(await capCount(bia.uid, 'fanclub_comment_sent')).toBe(1);
  });

  it('o texto pelas regras do comentário do Mural, e o teto `club_comment`', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi({}, { fanclub_comment_sent: 1 });
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');

    expect(await comment(call, bia, postId, '   ')).toMatchObject({
      status: 400,
      body: { code: 'comment_invalid', details: { reason: 'empty' } },
    });
    expect(await comment(call, bia, postId, 'a'.repeat(501))).toMatchObject({
      status: 400,
      body: { code: 'comment_invalid', details: { reason: 'too_long' } },
    });
    expect((await comment(call, bia, postId, 'a'.repeat(500))).status).toBe(200);
    expect(await comment(call, bia, postId, 'De novo')).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 1, action: 'club_comment' } },
    });
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({ commentCount: 1 });
  });

  it('o bloqueio: quem bloqueou não vê os comentários do bloqueado nem as respostas embaixo deles', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Bora?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');

    const fromBia = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const fromDuda = (await comment(call, duda, postId, 'Eu também!')).body.id as string;
    clock.offset += 1_000;
    const reply = (await comment(call, bia, postId, 'Bora juntas!', fromDuda)).body.id as string;
    clock.offset += 1_000;
    const dudaReply = (await comment(call, duda, postId, 'Combinado!', fromBia)).body.id as string;

    expect(
      (
        await call('PUT', `/me/blocks/${duda.uid}`, {
          token: enzo.token,
          key: unique('chave-bloqueia-'),
        })
      ).status,
    ).toBe(200);
    expect(ids(await comments(call, enzo, postId))).toEqual([fromBia]);
    expect(await comments(call, enzo, postId, { replyTo: fromDuda })).toMatchObject({
      status: 404,
      body: { code: 'fan_club_comment_not_found' },
    });
    expect(ids(await comments(call, enzo, postId, { replyTo: fromBia }))).toEqual([]);
    // Responder ao bloqueado (ou embaixo dele) é responder ao que não se vê: 404.
    for (const replyToId of [fromDuda, reply, dudaReply]) {
      expect((await comment(call, enzo, postId, 'Oi', replyToId)).status).toBe(404);
    }
    // Quem não bloqueou vê tudo.
    expect(ids(await comments(call, bia, postId))).toEqual([fromDuda, fromBia]);
    expect(ids(await comments(call, bia, postId, { replyTo: fromDuda }))).toEqual([reply]);

    // No próprio fã-clube, o gestor que bloqueou a Duda continua vendo os
    // comentários dela, para poder ocultá-los, e responde a eles (37.8).
    expect(
      (
        await call('PUT', `/me/blocks/${duda.uid}`, {
          token: owner.fan.token,
          key: unique('chave-bloqueia-'),
        })
      ).status,
    ).toBe(200);
    expect(ids(await comments(call, owner.fan, postId))).toEqual([fromDuda, fromBia]);
    expect(ids(await comments(call, owner.fan, postId, { replyTo: fromBia }))).toEqual([dudaReply]);
    expect((await comment(call, owner.fan, postId, 'Valeu!', fromDuda)).body).toMatchObject({
      replyToId: fromDuda,
      isManager: true,
    });
    // A Duda continua seguindo e comentando (decisão 32 de 34.1).
    expect((await comment(call, duda, postId, 'Até sábado!')).status).toBe(200);
  });
});

describe('a publicação fora do ar (37.3 e decisão 24 de 37.1)', () => {
  it('retirada, em análise, de fã-clube pausado ou de gestor bloqueado: 404 na leitura e nas ações; tirar a reação vale e acerta os números', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Ensaio cancelado.');
    const bia = await follower(call, owner, 'Bia Santos');
    expect((await react(call, bia, postId, 'heart')).status).toBe(200);
    const said = (await comment(call, bia, postId, 'Que pena!')).body.id as string;

    // Em análise: nada.
    const pending = await call('POST', '/me/fan-club/posts', {
      token: owner.fan.token,
      key: unique('chave-publica-'),
      body: { text: 'Ainda em análise', photo: false },
    });
    const pendingId = pending.body.id as string;
    // Tirada do ar pelo gestor: os comentários e as reações ficam, sem rota que os mostre.
    expect(
      (
        await call('DELETE', `/me/fan-club/posts/${postId}`, {
          token: owner.fan.token,
          key: unique('chave-retira-'),
        })
      ).status,
    ).toBe(200);
    for (const id of [postId, pendingId]) {
      for (const sent of [
        await call('GET', `/fan-club-posts/${id}`, { token: bia.token }),
        await comments(call, bia, id),
        await react(call, bia, id, 'fire'),
        await comment(call, bia, id, 'Oi'),
      ]) {
        expect(sent).toMatchObject({ status: 404, body: { code: 'fan_club_post_not_found' } });
      }
    }
    expect(await exists(`fanClubComments/${said}`)).toBe(true);
    // Tirar a reação vale em qualquer status, e os números ficam certos se ela voltar.
    expect(await unreact(call, bia, postId)).toMatchObject({
      status: 200,
      body: { reaction: null, reactionCount: 0 },
    });
    expect(await read(`fanClubPosts/${postId}`)).toMatchObject({
      status: 'removed',
      reactionCount: 0,
      commentCount: 1,
    });

    // O fã-clube pausado e o gestor bloqueado: a publicação no ar some para quem não a vê.
    const live = await publish(call, admin, owner, 'De volta!');
    expect((await call('GET', `/fan-club-posts/${live}`, { token: bia.token })).status).toBe(200);
    expect(
      (
        await call('PUT', `/me/blocks/${owner.fan.uid}`, {
          token: bia.token,
          key: unique('chave-bloqueia-'),
        })
      ).status,
    ).toBe(200);
    for (const sent of [
      await call('GET', `/fan-club-posts/${live}`, { token: bia.token }),
      await comments(call, bia, live),
      await react(call, bia, live, 'heart'),
    ]) {
      expect(sent).toMatchObject({ status: 404, body: { code: 'fan_club_post_not_found' } });
    }
    const duda = await follower(call, owner, 'Duda Lima');
    await db.doc(`fanClubs/${owner.clubId}`).update({ status: 'paused' });
    for (const sent of [
      await call('GET', `/fan-club-posts/${live}`, { token: duda.token }),
      await react(call, duda, live, 'heart'),
      await comment(call, duda, live, 'Oi'),
    ]) {
      expect(sent).toMatchObject({ status: 404, body: { code: 'fan_club_post_not_found' } });
    }
  });
});
