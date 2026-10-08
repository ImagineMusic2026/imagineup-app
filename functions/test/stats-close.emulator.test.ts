import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  runStatsClose,
  startStatsClose,
  STATS_FIRST_DAY,
  type CloseLog,
  type StatsSnapshot,
  type StatsTree,
} from '../src/points/close';
import { shiftDay } from '../src/points/model';
import { central, unique, useEmulators, waitFor } from './support';

/**
 * O fechamento do dia nos emuladores (bloco 11, docs/arquitetura-api.md, 26.3
 * e 26.14): o runStatsClose chamado no processo do teste, com o relógio fixo
 * (o emulador não roda função agendada), sobre shards gravados direto; a
 * trava da carga dos cadastros, a folga, o teto por rodada, o retrato da
 * noite, a rede de segurança do fanCount e as rodadas ao mesmo tempo.
 */
const env = useEmulators('fechamento', ['queueArtistFanCountSync', 'syncArtistFanCount']);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local: string) => Date.parse(`${local}-03:00`);

/** 00:20 de 07/10/2026: ontem é 06/10. */
const NIGHT = sp('2026-10-07T00:20:00');

type Logged = { level: 'info' | 'warn' | 'error'; message: string; data?: unknown };

function recordingLog(): { log: CloseLog; entries: Logged[] } {
  const entries: Logged[] = [];
  const at =
    (level: Logged['level']) =>
    (message: string, data?: unknown): void => {
      entries.push({ level, message, data });
    };
  return {
    entries,
    log: { info: at('info'), warn: at('warn'), error: at('error') } as unknown as CloseLog,
  };
}

const shard = (day: string, id: string, data: DocumentData) =>
  db.doc(`statsDaily/${day}/statsShards/${id}`).set({ day, ...data });

describe('a trava do começo', () => {
  it('sem statsMeta/close, nada fecha e o log é de erro', async () => {
    await shard('2026-10-05', '1', { totals: { earned: 3 } });
    const { log, entries } = recordingLog();
    const result = await runStatsClose(db, { now: NIGHT, log });
    expect(result).toMatchObject({ status: 'not-started', closed: [] });
    expect(entries).toEqual([
      {
        level: 'error',
        message: 'closeStatsDays: statsMeta/close não existe; rode a carga dos cadastros',
        data: undefined,
      },
    ]);
    expect(await exists('statsDaily/2026-10-05')).toBe(false);
  });

  it('o startStatsClose cria uma vez só: o primeiro a chegar vale', async () => {
    expect(await startStatsClose(db, '2026-10-01', 'seed', NIGHT)).toEqual({
      created: true,
      lastClosedDay: '2026-09-30',
    });
    expect(await startStatsClose(db, '2026-09-29', 'backfill', NIGHT)).toEqual({
      created: false,
      lastClosedDay: '2026-09-30',
    });
    expect(await read('statsMeta/close')).toEqual({
      lastClosedDay: '2026-09-30',
      startedBy: 'seed',
      updatedAt: Timestamp.fromMillis(NIGHT),
    });
    expect(STATS_FIRST_DAY).toBe('2026-09-29');
  });
});

describe('cada dia fechado', () => {
  it('soma os shards com o backfill; o dia sem shard fecha zerado; nunca muda numa rodada seguinte', async () => {
    await startStatsClose(db, '2026-10-05', 'seed', NIGHT);
    await shard('2026-10-05', '3', {
      totals: { earned: 10, earnedEvents: 2 },
      actives: { day: 2, newInWeek: 1 },
      byOrigin: { utmCampaign: { 'sao-joao': { signups: 1 } } },
      updatedAt: Timestamp.fromMillis(NIGHT),
    });
    await shard('2026-10-05', '9', { totals: { earned: 5, likes: 1 }, actives: { day: 1 } });
    await shard('2026-10-05', 'backfill', { signups: { total: 4 }, backfill: true });

    const result = await runStatsClose(db, {
      now: NIGHT,
      snapshotOf: () => null,
    });
    expect(result).toMatchObject({ status: 'closed', closed: ['2026-10-05', '2026-10-06'] });
    expect(await read('statsDaily/2026-10-05')).toEqual({
      day: '2026-10-05',
      closed: true,
      closedAt: Timestamp.fromMillis(NIGHT),
      shardCount: 3,
      schemaVersion: 1,
      snapshot: null,
      totals: { earned: 15, earnedEvents: 2, likes: 1 },
      actives: { day: 3, newInWeek: 1 },
      byOrigin: { utmCampaign: { 'sao-joao': { signups: 1 } } },
      signups: { total: 4 },
    });
    expect(await read('statsDaily/2026-10-06')).toEqual({
      day: '2026-10-06',
      closed: true,
      closedAt: Timestamp.fromMillis(NIGHT),
      shardCount: 0,
      schemaVersion: 1,
      snapshot: null,
    });
    expect((await read('statsMeta/close'))?.lastClosedDay).toBe('2026-10-06');

    // Um shard que chegasse depois a um dia fechado não muda o fechado.
    await shard('2026-10-05', '12', { totals: { earned: 100 } });
    const later = await runStatsClose(db, { now: NIGHT + 24 * 3_600_000, snapshotOf: () => null });
    expect(later.closed).toEqual(['2026-10-07']);
    expect((await read('statsDaily/2026-10-05'))?.totals).toEqual({
      earned: 15,
      earnedEvents: 2,
      likes: 1,
    });
  });

  it('a rodada à 00:05 não fecha ontem (a folga); à 00:10, fecha', async () => {
    await startStatsClose(db, '2026-10-05', 'seed', NIGHT);
    expect(
      (await runStatsClose(db, { now: sp('2026-10-07T00:05:00'), snapshotOf: () => null })).closed,
    ).toEqual(['2026-10-05']);
    expect(await exists('statsDaily/2026-10-06')).toBe(false);
    expect(
      (await runStatsClose(db, { now: sp('2026-10-07T00:10:00'), snapshotOf: () => null })).closed,
    ).toEqual(['2026-10-06']);
    expect(
      (await runStatsClose(db, { now: sp('2026-10-07T00:20:00'), snapshotOf: () => null })).status,
    ).toBe('idle');
  });

  it('fecha no máximo 31 dias por rodada; a rodada seguinte continua do seguinte', async () => {
    await startStatsClose(db, STATS_FIRST_DAY, 'backfill', NIGHT);
    const now = sp('2026-11-15T00:20:00');
    const first = await runStatsClose(db, { now, snapshotOf: () => null });
    expect(first.closed).toHaveLength(31);
    expect(first.closed[0]).toBe('2026-09-29');
    expect(first.lastClosedDay).toBe('2026-10-29');
    const second = await runStatsClose(db, { now, snapshotOf: () => null });
    expect(second.closed[0]).toBe('2026-10-30');
    expect(second.closed.at(-1)).toBe('2026-11-14');
    expect((await read('statsMeta/close'))?.lastClosedDay).toBe('2026-11-14');
  });

  it('duas rodadas ao mesmo tempo fecham cada dia uma vez', async () => {
    await startStatsClose(db, '2026-10-01', 'seed', NIGHT);
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      await shard(day, '1', { totals: { earned: 1 } });
    }
    const [a, b] = await Promise.all([
      runStatsClose(db, { now: NIGHT, snapshotOf: () => null }),
      runStatsClose(db, { now: NIGHT, snapshotOf: () => null }),
    ]);
    // Cada dia fechado por uma rodada só: a outra viu o controle passar dele e pulou.
    const closed = [...a.closed, ...b.closed].sort();
    expect(closed).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(a.closed.filter((day) => b.closed.includes(day))).toEqual([]);
    for (const day of closed) {
      expect((await read(`statsDaily/${day}`))?.closed).toBe(true);
    }
    expect((await read('statsMeta/close'))?.lastClosedDay).toBe('2026-10-06');
  });

  it('o snapshotOf é chamado em cada dia, na ordem, com a soma do dia, e o retrato vai para o dia', async () => {
    await startStatsClose(db, '2026-10-04', 'seed', NIGHT);
    await shard('2026-10-04', '1', { signups: { total: 2 } });
    await shard('2026-10-06', '1', { signups: { total: 5 } });
    const calls: [string, StatsTree][] = [];
    let fans = 100;
    const byDay = new Map<string, StatsSnapshot>();
    await runStatsClose(db, {
      now: NIGHT,
      snapshotOf: (day, sum) => {
        calls.push([day, sum]);
        // Como o seed: o retrato para a frente, guardado por dia (a transação pode repetir).
        const cached = byDay.get(day);
        if (cached) return cached;
        fans += ((sum.signups as StatsTree | undefined)?.total as number | undefined) ?? 0;
        const snapshot = { at: NIGHT, fans, season: null, artists: {} };
        byDay.set(day, snapshot);
        return snapshot;
      },
    });
    const order = calls.map(([day]) => day);
    expect(order).toEqual([...order].sort());
    expect([...new Set(calls.map(([day]) => day))]).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(calls.find(([day]) => day === '2026-10-04')![1]).toEqual({ signups: { total: 2 } });
    expect(calls.find(([day]) => day === '2026-10-05')![1]).toEqual({});
    expect((await read('statsDaily/2026-10-04'))?.snapshot).toEqual({
      at: Timestamp.fromMillis(NIGHT),
      fans: 102,
      season: null,
      artists: {},
    });
    expect((await read('statsDaily/2026-10-06'))?.snapshot?.fans).toBe(107);
  });
});

describe('o retrato da noite e a rede do fanCount', () => {
  it('só no dia de ontem: fãs, membros pela soma dos shards, PTS DA CENTRAL e fãs da temporada; a central com o fanCount errado é acertada', async () => {
    await startStatsClose(db, '2026-10-05', 'seed', NIGHT);
    const nenho = await central(env, {}, unique('nenho'));
    const netto = await central(env, {}, unique('netto'));
    const rascunho = await central(env, { status: 'draft' }, unique('rascunho'));

    for (const uid of ['f1', 'f2', 'f3']) {
      await db.doc(`users/${uid}`).set({ displayName: uid, createdAt: Timestamp.now() });
    }
    // Membros: 3 no Nenho (em dois shards), 1 no Netto; o rascunho sem shard.
    await db.doc(`artistStats/${nenho}/fanShards/0`).set({ count: 2 });
    await db.doc(`artistStats/${nenho}/fanShards/7`).set({ count: 1 });
    await db.doc(`artistStats/${netto}/fanShards/3`).set({ count: 1 });
    await waitFor('a cópia do fanCount pela fila', async () => {
      const [a, b] = await Promise.all([read(`artists/${nenho}`), read(`artists/${netto}`)]);
      return a?.fanCount === 3 && b?.fanCount === 1;
    });
    // A cópia do Netto diverge (uma tarefa perdida, por exemplo).
    await db.doc(`artists/${netto}`).update({ fanCount: 9 });

    // PTS DA CENTRAL e a temporada.
    const season = {
      id: 'sao-joao',
      name: 'São João',
      startsAt: Timestamp.fromMillis(NIGHT - 10 * 24 * 3_600_000),
      endsAt: Timestamp.fromMillis(NIGHT + 10 * 24 * 3_600_000),
      leaderTitle: null,
    };
    await db.doc('config/season').set({ version: 1, season, next: null, lastClosed: null });
    await db.doc(`wallets/f1/centralPoints/${nenho}`).set({ artistId: nenho, totalPoints: 40 });
    await db.doc(`wallets/f2/centralPoints/${nenho}`).set({ artistId: nenho, totalPoints: 2 });
    await db.doc(`wallets/f1`).set({ seasonId: 'sao-joao', seasonPoints: 10 });
    await db.doc(`wallets/f2`).set({ seasonId: 'sao-joao', seasonPoints: 0 });
    await db.doc(`wallets/f3`).set({ seasonId: 'carnaval', seasonPoints: 50 });

    const { log, entries } = recordingLog();
    const result = await runStatsClose(db, { now: NIGHT, log });
    expect(result.closed).toEqual(['2026-10-05', '2026-10-06']);
    expect(result.synced).toEqual([netto]);
    expect((await read('statsDaily/2026-10-05'))?.snapshot).toBeNull();
    expect((await read('statsDaily/2026-10-06'))?.snapshot).toEqual({
      at: Timestamp.fromMillis(NIGHT),
      fans: 3,
      season: { id: 'sao-joao', rankedFans: 1 },
      artists: {
        [nenho]: { members: 3, totalPoints: 42 },
        [netto]: { members: 1, totalPoints: 0 },
        [rascunho]: { members: 0, totalPoints: 0 },
      },
    });
    expect((await read(`artists/${netto}`))?.fanCount).toBe(1);
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('a temporada que terminou à meia-noite, com a virada já feita, fica no retrato do último dia dela', async () => {
    await startStatsClose(db, '2026-10-06', 'seed', NIGHT);
    const midnight = sp('2026-10-07T00:00:00');
    const DAY = 24 * 3_600_000;
    const def = (id: string, startsAt: number, endsAt: number) => ({
      id,
      name: id,
      startsAt: Timestamp.fromMillis(startsAt),
      endsAt: Timestamp.fromMillis(endsAt),
      leaderTitle: null,
    });
    await db.doc('config/season').set({
      version: 2,
      season: def('primavera', midnight, midnight + 30 * DAY),
      next: null,
      lastClosed: {
        ...def('sao-joao', midnight - 30 * DAY, midnight),
        closedAt: Timestamp.fromMillis(midnight + 5 * 60_000),
      },
    });
    // A virada não zera a carteira; quem já pontuou na primavera saiu da conta da São João.
    await db.doc('wallets/f1').set({ seasonId: 'sao-joao', seasonPoints: 10 });
    await db.doc('wallets/f2').set({ seasonId: 'sao-joao', seasonPoints: 3 });
    await db.doc('wallets/f3').set({ seasonId: 'primavera', seasonPoints: 2 });

    expect((await runStatsClose(db, { now: NIGHT })).closed).toEqual(['2026-10-06']);
    expect((await read('statsDaily/2026-10-06'))?.snapshot?.season).toEqual({
      id: 'sao-joao',
      rankedFans: 2,
    });
  });

  it('sem ontem entre os dias da rodada (o atraso que ainda não chegou), nenhum retrato', async () => {
    await startStatsClose(db, STATS_FIRST_DAY, 'backfill', NIGHT);
    const result = await runStatsClose(db, { now: NIGHT, maxDays: 3 });
    expect(result.closed).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    for (const day of result.closed) {
      expect((await read(`statsDaily/${day}`))?.snapshot).toBeNull();
    }
  });
});

describe('a carga dos cadastros e o fechamento', () => {
  const runScript = promisify(execFile);
  const script = resolve(__dirname, '../../scripts/backfill-signups.mjs');

  it('a primeira carga abre o fechamento; a segunda, depois de um fechamento, pula os perfis dos dias fechados e não toca no shard deles', async () => {
    const legacy = (id: string, day: string) =>
      db.doc(`users/${id}`).set({
        displayName: id,
        username: id,
        createdAt: Timestamp.fromMillis(Date.parse(`${day}T15:00:00.000Z`)),
      });
    await legacy('antigo-1', '2026-09-30');
    await legacy('antigo-2', '2026-10-02');

    const first = await runScript(process.execPath, [script], { env: process.env });
    expect(first.stdout).toContain('2026-09-30: 1');
    expect(first.stdout).toContain('Fechamento aberto');
    // O menor entre o primeiro dia somado e 29/09.
    expect(await read('statsMeta/close')).toMatchObject({
      lastClosedDay: shiftDay(STATS_FIRST_DAY, -1),
      startedBy: 'backfill',
    });

    // O fechamento anda até 01/10; nascem dois perfis sem a marca, um num dia fechado.
    await runStatsClose(db, { now: sp('2026-10-02T00:20:00'), snapshotOf: () => null });
    expect((await read('statsMeta/close'))?.lastClosedDay).toBe('2026-10-01');
    const closedBefore = await read('statsDaily/2026-09-30');
    await legacy('atrasado', '2026-09-30');
    await legacy('aberto', '2026-10-03');

    const dry = await runScript(process.execPath, [script, '--dry-run'], { env: process.env });
    expect(dry.stdout).toContain('2026-09-30: 1 (dia já fechado, fica de fora)');
    expect(dry.stdout).toContain('2026-10-03: 1');

    const second = await runScript(process.execPath, [script], { env: process.env });
    expect(second.stdout).toContain('1 perfis de dias já fechados ficaram de fora: 2026-09-30 (1)');
    expect(second.stdout).toContain('Fechamento já estava aberto');
    expect((await read('users/atrasado'))?.signupCounted).toBeUndefined();
    expect((await read('users/aberto'))?.signupCounted).toBe(true);
    // O shard do dia fechado ficou com o 1 da primeira carga; o fechado não mudou.
    expect((await read('statsDaily/2026-09-30/statsShards/backfill'))?.signups).toEqual({
      total: 1,
    });
    expect(await read('statsDaily/2026-09-30')).toEqual(closedBefore);
    expect((await read('statsDaily/2026-10-03/statsShards/backfill'))?.signups).toEqual({
      total: 1,
    });
  });
});
