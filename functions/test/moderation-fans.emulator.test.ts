import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  fanPhotoFiles,
  SEED_FAN_DETAILS,
  seedFanDetails,
  seedFanDetailsChanges,
  seedFanPhoto,
} from '../src/fan-profile';
import { hideFanComments, moderate } from '../src/moderation';
import { createConfigSource, runAward, SEED_ACTOR } from '../src/points';
import {
  callable,
  central,
  countShardSum,
  localApi,
  post,
  seedMember,
  show,
  signUpFan,
  unique,
  useEmulators,
  waitFor,
  type CallError,
  type Fan,
  type Member,
} from './support';

/**
 * A suspensão e as ferramentas da Moderação sobre um fã (bloco 11,
 * docs/arquitetura-api.md, 26.4, 26.6 e 26.14): o `setFanSuspended` e a trava
 * na `api` (as rotas que gravam recusam, as que leem e as seis de desfazer e
 * de segurança respondem), o convite do dono suspenso, o código novo recusado,
 * a devolução de um pedido do suspenso, o `hideFanComments` em páginas, o
 * `resetFanUsername` e o `clearFanPhoto` (com o gatilho e a fila das cópias)
 * e, desde o perfil novo (28.6), o `clearFanProfileText`.
 * A regra do perfil e a do Storage com o suspenso ficam nos testes de regras
 * (tests/firestore-rules.test.ts e tests/storage-rules.test.ts).
 */
const MODERATION_FUNCTIONS = [
  'setFanSuspended',
  'hideFanComments',
  'resetFanUsername',
  'clearFanPhoto',
  'clearFanProfileText',
];
const env = useEmulators('moderacao-fas', [
  'api',
  'createUserProfile',
  'queueFanProfileSync',
  'syncFanProfile',
  'createReward',
  'setRewardStatus',
  'setRedemptionStatus',
  ...MODERATION_FUNCTIONS,
]);
const { db, bucket } = env;
const files = fanPhotoFiles(() => bucket);

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

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

/** Quem chama no processo do teste, como o onCall entrega (a sessão de agora). */
const callerOf = (member: Member) => ({
  uid: member.uid,
  token: { auth_time: Math.floor(Date.now() / 1000) },
});

const suspend = (admin: Member, fan: Fan, extra: Record<string, unknown> = {}) =>
  ok('setFanSuspended', { uid: fan.uid, suspended: true, reason: 'spam', ...extra }, admin);

const unsuspend = (admin: Member, fan: Fan) =>
  ok('setFanSuspended', { uid: fan.uid, suspended: false }, admin);

/** Um membro da equipe que também é fã, na mesma conta (o linkStaffInvite). */
async function staffFan(sections: string[]): Promise<Fan> {
  const fan = await signUpFan(db, 'Fã da Equipe');
  const now = Timestamp.now();
  await db.doc(`staff/${fan.uid}`).set({
    uid: fan.uid,
    email: fan.email,
    displayName: 'Fã da Equipe',
    role: 'editor',
    sections,
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

describe('setFanSuspended', () => {
  it('suspende, de novo sem efeito, tira; a auditoria com o motivo e a nota', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Promo Seguidores');
    expect(await suspend(admin, fan, { note: 'Propaganda nos comentários' })).toEqual({
      ok: true,
      suspended: true,
    });
    expect(await read(`users/${fan.uid}`)).toMatchObject({
      suspendedAt: expect.any(Timestamp),
      suspensionReason: 'spam',
    });
    expect(await suspend(admin, fan)).toEqual({ ok: true, suspended: true });
    expect(await audits('fan.suspended')).toEqual([
      expect.objectContaining({
        actorUid: admin.uid,
        targetUid: fan.uid,
        targetEmail: '',
        section: 'moderation',
        targets: [`fan:${fan.uid}`],
        details: { uid: fan.uid, reason: 'spam', note: 'Propaganda nos comentários' },
      }),
    ]);
    // A lista "Fãs suspensos" da Moderação.
    const list = await db
      .collection('users')
      .where('suspendedAt', '!=', null)
      .orderBy('suspendedAt', 'desc')
      .get();
    expect(list.docs.map((doc) => doc.id)).toEqual([fan.uid]);

    expect(await unsuspend(admin, fan)).toEqual({ ok: true, suspended: false });
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile).not.toHaveProperty('suspendedAt');
    expect(profile).not.toHaveProperty('suspensionReason');
    expect(profile).not.toHaveProperty('updatedAt');
    expect(await audits('fan.unsuspended')).toEqual([
      expect.objectContaining({ targetUid: fan.uid, details: { uid: fan.uid } }),
    ]);
    expect(await unsuspend(admin, fan)).toEqual({ ok: true, suspended: false });
    expect(await audits('fan.unsuspended')).toHaveLength(1);
  });

  it('quem usa: a editora com moderation; leitor, outra seção, o próprio uid e o fã que não existe não', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['moderation']);
    const fansOnly = await seedMember(env, 'Fãs', 'editor', ['fans']);
    const self = await staffFan(['moderation']);
    const fan = await signUpFan(db);
    await suspend(editor as Member, fan);
    const input = { uid: fan.uid, suspended: false };
    expect((await failure('setFanSuspended', input, viewer)).details?.reason).toBe('no-section');
    expect((await failure('setFanSuspended', input, fansOnly)).details?.reason).toBe('no-section');
    expect(
      (await failure('setFanSuspended', { uid: self.uid, suspended: true, reason: 'spam' }, self))
        .details?.reason,
    ).toBe('self');
    expect(
      (
        await failure(
          'setFanSuspended',
          { uid: 'naoExiste1', suspended: true, reason: 'spam' },
          editor,
        )
      ).details?.reason,
    ).toBe('fan-not-found');
    expect(
      (await failure('setFanSuspended', { uid: fan.uid, suspended: true, reason: 'x' }, editor))
        .details,
    ).toEqual({ reason: 'invalid-request', field: 'reason' });
  });
});

describe('a api com o fã suspenso', () => {
  it('recusa as rotas que criam ou somam; responde às que leem e às seis de desfazer e de segurança', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Promo Seguidores');
    const other = await signUpFan(db, 'Bia Santos');
    const artistId = await central(env);
    const postId = await post(env, artistId);
    const eventId = await show(env, [artistId], Date.now() + 10 * DAY_MS);
    const call = localApi(env, { now: () => Date.now() });
    const send = (method: string, path: string, body?: unknown) =>
      call(method, path, { token: fan.token, key: unique('chave-suspenso-'), body });

    // Antes da suspensão: entra na central, curte, confirma presença e comenta.
    expect((await send('PUT', `/me/centrals/${artistId}`)).status).toBe(200);
    expect((await send('PUT', `/posts/${postId}/like`)).status).toBe(200);
    expect((await send('PUT', `/events/${eventId}/rsvp`)).status).toBe(200);
    const otherComment = await call('POST', `/posts/${postId}/comments`, {
      token: other.token,
      key: unique('chave-outro-'),
      body: { text: 'Que show!' },
    });
    expect(otherComment.status).toBe(200);

    await suspend(admin, fan);
    const refused = [
      await send('POST', `/posts/${postId}/comments`, { text: 'Sigam meu perfil' }),
      await send('PUT', `/posts/${postId}/like`),
      await send('PUT', `/events/${eventId}/rsvp`),
      await send('PUT', `/me/centrals/${artistId}`),
      await send('POST', '/me/artists', { artistIds: [artistId] }),
      await send('POST', `/posts/${postId}/comments/${String(otherComment.body.id)}/report`, {
        reason: 'spam',
      }),
      await send('PUT', '/me/username', { username: unique('promo') }),
      // O perfil novo (seção 28, decisão 11): o suspenso não edita nada, nem o que esconde.
      await send('PUT', '/me/profile', { bio: 'Sigam meu perfil' }),
      await send('PUT', '/me/profile', { privateAccount: true, bio: null }),
      await send('POST', '/invites/visit', {
        code: 'ABCD2345',
        link: { path: '/' },
        utm: {},
        openedAt: new Date().toISOString(),
      }),
    ];
    for (const result of refused) {
      expect(result).toEqual({
        status: 403,
        body: {
          code: 'account_suspended',
          message: 'Sua conta está suspensa. Fale com a equipe do ImagineUP.',
        },
      });
    }
    // A recusa não grava a chave de idempotência.
    const keys = await db.collection('idempotency').where('uid', '==', fan.uid).get();
    expect(keys.size).toBe(3);

    expect((await call('GET', '/me/wallet', { token: fan.token })).status).toBe(200);
    expect((await call('GET', '/feed', { token: fan.token })).status).toBe(200);

    const allowed = [
      await send('DELETE', `/posts/${postId}/like`),
      await send('DELETE', `/events/${eventId}/rsvp`),
      await send('DELETE', `/me/centrals/${artistId}`),
      await send('DELETE', '/me/photo'),
      await send('PUT', `/me/blocks/${other.uid}`),
      await send('DELETE', `/me/blocks/${other.uid}`),
    ];
    expect(allowed.map((result) => result.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await exists(`users/${fan.uid}/centrals/${artistId}`)).toBe(false);

    // Tirada a suspensão, volta a gravar.
    await unsuspend(admin, fan);
    expect((await send('PUT', `/posts/${postId}/like`)).status).toBe(200);
  });

  it('o código novo do suspenso é recusado; quem já tem código continua lendo o dele', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const withCode = await signUpFan(db);
    const withoutCode = await signUpFan(db);
    const call = localApi(env, { now: () => Date.now() });
    const first = await call('GET', '/me/invite', { token: withCode.token });
    expect(first.status).toBe(200);
    await suspend(admin, withCode);
    await suspend(admin, withoutCode);
    expect(await call('GET', '/me/invite', { token: withCode.token })).toMatchObject({
      status: 200,
      body: { code: first.body.code },
    });
    expect(await call('GET', '/me/invite', { token: withoutCode.token })).toMatchObject({
      status: 403,
      body: { code: 'account_suspended' },
    });
    expect(await exists(`fanInvites/${withoutCode.uid}`)).toBe(false);
  });

  it('o dono de um código suspenso não ganha pela visita nem pelo cadastro; volta a ganhar depois', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const owner = await signUpFan(db, 'Promo Seguidores');
    const call = localApi(env, { now: () => Date.now() });
    const code = (await call('GET', '/me/invite', { token: owner.token })).body.code as string;
    await suspend(admin, owner);

    const visitor = await signUpFan(db);
    const visitBody = () => ({
      code,
      link: { path: '/' },
      utm: {},
      openedAt: new Date().toISOString(),
    });
    expect(
      await call('POST', '/invites/visit', {
        token: visitor.token,
        key: unique('chave-visita-'),
        body: visitBody(),
      }),
    ).toMatchObject({ status: 200, body: { status: 'received' } });
    const invitee = await signUpFan(db);
    expect(
      await call('POST', '/invites/claim', {
        token: invitee.token,
        key: unique('chave-claim-'),
        body: { ...visitBody(), via: 'link' },
      }),
    ).toMatchObject({ status: 200, body: { status: 'claimed' } });
    expect((await db.collection(`wallets/${owner.uid}/ledger`).get()).size).toBe(0);
    expect(await read(`referrals/${invitee.uid}`)).toMatchObject({
      inviterUid: owner.uid,
      award: { visit: 'skipped', signup: 'skipped' },
    });

    await unsuspend(admin, owner);
    const later = await signUpFan(db);
    await call('POST', '/invites/visit', {
      token: later.token,
      key: unique('chave-visita-'),
      body: visitBody(),
    });
    const ledger = await db.collection(`wallets/${owner.uid}/ledger`).get();
    expect(ledger.docs.map((doc) => doc.get('source'))).toEqual(['invite_visit']);
  });

  it('a recusa de um pedido do suspenso devolve os pontos', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db);
    const { points } = await createConfigSource(db, { ttlMs: 0 }).get();
    await runAward(
      db,
      fan.uid,
      [{ kind: 'adjust', source: 'seed', eventId: unique('saldo-'), balance: 10_000 }],
      { now: Date.now(), config: points, actor: SEED_ACTOR },
    );
    const { rewardId } = await ok<{ rewardId: string }>(
      'createReward',
      {
        kind: 'ticket',
        title: 'Par de ingressos',
        subtitle: 'Pra Encher e Derramar',
        cost: 6_000,
        instructions: 'Retire na bilheteria com este código.',
      },
      admin,
    );
    await ok('setRewardStatus', { rewardId, status: 'published' }, admin);
    const call = localApi(env, { now: () => Date.now() });
    const redeemed = await call('POST', `/rewards/${rewardId}/redeem`, {
      token: fan.token,
      key: unique('chave-resgate-'),
      body: { expectedCost: 6_000 },
    });
    expect(redeemed.status).toBe(200);
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(4_000);

    await suspend(admin, fan);
    expect(
      await ok(
        'setRedemptionStatus',
        { redemptionId: redeemed.body.code, status: 'refused', reason: 'Conta suspensa' },
        admin,
      ),
    ).toMatchObject({ status: 'refused', refundedPoints: 6_000 });
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(10_000);
  });
});

describe('hideFanComments', () => {
  /** Comentário pela api, como o app. */
  async function comment(fan: Fan, postId: string, text: string): Promise<string> {
    const call = localApi(env, { now: () => Date.now() });
    const result = await call('POST', `/posts/${postId}/comments`, {
      token: fan.token,
      key: unique('chave-comentario-'),
      body: { text },
    });
    expect(result.status).toBe(200);
    return result.body.id as string;
  }

  it('em páginas (more), com as contagens descontadas uma vez, a fila resolvida e uma auditoria por chamada', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const fan = await signUpFan(db, 'Promo Seguidores');
    const other = await signUpFan(db, 'Bia Santos');
    const artistId = await central(env);
    const [p1, p2] = [await post(env, artistId), await post(env, artistId)];
    const c1 = await comment(fan, p1, 'Sigam meu perfil 1');
    const c2 = await comment(fan, p1, 'Sigam meu perfil 2');
    const c3 = await comment(fan, p2, 'Sigam meu perfil 3');
    const kept = await comment(other, p2, 'Que show!');
    const call = localApi(env, { now: () => Date.now() });
    const report = await call('POST', `/posts/${p1}/comments/${c1}/report`, {
      token: other.token,
      key: unique('chave-denuncia-'),
      body: { reason: 'spam' },
    });
    expect(report.status).toBe(200);
    const caller = callerOf(editor);
    const deps = { db, pageSize: 2, random: () => 0 };

    expect(await hideFanComments(deps, caller, { uid: fan.uid })).toEqual({
      hidden: 2,
      more: true,
    });
    // Um dos ocultos é reexibido no meio: a página seguinte oculta de novo.
    const hiddenNow = (
      await db
        .collectionGroup('postComments')
        .where('authorUid', '==', fan.uid)
        .where('status', '==', 'hidden')
        .get()
    ).docs;
    const back = hiddenNow[0]!;
    await moderate({ db }, caller, {
      postId: back.ref.parent.parent!.id,
      commentId: back.id,
      action: 'restore',
    });
    expect(await hideFanComments(deps, caller, { uid: fan.uid })).toEqual({
      hidden: 2,
      more: true,
    });
    expect(await hideFanComments(deps, caller, { uid: fan.uid })).toEqual({
      hidden: 0,
      more: false,
    });

    for (const [postId, commentId] of [
      [p1, c1],
      [p1, c2],
      [p2, c3],
    ] as const) {
      expect((await read(`posts/${postId}/postComments/${commentId}`))?.status).toBe('hidden');
    }
    expect((await read(`posts/${p2}/postComments/${kept}`))?.status).toBe('visible');
    expect(await countShardSum(db, p1, 'comments')).toBe(0);
    expect(await countShardSum(db, p2, 'comments')).toBe(1);
    expect(await read(`moderationQueue/${c1}`)).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
      resolvedBy: { uid: editor.uid, name: 'Editora' },
    });
    const entries = await audits('fan.comments.hidden');
    expect(entries.map((entry) => entry.details.count)).toEqual([2, 2]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorUid: editor.uid,
        targetUid: fan.uid,
        section: 'moderation',
        details: { uid: fan.uid, postIds: expect.any(Array), commentIds: expect.any(Array) },
      });
      const { postIds, commentIds } = entry.details as { postIds: string[]; commentIds: string[] };
      expect(commentIds).toHaveLength(2);
      expect(entry.targets).toEqual([
        `fan:${fan.uid}`,
        ...postIds.map((id) => `post:${id}`),
        ...commentIds.map((id) => `comment:${id}`),
      ]);
    }
    // Os três comentários aparecem no filtro por comentário dos Logs (o reexibido, duas vezes).
    const byComment = await db
      .collection('staffAudit')
      .where('targets', 'array-contains', `comment:${back.id}`)
      .get();
    expect(byComment.size).toBe(3);
    // Ocultar em lote não grava a auditoria de cada comentário (a reexibição grava a dela).
    expect(await audits('comment.hidden')).toEqual([]);
    expect(await audits('comment.restored')).toHaveLength(1);
  });

  it('quem perde o acesso no meio não oculta nada: o comentário oculto sempre tem a auditoria', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const fan = await signUpFan(db, 'Promo Seguidores');
    const artistId = await central(env);
    const postId = await post(env, artistId);
    const c1 = await comment(fan, postId, 'Sigam meu perfil 1');
    const c2 = await comment(fan, postId, 'Sigam meu perfil 2');
    const deps = {
      db,
      pageSize: 3,
      random: () => 0,
      // A seção sai depois de a página ser lida, antes da transação que oculta.
      onPage: async () => {
        await db.doc(`staff/${editor.uid}`).update({ sections: ['fans'] });
      },
    };
    await expect(hideFanComments(deps, callerOf(editor), { uid: fan.uid })).rejects.toMatchObject({
      details: { reason: 'no-section' },
    });
    for (const commentId of [c1, c2]) {
      expect((await read(`posts/${postId}/postComments/${commentId}`))?.status).toBe('visible');
    }
    expect(await countShardSum(db, postId, 'comments')).toBe(2);
    expect(await audits('fan.comments.hidden')).toEqual([]);
  });

  it('pela callable: o fã sem comentário visível não audita; o próprio uid e o leitor não', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['moderation']);
    const self = await staffFan(['moderation']);
    const fan = await signUpFan(db);
    expect(await ok('hideFanComments', { uid: fan.uid }, editor)).toEqual({
      hidden: 0,
      more: false,
    });
    expect(await audits('fan.comments.hidden')).toEqual([]);
    expect((await failure('hideFanComments', { uid: self.uid }, self)).details?.reason).toBe(
      'self',
    );
    expect((await failure('hideFanComments', { uid: fan.uid }, viewer)).details?.reason).toBe(
      'no-section',
    );
  });
});

describe('resetFanUsername', () => {
  it('um @ automático novo e sem prazo; o antigo livre na hora; a tela velha e a reserva de central recusam', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const previous = (await read(`users/${fan.uid}`))!.username as string;
    const { username } = await ok<{ username: string }>(
      'resetFanUsername',
      { uid: fan.uid, username: `@${previous}` },
      editor,
    );
    expect(username).toMatch(/^fa[0-9]+$/);
    expect(await read(`users/${fan.uid}`)).toMatchObject({
      username,
      usernameChangeableAt: null,
    });
    expect(await exists(`usernames/${previous}`)).toBe(false);
    expect(await read(`usernames/${username}`)).toMatchObject({ uid: fan.uid });
    expect(await audits('fan.username.reset')).toEqual([
      expect.objectContaining({
        targetUid: fan.uid,
        section: 'moderation',
        details: { uid: fan.uid, previous, username },
      }),
    ]);
    await waitFor('as chaves do @ novo', async () => {
      const keys = (await read(`users/${fan.uid}`))?.searchKeys as string[] | undefined;
      return keys?.includes(username.slice(0, 15)) === true;
    });

    // O @ antigo vai para outro fã na hora.
    const other = await signUpFan(db, 'Bia Santos');
    const call = localApi(env, { now: () => Date.now() });
    expect(
      (
        await call('PUT', '/me/username', {
          token: other.token,
          key: unique('chave-arroba-'),
          body: { username: previous },
        })
      ).status,
    ).toBe(200);

    expect(
      (await failure('resetFanUsername', { uid: fan.uid, username: previous }, editor)).details
        ?.reason,
    ).toBe('username-changed');

    // Um fã com o @ de uma central (a reserva sem uid): nada a trocar.
    const handle = unique('centralarroba');
    await central(env, {}, handle);
    await db.doc(`usernames/${handle}`).set({ artistId: handle, createdAt: Timestamp.now() });
    const odd = await signUpFan(db);
    await db.doc(`users/${odd.uid}`).update({ username: handle });
    expect(
      (await failure('resetFanUsername', { uid: odd.uid, username: handle }, editor)).details
        ?.reason,
    ).toBe('username-of-central');
    expect(await read(`usernames/${handle}`)).toMatchObject({ artistId: handle });
  });

  it('o próprio uid, o leitor e a editora sem moderation não', async () => {
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['moderation']);
    const fansOnly = await seedMember(env, 'Fãs', 'editor', ['fans']);
    const self = await staffFan(['moderation']);
    const fan = await signUpFan(db);
    const username = (await read(`users/${fan.uid}`))!.username as string;
    const selfName = (await read(`users/${self.uid}`))!.username as string;
    expect(
      (await failure('resetFanUsername', { uid: self.uid, username: selfName }, self)).details
        ?.reason,
    ).toBe('self');
    for (const member of [viewer, fansOnly]) {
      expect(
        (await failure('resetFanUsername', { uid: fan.uid, username }, member)).details?.reason,
      ).toBe('no-section');
    }
  });

  it('o fã que não existe e o @ fora do formato recusam sem gravar', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const fan = await signUpFan(db);
    const username = (await read(`users/${fan.uid}`))!.username as string;
    expect(
      (await failure('resetFanUsername', { uid: 'naoExiste1', username }, editor)).details?.reason,
    ).toBe('fan-not-found');
    for (const bad of [undefined, 42, 'ab', 'com espaço', `${username}_x`]) {
      expect(
        (await failure('resetFanUsername', { uid: fan.uid, username: bad }, editor)).details,
      ).toEqual({ reason: 'invalid-request', field: 'username' });
    }
    expect((await read(`users/${fan.uid}`))?.username).toBe(username);
    expect(await read(`usernames/${username}`)).toMatchObject({ uid: fan.uid });
    expect(await audits('fan.username.reset')).toEqual([]);
  });
});

describe('clearFanPhoto', () => {
  const JPEG = readFileSync(resolve(__dirname, '../../scripts/seed-assets/foto-teste.jpg'));
  const save = async (path: string, bytes: Uint8Array) => {
    await bucket
      .file(path)
      .save(Buffer.from(bytes), { resumable: false, contentType: 'image/jpeg' });
  };

  it('tira a foto: o arquivo sai pelo gatilho e as cópias nos comentários pela fila', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const self = await staffFan(['moderation']);
    const fan = await signUpFan(db, 'Promo Seguidores');
    expect(await seedFanPhoto(db, files, save, fan.uid, JPEG)).toBe('created');
    const { photoPath } = (await read(`users/${fan.uid}`))!;
    const artistId = await central(env);
    const postId = await post(env, artistId);
    const call = localApi(env, { now: () => Date.now() });
    const commented = await call('POST', `/posts/${postId}/comments`, {
      token: fan.token,
      key: unique('chave-comentario-'),
      body: { text: 'Sigam meu perfil' },
    });
    const commentPath = `posts/${postId}/postComments/${String(commented.body.id)}`;
    expect((await read(commentPath))?.authorPhotoURL).toEqual(expect.any(String));

    expect(await ok('clearFanPhoto', { uid: fan.uid }, editor)).toEqual({ ok: true });
    expect(await read(`users/${fan.uid}`)).toMatchObject({
      photoURL: null,
      photoPath: null,
      photoUpdatedAt: expect.any(Timestamp),
    });
    expect((await read(`users/${fan.uid}`))?.updatedAt).toBeUndefined();
    await waitFor('o arquivo da foto apagado', async () => {
      return !(await bucket.file(photoPath as string).exists())[0];
    });
    await waitFor('a cópia da foto no comentário', async () => {
      return (await read(commentPath))?.authorPhotoURL === null;
    });
    expect(await audits('fan.photo.removed')).toEqual([
      expect.objectContaining({ targetUid: fan.uid, details: { uid: fan.uid } }),
    ]);

    // Sem foto: ok sem gravar nem auditar.
    expect(await ok('clearFanPhoto', { uid: fan.uid }, editor)).toEqual({ ok: true });
    expect(await audits('fan.photo.removed')).toHaveLength(1);
    expect((await failure('clearFanPhoto', { uid: self.uid }, self)).details?.reason).toBe('self');
    expect((await failure('clearFanPhoto', { uid: 'naoExiste1' }, editor)).details?.reason).toBe(
      'fan-not-found',
    );
  });

  it('o leitor e a editora sem moderation não tiram a foto', async () => {
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['moderation']);
    const fansOnly = await seedMember(env, 'Fãs', 'editor', ['fans']);
    const fan = await signUpFan(db, 'Promo Seguidores');
    expect(await seedFanPhoto(db, files, save, fan.uid, JPEG)).toBe('created');
    const before = (await read(`users/${fan.uid}`))!.photoPath as string;
    for (const member of [viewer, fansOnly]) {
      expect((await failure('clearFanPhoto', { uid: fan.uid }, member)).details?.reason).toBe(
        'no-section',
      );
    }
    expect((await read(`users/${fan.uid}`))?.photoPath).toBe(before);
    expect(await audits('fan.photo.removed')).toEqual([]);
  });
});

describe('clearFanProfileText', () => {
  const SPAM = SEED_FAN_DETAILS.find((details) => details.email === 'spam@teste.imagineup')!;

  /** O fã de propaganda do seed, com a bio de spam e duas redes. */
  async function spamFan(): Promise<Fan> {
    const fan = await signUpFan(db, 'Promo Seguidores');
    expect(await seedFanDetails(db, fan.uid, seedFanDetailsChanges(SPAM))).toBe('written');
    return fan;
  }

  it('apaga só a bio, depois só as redes; nada a apagar não grava nem audita; a auditoria sem o texto', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const fan = await spamFan();

    expect(await ok('clearFanProfileText', { uid: fan.uid, fields: ['bio'] }, editor)).toEqual({
      ok: true,
      cleared: ['bio'],
    });
    const afterBio = (await read(`users/${fan.uid}`))!;
    expect(afterBio.bio).toBeNull();
    expect(afterBio.socials).toEqual({
      instagram: 'promo.teste.up',
      tiktok: null,
      linkedin: null,
      x: 'promotesteup',
    });
    expect(afterBio.updatedAt).toBeUndefined();

    // As duas pedidas, só as redes têm o que apagar.
    expect(
      await ok('clearFanProfileText', { uid: fan.uid, fields: ['socials', 'bio'] }, editor),
    ).toEqual({ ok: true, cleared: ['socials'] });
    expect(await read(`users/${fan.uid}`)).toMatchObject({ bio: null, socials: null });

    // Nada a apagar: ok sem gravar nem auditar.
    const before = await db.doc(`users/${fan.uid}`).get();
    expect(
      await ok('clearFanProfileText', { uid: fan.uid, fields: ['bio', 'socials'] }, editor),
    ).toEqual({ ok: true, cleared: [] });
    expect((await db.doc(`users/${fan.uid}`).get()).updateTime!.isEqual(before.updateTime!)).toBe(
      true,
    );

    const entries = await audits('fan.profile.cleared');
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUid: fan.uid,
          targetEmail: '',
          section: 'moderation',
          targets: [`fan:${fan.uid}`],
          details: { uid: fan.uid, fields: ['bio'] },
        }),
        expect.objectContaining({ details: { uid: fan.uid, fields: ['socials'] } }),
      ]),
    );
    // Nunca o texto apagado (decisão 21).
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('Seguidores reais');
    expect(logged).not.toContain('promo.teste.up');

    // O fã escreve outra bio depois, pela API, com o teto do dia.
    const call = localApi(env, { now: () => Date.now() });
    const again = await call('PUT', '/me/profile', {
      token: fan.token,
      key: unique('chave-perfil-'),
      body: { bio: 'Agora só música.' },
    });
    expect(again).toMatchObject({ status: 200, body: { bio: 'Agora só música.' } });
  });

  it('as duas de uma vez, numa auditoria só', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const fan = await spamFan();
    expect(
      await ok('clearFanProfileText', { uid: fan.uid, fields: ['bio', 'socials'] }, editor),
    ).toEqual({ ok: true, cleared: ['bio', 'socials'] });
    expect(await read(`users/${fan.uid}`)).toMatchObject({ bio: null, socials: null });
    expect(await audits('fan.profile.cleared')).toEqual([
      expect.objectContaining({ details: { uid: fan.uid, fields: ['bio', 'socials'] } }),
    ]);
  });

  it('recusas: fan-not-found, self, os campos fora do formato, sem a seção e o Leitor', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['moderation']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['moderation']);
    const fansOnly = await seedMember(env, 'Fãs', 'editor', ['fans']);
    const self = await staffFan(['moderation']);
    const fan = await spamFan();
    const before = await db.doc(`users/${fan.uid}`).get();

    expect(
      (await failure('clearFanProfileText', { uid: 'naoExiste1', fields: ['bio'] }, editor)).details
        ?.reason,
    ).toBe('fan-not-found');
    expect(
      (await failure('clearFanProfileText', { uid: self.uid, fields: ['bio'] }, self)).details
        ?.reason,
    ).toBe('self');
    expect(
      (await failure('clearFanProfileText', { uid: 'com espaço', fields: ['bio'] }, editor))
        .details,
    ).toEqual({ reason: 'invalid-request', field: 'uid' });
    for (const fields of [
      undefined,
      [],
      'bio',
      ['bio', 'bio'],
      ['foto'],
      ['bio', 'socials', 'bio'],
      ['displayName'],
    ]) {
      expect(
        (await failure('clearFanProfileText', { uid: fan.uid, fields }, editor)).details,
      ).toEqual({ reason: 'invalid-request', field: 'fields' });
    }
    for (const member of [viewer, fansOnly]) {
      expect(
        (await failure('clearFanProfileText', { uid: fan.uid, fields: ['bio'] }, member)).details
          ?.reason,
      ).toBe('no-section');
    }
    expect((await failure('clearFanProfileText', { uid: fan.uid, fields: ['bio'] })).status).toBe(
      'UNAUTHENTICATED',
    );
    const after = await db.doc(`users/${fan.uid}`).get();
    expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(after.get('bio')).toBe(SPAM.bio);
    expect(await audits('fan.profile.cleared')).toEqual([]);
  });
});
