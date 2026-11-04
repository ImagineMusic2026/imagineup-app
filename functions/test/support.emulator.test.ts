import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { DEFAULT_POINTS_CONFIG, dayKey, staticConfigSource } from '../src/points';
import { deleteUserData } from '../src/store';
import { SUPPORT_MESSAGES_PER_DAY } from '../src/support';
import {
  callable,
  http,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
} from './support';

/**
 * O Suporte dos Ajustes nos emuladores (docs/arquitetura-api.md, seção 38,
 * 38.11): o `POST /me/support` pela `api` de verdade, com o teto do dia, a
 * chave e o suspenso, e a callable resolveSupportMessage como o painel chama,
 * com a auditoria. A exclusão de conta leva as mensagens.
 */
const env = useEmulators('suporte', ['api', 'createUserProfile', 'resolveSupportMessage']);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();

const DEVICE = { platform: 'android', osVersion: '14', appVersion: '0.1.0', updateId: '01a1a459' };

const send = (fan: Fan, body: unknown, key: string = unique('chave-suporte-')) =>
  http(env, '/me/support', { method: 'POST', token: fan.token, key, body });

/** As mensagens do dia na carteira. */
const sentToday = async (fan: Fan) =>
  (await read(`wallets/${fan.uid}`))?.days?.[dayKey(Date.now())]?.count?.support_message as
    number | undefined;

const messagesOf = async (fan: Fan) =>
  (await db.collection('supportMessages').where('uid', '==', fan.uid).get()).docs;

describe('mandar uma mensagem (POST /me/support)', () => {
  it('grava o problema com o aparelho, a sugestão e o feedback sem; conta no teto e não vale ponto', async () => {
    const fan = await signUpFan(db, 'Bia Santos');
    // O saldo antes e depois (sem carteira, 0): mandar mensagem não vale ponto.
    const balance = async () =>
      ((await read(`wallets/${fan.uid}`))?.balance as number | undefined) ?? 0;
    const before = await balance();
    const startedAt = Date.now();

    const problem = await send(fan, {
      kind: 'problem',
      text: ' A agenda fica em branco.\r\nDuas vezes hoje. ',
      device: DEVICE,
    });
    expect(problem).toMatchObject({ status: 200, body: { status: 'sent' } });
    const id = problem.body.id as string;
    expect(await read(`supportMessages/${id}`)).toEqual({
      uid: fan.uid,
      kind: 'problem',
      text: 'A agenda fica em branco.\nDuas vezes hoje.',
      device: DEVICE,
      status: 'open',
      createdAt: expect.any(Timestamp),
      resolvedAt: null,
      resolvedBy: null,
      schemaVersion: 1,
    });
    expect(
      ((await read(`supportMessages/${id}`))!.createdAt as Timestamp).toMillis(),
    ).toBeGreaterThanOrEqual(startedAt - 1000);

    expect((await send(fan, { kind: 'idea', text: 'Salvar posts.' })).status).toBe(200);
    expect((await send(fan, { kind: 'feedback', text: 'Amei!', device: null })).status).toBe(200);
    const docs = await messagesOf(fan);
    expect(docs.map((doc) => [doc.get('kind'), doc.get('device')]).sort()).toEqual([
      ['feedback', null],
      ['idea', null],
      ['problem', DEVICE],
    ]);
    expect(await sentToday(fan)).toBe(3);
    expect(await balance()).toBe(before);
  });

  it('o corpo fora do formato: 400 com o campo, sem gravar nem contar', async () => {
    const fan = await signUpFan(db);
    for (const [body, field] of [
      [{ kind: 'bug', text: 'oi' }, 'kind'],
      [{ kind: 'idea', text: '   ' }, 'text'],
      [{ kind: 'idea', text: 'a'.repeat(2_001) }, 'text'],
      [{ kind: 'problem', text: 'oi' }, 'device'],
      [{ kind: 'idea', text: 'oi', device: DEVICE }, 'device'],
      [{ kind: 'idea', text: 'oi', email: 'a@b.c' }, 'email'],
    ] as const) {
      expect(await send(fan, body)).toMatchObject({
        status: 400,
        body: { code: 'invalid_request', details: { field } },
      });
    }
    expect(await messagesOf(fan)).toHaveLength(0);
    expect(await sentToday(fan)).toBeUndefined();
  });

  it('a mesma chave devolve a mesma mensagem, sem gravar outra', async () => {
    const fan = await signUpFan(db);
    const key = unique('chave-repetida-');
    const first = await send(fan, { kind: 'idea', text: 'Modo escuro já tem, amei.' }, key);
    const again = await send(fan, { kind: 'idea', text: 'Modo escuro já tem, amei.' }, key);
    expect(first.status).toBe(200);
    expect(again).toEqual(expect.objectContaining({ status: 200, body: first.body }));
    expect(await messagesOf(fan)).toHaveLength(1);
    expect(await sentToday(fan)).toBe(1);
  });

  it('o teto do dia (aqui 2): o 429 com a ação e o Retry-After, sem gravar', async () => {
    expect(SUPPORT_MESSAGES_PER_DAY).toBe(5);
    const points = {
      ...DEFAULT_POINTS_CONFIG,
      actionCaps: { ...DEFAULT_POINTS_CONFIG.actionCaps, support_message: 2 },
    };
    const call = localApi(env, {
      now: () => Date.now(),
      config: staticConfigSource({ points }),
      withHeaders: true,
    });
    const fan = await signUpFan(db);
    const body = { kind: 'feedback', text: 'Muito bom.' };
    for (let index = 0; index < 2; index += 1) {
      expect(
        (await call('POST', '/me/support', { token: fan.token, key: unique('chave-'), body }))
          .status,
      ).toBe(200);
    }
    const capped = await call('POST', '/me/support', {
      token: fan.token,
      key: unique('chave-'),
      body,
    });
    expect(capped).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 2, action: 'support' } },
    });
    expect(Number(capped.headers!['Retry-After'])).toBeGreaterThan(0);
    expect(await messagesOf(fan)).toHaveLength(2);
    expect(await sentToday(fan)).toBe(2);
  });

  it('o suspenso manda (o caminho dele até a equipe); sem login, 401', async () => {
    const fan = await signUpFan(db);
    await db.doc(`users/${fan.uid}`).update({ suspendedAt: Timestamp.now() });
    expect(
      await send(fan, { kind: 'problem', text: 'Fui suspensa por engano.', device: DEVICE }),
    ).toMatchObject({
      status: 200,
      body: { status: 'sent' },
    });
    expect(await messagesOf(fan)).toHaveLength(1);
    const anonymous = await http(env, '/me/support', {
      method: 'POST',
      key: unique('chave-'),
      body: { kind: 'idea', text: 'oi' },
    });
    expect(anonymous.status).toBe(401);
  });

  it('a exclusão de conta leva as mensagens do fã, e as dos outros ficam', async () => {
    const [gone, stays] = [await signUpFan(db), await signUpFan(db)];
    await send(gone, { kind: 'idea', text: 'Uma.' });
    await send(gone, { kind: 'feedback', text: 'Duas.' });
    await send(stays, { kind: 'idea', text: 'Fica.' });
    await deleteUserData(db, gone.uid);
    expect(await messagesOf(gone)).toHaveLength(0);
    expect(await messagesOf(stays)).toHaveLength(1);
  });
});

describe('resolver e reabrir (resolveSupportMessage)', () => {
  async function messageOf(kind: 'problem' | 'idea' = 'idea') {
    const fan = await signUpFan(db, 'Duda Lima');
    const body =
      kind === 'problem' ? { kind, text: 'Travou.', device: DEVICE } : { kind, text: 'Ideia.' };
    const result = await send(fan, body);
    return { fan, id: result.body.id as string };
  }

  it('o admin resolve e reabre: o estado, quem resolveu e a auditoria sem o texto', async () => {
    const { fan, id } = await messageOf('problem');
    const admin = await seedMember(env, 'Equipe Suporte', 'admin');

    expect(
      await callable(env, 'resolveSupportMessage', { id, action: 'resolve' }, admin.token),
    ).toEqual({ result: { ok: true, status: 'resolved' } });
    expect(await read(`supportMessages/${id}`)).toMatchObject({
      status: 'resolved',
      resolvedAt: expect.any(Timestamp),
      resolvedBy: { uid: admin.uid, name: 'Equipe Suporte' },
    });
    // De novo no mesmo estado: ok, sem auditar outra vez.
    expect(
      await callable(env, 'resolveSupportMessage', { id, action: 'resolve' }, admin.token),
    ).toEqual({ result: { ok: true, status: 'resolved' } });
    expect(
      await callable(env, 'resolveSupportMessage', { id, action: 'reopen' }, admin.token),
    ).toEqual({ result: { ok: true, status: 'open' } });
    expect(await read(`supportMessages/${id}`)).toMatchObject({
      status: 'open',
      resolvedAt: null,
      resolvedBy: null,
    });

    const audit = await db.collection('staffAudit').where('actorUid', '==', admin.uid).get();
    const entries = audit.docs
      .map((doc) => doc.data())
      .sort(
        (a, b) => (a.createdAt as Timestamp).toMillis() - (b.createdAt as Timestamp).toMillis(),
      );
    expect(entries.map((entry) => entry.action)).toEqual([
      'support.message.resolved',
      'support.message.reopened',
    ]);
    expect(entries[0]).toMatchObject({
      targetEmail: '',
      targetUid: null,
      details: { supportMessageId: id, fanUid: fan.uid, kind: 'problem' },
      section: 'support',
      targets: [`fan:${fan.uid}`, `supportMessage:${id}`],
    });
    expect(JSON.stringify(entries)).not.toContain('Travou.');
  });

  it('o editor com a seção resolve; o Leitor e quem não tem a seção recebem no-section', async () => {
    const { id } = await messageOf();
    const editor = await seedMember(env, 'Editora', 'editor', ['support']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['support']);
    const other = await seedMember(env, 'Moderadora', 'editor', ['moderation']);
    for (const member of [viewer, other]) {
      const { error } = await callable(
        env,
        'resolveSupportMessage',
        { id, action: 'resolve' },
        member.token,
      );
      expect(error).toMatchObject({ details: { reason: 'no-section' } });
    }
    expect((await read(`supportMessages/${id}`))!.status).toBe('open');
    expect(
      await callable(env, 'resolveSupportMessage', { id, action: 'resolve' }, editor.token),
    ).toEqual({ result: { ok: true, status: 'resolved' } });
  });

  it('a mensagem que não existe, o pedido fora do formato e sem login', async () => {
    const admin = await seedMember(env, 'Equipe', 'admin');
    expect(
      (
        await callable(
          env,
          'resolveSupportMessage',
          { id: 'naoExiste1', action: 'resolve' },
          admin.token,
        )
      ).error,
    ).toMatchObject({ status: 'NOT_FOUND', details: { reason: 'message-not-found' } });
    expect(
      (await callable(env, 'resolveSupportMessage', { id: 'a/b', action: 'resolve' }, admin.token))
        .error,
    ).toMatchObject({ details: { reason: 'invalid-request', field: 'id' } });
    expect(
      (await callable(env, 'resolveSupportMessage', { id: 'x1', action: 'apagar' }, admin.token))
        .error,
    ).toMatchObject({ details: { reason: 'invalid-request', field: 'action' } });
    expect(
      (await callable(env, 'resolveSupportMessage', { id: 'x1', action: 'resolve' })).error,
    ).toMatchObject({ details: { reason: 'unauthenticated' } });
  });
});
