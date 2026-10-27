import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { dayKey, shiftDay } from '../src/day';
import {
  copyFanClubCounts,
  FAN_CLUB_RULES_VERSION,
  removeCommentsPage,
  removeFanClubData,
} from '../src/fan-clubs';
import { fanPhotoFiles, syncFanProfile } from '../src/fan-profile';
import { staticConfigSource } from '../src/points';
import {
  callable,
  central,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
  type Member,
} from './support';

/**
 * A etapa 4 de 37.13 (docs/arquitetura-api.md, seção 37, 37.8 e 37.11): a
 * exclusão da conta do autor (os comentários dele, com as respostas embaixo
 * dos de cima dele saindo antes, e a que chega no meio, junto, as reações, as denúncias de comentário, as
 * marcações dele nos textos dos outros e os contadores, cada um descontando
 * uma vez, com os itens da fila em `author_deleted`, `removed`, `withdrawn` ou
 * abertos pelo pedido de revisão, e o registro do ocultar desligado) e a do
 * gestor (as publicações, em qualquer status, levando antes os comentários e
 * as reações, e o registro do ocultar como gestor apagado), as duas seguras de
 * rodar de novo; as cópias do perfil nos comentários; a taxa de engajamento
 * do `GET /me/fan-club/numbers` (30 dias, os seguidores de agora, sem
 * seguidor null, o gestor fora, a troca de emoji e o oculto que não mexem); e
 * o corte dos dias com mais de 35 dias na cópia da noite. O passo da exclusão
 * roda direto (`removeFanClubData`, depois do perfil apagado, como o
 * `deleteUserData`); o gatilho inteiro, com o `leftovers`, fica no
 * fan-data.emulator.test.ts.
 */
const env = useEmulators('fa-clube-conta', ['api', 'createUserProfile', 'decideFanClub']);
const { db, bucket } = env;
const files = fanPhotoFiles(() => bucket);

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Api = ReturnType<typeof localApi>;

/** O handler no processo com um relógio que o teste adianta (a ordem dos comentários). */
function clockApi() {
  const clock = { offset: 0 };
  const call = localApi(env, {
    now: () => Date.now() + clock.offset,
    config: staticConfigSource(),
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

const unfollow = (call: Api, fan: Fan, clubId: string) =>
  call('DELETE', `/me/fan-club-follows/${clubId}`, {
    token: fan.token,
    key: unique('chave-deixa-'),
  });

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

/** Comenta (ou responde) e devolve o id; a recusa falha o teste. */
async function say(call: Api, fan: Fan, postId: string, text: string, replyToId?: string) {
  const sent = await call('POST', `/fan-club-posts/${postId}/comments`, {
    token: fan.token,
    key: unique('chave-comenta-'),
    body: replyToId === undefined ? { text } : { text, replyToId },
  });
  expect(sent.status, text).toBe(200);
  return sent.body.id as string;
}

const report = (call: Api, fan: Fan, commentId: string) =>
  call('POST', `/fan-club-comments/${commentId}/report`, {
    token: fan.token,
    key: unique('chave-denuncia-'),
    body: { reason: 'spam' },
  });

const review = (call: Api, fan: Fan, commentId: string) =>
  call('POST', `/fan-club-comments/${commentId}/review`, {
    token: fan.token,
    key: unique('chave-revisao-'),
  });

const hide = (call: Api, fan: Fan, commentId: string) =>
  call('PUT', `/me/fan-club/hidden-comments/${commentId}`, {
    token: fan.token,
    key: unique('chave-oculta-'),
  });

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

const handleOf = async (fan: Fan) => (await read(`users/${fan.uid}`))?.username as string;

/** A exclusão como o gatilho faz: o perfil sai primeiro, e então o passo do fã-clube. */
async function deleteAccount(fan: Fan): Promise<void> {
  await db.doc(`users/${fan.uid}`).delete();
  await removeFanClubData(db, fan.uid);
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

const ZERO_COUNTS = { heart: 0, fire: 0, laugh: 0, wow: 0, clap: 0 };

/** Os contadores gravados na publicação; o emoji que nunca mexeu vale 0, como na leitura. */
const countsOf = async (postId: string) => {
  const post = await read(`fanClubPosts/${postId}`);
  return {
    commentCount: post?.commentCount as number,
    reactionCount: post?.reactionCount as number,
    reactionCounts: { ...ZERO_COUNTS, ...(post?.reactionCounts as Record<string, number>) },
  };
};

const queueOf = (commentId: string) => read(`fanClubCommentQueue/${commentId}`);

describe('a exclusão do autor (37.8, passos 1 a 4)', () => {
  it('os comentários e as respostas embaixo dos de cima dele, as reações, as denúncias, as marcações e os contadores, cada um uma vez; de novo, nada muda', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const p1 = await publish(call, admin, owner, 'Quem vem no sábado?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');
    const bh = await handleOf(bia);
    const dh = await handleOf(duda);
    // A publicação do gestor que marca a Bia (resolvida no envio, 37.7).
    const p2 = await publish(call, admin, owner, `Valeu pela força, @${bh}!`);
    expect(await read(`fanClubPosts/${p2}`)).toMatchObject({ mentionUids: [bia.uid] });

    // Na p1: o de cima da Duda marca a Bia e recebe uma resposta dela; o de
    // cima da Bia marca a Duda e recebe três respostas, a do Enzo oculta pelo
    // gestor e uma dela mesma (a página dela traz essa resposta, que a
    // varredura do de cima leva antes: não desconta duas vezes); mais um da
    // Bia, oculto pela equipe, e um do Enzo, que a Bia denuncia e o gestor
    // oculta, com o pedido de revisão do Enzo.
    const d0 = await say(call, duda, p1, `Bora, @${bh}?`);
    clock.offset += 1_000;
    const b1 = await say(call, bia, p1, `Vou com a @${dh}`);
    clock.offset += 1_000;
    const d1 = await say(call, duda, p1, 'Combinado!', b1);
    clock.offset += 1_000;
    const e1 = await say(call, enzo, p1, 'Eu também', b1);
    clock.offset += 1_000;
    const b5 = await say(call, bia, p1, 'Até lá', b1);
    clock.offset += 1_000;
    const b2 = await say(call, bia, p1, 'Fechou!', d0);
    clock.offset += 1_000;
    const b4 = await say(call, bia, p1, 'Esse a equipe ocultou');
    clock.offset += 1_000;
    const e2 = await say(call, enzo, p1, 'Esse o gestor ocultou');
    // Na p2: um da Bia, oculto pelo gestor (a linha do registro com ela como autora).
    const b3 = await say(call, bia, p2, 'Obrigada!');

    expect((await report(call, duda, b1)).status).toBe(200);
    expect((await report(call, enzo, d1)).status).toBe(200);
    expect((await report(call, bia, d0)).status).toBe(200);
    expect((await report(call, bia, e2)).status).toBe(200);
    expect((await hide(call, owner.fan, e1)).status).toBe(200);
    expect((await hide(call, owner.fan, e2)).status).toBe(200);
    expect((await hide(call, owner.fan, b3)).status).toBe(200);
    expect((await review(call, enzo, e2)).status).toBe(200);
    await ok(
      'decideFanClub',
      { subject: 'comment', id: b4, decision: 'hide', expected: 'visible' },
      admin,
    );

    // As reações: a da Bia e a da Duda na p1; a da Bia na p2, tirada (o documento fica).
    expect((await react(call, bia, p1, 'heart')).status).toBe(200);
    expect((await react(call, duda, p1, 'heart')).status).toBe(200);
    expect((await react(call, bia, p2, 'fire')).status).toBe(200);
    expect((await unreact(call, bia, p2)).status).toBe(200);

    // Antes: na p1 aparecem o d0, a b2, o b1, a d1 e a b5 (os ocultos ficam fora).
    expect(await countsOf(p1)).toEqual({
      commentCount: 5,
      reactionCount: 2,
      reactionCounts: { ...ZERO_COUNTS, heart: 2 },
    });
    expect(await read(`fanClubComments/${b1}`)).toMatchObject({
      replyCount: 2,
      managerHiddenReplyCount: 1,
      mentionUids: [duda.uid],
    });
    expect(await read(`fanClubComments/${d0}`)).toMatchObject({
      replyCount: 1,
      mentionUids: [bia.uid],
    });
    expect(await countsOf(p2)).toMatchObject({ commentCount: 0, reactionCount: 0 });
    expect(await queueOf(e2)).toMatchObject({
      kind: 'report',
      reportCount: 1,
      reviewRequested: true,
      status: 'open',
    });
    const reviewRequestedAt = (await queueOf(e2))?.reviewRequestedAt as Timestamp;
    const comments = await dayCount(owner.clubId, 'comments');
    const reactions = await dayCount(owner.clubId, 'reactions');

    await deleteAccount(bia);

    // Os comentários dela saíram, com as respostas da Duda e do Enzo embaixo do de cima dela.
    for (const id of [b1, b2, b3, b4, b5, d1, e1]) {
      expect(await exists(`fanClubComments/${id}`), id).toBe(false);
    }
    expect(
      (await db.collection('fanClubComments').where('authorUid', '==', bia.uid).get()).empty,
    ).toBe(true);
    // Os números: na p1 sobra só o d0 (o e2 está oculto), cada um descontado
    // uma vez; o d0 perde a resposta dela e a marcação dela, com o @ no texto.
    expect(await countsOf(p1)).toEqual({
      commentCount: 1,
      reactionCount: 1,
      reactionCounts: { ...ZERO_COUNTS, heart: 1 },
    });
    expect(await read(`fanClubComments/${d0}`)).toMatchObject({
      text: `Bora, @${bh}?`,
      replyCount: 0,
      mentions: [],
      mentionUids: [],
      status: 'visible',
    });
    expect(await read(`fanClubPosts/${p2}`)).toMatchObject({
      text: `Valeu pela força, @${bh}!`,
      mentions: [],
      mentionUids: [],
      commentCount: 0,
      reactionCount: 0,
    });
    // As reações dela saíram, também a tirada; a da Duda fica.
    expect((await db.collection('fanClubReactions').where('uid', '==', bia.uid).get()).empty).toBe(
      true,
    );
    expect(await exists(`fanClubReactions/${duda.uid}_${p1}`)).toBe(true);
    // A fila: o dela em `author_deleted` (com a autora), a resposta da Duda em
    // `removed`; o d0, sem a denúncia dela, em `withdrawn`; o e2, sem a
    // denúncia, continua aberto pelo pedido de revisão do Enzo.
    expect(await queueOf(b1)).toMatchObject({
      authorUid: bia.uid,
      status: 'resolved',
      resolution: 'author_deleted',
    });
    expect(await queueOf(d1)).toMatchObject({ status: 'resolved', resolution: 'removed' });
    expect(await queueOf(d0)).toMatchObject({
      reportCount: 0,
      reasons: { spam: 0 },
      status: 'resolved',
      resolution: 'withdrawn',
    });
    expect(await queueOf(e2)).toMatchObject({
      kind: 'review',
      reportCount: 0,
      reviewRequested: true,
      status: 'open',
      resolution: null,
      lastActivityAt: reviewRequestedAt,
    });
    expect(
      (await db.collection('fanClubCommentReports').where('reporterUid', '==', bia.uid).get())
        .empty,
    ).toBe(true);
    // As denúncias contra ela ficam (são de quem denunciou).
    expect(await exists(`fanClubCommentReports/${duda.uid}_${b1}`)).toBe(true);
    // O registro do ocultar: a linha dela como autora fica, sem a autora; as do Enzo, inteiras.
    const lines = (await db.collection('fanClubHideLog').where('clubId', '==', owner.clubId).get())
      .docs;
    expect(lines.map((doc) => [doc.get('commentId'), doc.get('authorUid')]).sort()).toEqual(
      [
        [b3, null],
        [e1, enzo.uid],
        [e2, enzo.uid],
      ].sort(),
    );
    // Os dias da taxa não descontam (37.11).
    expect(await dayCount(owner.clubId, 'comments')).toBe(comments);
    expect(await dayCount(owner.clubId, 'reactions')).toBe(reactions);

    // De novo (a nova tentativa do gatilho): nada muda.
    await removeFanClubData(db, bia.uid);
    expect(await countsOf(p1)).toMatchObject({ commentCount: 1, reactionCount: 1 });
    expect(await read(`fanClubComments/${d0}`)).toMatchObject({ replyCount: 0 });
    expect(await queueOf(e2)).toMatchObject({ status: 'open', kind: 'review' });
  });

  it('a nova tentativa do gatilho: a resposta que já saiu não desconta de novo, e a de outro fã que faltou sai antes do de cima', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const p1 = await publish(call, admin, owner, 'Bora?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const b1 = await say(call, bia, p1, 'Eu vou!');
    clock.offset += 1_000;
    const own = await say(call, bia, p1, 'E levo a turma', b1);
    clock.offset += 1_000;
    const d1 = await say(call, duda, p1, 'Eu também', b1);
    expect(await countsOf(p1)).toMatchObject({ commentCount: 3 });
    expect(await read(`fanClubComments/${b1}`)).toMatchObject({ replyCount: 2 });

    // Uma tentativa que caiu no meio: a varredura do b1 levou a resposta dela,
    // com o desconto, e caiu antes da resposta da Duda e do b1.
    await db.runTransaction(async (tx) => {
      tx.delete(db.doc(`fanClubComments/${own}`));
      tx.update(db.doc(`fanClubComments/${b1}`), { replyCount: 1 });
      tx.update(db.doc(`fanClubPosts/${p1}`), { commentCount: 2 });
    });
    // A nova tentativa acha o b1 pelo autor e a resposta da Duda pelo `replyToId`.
    await deleteAccount(bia);
    for (const id of [b1, own, d1]) expect(await exists(`fanClubComments/${id}`), id).toBe(false);
    expect(await countsOf(p1)).toMatchObject({ commentCount: 0 });
  });

  it('a resposta que chega entre a varredura do de cima e a página dele sai junto, com o item em `removed` e o desconto uma vez', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const p1 = await publish(call, admin, owner, 'Bora?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');
    const d0 = await say(call, duda, p1, 'Quem mais vai?');
    clock.offset += 1_000;
    const b1 = await say(call, bia, p1, 'Eu vou!');
    // A varredura das respostas do b1 já passou (não havia nenhuma) quando a
    // resposta da Duda chega, e o Enzo a denuncia; a página do b1 vem depois.
    clock.offset += 1_000;
    const d1 = await say(call, duda, p1, 'Eu também', b1);
    expect((await report(call, enzo, d1)).status).toBe(200);
    expect(await countsOf(p1)).toMatchObject({ commentCount: 3 });
    expect(await read(`fanClubComments/${b1}`)).toMatchObject({ replyCount: 1 });
    expect(await queueOf(d1)).toMatchObject({ status: 'open' });

    // A página do b1, como o passo dos comentários a roda depois da varredura.
    expect(
      await removeCommentsPage(
        db,
        [db.doc(`fanClubComments/${b1}`)],
        bia.uid,
        Date.now(),
        (comment) => comment.authorUid === bia.uid,
      ),
    ).toBe(2);
    for (const id of [b1, d1]) expect(await exists(`fanClubComments/${id}`), id).toBe(false);
    expect((await db.collection('fanClubComments').where('replyToId', '==', b1).get()).empty).toBe(
      true,
    );
    expect(await queueOf(d1)).toMatchObject({
      authorUid: duda.uid,
      status: 'resolved',
      resolution: 'removed',
    });
    // O `1 + replyCount` do b1 já leva a resposta: sobra só o d0.
    expect(await countsOf(p1)).toMatchObject({ commentCount: 1 });
    expect(await exists(`fanClubComments/${d0}`)).toBe(true);

    // A exclusão inteira depois: nada muda.
    await deleteAccount(bia);
    expect(await countsOf(p1)).toMatchObject({ commentCount: 1 });
    expect(await queueOf(d1)).toMatchObject({ resolution: 'removed' });
  });
});

describe('a exclusão do gestor (37.8, passo 5)', () => {
  it('as publicações, em qualquer status, levam antes os comentários e as reações, com a fila em `removed`; o registro do ocultar como gestor sai', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const other = await manager(call, admin, 'Gabi Souza');
    const p1 = await publish(call, admin, owner, 'Quem vem no sábado?');
    const p2 = await publish(call, admin, owner, 'Ensaio aberto');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    // O gestor também comenta fora: na publicação de outra gestora.
    const elsewhere = await publish(call, admin, other, 'Do outro fã-clube');
    expect((await follow(call, owner.fan, other.clubId)).status).toBe(200);
    const outside = await say(call, owner.fan, elsewhere, 'Passando para dar oi');

    const c1 = await say(call, bia, p1, 'Eu vou!');
    clock.offset += 1_000;
    const r1 = await say(call, duda, p1, 'Também', c1);
    clock.offset += 1_000;
    const mine = await say(call, owner.fan, p1, 'Esperamos vocês');
    clock.offset += 1_000;
    const c2 = await say(call, bia, p1, 'Esse o gestor ocultou');
    const c3 = await say(call, bia, p2, 'Que legal');
    expect((await react(call, bia, p1, 'heart')).status).toBe(200);
    expect((await react(call, duda, p1, 'clap')).status).toBe(200);
    expect((await react(call, owner.fan, p1, 'fire')).status).toBe(200);
    expect((await react(call, bia, p2, 'wow')).status).toBe(200);
    expect((await report(call, duda, c1)).status).toBe(200);
    expect((await report(call, bia, mine)).status).toBe(200);
    expect((await hide(call, owner.fan, c2)).status).toBe(200);
    // A p2 sai do ar pelo gestor: os comentários e as reações dela ficam (decisão 24).
    expect(
      (
        await call('DELETE', `/me/fan-club/posts/${p2}`, {
          token: owner.fan.token,
          key: unique('chave-retira-'),
        })
      ).status,
    ).toBe(200);
    expect(await read(`fanClubPosts/${p2}`)).toMatchObject({ status: 'removed' });
    expect(await exists(`fanClubComments/${c3}`)).toBe(true);

    await deleteAccount(owner.fan);

    // As publicações saíram, e nada delas sobrou.
    for (const postId of [p1, p2]) {
      expect(await exists(`fanClubPosts/${postId}`), postId).toBe(false);
      expect(
        (await db.collection('fanClubComments').where('postId', '==', postId).get()).empty,
        postId,
      ).toBe(true);
      expect(
        (await db.collection('fanClubReactions').where('postId', '==', postId).get()).empty,
        postId,
      ).toBe(true);
    }
    for (const id of [c1, r1, mine, c2, c3, outside]) {
      expect(await exists(`fanClubComments/${id}`), id).toBe(false);
    }
    // A fila: o comentário da Bia saiu com a publicação (`removed`); o do gestor, com a conta.
    expect(await queueOf(c1)).toMatchObject({
      authorUid: bia.uid,
      status: 'resolved',
      resolution: 'removed',
    });
    expect(await queueOf(mine)).toMatchObject({
      authorUid: owner.fan.uid,
      status: 'resolved',
      resolution: 'author_deleted',
    });
    // As denúncias dos outros ficam (são de quem denunciou).
    expect(await exists(`fanClubCommentReports/${duda.uid}_${c1}`)).toBe(true);
    // O registro do ocultar como gestor saiu; o fã-clube é lápide.
    expect(
      (await db.collection('fanClubHideLog').where('managerUid', '==', owner.fan.uid).get()).empty,
    ).toBe(true);
    expect(await read(`fanClubs/${owner.clubId}`)).toMatchObject({
      status: 'closed',
      ownerUid: null,
      accountDeleted: true,
    });
    // A outra gestora não perde nada além do comentário dele.
    expect(await exists(`fanClubPosts/${elsewhere}`)).toBe(true);
    expect(await countsOf(elsewhere)).toMatchObject({ commentCount: 0 });

    // De novo: nada a fazer.
    await removeFanClubData(db, owner.fan.uid);
    expect(await queueOf(c1)).toMatchObject({ resolution: 'removed' });
  });
});

describe('as cópias do perfil nos comentários (37.8)', () => {
  it('a troca do nome, do @ e da foto regrava o author* dos comentários do fã nos fã-clubes', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const p1 = await publish(call, admin, owner, 'Bora?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const top = await say(call, bia, p1, 'Eu vou!');
    const reply = await say(call, bia, p1, 'Levo a turma', top);
    const other = await say(call, duda, p1, 'Também');
    const photoURL = 'https://firebasestorage.googleapis.com/v0/b/x/o/fans%2Fbia.jpg?alt=media';

    // A gravação direta também dispara o gatilho de verdade, que pode acertar
    // as cópias antes: a conta exata fica com o teste puro.
    await db.doc(`users/${bia.uid}`).update({
      displayName: 'Bia S.',
      username: 'biasantosnova',
      photoURL,
    });
    const result = await syncFanProfile(db, files, bia.uid, Date.now());
    expect(result).toMatchObject({ deleted: false, fanClubCopies: expect.any(Number) });
    for (const id of [top, reply]) {
      expect(await read(`fanClubComments/${id}`), id).toMatchObject({
        authorName: 'Bia S.',
        authorUsername: 'biasantosnova',
        authorPhotoURL: photoURL,
      });
    }
    // O comentário de outra pessoa não muda.
    expect(await read(`fanClubComments/${other}`)).toMatchObject({ authorName: 'Duda Lima' });
    // De novo: nada a regravar.
    expect((await syncFanProfile(db, files, bia.uid, Date.now())).fanClubCopies).toBe(0);
    // A lista mostra a cópia nova.
    const listed = await call('GET', `/fan-club-posts/${p1}/comments`, {
      token: duda.token,
      query: {},
    });
    expect(listed.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: top,
          author: { uid: bia.uid, name: 'Bia S.', username: 'biasantosnova', photoURL },
        }),
      ]),
    );
  });
});

describe('a taxa de engajamento (37.11)', () => {
  it('30 dias nos shards sobre os seguidores de agora; sem seguidor, null; o gestor, a troca de emoji e o oculto não mexem', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const numbers = async () =>
      (await call('GET', '/me/fan-club/numbers', { token: owner.fan.token })).body.engagement;
    const p1 = await publish(call, admin, owner, 'Bora?');

    // Sem seguidor: null, e o que o gestor faz no próprio fã-clube não conta.
    expect(await say(call, owner.fan, p1, 'Esperamos vocês')).toEqual(expect.any(String));
    expect((await react(call, owner.fan, p1, 'heart')).status).toBe(200);
    expect(await numbers()).toEqual({ reactions30d: 0, comments30d: 0, rate30d: null });

    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const b1 = await say(call, bia, p1, 'Eu vou!');
    await say(call, duda, p1, 'Também', b1);
    const d2 = await say(call, duda, p1, 'Que dia?');
    expect((await react(call, bia, p1, 'fire')).status).toBe(200);
    // Trocar, tirar e reagir de novo não somam: a reação conta uma vez na vida.
    expect((await react(call, bia, p1, 'heart')).status).toBe(200);
    expect((await unreact(call, bia, p1)).status).toBe(200);
    expect((await react(call, bia, p1, 'clap')).status).toBe(200);
    // A Duda segue há mais de 30 dias: conta nos seguidores de agora, não nos dos 30 dias.
    await db
      .doc(`users/${duda.uid}/fanClubFollows/${owner.clubId}`)
      .update({ followedAt: Timestamp.fromMillis(Date.now() - 31 * 24 * 60 * 60 * 1000) });
    expect(
      (await call('GET', '/me/fan-club/numbers', { token: owner.fan.token })).body,
    ).toMatchObject({
      followers: 2,
      followers30d: 1,
      engagement: { reactions30d: 1, comments30d: 3, rate30d: 200 },
    });
    // 1 reação e 3 comentários sobre 2 seguidores: 200%.
    expect(await numbers()).toEqual({ reactions30d: 1, comments30d: 3, rate30d: 200 });

    // O oculto depois não desconta.
    expect((await hide(call, owner.fan, d2)).status).toBe(200);
    expect(await numbers()).toEqual({ reactions30d: 1, comments30d: 3, rate30d: 200 });

    // Só as chaves dos últimos 30 dias contam: o 29º dia para trás entra, o 30º não.
    const today = dayKey(Date.now());
    await db.doc(`fanClubStats/${owner.clubId}/fanClubShards/5`).set(
      {
        days: {
          [shiftDay(today, -29)]: { reactions: 2, comments: 1 },
          [shiftDay(today, -30)]: { reactions: 7, comments: 7 },
        },
      },
      { merge: true },
    );
    expect(await numbers()).toEqual({ reactions30d: 3, comments30d: 4, rate30d: 350 });

    // Os seguidores de agora: a Duda deixa de seguir, e a taxa sobe.
    expect((await unfollow(call, duda, owner.clubId)).status).toBe(200);
    expect(await numbers()).toEqual({ reactions30d: 3, comments30d: 4, rate30d: 700 });
  });
});

describe('o corte dos dias na cópia da noite (37.11)', () => {
  it('apaga os dias com mais de 35 dias, só nos shards que têm, no prazo da cópia; o de 35, o de hoje e o encerrado ficam', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const closed = await manager(call, admin, 'Gabi Souza');
    await ok(
      'decideFanClub',
      { subject: 'club', id: closed.clubId, decision: 'close', expected: 'active' },
      admin,
    );
    const now = Date.now();
    const today = dayKey(now);
    const day = (offset: number) => shiftDay(today, offset);
    const at = Timestamp.fromMillis(now - 60_000);
    const shard = (clubId: string, n: number) =>
      db.doc(`fanClubStats/${clubId}/fanClubShards/${n}`);
    await shard(owner.clubId, 2).set({
      joins: 4,
      updatedAt: at,
      days: {
        [day(0)]: { reactions: 1 },
        [day(-35)]: { comments: 2 },
        [day(-36)]: { reactions: 3 },
        [day(-90)]: { comments: 1 },
      },
    });
    await shard(owner.clubId, 7).set({
      links: 1,
      updatedAt: at,
      days: { [day(-10)]: { reactions: 1 } },
    });
    await shard(owner.clubId, 9).set({ updatedAt: at, days: { [day(-40)]: { comments: 5 } } });
    await shard(closed.clubId, 1).set({ updatedAt: at, days: { [day(-50)]: { reactions: 1 } } });

    const log = { info: vi.fn(), error: vi.fn() };
    expect(await copyFanClubCounts(db, { now, deadline: now + 60_000, log })).toMatchObject({
      selected: 1,
      copied: 1,
      failed: 0,
      daysCut: 3,
    });
    expect(log.error).not.toHaveBeenCalled();
    expect(await read(`fanClubStats/${owner.clubId}/fanClubShards/2`)).toEqual({
      joins: 4,
      updatedAt: at,
      days: { [day(0)]: { reactions: 1 }, [day(-35)]: { comments: 2 } },
    });
    expect(await read(`fanClubStats/${owner.clubId}/fanClubShards/7`)).toEqual({
      links: 1,
      updatedAt: at,
      days: { [day(-10)]: { reactions: 1 } },
    });
    expect(await read(`fanClubStats/${owner.clubId}/fanClubShards/9`)).toEqual({
      updatedAt: at,
      days: {},
    });
    // O encerrado fica fora da cópia: guarda os dias a mais.
    expect(await read(`fanClubStats/${closed.clubId}/fanClubShards/1`)).toMatchObject({
      days: { [day(-50)]: { reactions: 1 } },
    });
    // Os números da cópia continuam a soma dos shards.
    expect((await read(`fanClubs/${owner.clubId}`))?.counts).toMatchObject({ joins: 4, links: 1 });

    // De novo: nada a cortar.
    expect(
      await copyFanClubCounts(db, { now: now + 1_000, deadline: Date.now() + 60_000, log }),
    ).toMatchObject({ copied: 1, daysCut: 0 });
  });
});
