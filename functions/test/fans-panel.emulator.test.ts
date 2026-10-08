import { Timestamp } from 'firebase-admin/firestore';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import { fanSearchKeys, queueFanProfileSync } from '../src/fan-profile';
import { dayKey, DEFAULT_SEASON_CONFIG, type SeasonInfo } from '../src/points';
import { ADJUST_EDITOR_DAILY_MAX, ADJUST_EDITOR_MAX } from '../src/points/adjust';
import { writeSeasonConfig } from '../src/points/config';
import { staffLimitId } from '../src/staff/limits';
import {
  callable,
  central,
  localApi,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  waitFor,
  type CallError,
  type Fan,
  type Member,
} from './support';

/**
 * A seção Fãs do painel no servidor (bloco 11, docs/arquitetura-api.md, 26.4,
 * 26.7 e 26.14): o `adjustFanPoints` com os papéis, os tetos, o orçamento do
 * dia, a repetição da tentativa e o `game`; o `findFanByEmail` com a auditoria
 * sem o e-mail e o teto do dia; e o `searchKeys` no cadastro e no gatilho do
 * perfil (o nome gravado pelo Admin SDK, como a API grava, e o @ pela api).
 */
const env = useEmulators('fas-painel', [
  'api',
  'createUserProfile',
  'queueFanProfileSync',
  'adjustFanPoints',
  'findFanByEmail',
]);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();

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

async function limitOf(uid: string) {
  const snap = await db.collection('staffLimits').where('uid', '==', uid).get();
  return snap.docs.map((doc) => doc.data())[0];
}

const adjustment = (uid: string, extra: Record<string, unknown> = {}) => ({
  uid,
  adjustmentId: unique('ajuste-teste-'),
  note: 'Correção do show',
  ...extra,
});

/** A temporada em andamento em config/season, como as callables gravam. */
async function activeSeason(): Promise<SeasonInfo> {
  const now = Date.now();
  const season: SeasonInfo = {
    id: unique('temporada-'),
    name: 'São João',
    startsAt: now - 10 * DAY_MS,
    endsAt: now + 10 * DAY_MS,
    leaderTitle: null,
    topTarget: 10,
    endedEarly: null,
  };
  await db.runTransaction(async (tx) => {
    writeSeasonConfig(
      tx,
      db,
      { ...DEFAULT_SEASON_CONFIG, version: 1, season },
      { now, updatedBy: null },
    );
  });
  return season;
}

/** Um membro da equipe que também é fã, na mesma conta (o linkStaffInvite). */
async function staffFan(sections: string[]): Promise<Fan & Caller> {
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

describe('adjustFanPoints: quem ajusta', () => {
  it('admin e editora com fans; leitor, outra seção, desativada, fã e sem login não', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['fans']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['fans']);
    const other = await seedMember(env, 'Moderação', 'editor', ['moderation']);
    const disabled = await seedMember(env, 'Desativada', 'editor', ['fans'], 'disabled');
    const fan = await signUpFan(db, 'Camila Ribeiro');

    for (const member of [admin, editor]) {
      expect(await ok('adjustFanPoints', adjustment(fan.uid, { balance: 10 }), member)).toEqual({
        status: 'applied',
        balance: member === admin ? 10 : 20,
        xp: 0,
        seasonPoints: 0,
      });
    }
    const input = adjustment(fan.uid, { balance: 10 });
    expect((await failure('adjustFanPoints', input, viewer)).details?.reason).toBe('no-section');
    expect((await failure('adjustFanPoints', input, other)).details?.reason).toBe('no-section');
    expect((await failure('adjustFanPoints', input, disabled)).details?.reason).toBe('not-staff');
    // O fã que chama: o próprio uid é `self` antes de qualquer leitura; outro, `not-staff`.
    expect((await failure('adjustFanPoints', input, fan)).details?.reason).toBe('self');
    const someone = await signUpFan(db);
    expect(
      (await failure('adjustFanPoints', adjustment(someone.uid, { balance: 1 }), fan)).details
        ?.reason,
    ).toBe('not-staff');
    expect((await failure('adjustFanPoints', input)).details?.reason).toBe('unauthenticated');
    expect(await audits('wallet.adjusted')).toHaveLength(2);
  });

  it('ninguém ajusta a própria conta de fã (self), nem um admin', async () => {
    const member = await staffFan(['fans']);
    const error = await failure('adjustFanPoints', adjustment(member.uid, { balance: 5 }), member);
    expect(error.details?.reason).toBe('self');
    expect(error.message).toBe('Você não pode mudar a sua própria conta de fã pelo painel.');
    expect(await read(`wallets/${member.uid}`)).toBeUndefined();
  });
});

describe('adjustFanPoints: os contadores', () => {
  it('saldo, XP, temporada e central, com o motivo no extrato e na auditoria', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const season = await activeSeason();
    const artistId = await central(env, { status: 'draft' });
    const input = adjustment(fan.uid, {
      balance: 300,
      xp: 200,
      season: 50,
      central: { artistId, season: 40, total: 70 },
      note: '  Devolução do ingresso  ',
    });
    expect(await ok('adjustFanPoints', input, admin)).toEqual({
      status: 'applied',
      balance: 300,
      xp: 200,
      seasonPoints: 50,
    });
    const entryId = `adjustment:${input.adjustmentId}`;
    expect(await read(`wallets/${fan.uid}/ledger/${entryId}`)).toMatchObject({
      kind: 'adjust',
      source: 'adjustment',
      points: 300,
      xpDelta: 200,
      seasonDelta: 50,
      artistId,
      centralSeasonDelta: 40,
      centralTotalDelta: 70,
      seasonId: season.id,
      note: 'Devolução do ingresso',
      actor: { type: 'staff', uid: admin.uid, name: 'Admin' },
    });
    expect(await read(`wallets/${fan.uid}/centralPoints/${artistId}`)).toMatchObject({
      seasonPoints: 40,
      totalPoints: 70,
    });
    expect(await audits('wallet.adjusted')).toEqual([
      expect.objectContaining({
        actorUid: admin.uid,
        targetUid: fan.uid,
        targetEmail: '',
        section: 'fans',
        targets: expect.arrayContaining([`fan:${fan.uid}`, `artist:${artistId}`]),
        details: {
          entryId,
          balance: 300,
          xp: 200,
          season: 50,
          central: { artistId, season: 40, total: 70 },
          seasonId: season.id,
          note: 'Devolução do ingresso',
        },
      }),
    ]);
  });

  it('o ajuste que passa um degrau desbloqueia a conquista de nível (o game da configuração)', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db);
    await ok('adjustFanPoints', adjustment(fan.uid, { xp: 1_600 }), admin);
    const wallet = await read(`wallets/${fan.uid}`);
    expect(wallet?.xp).toBe(1_600);
    expect(wallet?.achievements?.['pe-de-serra']).toBeInstanceOf(Timestamp);
  });

  it('recusas: temporada sem temporada, contador negativo, fã sem perfil, central que não existe, corpo torto', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db);
    expect(
      (await failure('adjustFanPoints', adjustment(fan.uid, { season: 5 }), admin)).details?.reason,
    ).toBe('season-required');
    const negative = await failure('adjustFanPoints', adjustment(fan.uid, { balance: -1 }), admin);
    expect(negative.details).toMatchObject({ reason: 'negative-counter', counter: 'balance' });
    expect(negative.message).toBe('O ajuste deixaria o saldo negativo.');
    expect(
      (await failure('adjustFanPoints', adjustment('semPerfil123', { balance: 1 }), admin)).details
        ?.reason,
    ).toBe('fan-not-found');
    // A conta só da equipe também não é fã.
    const member = await seedMember(env, 'Só equipe', 'viewer', ['ranking']);
    expect(
      (await failure('adjustFanPoints', adjustment(member.uid, { balance: 1 }), admin)).details
        ?.reason,
    ).toBe('fan-not-found');
    expect(
      (
        await failure(
          'adjustFanPoints',
          adjustment(fan.uid, { central: { artistId: 'naoexiste', total: 1 } }),
          admin,
        )
      ).details?.reason,
    ).toBe('artist-not-found');
    expect(
      (await failure('adjustFanPoints', adjustment(fan.uid, { balance: 0 }), admin)).details,
    ).toEqual({ reason: 'invalid-request', field: 'balance' });
    expect(
      (await failure('adjustFanPoints', adjustment(fan.uid, { balance: 1, note: '' }), admin))
        .details,
    ).toEqual({ reason: 'invalid-request', field: 'note' });
    expect(await read(`wallets/${fan.uid}`)).toBeUndefined();
    expect(await audits('wallet.adjusted')).toEqual([]);
    expect(await limitOf(admin.uid)).toBeUndefined();
  });
});

describe('adjustFanPoints: os tetos e o orçamento do dia', () => {
  it('editor até 50.000 por ajuste e 100.000 por contador no dia; o admin passa', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['fans']);
    const fan = await signUpFan(db);

    const above = await failure(
      'adjustFanPoints',
      adjustment(fan.uid, { balance: ADJUST_EDITOR_MAX + 10_000 }),
      editor,
    );
    expect(above.details).toEqual({ reason: 'adjust-above-limit', max: ADJUST_EDITOR_MAX });
    expect(above.message).toBe(
      'O ajuste passa do limite de 50.000 pontos por contador. Fale com um admin.',
    );

    for (let round = 0; round < 2; round += 1) {
      await ok('adjustFanPoints', adjustment(fan.uid, { balance: ADJUST_EDITOR_MAX }), editor);
    }
    const daily = await failure('adjustFanPoints', adjustment(fan.uid, { balance: 1 }), editor);
    expect(daily.details).toEqual({
      reason: 'adjust-daily-limit',
      counter: 'balance',
      remaining: 0,
    });
    expect(daily.message).toBe(
      'Hoje você ainda pode ajustar 0 pontos no saldo. Fale com um admin.',
    );
    // O negativo também conta (valor absoluto), e o XP tem o orçamento dele.
    expect(
      (await failure('adjustFanPoints', adjustment(fan.uid, { balance: -1 }), editor)).details
        ?.reason,
    ).toBe('adjust-daily-limit');
    await ok('adjustFanPoints', adjustment(fan.uid, { xp: 40_000 }), editor);
    await ok('adjustFanPoints', adjustment(fan.uid, { xp: 50_000 }), editor);
    const xpLeft = await failure('adjustFanPoints', adjustment(fan.uid, { xp: 20_000 }), editor);
    expect(xpLeft.details).toEqual({
      reason: 'adjust-daily-limit',
      counter: 'xp',
      remaining: ADJUST_EDITOR_DAILY_MAX - 90_000,
    });

    // A recusa não soma no orçamento; o documento é do dia, com o TTL.
    const limit = await limitOf(editor.uid);
    expect(limit).toMatchObject({
      uid: editor.uid,
      day: dayKey(Date.now()),
      adjusted: { balance: ADJUST_EDITOR_DAILY_MAX, xp: 90_000, season: 0 },
      emailLookups: 0,
    });
    expect((limit!.expiresAt as Timestamp).toMillis()).toBeGreaterThan(Date.now() + 29 * DAY_MS);

    // O admin não tem orçamento (o que ele ajusta fica registrado).
    await ok('adjustFanPoints', adjustment(fan.uid, { balance: 600_000 }), admin);
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(700_000);
    expect((await limitOf(admin.uid))?.adjusted.balance).toBe(600_000);
  });
});

describe('adjustFanPoints: a mesma tentativa', () => {
  it('repetida: duplicate, uma auditoria e o orçamento somado uma vez; com outro corpo, adjustment-id-reused', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['fans']);
    const fan = await signUpFan(db);
    const input = adjustment(fan.uid, { balance: 100 });
    await ok('adjustFanPoints', input, editor);
    expect(await ok('adjustFanPoints', input, editor)).toEqual({
      status: 'duplicate',
      balance: 100,
      xp: 0,
      seasonPoints: 0,
    });
    expect(await audits('wallet.adjusted')).toHaveLength(1);
    expect((await limitOf(editor.uid))?.adjusted.balance).toBe(100);

    const reused = await failure('adjustFanPoints', { ...input, balance: 150 }, editor);
    expect(reused.details).toEqual({
      reason: 'adjustment-id-reused',
      entry: {
        balance: 100,
        xp: 0,
        season: 0,
        central: null,
        note: 'Correção do show',
        balanceAfter: 100,
        createdAt: expect.any(String),
      },
    });
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(100);
  });

  it('duas chamadas em paralelo com o mesmo id lançam uma vez', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db);
    const input = adjustment(fan.uid, { balance: 25 });
    const results = await Promise.all([
      callable<{ status: string }>(env, 'adjustFanPoints', input, admin.token),
      callable<{ status: string }>(env, 'adjustFanPoints', input, admin.token),
    ]);
    expect(results.map((item) => item.result?.status).sort()).toEqual(['applied', 'duplicate']);
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(1);
    expect((await read(`wallets/${fan.uid}`))?.balance).toBe(25);
    expect(await audits('wallet.adjusted')).toHaveLength(1);
  });
});

describe('findFanByEmail', () => {
  it('o uid do fã; null sem conta ou com conta só da equipe; a auditoria sem o e-mail', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['fans']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['fans']);
    const bia = await signUpFan(db, 'Bia Santos');
    expect(await ok('findFanByEmail', { email: `  ${bia.email.toUpperCase()} ` }, editor)).toEqual({
      uid: bia.uid,
    });
    expect(await ok('findFanByEmail', { email: 'ninguem@teste.dev' }, editor)).toEqual({
      uid: null,
    });
    expect(await ok('findFanByEmail', { email: viewer.email }, editor)).toEqual({ uid: null });
    expect((await failure('findFanByEmail', { email: bia.email }, viewer)).details?.reason).toBe(
      'no-section',
    );
    expect((await failure('findFanByEmail', { email: 'sem-arroba' }, editor)).details).toEqual({
      reason: 'invalid-request',
      field: 'email',
    });

    const entries = await audits('fan.email.lookup');
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.details.found).sort()).toEqual([false, false, true]);
    expect(entries.find((entry) => entry.details.found)).toMatchObject({
      targetUid: bia.uid,
      targetEmail: '',
      section: 'fans',
      targets: [`fan:${bia.uid}`],
    });
    for (const entry of entries) {
      const text = JSON.stringify(entry);
      expect(text).not.toContain('@teste.dev');
      expect(text).not.toContain('ninguem');
    }
    expect((await limitOf(editor.uid))?.emailLookups).toBe(3);
  });

  it('a 51ª busca do dia recusa, sem auditar nem somar', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const bia = await signUpFan(db, 'Bia Santos');
    const now = Date.now();
    const id = staffLimitId(admin.uid, dayKey(now));
    await db.doc(`staffLimits/${id}`).set({
      uid: admin.uid,
      day: dayKey(now),
      adjusted: { balance: 0, xp: 0, season: 0, centralSeason: 0, centralTotal: 0 },
      emailLookups: 50,
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + 30 * DAY_MS),
    });
    const error = await failure('findFanByEmail', { email: bia.email }, admin);
    expect(error.details).toEqual({ reason: 'lookup-daily-limit', max: 50 });
    expect(error.message).toBe('Você chegou ao limite de 50 buscas por e-mail hoje.');
    expect(await audits('fan.email.lookup')).toEqual([]);
    expect((await read(`staffLimits/${id}`))?.emailLookups).toBe(50);
  });
});

describe('searchKeys (a busca de fãs do painel)', () => {
  it('nasce no cadastro e acompanha o nome trocado no perfil (gravado pelo Admin SDK)', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const profile = (await read(`users/${fan.uid}`))!;
    expect(profile.searchKeys).toEqual(fanSearchKeys('Camila Ribeiro', profile.username));
    expect(profile.searchKeys).toContain('cami');

    // O teste é do gatilho, não do caminho: a gravação como a API faz, sem o updatedAt.
    await db.doc(`users/${fan.uid}`).update({ displayName: 'Bia Andrade' });
    // O @ continua o do cadastro (e as palavras dele, com o "cami").
    const expected = fanSearchKeys('Bia Andrade', profile.username);
    expect(expected).toContain('andr');
    await waitFor('as chaves do nome novo', async () => {
      const keys = (await read(`users/${fan.uid}`))?.searchKeys as string[] | undefined;
      return JSON.stringify(keys) === JSON.stringify(expected);
    });
  });

  it('acompanha o @ trocado pela api, sem laço e sem mexer no updatedAt', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const call = localApi(env, { now: () => Date.now() });
    const username = unique('camilanova');
    const result = await call('PUT', '/me/username', {
      token: fan.token,
      key: unique('chave-arroba-'),
      body: { username },
    });
    expect(result.status).toBe(200);
    await waitFor('as chaves do @ novo', async () => {
      const keys = (await read(`users/${fan.uid}`))?.searchKeys as string[] | undefined;
      return keys?.includes(username.slice(0, 15)) === true;
    });
    const first = await db.doc(`users/${fan.uid}`).get();
    expect(first.get('updatedAt')).toBeUndefined();
    await sleep(3_000);
    const later = await db.doc(`users/${fan.uid}`).get();
    expect(later.updateTime?.isEqual(first.updateTime!)).toBe(true);
  });

  it('um evento velho entregue depois do novo deixa as chaves do perfil de agora', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const current = (await read(`users/${fan.uid}`))!;
    const result = await queueFanProfileSync(
      db,
      { enqueue: async () => {} },
      { remove: async () => {} },
      {
        uid: fan.uid,
        before: { ...current, displayName: 'Camila Ribeiro' },
        after: { ...current, displayName: 'Nome Antigo' },
        eventTime: Date.now(),
      },
      { emulator: true },
    );
    expect(result.searchKeys).toBe('unchanged');
    expect((await read(`users/${fan.uid}`))?.searchKeys).toEqual(current.searchKeys);
  });
});
