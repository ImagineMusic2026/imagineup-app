import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { SeasonConfig, SeasonInfo } from '../src/points';
import { writeSeasonConfig } from '../src/points/config';
import { CLOSE_GRACE_MS, closeJobId, closeNow, runSeasonClose } from '../src/ranking';
import { callable, seedMember, useEmulators, type Member } from './support';

/**
 * As callables da temporada do bloco 8 nos emuladores (docs/arquitetura-api.md,
 * 23.10): `updateSeason` (mais estrito), `scheduleNextSeason`, `endSeason` e
 * `closeSeasonNow`, com a seção ranking, a versão conferida, as recusas, a
 * cópia em versions/{n} e a auditoria em staffAudit. O relógio das callables é
 * o de verdade: as temporadas são montadas em volta de agora.
 */
const SEASON_FUNCTIONS = ['updateSeason', 'scheduleNextSeason', 'endSeason', 'closeSeasonNow'];
const env = useEmulators('temporada', ['createUserProfile', ...SEASON_FUNCTIONS]);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();

async function ok<T = Record<string, unknown>>(name: string, data: unknown, member: Member) {
  const { result, error } = await callable<T>(env, name, data, member.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function failure(name: string, data: unknown, member?: Member) {
  const { error } = await callable(env, name, data, member?.token);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error.details as { reason?: string; field?: string; version?: number };
}

/** As entradas da auditoria de uma ação, em ordem de criação. */
const audits = async (action: string) =>
  (await db.collection('staffAudit').where('action', '==', action).get()).docs
    .map((doc) => doc.data())
    .sort((a, b) => (a.createdAt as Timestamp).toMillis() - (b.createdAt as Timestamp).toMillis());

/** Uma temporada em volta de agora (datas em ms), como o painel manda. */
function season(id: string, startsInDays: number, endsInDays: number) {
  const now = Date.now();
  return {
    id,
    name: `Temporada ${id}`,
    startsAt: now + startsInDays * DAY_MS,
    endsAt: now + endsInDays * DAY_MS,
    leaderTitle: null,
  };
}

const info = (input: ReturnType<typeof season>): SeasonInfo => ({
  ...input,
  topTarget: 10,
  endedEarly: null,
});

/** config/season inteiro, gravado direto (o estado de partida de cada teste). */
async function seasons(config: Partial<Omit<SeasonConfig, 'version'>>, version = 1) {
  await db.runTransaction(async (tx) => {
    writeSeasonConfig(
      tx,
      db,
      { version, season: null, next: null, lastClosed: null, ...config },
      { now: Date.now(), updatedBy: null },
    );
  });
}

describe('acesso', () => {
  it('a seção ranking edita; o leitor, sem a seção, desativada e sem login não', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['ranking']);
    const missions = await seedMember(env, 'Missões', 'editor', ['missions']);
    const disabled = await seedMember(env, 'Desativada', 'editor', ['ranking'], 'disabled');
    await seasons({ season: info(season('temporada-atual', -10, 20)) });
    const next = { expectedVersion: 1, next: season('temporada-proxima', 21, 50) };
    const end = { expectedVersion: 1, seasonId: 'temporada-atual' };
    const close = { seasonId: 'temporada-atual' };
    for (const [name, data] of [
      ['scheduleNextSeason', next],
      ['endSeason', end],
      ['closeSeasonNow', close],
    ] as const) {
      expect((await failure(name, data, viewer)).reason).toBe('no-section');
      expect((await failure(name, data, missions)).reason).toBe('no-section');
      expect((await failure(name, data, disabled)).reason).toBe('not-staff');
      expect((await failure(name, data)).reason).toBe('unauthenticated');
    }
    expect(await ok('scheduleNextSeason', next, editor)).toEqual({ ok: true, version: 2 });
  });
});

describe('updateSeason (mais estrito)', () => {
  it('a começada não sai nem muda de início; o fim no passado é o endSeason; o fim depois do início da próxima', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const current = season('temporada-atual', -10, 20);
    const next = season('temporada-proxima', 21, 50);
    await seasons({ season: info(current), next: info(next) });
    const update = (change: Record<string, unknown> | null) =>
      failure(
        'updateSeason',
        { expectedVersion: 1, season: change === null ? null : { ...current, ...change } },
        editor,
      );
    expect((await update(null)).reason).toBe('season-started');
    expect((await update({ startsAt: current.startsAt + 1 })).reason).toBe('season-started');
    expect((await update({ id: 'outra' })).reason).toBe('season-id-locked');
    expect((await update({ endsAt: Date.now() - 1_000 })).reason).toBe('season-end-in-past');
    expect((await update({ endsAt: next.startsAt + 1 })).reason).toBe('season-overlap');
    // Nome, título e o top do card mudam; a próxima e a última fechada ficam.
    expect(
      await ok(
        'updateSeason',
        { expectedVersion: 1, season: { ...current, name: 'Junina', topTarget: 5 } },
        editor,
      ),
    ).toEqual({ ok: true, version: 2 });
    expect(await read('config/season')).toMatchObject({
      version: 2,
      season: { id: 'temporada-atual', name: 'Junina', topTarget: 5 },
      next: { id: 'temporada-proxima' },
      lastClosed: null,
    });
    // O mesmo pedido de novo: nada muda, sem auditoria nova.
    expect(
      await ok(
        'updateSeason',
        { expectedVersion: 2, season: { ...current, name: 'Junina', topTarget: 5 } },
        editor,
      ),
    ).toEqual({ ok: true, version: 2 });
    expect(await audits('season.updated')).toHaveLength(1);
  });

  it('a encerrada esperando a virada: só nome, título e top; durante a virada, nada (season-closing)', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const ended = season('temporada-encerrada', -30, -1);
    await seasons({ season: info(ended) });
    expect(
      (
        await failure(
          'updateSeason',
          { expectedVersion: 1, season: { ...ended, endsAt: ended.endsAt + DAY_MS } },
          editor,
        )
      ).reason,
    ).toBe('season-ended');
    await ok(
      'updateSeason',
      { expectedVersion: 1, season: { ...ended, leaderTitle: 'Rainha do São João' } },
      editor,
    );
    await db.doc(`rankingJobs/${closeJobId('temporada-encerrada')}`).set({ status: 'running' });
    expect(
      (
        await failure(
          'updateSeason',
          { expectedVersion: 2, season: { ...ended, name: 'Outro nome' } },
          editor,
        )
      ).reason,
    ).toBe('season-closing');
    expect(
      (await failure('endSeason', { expectedVersion: 2, seasonId: 'temporada-encerrada' }, editor))
        .reason,
    ).toBe('season-not-active');
  });

  it('a agendada é livre, mas não sai com a próxima (has-next), nem toma o id da próxima ou de uma fechada', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const scheduled = season('temporada-agendada', 2, 20);
    const next = season('temporada-proxima', 21, 50);
    await seasons({ season: info(scheduled), next: info(next) });
    expect(
      (await failure('updateSeason', { expectedVersion: 1, season: null }, editor)).reason,
    ).toBe('has-next');
    expect(
      (
        await failure(
          'updateSeason',
          { expectedVersion: 1, season: { ...scheduled, id: 'temporada-proxima' } },
          editor,
        )
      ).reason,
    ).toBe('season-id-used');
    await db.doc('seasons/temporada-fechada').set({ status: 'closed' });
    expect(
      (
        await failure(
          'updateSeason',
          { expectedVersion: 1, season: { ...scheduled, id: 'temporada-fechada' } },
          editor,
        )
      ).reason,
    ).toBe('season-id-used');
    // Trocar o id da agendada por um livre vale.
    await ok(
      'updateSeason',
      { expectedVersion: 1, season: { ...scheduled, id: 'temporada-ferias' } },
      editor,
    );
    expect((await read('config/season'))!.season.id).toBe('temporada-ferias');
  });
});

describe('scheduleNextSeason', () => {
  it('sem temporada atual é no-season; o id da atual e o de uma fechada, season-id-used; vencida e cruzando a atual, recusadas; null sem atual vale', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const next = season('temporada-proxima', 21, 50);
    expect((await failure('scheduleNextSeason', { expectedVersion: 0, next }, editor)).reason).toBe(
      'no-season',
    );
    expect(await ok('scheduleNextSeason', { expectedVersion: 0, next: null }, editor)).toEqual({
      ok: true,
      version: 0,
    });

    const current = season('temporada-atual', -10, 20);
    await seasons({ season: info(current) });
    await db.doc('seasons/temporada-carnaval').set({ status: 'closed' });
    const schedule = (change: Record<string, unknown>) =>
      failure('scheduleNextSeason', { expectedVersion: 1, next: { ...next, ...change } }, editor);
    expect((await schedule({ id: 'temporada-atual' })).reason).toBe('season-id-used');
    expect((await schedule({ id: 'temporada-carnaval' })).reason).toBe('season-id-used');
    expect(
      (await schedule({ startsAt: Date.now() - 3 * DAY_MS, endsAt: Date.now() - DAY_MS })).reason,
    ).toBe('season-end-in-past');
    expect((await schedule({ startsAt: current.endsAt - 1 })).reason).toBe('season-overlap');
    expect((await schedule({ topTarget: 51 })).field).toBe('next.topTarget');
    expect((await failure('scheduleNextSeason', { expectedVersion: 0, next }, editor)).reason).toBe(
      'config-changed',
    );

    expect(await ok('scheduleNextSeason', { expectedVersion: 1, next }, editor)).toEqual({
      ok: true,
      version: 2,
    });
    expect(await read('config/season')).toMatchObject({
      version: 2,
      season: { id: 'temporada-atual' },
      next: { id: 'temporada-proxima', topTarget: 10, endedEarly: null },
      updatedBy: { name: 'Ranking' },
    });
    expect(await read('config/season/versions/2')).toMatchObject({
      next: { id: 'temporada-proxima' },
    });
    expect(await ok('scheduleNextSeason', { expectedVersion: 2, next: null }, editor)).toEqual({
      ok: true,
      version: 3,
    });
    expect((await audits('season.next.updated')).map((item) => item.details)).toEqual([
      expect.objectContaining({ seasonId: 'temporada-proxima', previousSeasonId: null }),
      expect.objectContaining({ seasonId: null, previousSeasonId: 'temporada-proxima' }),
    ]);
  });
});

describe('endSeason e a virada', () => {
  it('grava o fim e o endedEarly; a virada fecha depois, com o fim de verdade; o id da tela velha é season-not-active', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const current = season('temporada-atual', -10, 20);
    await seasons({ season: info(current) });
    expect(
      (await failure('endSeason', { expectedVersion: 1, seasonId: 'outra' }, editor)).reason,
    ).toBe('season-not-active');
    const before = Date.now();
    const ended = await ok<{ ok: true; version: number; endsAt: number }>(
      'endSeason',
      { expectedVersion: 1, seasonId: 'temporada-atual' },
      editor,
    );
    expect(ended.version).toBe(2);
    expect(ended.endsAt).toBeGreaterThanOrEqual(before);
    const config = (await read('config/season'))!;
    expect((config.season.endsAt as Timestamp).toMillis()).toBe(ended.endsAt);
    expect(config.season.endedEarly).toMatchObject({
      plannedEndsAt: Timestamp.fromMillis(current.endsAt),
      at: Timestamp.fromMillis(ended.endsAt),
      by: { uid: editor.uid, name: 'Ranking' },
    });
    expect((await audits('season.ended'))[0]!.details).toMatchObject({
      seasonId: 'temporada-atual',
      plannedEndsAt: new Date(current.endsAt).toISOString(),
      endedAt: new Date(ended.endsAt).toISOString(),
    });
    // Encerrada: encerrar de novo não vale.
    expect(
      (await failure('endSeason', { expectedVersion: 2, seasonId: 'temporada-atual' }, editor))
        .reason,
    ).toBe('season-not-active');
    // A virada, pelo handler, depois da folga.
    expect(
      await runSeasonClose(db, { now: ended.endsAt + CLOSE_GRACE_MS, budgetMs: 60_000 }),
    ).toMatchObject({ status: 'closed' });
    expect(await read('seasons/temporada-atual')).toMatchObject({
      status: 'closed',
      endsAt: Timestamp.fromMillis(ended.endsAt),
      endedEarly: { plannedEndsAt: Timestamp.fromMillis(current.endsAt) },
    });
  });
});

describe('closeSeasonNow', () => {
  it('antes do fim mais a folga é season-not-due; sem temporada, no-season; vencida, fecha e audita', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    expect((await failure('closeSeasonNow', { seasonId: 'x' }, editor)).reason).toBe('no-season');
    await seasons({ season: info(season('temporada-atual', -10, 20)) });
    expect((await failure('closeSeasonNow', { seasonId: 'temporada-atual' }, editor)).reason).toBe(
      'season-not-due',
    );
    const now = Date.now();
    await seasons(
      {
        season: {
          ...info(season('temporada-atual', -10, 20)),
          endsAt: now - 2 * CLOSE_GRACE_MS,
        },
        next: info(season('temporada-proxima', 1, 30)),
      },
      2,
    );
    expect((await failure('closeSeasonNow', { seasonId: 'outra' }, editor)).reason).toBe(
      'no-season',
    );
    expect(await ok('closeSeasonNow', { seasonId: 'temporada-atual' }, editor)).toEqual({
      ok: true,
      status: 'closed',
      pages: 1,
    });
    expect(await read('config/season')).toMatchObject({
      version: 3,
      season: { id: 'temporada-proxima' },
      lastClosed: { id: 'temporada-atual' },
    });
    expect((await audits('season.close.requested'))[0]).toMatchObject({
      actorUid: editor.uid,
      details: { seasonId: 'temporada-atual', status: 'closed', pages: 1 },
    });
    expect(await audits('season.closed')).toHaveLength(1);
  });

  it('com o tempo acabando, responde running, e a chamada seguinte continua do cursor até closed', async () => {
    const editor = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const now = Date.now();
    const current = {
      ...info(season('temporada-atual', -10, 20)),
      endsAt: now - 2 * CLOSE_GRACE_MS,
    };
    await seasons({ season: current });
    for (let index = 0; index < 5; index += 1) {
      await db.doc(`wallets/f${index}`).set({
        uid: `f${index}`,
        seasonId: 'temporada-atual',
        seasonPoints: 100 - index,
        seasonPointsAt: Timestamp.fromMillis(now - DAY_MS),
        stats: { pastSeasons: 0, closedSeasonId: null },
        achievements: {},
      });
    }
    const caller = { uid: editor.uid, token: { auth_time: Math.floor(Date.now() / 1000) } };
    const deps = { db, closeBudgetMs: 0, closePageSize: 2 };
    expect(await closeNow(deps, caller, { seasonId: 'temporada-atual' })).toEqual({
      ok: true,
      status: 'running',
      pages: 1,
    });
    let last = { status: 'running' };
    for (let round = 0; round < 10 && last.status === 'running'; round += 1) {
      last = await closeNow(deps, caller, { seasonId: 'temporada-atual' });
    }
    expect(last.status).toBe('closed');
    for (let index = 0; index < 5; index += 1) {
      expect((await read(`seasons/temporada-atual/standings/f${index}`))!.position).toBe(index + 1);
      expect((await read(`wallets/f${index}`))!.stats.pastSeasons).toBe(1);
    }
    // Depois de fechada, a temporada não é mais a atual: no-season.
    expect((await failure('closeSeasonNow', { seasonId: 'temporada-atual' }, editor)).reason).toBe(
      'no-season',
    );
  });
});
