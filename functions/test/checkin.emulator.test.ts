import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ACHIEVEMENTS_CONFIG, type AchievementRecord } from '../src/achievements';
import type { CheckinResult, CheckinState } from '../src/api/contract';
import { DEFAULT_POINTS_CONFIG, staticConfigSource, type PointsConfig } from '../src/points';
import {
  daysSince,
  http,
  localApi,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  type Fan,
} from './support';

/**
 * O check-in diário com sequência nos emuladores (docs/arquitetura-api.md,
 * seção 40). Com a chave desligada (o padrão do código), pela `api` de
 * verdade: o GET responde `enabled: false`, o POST recusa com 409 e nada é
 * gravado. Com a chave ligada, o handler da `api` no processo do teste, com o
 * ID token de verdade do emulador de Auth, o Firestore do emulador, a
 * configuração injetada e o relógio na mão: vários dias seguidos, a volta do
 * ciclo, o dia perdido, a meia-noite de São Paulo (03:00Z), os pedidos fora de
 * ordem, a chave repetida, o segundo toque, o suspenso, a temporada e a
 * conquista de sequência (a publicada depois de o fã já ter os dias só sai
 * num check-in, nunca por outra rota). A função publicada guarda a
 * configuração dela por 60 s: por isso este arquivo nunca grava a chave
 * ligada em config/points, e os testes que gravam (o do painel e o do seed)
 * não chamam a `api` de verdade enquanto ela está lá.
 */
const env = useEmulators('checkin', ['api', 'createUserProfile']);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
// Terça-feira, 10 de novembro de 2026, meio-dia em São Paulo.
const T0 = Date.parse('2026-11-10T15:00:00.000Z');
const CYCLE = [3, 3, 4, 4, 5, 6, 15];
const ON: PointsConfig = {
  ...DEFAULT_POINTS_CONFIG,
  checkin: { enabled: true, cycle: CYCLE },
};
const NO_REWARDS = {
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
};

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

/** O handler com o relógio dado e a chave ligada (ou a configuração passada). */
function apiAt(now: () => number, config: Parameters<typeof staticConfigSource>[0] = {}) {
  return localApi(env, { now, config: staticConfigSource({ points: ON, ...config }) });
}

type Api = ReturnType<typeof apiAt>;

const key = () => unique('chave-checkin-');

/** O toque do fã: `POST /me/checkin`, sem corpo. */
async function checkIn(api: Api, fan: Fan, k: string = key()) {
  const sent = await api('POST', '/me/checkin', { token: fan.token, key: k });
  return { status: sent.status, body: sent.body as unknown as CheckinResult };
}

const stateOf = async (api: Api, fan: Fan) =>
  (await api('GET', '/me/checkin', { token: fan.token })).body as unknown as CheckinState;

/** A carteira lida direto (o fã não lê a própria pelo Firestore; o teste lê pelo Admin SDK). */
const wallet = (fan: Fan) => read(`wallets/${fan.uid}`);

const ledgerIds = async (fan: Fan) =>
  (await db.collection(`wallets/${fan.uid}/ledger`).get()).docs.map((doc) => doc.id).sort();

const keysOf = async (fan: Fan) =>
  (await db.collection('idempotency').where('uid', '==', fan.uid).get()).docs;

async function writeSeason(id: string, startsAt: number, endsAt: number): Promise<void> {
  await db.doc('config/season').set({
    version: 1,
    season: {
      id,
      name: 'Temporada de teste',
      startsAt: Timestamp.fromMillis(startsAt),
      endsAt: Timestamp.fromMillis(endsAt),
      leaderTitle: null,
    },
  });
}

describe('com a chave desligada (o padrão do código), pela api de verdade', () => {
  it('o GET responde enabled false, o POST recusa com 409 checkin_disabled e nada é gravado; sem token, 401', async () => {
    const startedAt = Date.now();
    const fan = await signUpFan(db, 'Bia Santos');

    const state = await http(env, '/me/checkin', { token: fan.token });
    expect(state.status).toBe(200);
    expect(state.body).toEqual({
      enabled: false,
      checkedInToday: false,
      streak: 0,
      best: 0,
      cycle: [],
      cycleDay: 0,
      todayPoints: 0,
      resetsAt: expect.any(String),
    });
    // A próxima meia-noite de São Paulo: no futuro, a menos de um dia.
    const resetsAt = Date.parse(state.body.resetsAt as string);
    expect(resetsAt).toBeGreaterThan(startedAt);
    expect(resetsAt).toBeLessThanOrEqual(Date.now() + DAY_MS);
    expect(new Date(resetsAt).toISOString()).toMatch(/T03:00:00\.000Z$/);

    const k = key();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // A recusa não guarda a chave: o mesmo pedido de novo recusa de novo.
      const refused = await http(env, '/me/checkin', { method: 'POST', token: fan.token, key: k });
      expect(refused.status).toBe(409);
      expect(refused.body).toEqual({
        code: 'checkin_disabled',
        message: 'O check-in diário não está disponível agora.',
      });
      expect(refused.headers.get('Idempotency-Replayed')).toBeNull();
    }

    // Nada foi gravado: nem carteira, nem extrato, nem chave, nem atividade no dia.
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);
    expect(await ledgerIds(fan)).toEqual([]);
    expect(await keysOf(fan)).toHaveLength(0);
    const days = daysSince(startedAt);
    expect(await statsSum(db, days, (data) => data.actives?.day ?? 0)).toBe(0);
    expect(await statsSum(db, days, (data) => data.bySource?.checkin?.events ?? 0)).toBe(0);

    // Sem token: 401 nas duas (o servidor de antes responderia 404 not_found).
    expect((await http(env, '/me/checkin')).status).toBe(401);
    const anonymous = await http(env, '/me/checkin', { method: 'POST', key: key() });
    expect(anonymous).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    // Sem a chave de idempotência, o POST nem chega à recusa do check-in.
    const noKey = await http(env, '/me/checkin', { method: 'POST', token: fan.token });
    expect(noKey).toMatchObject({ status: 400, body: { code: 'idempotency_key_required' } });
    const put = await http(env, '/me/checkin', { method: 'PUT', token: fan.token, key: key() });
    expect(put.status).toBe(405);
    expect(put.headers.get('Allow')).toBe('GET, POST');
  });

  it('as outras gravações não põem o campo do check-in na carteira', async () => {
    const fan = await signUpFan(db);
    // Uma gravação qualquer pela api (a mensagem do Suporte): a carteira nasce sem o campo.
    const sent = await http(env, '/me/support', {
      method: 'POST',
      token: fan.token,
      key: key(),
      body: { kind: 'idea', text: 'Um check-in diário seria legal.' },
    });
    expect(sent.status).toBe(200);
    const stored = (await wallet(fan))!;
    expect(stored).toMatchObject({ balance: 0, xp: 0 });
    expect(stored).not.toHaveProperty('checkin');
    // O POST recusado depois dela também não deixa nada.
    const refused = await http(env, '/me/checkin', {
      method: 'POST',
      token: fan.token,
      key: key(),
    });
    expect(refused.status).toBe(409);
    expect(await wallet(fan)).toEqual(stored);
    expect(await ledgerIds(fan)).toEqual([]);
  });
});

describe('com a chave ligada', () => {
  it('o primeiro check-in paga o dia 1, guarda a sequência, entra no extrato e marca o fã ativo', async () => {
    const api = apiAt(() => T0);
    const fan = await signUpFan(db, 'Bia Santos');
    const resetsAt = '2026-11-11T03:00:00.000Z';

    // Antes: o dia 1 por fazer. A leitura não cria a carteira.
    expect(await api('GET', '/me/checkin', { token: fan.token })).toEqual({
      status: 200,
      body: {
        enabled: true,
        checkedInToday: false,
        streak: 0,
        best: 0,
        cycle: CYCLE,
        cycleDay: 1,
        todayPoints: 3,
        resetsAt,
      },
    });
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);

    const done = await checkIn(api, fan);
    const state = {
      enabled: true,
      checkedInToday: true,
      streak: 1,
      best: 1,
      cycle: CYCLE,
      cycleDay: 1,
      todayPoints: 3,
      resetsAt,
    };
    expect(done).toEqual({
      status: 200,
      body: { pointsAwarded: 3, checkin: state, ...NO_REWARDS },
    });
    expect(await stateOf(api, fan)).toEqual(state);

    // A carteira: os pontos como um ganho qualquer e a sequência no campo `checkin`.
    const stored = (await wallet(fan))!;
    expect(stored).toMatchObject({
      balance: 3,
      xp: 3,
      earnedTotal: 3,
      spentTotal: 0,
      seasonId: null,
      seasonPoints: 0,
      days: { '2026-11-10': { earned: 3, count: { checkin: 1 } } },
      // O check-in é uma gravação pela api: o fã conta como ativo no dia.
      activity: { lastDay: '2026-11-10', lastWeek: '2026-W46', lastMonth: '2026-11' },
      updatedAt: Timestamp.fromMillis(T0),
    });
    expect(stored.checkin).toEqual({ streak: 1, best: 1, lastDay: '2026-11-10' });

    // O extrato: um lançamento, com o id do dia, sem central, assunto nem título.
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10']);
    expect(await read(`wallets/${fan.uid}/ledger/checkin:2026-11-10`)).toMatchObject({
      uid: fan.uid,
      kind: 'earn',
      source: 'checkin',
      eventId: '2026-11-10',
      points: 3,
      xpDelta: 3,
      seasonDelta: 0,
      artistId: null,
      centralSeasonDelta: 0,
      centralTotalDelta: 0,
      seasonId: null,
      subject: null,
      subjectTitle: null,
      balanceAfter: 3,
      xpAfter: 3,
      actor: { type: 'fan', uid: fan.uid },
      day: '2026-11-10',
      createdAt: Timestamp.fromMillis(T0),
    });
    expect(await read(`wallets/${fan.uid}/centralPoints/nettobrito`)).toBeUndefined();
    expect((await db.collection(`wallets/${fan.uid}/centralPoints`).get()).size).toBe(0);

    // As rotas de leitura mostram o mesmo.
    expect((await api('GET', '/me/wallet', { token: fan.token })).body).toMatchObject({
      balance: 3,
      xp: 3,
    });
    const ledger = (await api('GET', '/me/ledger', { token: fan.token })).body as {
      items: Record<string, unknown>[];
    };
    expect(ledger.items).toHaveLength(1);
    expect(ledger.items[0]).toMatchObject({
      id: 'checkin:2026-11-10',
      kind: 'earn',
      source: 'checkin',
      points: 3,
      artistId: null,
      artistName: null,
      subject: null,
      subjectTitle: null,
    });

    // Os agregados do dia: o ganho pela origem `checkin` e o fã ativo.
    const day = ['2026-11-10'];
    expect(await statsSum(db, day, (data) => data.bySource?.checkin?.points ?? 0)).toBe(3);
    expect(await statsSum(db, day, (data) => data.bySource?.checkin?.events ?? 0)).toBe(1);
    expect(await statsSum(db, day, (data) => data.totals?.earned ?? 0)).toBe(3);
    expect(await statsSum(db, day, (data) => data.actives?.day ?? 0)).toBe(1);
  });

  it('vários dias seguidos: a sequência anda, o ciclo dá a volta no 8º dia e cada dia tem o lançamento dele', async () => {
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    const paid: number[] = [];
    const places: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      clock = T0 + index * DAY_MS;
      const done = await checkIn(api, fan);
      expect(done.status).toBe(200);
      expect(done.body.checkin).toMatchObject({
        checkedInToday: true,
        streak: index + 1,
        best: index + 1,
      });
      paid.push(done.body.pointsAwarded);
      places.push(done.body.checkin.cycleDay);
    }
    // Sem bônus de marco: o 7º dia paga o maior valor do ciclo, e o 8º volta ao primeiro.
    expect(paid).toEqual([3, 3, 4, 4, 5, 6, 15, 3, 3]);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2]);
    const stored = (await wallet(fan))!;
    expect(stored).toMatchObject({ balance: 46, xp: 46, earnedTotal: 46 });
    expect(stored.checkin).toEqual({ streak: 9, best: 9, lastDay: '2026-11-18' });
    expect(await ledgerIds(fan)).toEqual(
      Array.from({ length: 9 }, (_, index) => `checkin:2026-11-${10 + index}`),
    );
    expect(await read(`wallets/${fan.uid}/ledger/checkin:2026-11-16`)).toMatchObject({
      points: 15,
      balanceAfter: 40,
    });

    // No dia seguinte, o 10º fica por fazer, no 3º lugar do ciclo.
    clock = T0 + 9 * DAY_MS;
    expect(await stateOf(api, fan)).toMatchObject({
      checkedInToday: false,
      streak: 9,
      best: 9,
      cycleDay: 3,
      todayPoints: 4,
      resetsAt: '2026-11-20T03:00:00.000Z',
    });
  });

  it('o dia perdido volta a sequência ao dia 1; os pontos ganhos e a melhor sequência ficam', async () => {
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    for (let index = 0; index < 3; index += 1) {
      clock = T0 + index * DAY_MS;
      await checkIn(api, fan);
    }
    expect((await wallet(fan))!.balance).toBe(10);

    // No 4º dia, sem check-in, a sequência ainda vale: o de hoje está por fazer.
    clock = T0 + 3 * DAY_MS;
    expect(await stateOf(api, fan)).toMatchObject({
      checkedInToday: false,
      streak: 3,
      best: 3,
      cycleDay: 4,
      todayPoints: 4,
    });
    // O dia passou em branco: no 5º, a sequência se perdeu. A leitura não grava nada.
    clock = T0 + 4 * DAY_MS;
    expect(await stateOf(api, fan)).toMatchObject({
      checkedInToday: false,
      streak: 0,
      best: 3,
      cycleDay: 1,
      todayPoints: 3,
    });
    expect((await wallet(fan))!.checkin).toEqual({ streak: 3, best: 3, lastDay: '2026-11-12' });

    const again = await checkIn(api, fan);
    expect(again.body).toMatchObject({
      pointsAwarded: 3,
      checkin: { checkedInToday: true, streak: 1, best: 3, cycleDay: 1 },
    });
    const stored = (await wallet(fan))!;
    expect(stored.balance).toBe(13);
    expect(stored.checkin).toEqual({ streak: 1, best: 3, lastDay: '2026-11-14' });
    expect(await ledgerIds(fan)).toEqual([
      'checkin:2026-11-10',
      'checkin:2026-11-11',
      'checkin:2026-11-12',
      'checkin:2026-11-14',
    ]);
  });

  it('a meia-noite de São Paulo (03:00Z): 23:59:59,999 ainda é o mesmo dia, e 0:00 abre o seguinte', async () => {
    // 23:00 de 10/11 em São Paulo.
    let clock = Date.parse('2026-11-11T02:00:00.000Z');
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    expect((await checkIn(api, fan)).body).toMatchObject({
      pointsAwarded: 3,
      checkin: { streak: 1, resetsAt: '2026-11-11T03:00:00.000Z' },
    });
    expect((await wallet(fan))!.checkin).toEqual({ streak: 1, best: 1, lastDay: '2026-11-10' });

    // Um milésimo antes da meia-noite: o dia ainda é o 10, e o toque não paga de novo.
    clock = Date.parse('2026-11-11T02:59:59.999Z');
    expect((await checkIn(api, fan)).body).toMatchObject({
      pointsAwarded: 0,
      checkin: { checkedInToday: true, streak: 1, resetsAt: '2026-11-11T03:00:00.000Z' },
    });

    // Meia-noite em ponto: o dia 11 abriu, com o 2º dia por fazer.
    clock = Date.parse('2026-11-11T03:00:00.000Z');
    expect(await stateOf(api, fan)).toMatchObject({
      checkedInToday: false,
      streak: 1,
      cycleDay: 2,
      todayPoints: 3,
      resetsAt: '2026-11-12T03:00:00.000Z',
    });
    expect((await checkIn(api, fan)).body).toMatchObject({
      pointsAwarded: 3,
      checkin: { checkedInToday: true, streak: 2, cycleDay: 2 },
    });
    const stored = (await wallet(fan))!;
    expect(stored.balance).toBe(6);
    expect(stored.checkin).toEqual({ streak: 2, best: 2, lastDay: '2026-11-11' });
    expect(stored.days).toMatchObject({
      '2026-11-10': { earned: 3, count: { checkin: 1 } },
      '2026-11-11': { earned: 3, count: { checkin: 1 } },
    });
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10', 'checkin:2026-11-11']);
  });

  it('com a ordem invertida na virada, o pedido de 23:59:59,950 que grava depois do de 00:00:00,010 não desfaz o dia novo', async () => {
    const after = Date.parse('2026-11-11T03:00:00.010Z');
    const before = Date.parse('2026-11-11T02:59:59.950Z');

    // Quem já vinha de dois dias seguidos (9 e 10 de novembro).
    const fan = await signUpFan(db);
    await checkIn(
      apiAt(() => T0 - DAY_MS),
      fan,
    );
    await checkIn(
      apiAt(() => T0),
      fan,
    );
    // O pedido de 0:00:00,010 do dia 11 grava antes...
    expect(
      (
        await checkIn(
          apiAt(() => after),
          fan,
        )
      ).body,
    ).toMatchObject({ pointsAwarded: 4, checkin: { streak: 3, cycleDay: 3 } });
    const written = await db.doc(`wallets/${fan.uid}`).get();
    expect(written.get('checkin')).toEqual({ streak: 3, best: 3, lastDay: '2026-11-11' });
    // ...e o de 23:59:59,950 do dia 10 chega depois: não paga, não anda e não grava a carteira.
    const late = await checkIn(
      apiAt(() => before),
      fan,
    );
    expect(late).toMatchObject({
      status: 200,
      body: { pointsAwarded: 0, checkin: { checkedInToday: true, streak: 3, best: 3 } },
    });
    expect((await db.doc(`wallets/${fan.uid}`).get()).updateTime).toEqual(written.updateTime);
    expect((await wallet(fan))!.balance).toBe(10);
    expect(await ledgerIds(fan)).toEqual([
      'checkin:2026-11-09',
      'checkin:2026-11-10',
      'checkin:2026-11-11',
    ]);

    // O fã novo: o dia 11 entra primeiro, e o dia 10 atrasado não ganha lançamento.
    const fresh = await signUpFan(db);
    await checkIn(
      apiAt(() => after),
      fresh,
    );
    expect(
      (
        await checkIn(
          apiAt(() => before),
          fresh,
        )
      ).body,
    ).toMatchObject({ pointsAwarded: 0, checkin: { checkedInToday: true, streak: 1 } });
    expect((await wallet(fresh))!.checkin).toEqual({ streak: 1, best: 1, lastDay: '2026-11-11' });
    expect(await ledgerIds(fresh)).toEqual(['checkin:2026-11-11']);
    expect((await wallet(fresh))!.balance).toBe(3);
  });

  it('a mesma chave devolve a resposta guardada, sem pagar de novo; o segundo toque, com outra chave, responde 200 com 0 ponto', async () => {
    let clock = T0;
    const api = localApi(env, {
      now: () => clock,
      config: staticConfigSource({ points: ON }),
      withHeaders: true,
    });
    const fan = await signUpFan(db);
    const k = key();
    const first = await api('POST', '/me/checkin', { token: fan.token, key: k });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ pointsAwarded: 3, checkin: { streak: 1 } });
    expect(first.headers).not.toHaveProperty('Idempotency-Replayed');

    const replay = await api('POST', '/me/checkin', { token: fan.token, key: k });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers!['Idempotency-Replayed']).toBe('true');

    // A chave guarda a resposta como saiu (JSON do Firestore), por fã e por rota.
    const stored = await keysOf(fan);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.data()).toMatchObject({
      uid: fan.uid,
      route: 'POST /me/checkin',
      status: 200,
      body: first.body,
    });

    // Outro toque no mesmo dia, com outra chave: não é erro, e nada muda.
    const second = await api('POST', '/me/checkin', { token: fan.token, key: key() });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      pointsAwarded: 0,
      checkin: (first.body as unknown as CheckinResult).checkin,
      ...NO_REWARDS,
    });
    expect(second.headers).not.toHaveProperty('Idempotency-Replayed');
    expect((await wallet(fan))!.balance).toBe(3);
    expect((await wallet(fan))!.checkin).toEqual({ streak: 1, best: 1, lastDay: '2026-11-10' });
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10']);
    expect(await keysOf(fan)).toHaveLength(2);

    // A chave de ontem, repetida hoje, devolve a resposta de ontem e não faz o
    // check-in de hoje: o app usa uma chave nova a cada toque.
    clock = T0 + DAY_MS;
    const old = await api('POST', '/me/checkin', { token: fan.token, key: k });
    expect(old.body).toEqual(first.body);
    expect(old.headers!['Idempotency-Replayed']).toBe('true');
    expect((await wallet(fan))!.checkin).toEqual({ streak: 1, best: 1, lastDay: '2026-11-10' });
    const today = await api('POST', '/me/checkin', { token: fan.token, key: key() });
    expect(today.body).toMatchObject({ pointsAwarded: 3, checkin: { streak: 2, cycleDay: 2 } });
  });

  it('cinco toques ao mesmo tempo, cada um com a chave dele: um paga, e a carteira fecha num check-in só', async () => {
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    const results = await Promise.all(Array.from({ length: 5 }, () => checkIn(api, fan)));
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.map((result) => result.body.pointsAwarded).sort()).toEqual([0, 0, 0, 0, 3]);
    for (const result of results) {
      expect(result.body.checkin).toMatchObject({ checkedInToday: true, streak: 1, best: 1 });
    }
    const stored = (await wallet(fan))!;
    expect(stored).toMatchObject({
      balance: 3,
      xp: 3,
      days: { '2026-11-10': { earned: 3, count: { checkin: 1 } } },
    });
    expect(stored.checkin).toEqual({ streak: 1, best: 1, lastDay: '2026-11-10' });
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10']);
    expect(await statsSum(db, ['2026-11-10'], (data) => data.bySource?.checkin?.events ?? 0)).toBe(
      1,
    );
  });

  it('o fã suspenso não faz check-in (403), a sequência dele fica como estava e a leitura segue', async () => {
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    await checkIn(api, fan);
    await db.doc(`users/${fan.uid}`).update({ suspendedAt: Timestamp.now() });
    const before = await db.doc(`wallets/${fan.uid}`).get();

    clock = T0 + DAY_MS;
    const refused = await api('POST', '/me/checkin', { token: fan.token, key: key() });
    expect(refused).toMatchObject({ status: 403, body: { code: 'account_suspended' } });
    expect((await db.doc(`wallets/${fan.uid}`).get()).updateTime).toEqual(before.updateTime);
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10']);
    // A leitura não olha a suspensão: o app mostra o card, e o toque abre o aviso da conta suspensa.
    expect(await stateOf(api, fan)).toMatchObject({
      enabled: true,
      checkedInToday: false,
      streak: 1,
      cycleDay: 2,
    });
  });

  it('com a temporada no ar, os pontos do check-in entram nela; depois do fim, só no saldo e no XP', async () => {
    await writeSeason('temporada-teste', T0 - 5 * DAY_MS, T0 + DAY_MS + 60_000);
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    await checkIn(api, fan);
    expect(await wallet(fan)).toMatchObject({
      balance: 3,
      seasonId: 'temporada-teste',
      seasonPoints: 3,
      seasonPointsAt: Timestamp.fromMillis(T0),
    });
    expect(await read(`wallets/${fan.uid}/ledger/checkin:2026-11-10`)).toMatchObject({
      seasonDelta: 3,
      seasonId: 'temporada-teste',
      seasonPointsAfter: 3,
    });
    clock = T0 + DAY_MS;
    await checkIn(api, fan);
    expect(await wallet(fan)).toMatchObject({ balance: 6, seasonPoints: 6 });

    // A temporada acabou um minuto depois: o 3º dia paga, fora dela.
    clock = T0 + 2 * DAY_MS;
    expect((await checkIn(api, fan)).body.pointsAwarded).toBe(4);
    expect(await wallet(fan)).toMatchObject({ balance: 10, xp: 10, seasonPoints: 6 });
    expect(await read(`wallets/${fan.uid}/ledger/checkin:2026-11-12`)).toMatchObject({
      points: 4,
      seasonDelta: 0,
      seasonId: null,
    });
  });

  it('a conquista de sequência sai na resposta do check-in que completa os dias, e só aparece com a chave ligada', async () => {
    const at = Date.parse('2026-01-01T00:00:00.000Z');
    const streak: AchievementRecord = {
      id: 'dois-dias-ab12',
      title: 'Dois dias seguidos',
      icon: 'flame',
      tone: 'action',
      rule: { type: 'streak', days: 2 },
      status: 'active',
      activatedAt: at,
      createdAt: at,
      updatedAt: at,
    };
    const achievements = {
      version: 2,
      achievements: [...DEFAULT_ACHIEVEMENTS_CONFIG.achievements, streak],
    };
    let clock = T0;
    const api = apiAt(() => clock, { achievements });
    const fan = await signUpFan(db);
    const list = async (from: Api) =>
      (await from('GET', '/me/achievements', { token: fan.token })).body as {
        unlockedCount: number;
        totalCount: number;
        highlights: { id: string; unlockedAt: string | null }[];
      };

    // No 1º dia, nada; a conquista conta no "de N" e está bloqueada.
    expect((await checkIn(api, fan)).body.unlockedAchievements).toEqual([]);
    expect(await list(api)).toMatchObject({ unlockedCount: 0, totalCount: 11 });

    // O 2º dia seguido completa a regra: o anúncio vem na mesma resposta.
    clock = T0 + DAY_MS;
    const second = await checkIn(api, fan);
    expect(second.body).toMatchObject({
      pointsAwarded: 3,
      checkin: { streak: 2, best: 2 },
      unlockedAchievements: [{ id: 'dois-dias-ab12', title: 'Dois dias seguidos' }],
    });
    expect((await wallet(fan))!.achievements).toEqual({
      'dois-dias-ab12': Timestamp.fromMillis(clock),
    });
    const unlocked = await list(api);
    expect(unlocked).toMatchObject({ unlockedCount: 1, totalCount: 11 });
    expect(unlocked.highlights[0]).toMatchObject({
      id: 'dois-dias-ab12',
      unlockedAt: new Date(clock).toISOString(),
    });
    expect(
      await statsSum(
        db,
        ['2026-11-11'],
        (data) => data.byAchievement?.['dois-dias-ab12']?.unlocked ?? 0,
      ),
    ).toBe(1);

    // O 3º dia não anuncia de novo.
    clock = T0 + 2 * DAY_MS;
    expect((await checkIn(api, fan)).body.unlockedAchievements).toEqual([]);

    // Com a chave desligada, o mesmo catálogo: a de sequência some do "de N"
    // (fica na carteira de quem ganhou), e o estado do check-in vem zerado.
    const off = localApi(env, {
      now: () => clock,
      config: staticConfigSource({ points: DEFAULT_POINTS_CONFIG, achievements }),
    });
    const hidden = await list(off);
    expect(hidden).toMatchObject({ unlockedCount: 0, totalCount: 10 });
    expect(hidden.highlights.map((item) => item.id)).not.toContain('dois-dias-ab12');
    expect(await stateOf(off, fan)).toMatchObject({
      enabled: false,
      streak: 0,
      best: 0,
      cycle: [],
    });
  });

  it('a conquista de sequência publicada depois de o fã já ter os dias não entra por outra rota: sai, com o anúncio, no check-in seguinte, também no segundo toque do dia', async () => {
    const at = Date.parse('2026-01-01T00:00:00.000Z');
    const late = (id: string, title: string, days: number): AchievementRecord => ({
      id,
      title,
      icon: 'flame',
      tone: 'action',
      rule: { type: 'streak', days },
      status: 'active',
      activatedAt: at,
      createdAt: at,
      updatedAt: at,
    });
    const two = late('dois-dias-cd34', 'Dois dias seguidos', 2);
    const three = late('tres-dias-ef56', 'Três dias seguidos', 3);
    let clock = T0;
    /** A api com o catálogo que a equipe publicou até ali. */
    const withCatalog = (version: number, extra: AchievementRecord[]) =>
      apiAt(() => clock, {
        achievements: {
          version,
          achievements: [...DEFAULT_ACHIEVEMENTS_CONFIG.achievements, ...extra],
        },
      });
    const fan = await signUpFan(db);
    /** Outra rota que grava e não responde recompensas: a mensagem do Suporte. */
    const support = (api: Api) =>
      api('POST', '/me/support', {
        token: fan.token,
        key: key(),
        body: { kind: 'idea', text: 'Cadê a minha conquista?' },
      });
    const unlockedOf = (id: string, day: string) =>
      statsSum(db, [day], (data) => data.byAchievement?.[id]?.unlocked ?? 0);

    // Dois dias seguidos, com o catálogo ainda sem conquista de sequência.
    const plain = withCatalog(1, []);
    await checkIn(plain, fan);
    clock = T0 + DAY_MS;
    expect((await checkIn(plain, fan)).body).toMatchObject({
      checkin: { streak: 2, best: 2 },
      unlockedAchievements: [],
    });

    // A equipe publica a de 2 dias depois, no mesmo dia. A mensagem do Suporte
    // grava a carteira (o teto do dia dela) e não dá a conquista.
    const withTwo = withCatalog(2, [two]);
    expect(await support(withTwo)).toMatchObject({ status: 200, body: { status: 'sent' } });
    const afterSupport = (await wallet(fan))!;
    expect(afterSupport.days['2026-11-11'].count).toEqual({ checkin: 1, support_message: 1 });
    expect(afterSupport.achievements).toEqual({});
    expect(await unlockedOf(two.id, '2026-11-11')).toBe(0);
    // O segundo toque do dia é um check-in: não paga, destrava e anuncia.
    const tap = await checkIn(withTwo, fan);
    expect(tap).toMatchObject({
      status: 200,
      body: {
        pointsAwarded: 0,
        checkin: { checkedInToday: true, streak: 2, best: 2 },
        unlockedAchievements: [{ id: two.id, title: two.title }],
      },
    });
    const afterTap = (await wallet(fan))!;
    expect(afterTap.achievements).toEqual({ [two.id]: Timestamp.fromMillis(clock) });
    expect(afterTap).toMatchObject({ balance: 6, xp: 6 });
    expect(afterTap.checkin).toEqual({ streak: 2, best: 2, lastDay: '2026-11-11' });
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10', 'checkin:2026-11-11']);
    expect(await unlockedOf(two.id, '2026-11-11')).toBe(1);

    // No 3º dia, o check-in não anuncia de novo.
    clock = T0 + 2 * DAY_MS;
    expect((await checkIn(withTwo, fan)).body).toMatchObject({
      pointsAwarded: 4,
      checkin: { streak: 3, best: 3 },
      unlockedAchievements: [],
    });

    // No 4º dia, a de 3 dias é publicada antes do check-in. A primeira gravação
    // do dia é a mensagem do Suporte: marca a atividade e não dá a conquista.
    clock = T0 + 3 * DAY_MS;
    const withThree = withCatalog(3, [two, three]);
    expect((await support(withThree)).status).toBe(200);
    const marked = (await wallet(fan))!;
    expect(marked.updatedAt).toEqual(Timestamp.fromMillis(clock));
    expect(marked.activity).toMatchObject({ lastDay: '2026-11-13' });
    expect(Object.keys(marked.achievements)).toEqual([two.id]);
    // O check-in do dia destrava e anuncia, na mesma resposta dos pontos.
    expect((await checkIn(withThree, fan)).body).toMatchObject({
      pointsAwarded: 4,
      checkin: { streak: 4, best: 4 },
      unlockedAchievements: [{ id: three.id, title: three.title }],
    });
    expect((await wallet(fan))!.achievements).toEqual({
      [two.id]: Timestamp.fromMillis(T0 + DAY_MS),
      [three.id]: Timestamp.fromMillis(clock),
    });
    expect(await unlockedOf(three.id, '2026-11-13')).toBe(1);
  });

  it('desligada no meio de uma sequência, nada anda; religada depois de um dia inteiro, a sequência recomeça do dia 1', async () => {
    let clock = T0;
    const on = apiAt(() => clock);
    // A mesma api com a chave desligada (o padrão do código).
    const off = localApi(env, { now: () => clock, config: staticConfigSource() });
    const fan = await signUpFan(db);
    await checkIn(on, fan);
    clock = T0 + DAY_MS;
    await checkIn(on, fan);
    expect((await wallet(fan))!.checkin).toEqual({ streak: 2, best: 2, lastDay: '2026-11-11' });

    // Desligada: o estado vem zerado, o toque é recusado e nada é gravado.
    clock = T0 + 2 * DAY_MS;
    expect(await off('GET', '/me/checkin', { token: fan.token })).toEqual({
      status: 200,
      body: {
        enabled: false,
        checkedInToday: false,
        streak: 0,
        best: 0,
        cycle: [],
        cycleDay: 0,
        todayPoints: 0,
        resetsAt: '2026-11-13T03:00:00.000Z',
      },
    });
    const before = await db.doc(`wallets/${fan.uid}`).get();
    const refused = await off('POST', '/me/checkin', { token: fan.token, key: key() });
    expect(refused).toEqual({
      status: 409,
      body: { code: 'checkin_disabled', message: 'O check-in diário não está disponível agora.' },
    });
    expect((await db.doc(`wallets/${fan.uid}`).get()).updateTime).toEqual(before.updateTime);
    expect(await keysOf(fan)).toHaveLength(2);

    // Outra gravação com a chave desligada mantém a sequência guardada como estava.
    const sent = await off('POST', '/me/support', {
      token: fan.token,
      key: key(),
      body: { kind: 'feedback', text: 'Cadê o check-in?' },
    });
    expect(sent.status).toBe(200);
    const kept = (await wallet(fan))!;
    expect(kept.checkin).toEqual({ streak: 2, best: 2, lastDay: '2026-11-11' });
    expect(kept).toMatchObject({ balance: 6, updatedAt: Timestamp.fromMillis(clock) });
    expect(await ledgerIds(fan)).toEqual(['checkin:2026-11-10', 'checkin:2026-11-11']);

    // Religada no dia seguinte: o dia 12 passou em branco, e a chave não é um botão de pausa.
    clock = T0 + 3 * DAY_MS;
    expect(await stateOf(on, fan)).toMatchObject({
      enabled: true,
      checkedInToday: false,
      streak: 0,
      best: 2,
      cycleDay: 1,
    });
    expect((await checkIn(on, fan)).body).toMatchObject({
      pointsAwarded: 3,
      checkin: { streak: 1, best: 2, cycleDay: 1 },
    });
    expect((await wallet(fan))!.checkin).toEqual({ streak: 1, best: 2, lastDay: '2026-11-13' });
  });
});
