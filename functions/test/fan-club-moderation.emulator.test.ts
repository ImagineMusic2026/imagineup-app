import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { dayKey } from '../src/day';
import { FAN_CLUB_RULES_VERSION } from '../src/fan-clubs';
import { HIDE_FAN_COMMENTS_PAGE, hideFanComments, runFanSuspension } from '../src/moderation';
import { staticConfigSource } from '../src/points';
import { AUDIT_TARGETS_MAX } from '../src/staff/audit-index';
import {
  callable,
  central,
  localApi,
  post,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
  type LocalResult,
  type Member,
} from './support';

/**
 * A moderação dos comentários do fã-clube, a etapa 3 de 37.13
 * (docs/arquitetura-api.md, seção 37, 37.2, 37.3 e 37.6): a denúncia de quem
 * vê, com a fila `fanClubCommentQueue` (o tipo e a rodada) e a rodada nova; o
 * ocultar e o reexibir do gestor, com o registro `fanClubHideLog`, os
 * contadores no de cima com respostas e na resposta, a lista do gestor com os
 * ocultos dele (também de quem ele bloqueou) e o `ownHidden` só para o autor;
 * o pedido de revisão, uma vez por ocultar, com o `already_requested` e o
 * `withdrawn` do reexibir do gestor; as recusas (`own_comment`,
 * `staff_decided`, `club_not_active` e o 403 do suspenso); a `decideFanClub`
 * com o assunto `comment` (cada decisão da tabela de 37.6, o item aberto
 * resolvido pelo Ocultar e pelo Reexibir sem a rodada, o Reexibir do oculto
 * pelo gestor, o `stale-decision` pelo status e, no Manter, pela rodada, o
 * `ok` sem auditar, o `self` da autora e do gestor); e o ocultar em lote da
 * Moderação com as duas etapas e os 50 alvos da auditoria.
 */
const env = useEmulators('fa-clube-moderacao', ['api', 'createUserProfile', 'decideFanClub']);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Api = ReturnType<typeof localApi>;

const NOT_FOUND = { status: 404, body: { code: 'fan_club_comment_not_found' } };

const EMPTY_REASONS = { spam: 0, offensive: 0, harassment: 0, other: 0, none: 0 };

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

/** A `decideFanClub` com o assunto `comment`: o resultado ou o erro, como o painel recebe. */
const decide = (who: Pick<Member, 'token'>, data: Record<string, unknown>) =>
  callable(env, 'decideFanClub', { subject: 'comment', ...data }, who.token);

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

const comment = (call: Api, fan: Fan, postId: string, text: string, replyToId?: string) =>
  call('POST', `/fan-club-posts/${postId}/comments`, {
    token: fan.token,
    key: unique('chave-comenta-'),
    body: replyToId === undefined ? { text } : { text, replyToId },
  });

const comments = (call: Api, fan: Fan, postId: string, query: Record<string, string> = {}) =>
  call('GET', `/fan-club-posts/${postId}/comments`, { token: fan.token, query });

const report = (call: Api, fan: Fan, commentId: string, reason?: string | null) =>
  call('POST', `/fan-club-comments/${commentId}/report`, {
    token: fan.token,
    key: unique('chave-denuncia-'),
    body: reason === undefined ? {} : { reason },
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

const unhide = (call: Api, fan: Fan, commentId: string) =>
  call('DELETE', `/me/fan-club/hidden-comments/${commentId}`, {
    token: fan.token,
    key: unique('chave-reexibe-'),
  });

const block = (call: Api, fan: Fan, fanId: string) =>
  call('PUT', `/me/blocks/${fanId}`, { token: fan.token, key: unique('chave-bloqueia-') });

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

/** Um fã que também é da equipe, na mesma conta (o linkStaffInvite), com a seção Fã-clubes. */
async function asStaff(fan: Fan): Promise<Fan> {
  const now = Timestamp.now();
  await db.doc(`staff/${fan.uid}`).set({
    uid: fan.uid,
    email: fan.email,
    displayName: 'Fã da Equipe',
    role: 'editor',
    sections: ['fanClubs'],
    status: 'active',
    accountCreatedByInvite: false,
    inviteId: 'semente',
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  return fan;
}

/** O contador do teto do dia na carteira. */
async function capCount(uid: string, key: string): Promise<number> {
  const wallet = await read(`wallets/${uid}`);
  return (wallet?.days?.[dayKey(Date.now())]?.count?.[key] as number | undefined) ?? 0;
}

async function audits(action: string) {
  const snap = await db.collection('staffAudit').where('action', '==', action).get();
  return snap.docs.map((doc) => doc.data());
}

/** O registro do ocultar do gestor de um fã-clube. */
async function hideLog(clubId: string) {
  const snap = await db.collection('fanClubHideLog').where('clubId', '==', clubId).get();
  return snap.docs.map((doc) => doc.data());
}

const commentCountOf = async (postId: string) =>
  (await read(`fanClubPosts/${postId}`))?.commentCount as number;

type CommentItem = Record<string, unknown> & { id: string };

const itemsOf = (sent: LocalResult) => sent.body.items as CommentItem[];

const ids = (sent: LocalResult) => itemsOf(sent).map((item) => item.id);

/** Quem chama no processo do teste, como o onCall entrega (a sessão de agora). */
const callerOf = (member: Member) => ({
  uid: member.uid,
  token: { auth_time: Math.floor(Date.now() / 1000) },
});

describe('a denúncia de comentário (37.3 e 37.6)', () => {
  it('de quem vê, sem seguir: o item nasce com o tipo e a rodada e soma; a mesma pessoa na rodada não conta de novo; o próprio é 400', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem no sábado?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const visitor = await signUpFan(db, 'Enzo Rocha');
    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;

    // Quem só vê o fã-clube denuncia: ler e denunciar não pedem seguir (37.6).
    expect(await report(call, visitor, c1, 'spam')).toEqual({
      status: 200,
      body: { commentId: c1, status: 'reported' },
    });
    expect(await read(`fanClubCommentQueue/${c1}`)).toEqual({
      commentId: c1,
      postId,
      clubId: owner.clubId,
      artistId: owner.artistId,
      authorUid: bia.uid,
      kind: 'report',
      reportCount: 1,
      reasons: { ...EMPTY_REASONS, spam: 1 },
      reviewRequested: false,
      status: 'open',
      resolution: null,
      round: 1,
      openedAt: expect.any(Timestamp),
      firstReportedAt: expect.any(Timestamp),
      lastReportedAt: expect.any(Timestamp),
      reviewRequestedAt: null,
      lastActivityAt: expect.any(Timestamp),
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
    // A denúncia guarda quem denunciou e a rodada, nunca o texto.
    expect(await read(`fanClubCommentReports/${visitor.uid}_${c1}`)).toEqual({
      commentId: c1,
      postId,
      clubId: owner.clubId,
      reporterUid: visitor.uid,
      reason: 'spam',
      round: 1,
      reportedAt: expect.any(Timestamp),
      day: dayKey(Date.now()),
      schemaVersion: 1,
    });
    expect(await capCount(visitor.uid, 'comment_report')).toBe(1);

    // De novo na mesma rodada: sem contar e sem teto.
    expect((await report(call, visitor, c1, 'offensive')).body).toEqual({
      commentId: c1,
      status: 'already_reported',
    });
    expect(await capCount(visitor.uid, 'comment_report')).toBe(1);

    // Outra pessoa, sem motivo: soma no item aberto.
    clock.offset += 1_000;
    expect((await report(call, duda, c1)).body).toEqual({ commentId: c1, status: 'reported' });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      kind: 'report',
      reportCount: 2,
      reasons: { ...EMPTY_REASONS, spam: 1, none: 1 },
      round: 1,
      status: 'open',
    });

    // A denúncia não esconde o comentário de ninguém.
    expect(ids(await comments(call, duda, postId))).toEqual([c1]);
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({ status: 'visible' });

    // O próprio: 400 `own_comment`, como no Mural, sem gravar nada.
    expect(await report(call, bia, c1, 'spam')).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { reason: 'own_comment' } },
    });
    expect(await exists(`fanClubCommentReports/${bia.uid}_${c1}`)).toBe(false);
  });

  it('fora da vista de quem denuncia, 404: o que não existe, o oculto pelo gestor, o de quem ele bloqueou, a resposta embaixo de um de cima que ele não vê e a publicação fora do ar', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Bora?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');
    const gil = await follower(call, owner, 'Gil Souza');

    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const r1 = (await comment(call, duda, postId, 'Bora juntas!', c1)).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Eu também!')).body.id as string;

    expect(await report(call, enzo, 'naoexiste', 'spam')).toMatchObject(NOT_FOUND);
    // O Enzo bloqueou a Bia: o comentário dela e a resposta embaixo dele somem para ele.
    expect((await block(call, enzo, bia.uid)).status).toBe(200);
    expect(await report(call, enzo, c1, 'spam')).toMatchObject(NOT_FOUND);
    expect(await report(call, enzo, r1, 'spam')).toMatchObject(NOT_FOUND);
    expect((await report(call, enzo, c2, 'spam')).status).toBe(200);

    // O gestor oculta o c1: ninguém mais o denuncia, nem a resposta embaixo dele.
    expect((await hide(call, owner.fan, c1)).status).toBe(200);
    expect(await report(call, gil, c1, 'spam')).toMatchObject(NOT_FOUND);
    expect(await report(call, gil, r1, 'spam')).toMatchObject(NOT_FOUND);

    // A publicação tirada do ar: os comentários dela não se denunciam.
    expect(
      (
        await call('DELETE', `/me/fan-club/posts/${postId}`, {
          token: owner.fan.token,
          key: unique('chave-retira-'),
        })
      ).status,
    ).toBe(200);
    expect(await report(call, gil, c2, 'spam')).toMatchObject(NOT_FOUND);

    // Nenhum 404 gravou denúncia, item ou teto.
    expect(await exists(`fanClubCommentQueue/${c1}`)).toBe(false);
    expect(await exists(`fanClubCommentQueue/${r1}`)).toBe(false);
    expect(await exists(`fanClubCommentReports/${gil.uid}_${c2}`)).toBe(false);
    expect(await read(`fanClubCommentQueue/${c2}`)).toMatchObject({ reportCount: 1 });
    expect(await capCount(gil.uid, 'comment_report')).toBe(0);
  });

  it('a rodada nova: o item resolvido reabre na rodada seguinte, aberto pela denúncia; quem denunciou antes só conta de novo na rodada nova', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Bora?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');
    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;

    expect((await report(call, duda, c1, 'spam')).status).toBe(200);
    const before = (await read(`fanClubCommentQueue/${c1}`))!;
    expect(
      await decide(admin, { id: c1, decision: 'keep', expected: 'visible', round: 1 }),
    ).toEqual({ result: { ok: true, subject: 'comment', id: c1, status: 'visible' } });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
      round: 1,
    });

    // A mesma pessoa na mesma rodada não reabre.
    expect((await report(call, duda, c1, 'spam')).body).toMatchObject({
      status: 'already_reported',
    });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({ status: 'resolved', round: 1 });

    // Outra pessoa reabre na rodada 2, com a contagem do zero; o `firstReportedAt` fica.
    clock.offset += 1_000;
    expect((await report(call, enzo, c1, 'harassment')).body).toMatchObject({
      status: 'reported',
    });
    const reopened = (await read(`fanClubCommentQueue/${c1}`))!;
    expect(reopened).toMatchObject({
      kind: 'report',
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      round: 2,
      reportCount: 1,
      reasons: { ...EMPTY_REASONS, harassment: 1 },
      reviewRequested: false,
      firstReportedAt: before.firstReportedAt,
    });
    expect((reopened.openedAt as Timestamp).toMillis()).toBeGreaterThan(
      (before.openedAt as Timestamp).toMillis(),
    );
    // A Duda, da rodada 1, conta na rodada 2.
    expect((await report(call, duda, c1, 'spam')).body).toMatchObject({ status: 'reported' });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({ round: 2, reportCount: 2 });
    expect(await read(`fanClubCommentReports/${duda.uid}_${c1}`)).toMatchObject({ round: 2 });
  });
});

describe('o ocultar e o reexibir do gestor (37.3 e 37.6)', () => {
  it('o de cima com respostas: os contadores, o registro, a lista do gestor (também com quem ele bloqueou) e o `ownHidden` só para a autora; reexibir devolve tudo', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');

    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const r1 = (await comment(call, duda, postId, 'Bora juntas!', c1)).body.id as string;
    clock.offset += 1_000;
    const r2 = (await comment(call, enzo, postId, 'Eu também!', c1)).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Quem leva a faixa?')).body.id as string;
    expect(await commentCountOf(postId)).toBe(4);

    // O gestor bloqueou a Bia: no próprio fã-clube, ele continua vendo e oculta (37.8).
    expect((await block(call, owner.fan, bia.uid)).status).toBe(200);
    expect(await hide(call, owner.fan, c1)).toEqual({
      status: 200,
      body: { commentId: c1, hidden: true },
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      status: 'manager_hidden',
      hiddenBy: owner.fan.uid,
      hiddenAt: expect.any(Timestamp),
      reviewRequestedAt: null,
      reviewOutcome: null,
      restoredByStaffAt: null,
      replyCount: 2,
    });
    // O de cima leva as respostas visíveis da vista: 4 - (1 + 2).
    expect(await commentCountOf(postId)).toBe(1);
    expect(await hideLog(owner.clubId)).toEqual([
      {
        clubId: owner.clubId,
        postId,
        commentId: c1,
        authorUid: bia.uid,
        managerUid: owner.fan.uid,
        action: 'hidden',
        at: expect.any(Timestamp),
        schemaVersion: 1,
      },
    ]);
    // O ocultar do gestor nunca vai ao staffAudit.
    expect(
      (
        await db
          .collection('staffAudit')
          .where('targets', 'array-contains', `fanClubComment:${c1}`)
          .get()
      ).size,
    ).toBe(0);

    // Para os outros, o c1 some com as respostas.
    const dudaPage = await comments(call, duda, postId);
    expect(ids(dudaPage)).toEqual([c2]);
    expect(dudaPage.body.ownHidden).toEqual([]);
    expect(await comments(call, duda, postId, { replyTo: c1 })).toMatchObject(NOT_FOUND);
    // Para a autora, some da lista e volta no `ownHidden`, com o "Oculto pelo gestor".
    const biaPage = await comments(call, bia, postId);
    expect(ids(biaPage)).toEqual([c2]);
    const own = biaPage.body.ownHidden as CommentItem[];
    expect(own).toEqual([
      expect.objectContaining({
        id: c1,
        replyToId: null,
        replyCount: 2,
        hidden: 'manager',
        review: null,
      }),
    ]);
    expect(own[0]).not.toHaveProperty('hiddenReplyCount');
    // O `ownHidden` só vem na primeira página dos de cima.
    expect((await comments(call, bia, postId, { replyTo: c2 })).body).not.toHaveProperty(
      'ownHidden',
    );
    // Para o gestor, na lista, com o "Oculto por você", e as respostas abrem.
    const ownerPage = await comments(call, owner.fan, postId);
    expect(ownerPage.body).not.toHaveProperty('ownHidden');
    expect(itemsOf(ownerPage)).toEqual([
      expect.objectContaining({ id: c2, hidden: null, review: null, hiddenReplyCount: 0 }),
      expect.objectContaining({
        id: c1,
        hidden: 'manager',
        review: null,
        replyCount: 2,
        hiddenReplyCount: 0,
      }),
    ]);
    expect(ids(await comments(call, owner.fan, postId, { replyTo: c1 }))).toEqual([r1, r2]);
    // A resposta nunca nasce embaixo de um oculto, nem a do gestor.
    expect(await comment(call, owner.fan, postId, 'Oi', c1)).toMatchObject(NOT_FOUND);

    // De novo: a mesma resposta, sem gravar.
    expect(await hide(call, owner.fan, c1)).toEqual({
      status: 200,
      body: { commentId: c1, hidden: true },
    });
    expect(await hideLog(owner.clubId)).toHaveLength(1);
    expect(await commentCountOf(postId)).toBe(1);

    // Reexibir: tudo volta, com a linha `restored`.
    expect(await unhide(call, owner.fan, c1)).toEqual({
      status: 200,
      body: { commentId: c1, hidden: false },
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      status: 'visible',
      hiddenAt: null,
      hiddenBy: null,
      restoredByStaffAt: null,
    });
    expect(await commentCountOf(postId)).toBe(4);
    expect((await hideLog(owner.clubId)).map((row) => row.action).sort()).toEqual([
      'hidden',
      'restored',
    ]);
    expect(ids(await comments(call, duda, postId))).toEqual([c2, c1]);
    expect((await comments(call, bia, postId)).body.ownHidden).toEqual([]);
    // Reexibir o visível: só o que ele ocultou, o resto é 404.
    expect(await unhide(call, owner.fan, c1)).toMatchObject(NOT_FOUND);
  });

  it('a resposta: o `replyCount` e o `managerHiddenReplyCount` do de cima e o `hiddenReplyCount` do gestor; com o de cima oculto, o `commentCount` não conta de novo', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');

    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const r1 = (await comment(call, duda, postId, 'Bora juntas!', c1)).body.id as string;
    clock.offset += 1_000;
    const r2 = (await comment(call, enzo, postId, 'Eu também!', c1)).body.id as string;

    expect((await hide(call, owner.fan, r1)).status).toBe(200);
    expect(await commentCountOf(postId)).toBe(2);
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      replyCount: 1,
      managerHiddenReplyCount: 1,
    });
    // O gestor vê a resposta oculta e o "Ver N respostas" com as duas.
    expect(itemsOf(await comments(call, owner.fan, postId))).toEqual([
      expect.objectContaining({ id: c1, replyCount: 1, hiddenReplyCount: 1 }),
    ]);
    expect(itemsOf(await comments(call, owner.fan, postId, { replyTo: c1 }))).toEqual([
      expect.objectContaining({ id: r1, hidden: 'manager' }),
      expect.objectContaining({ id: r2, hidden: null }),
    ]);
    // A Bia vê só a r2, e nada diz que há resposta oculta.
    const biaTop = itemsOf(await comments(call, bia, postId));
    expect(biaTop).toEqual([expect.objectContaining({ id: c1, replyCount: 1 })]);
    expect(biaTop[0]).not.toHaveProperty('hiddenReplyCount');
    expect(ids(await comments(call, bia, postId, { replyTo: c1 }))).toEqual([r2]);
    // A Duda, autora da resposta, a vê no `ownHidden`, com o de cima dela.
    expect((await comments(call, duda, postId)).body.ownHidden).toEqual([
      expect.objectContaining({ id: r1, replyToId: c1, hidden: 'manager', review: null }),
    ]);

    // O de cima oculto depois: as respostas visíveis saem com ele, e a oculta não desconta de novo.
    expect((await hide(call, owner.fan, c1)).status).toBe(200);
    expect(await commentCountOf(postId)).toBe(0);
    // Outra resposta oculta embaixo do de cima oculto: o `commentCount` não muda.
    expect((await hide(call, owner.fan, r2)).status).toBe(200);
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      replyCount: 0,
      managerHiddenReplyCount: 2,
    });
    expect(await commentCountOf(postId)).toBe(0);
    // Reexibir o de cima devolve só ele; cada resposta reexibida volta a contar.
    expect((await unhide(call, owner.fan, c1)).status).toBe(200);
    expect(await commentCountOf(postId)).toBe(1);
    expect((await unhide(call, owner.fan, r1)).status).toBe(200);
    expect((await unhide(call, owner.fan, r2)).status).toBe(200);
    expect(await commentCountOf(postId)).toBe(3);
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      replyCount: 2,
      managerHiddenReplyCount: 0,
    });
    expect(await hideLog(owner.clubId)).toHaveLength(6);
  });

  it('as recusas: o próprio (400), o de outro fã-clube e o oculto pela equipe (404), o reexibido pela equipe (409 `staff_decided`) e o fã-clube pausado (409 `club_not_active`)', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');

    const mine = (await comment(call, owner.fan, postId, 'Guardo um lugar!')).body.id as string;
    expect(await hide(call, owner.fan, mine)).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { reason: 'own_comment' } },
    });
    clock.offset += 1_000;
    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Eu também!')).body.id as string;
    clock.offset += 1_000;
    const c3 = (await comment(call, bia, postId, 'Levo a faixa.')).body.id as string;

    // Outro gestor e um fã qualquer: o comentário não é do fã-clube deles.
    const other = await manager(call, admin, 'Gil Souza');
    for (const who of [other.fan, bia]) {
      expect(await hide(call, who, c2)).toMatchObject(NOT_FOUND);
    }

    // A equipe oculta o c1: some também para o gestor, que não oculta nem reexibe.
    expect((await decide(admin, { id: c1, decision: 'hide', expected: 'visible' })).result).toEqual(
      { ok: true, subject: 'comment', id: c1, status: 'staff_hidden' },
    );
    expect(await hide(call, owner.fan, c1)).toMatchObject(NOT_FOUND);
    expect(await unhide(call, owner.fan, c1)).toMatchObject(NOT_FOUND);
    // A equipe reexibe: a palavra dela vale, e o gestor não oculta de novo (decisão 21).
    expect(
      (await decide(admin, { id: c1, decision: 'restore', expected: 'staff_hidden' })).result,
    ).toMatchObject({ status: 'visible' });
    expect(await hide(call, owner.fan, c1)).toMatchObject({
      status: 409,
      body: { code: 'fan_club_refused', details: { reason: 'staff_decided' } },
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      status: 'visible',
      restoredByStaffAt: expect.any(Timestamp),
    });

    // O fã-clube pausado: nem ocultar nem reexibir.
    expect((await hide(call, owner.fan, c3)).status).toBe(200);
    await ok(
      'decideFanClub',
      { subject: 'club', id: owner.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    const paused = {
      status: 409,
      body: { code: 'fan_club_refused', details: { reason: 'club_not_active' } },
    };
    expect(await hide(call, owner.fan, c2)).toMatchObject(paused);
    expect(await unhide(call, owner.fan, c3)).toMatchObject(paused);
    expect(await read(`fanClubComments/${c2}`)).toMatchObject({ status: 'visible' });
    expect(await read(`fanClubComments/${c3}`)).toMatchObject({ status: 'manager_hidden' });
    expect(await hideLog(owner.clubId)).toHaveLength(1);
  });
});

describe('o pedido de revisão (37.3 e 37.6)', () => {
  it('só a autora e só no oculto pelo gestor; uma vez por ocultar, no teto `report`; o reexibir do gestor retira o pedido; o ocultar novo zera', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const c1 = (await comment(call, bia, postId, 'Alguém vende ingresso?')).body.id as string;

    // Visível: não há o que revisar.
    expect(await review(call, bia, c1)).toMatchObject(NOT_FOUND);
    expect((await hide(call, owner.fan, c1)).status).toBe(200);
    // Ninguém descobre o estado de um comentário alheio.
    for (const who of [duda, owner.fan]) {
      expect(await review(call, who, c1)).toMatchObject(NOT_FOUND);
    }
    expect(await review(call, bia, 'naoexiste')).toMatchObject(NOT_FOUND);

    expect(await review(call, bia, c1)).toEqual({
      status: 200,
      body: { commentId: c1, status: 'requested' },
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      status: 'manager_hidden',
      reviewRequestedAt: expect.any(Timestamp),
      reviewOutcome: null,
    });
    expect(await read(`fanClubCommentQueue/${c1}`)).toEqual({
      commentId: c1,
      postId,
      clubId: owner.clubId,
      artistId: owner.artistId,
      authorUid: bia.uid,
      kind: 'review',
      reportCount: 0,
      reasons: EMPTY_REASONS,
      reviewRequested: true,
      status: 'open',
      resolution: null,
      round: 1,
      openedAt: expect.any(Timestamp),
      firstReportedAt: null,
      lastReportedAt: null,
      reviewRequestedAt: expect.any(Timestamp),
      lastActivityAt: expect.any(Timestamp),
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
    expect(await capCount(bia.uid, 'comment_report')).toBe(1);
    // O "Revisão pedida" é só da autora; o gestor vê o oculto sem o pedido.
    expect((await comments(call, bia, postId)).body.ownHidden).toEqual([
      expect.objectContaining({ id: c1, hidden: 'manager', review: 'requested' }),
    ]);
    expect(itemsOf(await comments(call, owner.fan, postId))).toEqual([
      expect.objectContaining({ id: c1, hidden: 'manager', review: null }),
    ]);

    // De novo neste ocultar: `already_requested`, sem teto.
    expect((await review(call, bia, c1)).body).toEqual({
      commentId: c1,
      status: 'already_requested',
    });
    expect(await capCount(bia.uid, 'comment_report')).toBe(1);

    // O gestor reexibe antes da decisão: o item aberto só pelo pedido sai como `withdrawn`.
    expect((await unhide(call, owner.fan, c1)).status).toBe(200);
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'withdrawn',
      resolvedAt: expect.any(Timestamp),
      resolvedBy: null,
      round: 1,
    });

    // O ocultar novo zera o pedido, e o pedido novo reabre o item na rodada 2.
    clock.offset += 1_000;
    expect((await hide(call, owner.fan, c1)).status).toBe(200);
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      status: 'manager_hidden',
      reviewRequestedAt: null,
      reviewOutcome: null,
    });
    expect((await comments(call, bia, postId)).body.ownHidden).toEqual([
      expect.objectContaining({ id: c1, review: null }),
    ]);
    expect((await review(call, bia, c1)).body).toMatchObject({ status: 'requested' });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      kind: 'review',
      status: 'open',
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      round: 2,
      reportCount: 0,
      reviewRequested: true,
    });
    expect(await capCount(bia.uid, 'comment_report')).toBe(2);
  });

  it('no item aberto por denúncia, o pedido marca o `reviewRequested`; o reexibir do gestor deixa o item aberto, de volta à denúncia', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const c1 = (await comment(call, bia, postId, 'Alguém vende ingresso?')).body.id as string;

    expect((await report(call, duda, c1, 'spam')).status).toBe(200);
    const reported = (await read(`fanClubCommentQueue/${c1}`))!;
    // O ocultar do gestor não fecha o item: a equipe ainda decide.
    expect((await hide(call, owner.fan, c1)).status).toBe(200);
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      status: 'open',
      kind: 'report',
      reportCount: 1,
    });
    clock.offset += 1_000;
    expect((await review(call, bia, c1)).body).toMatchObject({ status: 'requested' });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      kind: 'report',
      status: 'open',
      round: 1,
      reportCount: 1,
      reviewRequested: true,
      reviewRequestedAt: expect.any(Timestamp),
    });

    // O gestor reexibe: a denúncia continua aberta, sem o pedido.
    expect((await unhide(call, owner.fan, c1)).status).toBe(200);
    const after = (await read(`fanClubCommentQueue/${c1}`))!;
    expect(after).toMatchObject({
      kind: 'report',
      status: 'open',
      resolution: null,
      round: 1,
      reportCount: 1,
      reviewRequested: false,
      reviewRequestedAt: null,
    });
    expect(after.lastActivityAt).toEqual(reported.lastReportedAt);
  });

  it('o suspenso não denuncia, não pede revisão e não oculta (403)', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Eu também!')).body.id as string;
    expect((await hide(call, owner.fan, c1)).status).toBe(200);

    const actor = { actor: { uid: admin.uid, name: 'Admin da Equipe' } };
    for (const fan of [bia, owner.fan]) {
      await runFanSuspension(
        db,
        { uid: fan.uid, suspended: true, reason: 'spam', note: null },
        actor,
      );
    }
    for (const sent of [
      await review(call, bia, c1),
      await report(call, bia, c2, 'spam'),
      await hide(call, owner.fan, c2),
      await unhide(call, owner.fan, c1),
    ]) {
      expect(sent).toMatchObject({ status: 403, body: { code: 'account_suspended' } });
    }
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      status: 'manager_hidden',
      reviewRequestedAt: null,
    });
    expect(await read(`fanClubComments/${c2}`)).toMatchObject({ status: 'visible' });
    expect(await exists(`fanClubCommentQueue/${c1}`)).toBe(false);
    expect(await exists(`fanClubCommentQueue/${c2}`)).toBe(false);
  });
});

describe('a decisão da equipe (decideFanClub, assunto comment, 37.6)', () => {
  it('a tabela: Manter, Ocultar e Reexibir, com a fila, os contadores e a auditoria; a repetição e o que não muda nada respondem `ok` sem auditar', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');

    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const r1 = (await comment(call, enzo, postId, 'Bora!', c1)).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Alguém vende ingresso?')).body.id as string;
    expect(await commentCountOf(postId)).toBe(3);
    expect((await report(call, duda, c1, 'spam')).status).toBe(200);
    const by = { uid: admin.uid, name: 'Admin da Equipe' };

    // Manter o visível denunciado: o item vai a `kept`, e a auditoria leva os alvos novos.
    expect(
      await decide(admin, { id: c1, decision: 'keep', expected: 'visible', round: 1 }),
    ).toEqual({ result: { ok: true, subject: 'comment', id: c1, status: 'visible' } });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
      resolvedAt: expect.any(Timestamp),
      resolvedBy: by,
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({ status: 'visible' });
    const kept = await audits('fanClub.comment.kept');
    expect(kept).toEqual([
      expect.objectContaining({
        actorUid: admin.uid,
        targetUid: null,
        section: 'fanClubs',
        details: {
          fanClubCommentId: c1,
          fanClubPostId: postId,
          clubId: owner.clubId,
          authorUid: bia.uid,
          fanUid: owner.fan.uid,
          from: 'visible',
          round: 1,
        },
      }),
    ]);
    expect(kept[0]!.targets).toEqual(
      expect.arrayContaining([
        `fanClubComment:${c1}`,
        `fanClubPost:${postId}`,
        `fanClub:${owner.clubId}`,
        `fan:${bia.uid}`,
        `fan:${owner.fan.uid}`,
      ]),
    );
    for (const target of kept[0]!.targets as string[]) {
      expect(target.startsWith('comment:') || target.startsWith('post:')).toBe(false);
    }
    // O Manter de novo, sem item aberto: `ok`, sem gravar nem auditar.
    expect(
      (await decide(admin, { id: c1, decision: 'keep', expected: 'visible', round: 1 })).result,
    ).toMatchObject({ ok: true, status: 'visible' });
    expect(await audits('fanClub.comment.kept')).toHaveLength(1);

    // O oculto pelo gestor com o pedido de revisão: "Manter oculto".
    expect((await hide(call, owner.fan, c2)).status).toBe(200);
    expect((await review(call, duda, c2)).status).toBe(200);
    expect(
      (await decide(admin, { id: c2, decision: 'keep', expected: 'manager_hidden', round: 1 }))
        .result,
    ).toEqual({ ok: true, subject: 'comment', id: c2, status: 'manager_hidden' });
    expect(await read(`fanClubComments/${c2}`)).toMatchObject({
      status: 'manager_hidden',
      reviewOutcome: 'kept',
    });
    expect(await read(`fanClubCommentQueue/${c2}`)).toMatchObject({
      status: 'resolved',
      resolution: 'kept',
    });
    // "A equipe manteve oculto" para a autora, e o pedido não volta neste ocultar.
    expect((await comments(call, duda, postId)).body.ownHidden).toEqual([
      expect.objectContaining({ id: c2, hidden: 'manager', review: 'kept' }),
    ]);
    expect((await review(call, duda, c2)).body).toMatchObject({ status: 'already_requested' });
    expect(await audits('fanClub.comment.kept')).toHaveLength(2);

    // Ocultar pela equipe o oculto pelo gestor (do diálogo da ficha, sem a
    // rodada): some também para a autora (decisão 22); o `commentCount` não muda.
    expect(await commentCountOf(postId)).toBe(2);
    expect(
      (await decide(admin, { id: c2, decision: 'hide', expected: 'manager_hidden' })).result,
    ).toMatchObject({ status: 'staff_hidden' });
    expect(await read(`fanClubComments/${c2}`)).toMatchObject({
      status: 'staff_hidden',
      hiddenBy: admin.uid,
      hiddenAt: expect.any(Timestamp),
    });
    expect(await read(`fanClubCommentQueue/${c2}`)).toMatchObject({ resolution: 'kept' });
    expect(await commentCountOf(postId)).toBe(2);
    expect((await comments(call, duda, postId)).body.ownHidden).toEqual([]);
    expect(ids(await comments(call, owner.fan, postId))).toEqual([c1]);
    expect(await audits('fanClub.comment.hidden')).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          fanClubCommentId: c2,
          from: 'manager_hidden',
          round: null,
        }),
      }),
    ]);

    // Reexibir pela equipe: visível, com o `restoredByStaffAt`; o gestor não oculta de novo.
    expect(
      (await decide(admin, { id: c2, decision: 'restore', expected: 'staff_hidden' })).result,
    ).toMatchObject({ status: 'visible' });
    expect(await read(`fanClubComments/${c2}`)).toMatchObject({
      status: 'visible',
      hiddenAt: null,
      hiddenBy: null,
      restoredByStaffAt: expect.any(Timestamp),
    });
    expect(await commentCountOf(postId)).toBe(3);
    expect((await hide(call, owner.fan, c2)).body).toMatchObject({
      details: { reason: 'staff_decided' },
    });
    // A repetição do Reexibir: `ok`, sem gravar nem auditar.
    expect(
      (await decide(admin, { id: c2, decision: 'restore', expected: 'staff_hidden' })).result,
    ).toMatchObject({ ok: true, status: 'visible' });
    expect(await audits('fanClub.comment.restored')).toHaveLength(1);

    // Ocultar o de cima com resposta, com a rodada do item já resolvido: a
    // resposta sai junto da vista, e a resolução da rodada troca para `hidden`.
    expect(
      (await decide(admin, { id: c1, decision: 'hide', expected: 'visible', round: 1 })).result,
    ).toMatchObject({ status: 'staff_hidden' });
    expect(await commentCountOf(postId)).toBe(1);
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
      round: 1,
      resolvedBy: by,
    });
    expect(await comments(call, enzo, postId, { replyTo: c1 })).toMatchObject(NOT_FOUND);
    expect(await read(`fanClubComments/${r1}`)).toMatchObject({ status: 'visible' });
    // A autora não vê mais o oculto pela equipe em rota nenhuma.
    expect((await comments(call, bia, postId)).body.ownHidden).toEqual([]);
    // A repetição do Ocultar: `ok`, mesmo com a tela de antes.
    expect(
      (await decide(admin, { id: c1, decision: 'hide', expected: 'visible', round: 1 })).result,
    ).toMatchObject({ ok: true, status: 'staff_hidden' });
    expect(await audits('fanClub.comment.hidden')).toHaveLength(2);

    // Reexibir com a rodada: a resposta volta junto, e a resolução troca para `restored`.
    expect(
      (await decide(admin, { id: c1, decision: 'restore', expected: 'staff_hidden', round: 1 }))
        .result,
    ).toMatchObject({ status: 'visible' });
    expect(await commentCountOf(postId)).toBe(3);
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({ resolution: 'restored' });
  });

  it('o item aberto: o Ocultar e o Reexibir sem a rodada o resolvem; o Reexibir do oculto pelo gestor', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const by = { uid: admin.uid, name: 'Admin da Equipe' };

    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const r1 = (await comment(call, duda, postId, 'Bora!', c1)).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Alguém vende ingresso?')).body.id as string;
    expect(await commentCountOf(postId)).toBe(3);

    // O visível denunciado, ocultado do diálogo da ficha (sem a rodada): o item aberto vai a `hidden`.
    expect((await report(call, bia, c2, 'spam')).status).toBe(200);
    expect(
      (await decide(admin, { id: c2, decision: 'hide', expected: 'visible' })).result,
    ).toMatchObject({ status: 'staff_hidden' });
    expect(await read(`fanClubCommentQueue/${c2}`)).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
      round: 1,
      resolvedAt: expect.any(Timestamp),
      resolvedBy: by,
    });
    expect(await commentCountOf(postId)).toBe(2);
    expect(await audits('fanClub.comment.hidden')).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({ fanClubCommentId: c2, from: 'visible', round: 1 }),
      }),
    ]);

    // A resposta oculta pelo gestor, com o pedido de revisão, reexibida pela equipe sem a rodada.
    expect((await hide(call, owner.fan, r1)).status).toBe(200);
    expect((await review(call, duda, r1)).status).toBe(200);
    expect(await commentCountOf(postId)).toBe(1);
    expect(
      (await decide(admin, { id: r1, decision: 'restore', expected: 'manager_hidden' })).result,
    ).toEqual({ ok: true, subject: 'comment', id: r1, status: 'visible' });
    expect(await read(`fanClubComments/${r1}`)).toMatchObject({
      status: 'visible',
      hiddenAt: null,
      hiddenBy: null,
      restoredByStaffAt: expect.any(Timestamp),
    });
    expect(await read(`fanClubCommentQueue/${r1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'restored',
      round: 1,
      resolvedBy: by,
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({
      replyCount: 1,
      managerHiddenReplyCount: 0,
    });
    expect(await commentCountOf(postId)).toBe(2);
    expect(await audits('fanClub.comment.restored')).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          fanClubCommentId: r1,
          from: 'manager_hidden',
          round: 1,
        }),
      }),
    ]);
    // A palavra da equipe vale: o gestor não oculta de novo.
    expect(await hide(call, owner.fan, r1)).toMatchObject({
      status: 409,
      body: { code: 'fan_club_refused', details: { reason: 'staff_decided' } },
    });
  });

  it('`stale-decision` pelo status e, no Manter, pela rodada; a rodada que falta no Manter; o `self` da autora e do gestor; o comentário que não existe', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const duda = await follower(call, owner, 'Duda Lima');
    const enzo = await follower(call, owner, 'Enzo Rocha');
    const c1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const c2 = (await comment(call, duda, postId, 'Eu também!')).body.id as string;
    expect((await report(call, duda, c1, 'spam')).status).toBe(200);

    const reasonOf = async (data: Record<string, unknown>, who: Pick<Member, 'token'> = admin) =>
      (await decide(who, data)).error?.details;

    // O status da tela diferente do de agora.
    expect(await reasonOf({ id: c1, decision: 'hide', expected: 'manager_hidden' })).toEqual({
      reason: 'stale-decision',
    });
    // O Manter não muda o status: a rodada barra a tela velha.
    expect(await reasonOf({ id: c1, decision: 'keep', expected: 'visible', round: 2 })).toEqual({
      reason: 'stale-decision',
    });
    expect(
      (await decide(admin, { id: c1, decision: 'keep', expected: 'visible', round: 1 })).result,
    ).toMatchObject({ ok: true });
    clock.offset += 1_000;
    expect((await report(call, enzo, c1, 'offensive')).status).toBe(200);
    expect(await reasonOf({ id: c1, decision: 'keep', expected: 'visible', round: 1 })).toEqual({
      reason: 'stale-decision',
    });
    expect(await read(`fanClubCommentQueue/${c1}`)).toMatchObject({ status: 'open', round: 2 });
    expect(
      (await decide(admin, { id: c1, decision: 'keep', expected: 'visible', round: 2 })).result,
    ).toMatchObject({ ok: true });
    // Sem item, a rodada da tela não existe.
    expect(await reasonOf({ id: c2, decision: 'keep', expected: 'visible', round: 1 })).toEqual({
      reason: 'stale-decision',
    });
    // O Manter pede a rodada.
    expect(await reasonOf({ id: c2, decision: 'keep', expected: 'visible' })).toEqual({
      reason: 'invalid-request',
      field: 'round',
    });

    // A autora e o gestor, também da equipe, não decidem: o gestor é parte do ocultar.
    for (const who of [await asStaff(bia), await asStaff(owner.fan)]) {
      expect(await reasonOf({ id: c1, decision: 'hide', expected: 'visible' }, who)).toEqual({
        reason: 'self',
      });
    }
    // Outro membro com a seção decide o mesmo comentário.
    expect(
      (await decide(await asStaff(enzo), { id: c2, decision: 'hide', expected: 'visible' })).result,
    ).toMatchObject({ status: 'staff_hidden' });

    expect(await reasonOf({ id: 'naoexiste', decision: 'hide', expected: 'visible' })).toEqual({
      reason: 'fan-club-comment-not-found',
    });
    expect(await read(`fanClubComments/${c1}`)).toMatchObject({ status: 'visible' });
  });
});

describe('o ocultar em lote da Moderação (hideFanComments, 37.6)', () => {
  it('as duas etapas: o Mural primeiro, depois os fã-clubes (os visíveis e os ocultos pelo gestor), com os contadores, a fila e uma auditoria por página com os alvos novos', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const { clock, call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const bia = await follower(call, owner, 'Bia Santos');
    const spam = await follower(call, owner, 'Promo Seguidores');

    // Um comentário no Mural.
    const artistId = await central(env);
    const muralPost = await post(env, artistId);
    const mural = await call('POST', `/posts/${muralPost}/comments`, {
      token: spam.token,
      key: unique('chave-mural-'),
      body: { text: 'Sigam meu perfil' },
    });
    expect(mural.status).toBe(200);

    // Nos fã-clubes: um de cima denunciado, uma resposta embaixo do da Bia e um oculto pelo gestor.
    const b1 = (await comment(call, bia, postId, 'Eu vou!')).body.id as string;
    clock.offset += 1_000;
    const f1 = (await comment(call, spam, postId, 'Ganhe seguidores!')).body.id as string;
    clock.offset += 1_000;
    const f2 = (await comment(call, spam, postId, 'Chama no perfil!', b1)).body.id as string;
    clock.offset += 1_000;
    const f3 = (await comment(call, spam, postId, 'Promoção só hoje!')).body.id as string;
    expect((await report(call, bia, f1, 'spam')).status).toBe(200);
    expect((await hide(call, owner.fan, f3)).status).toBe(200);
    expect(await commentCountOf(postId)).toBe(3);
    expect((await comments(call, spam, postId)).body.ownHidden).toEqual([
      expect.objectContaining({ id: f3 }),
    ]);

    const caller = callerOf(editor);
    const deps = { db, pageSize: 2, random: () => 0 };
    // O Mural primeiro: a última página dele já diz que há mais nos fã-clubes.
    expect(await hideFanComments(deps, caller, { uid: spam.uid })).toEqual({
      hidden: 1,
      more: true,
    });
    expect(await commentCountOf(postId)).toBe(3);
    // Depois, os fã-clubes, em páginas próprias.
    expect(await hideFanComments(deps, caller, { uid: spam.uid })).toEqual({
      hidden: 2,
      more: true,
    });
    expect(await hideFanComments(deps, caller, { uid: spam.uid })).toEqual({
      hidden: 1,
      more: false,
    });
    expect(await hideFanComments(deps, caller, { uid: spam.uid })).toEqual({
      hidden: 0,
      more: false,
    });

    for (const id of [f1, f2, f3]) {
      expect(await read(`fanClubComments/${id}`)).toMatchObject({
        status: 'staff_hidden',
        hiddenBy: editor.uid,
      });
    }
    expect(await read(`fanClubComments/${b1}`)).toMatchObject({
      status: 'visible',
      replyCount: 0,
      managerHiddenReplyCount: 0,
    });
    // f1 e f2 saíram da vista (o f3 já estava fora): sobra o da Bia.
    expect(await commentCountOf(postId)).toBe(1);
    expect(await read(`fanClubCommentQueue/${f1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
      resolvedBy: { uid: editor.uid, name: 'Editora' },
    });
    // O oculto pela equipe some também para o autor.
    expect((await comments(call, spam, postId)).body.ownHidden).toEqual([]);

    const entries = await audits('fan.comments.hidden');
    expect(entries).toHaveLength(3);
    const clubEntries = entries.filter((entry) => 'fanClubCommentIds' in entry.details);
    expect(clubEntries).toHaveLength(2);
    expect(
      clubEntries.flatMap((entry) => entry.details.fanClubCommentIds as string[]).sort(),
    ).toEqual([f1, f2, f3].sort());
    for (const entry of clubEntries) {
      expect(entry.details).not.toHaveProperty('commentIds');
      expect(entry.details).not.toHaveProperty('postIds');
      expect(entry.details).toMatchObject({ uid: spam.uid, fanClubPostIds: [postId] });
      expect(entry.targets).toEqual([
        `fan:${spam.uid}`,
        `fanClubPost:${postId}`,
        ...(entry.details.fanClubCommentIds as string[]).map((id) => `fanClubComment:${id}`),
      ]);
      expect(entry.section).toBe('moderation');
    }
  });

  it('uma página cheia dos fã-clubes cabe nos 50 alvos da auditoria (1 + 24 + 24)', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const uid = unique('promoLote');
    const batch = db.batch();
    const at = Timestamp.now();
    for (let index = 0; index < HIDE_FAN_COMMENTS_PAGE; index += 1) {
      batch.set(db.doc(`fanClubPosts/lote-pub-${index}`), {
        clubId: 'lote-clube',
        status: 'published',
        commentCount: 1,
      });
      batch.set(db.doc(`fanClubComments/lote-c-${index}`), {
        clubId: 'lote-clube',
        postId: `lote-pub-${index}`,
        artistId: 'lote',
        authorUid: uid,
        text: 'Sigam meu perfil',
        replyToId: null,
        replyCount: 0,
        managerHiddenReplyCount: 0,
        status: 'visible',
        hiddenAt: null,
        hiddenBy: null,
        restoredByStaffAt: null,
        reviewRequestedAt: null,
        reviewOutcome: null,
        createdAt: at,
        schemaVersion: 1,
      });
    }
    await batch.commit();

    const caller = callerOf(editor);
    expect(await hideFanComments({ db }, caller, { uid })).toEqual({
      hidden: HIDE_FAN_COMMENTS_PAGE,
      more: true,
    });
    expect(await hideFanComments({ db }, caller, { uid })).toEqual({ hidden: 0, more: false });
    const [entry] = await audits('fan.comments.hidden');
    expect(entry!.details).toMatchObject({ uid, count: HIDE_FAN_COMMENTS_PAGE });
    expect(entry!.targets).toHaveLength(1 + 2 * HIDE_FAN_COMMENTS_PAGE);
    expect((entry!.targets as string[]).length).toBeLessThanOrEqual(AUDIT_TARGETS_MAX);
    for (let index = 0; index < HIDE_FAN_COMMENTS_PAGE; index += 1) {
      expect(await commentCountOf(`lote-pub-${index}`)).toBe(0);
    }
  });

  it('quem perde o acesso no meio da etapa dos fã-clubes não oculta nada', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const { call } = clockApi();
    const owner = await manager(call, admin);
    const postId = await publish(call, admin, owner, 'Quem vem?');
    const spam = await follower(call, owner, 'Promo Seguidores');
    const f1 = (await comment(call, spam, postId, 'Ganhe seguidores!')).body.id as string;
    const deps = {
      db,
      random: () => 0,
      // A seção sai depois de a página ser lida, antes da transação que oculta.
      onPage: async () => {
        await db.doc(`staff/${editor.uid}`).update({ sections: ['fans'] });
      },
    };
    await expect(hideFanComments(deps, callerOf(editor), { uid: spam.uid })).rejects.toMatchObject({
      details: { reason: 'no-section' },
    });
    expect(await read(`fanClubComments/${f1}`)).toMatchObject({ status: 'visible' });
    expect(await commentCountOf(postId)).toBe(1);
    expect(await audits('fan.comments.hidden')).toEqual([]);
  });
});
