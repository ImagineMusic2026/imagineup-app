import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ACHIEVEMENTS_CONFIG } from '../src/achievements';
import { addMission, catalogDoc, type MissionRecord } from '../src/missions';
import { createConfigSource, DEFAULT_POINTS_CONFIG } from '../src/points';
import { seedGameConfig } from '../src/points/config-seed';
import { CLOSE_GRACE_MS, runSeasonClose } from '../src/ranking';
import {
  callable,
  central,
  localApi,
  post,
  seedMember,
  signUpFan,
  useEmulators,
  type Member,
} from './support';

/**
 * As callables do painel do bloco 7 nos emuladores (docs/arquitetura-api.md,
 * 22.8 e 22.14): a régua e a temporada, as missões e a meta da temporada e as
 * conquistas, com o acesso pela seção (missions; ranking na temporada), a
 * versão conferida, a cópia em versions/{n} e a auditoria em staffAudit.
 */
const GAME_FUNCTIONS = [
  'updatePointsConfig',
  'updateSeason',
  'endSeason',
  'createMission',
  'updateMission',
  'setMissionStatus',
  'reorderMissions',
  'updateSeasonGoal',
  'createAchievement',
  'updateAchievement',
  'setAchievementStatus',
  'reorderAchievements',
];
const env = useEmulators('jogo', ['api', 'createUserProfile', ...GAME_FUNCTIONS]);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

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
  return error.details as { reason?: string; field?: string; version?: number } & Record<
    string,
    unknown
  >;
}

const audits = async (action: string) =>
  (await db.collection('staffAudit').where('action', '==', action).get()).docs.map((doc) =>
    doc.data(),
  );

const missionInput = (extra: Record<string, unknown> = {}) => ({
  title: 'Curta 5 posts do Nenho',
  action: 'like',
  target: null,
  goal: 5,
  period: 'daily',
  rewardPoints: 10,
  featured: false,
  startsAt: Date.now() - DAY_MS,
  endsAt: null,
  ...extra,
});

describe('acesso às callables do jogo', () => {
  it('admin e editora com missions mudam; leitor, sem a seção e desativada não', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['missions']);
    const fans = await seedMember(env, 'Fãs', 'editor', ['fans']);
    const ranking = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const disabled = await seedMember(env, 'Desativada', 'editor', ['missions'], 'disabled');
    const data = { expectedVersion: 0, mission: missionInput() };

    expect(await ok('createMission', data, editor)).toMatchObject({ ok: true, version: 1 });
    expect(await ok('createMission', { ...data, expectedVersion: 1 }, admin)).toMatchObject({
      version: 2,
    });
    expect((await failure('createMission', data, viewer)).reason).toBe('no-section');
    expect((await failure('createMission', data, fans)).reason).toBe('no-section');
    expect((await failure('createMission', data, ranking)).reason).toBe('no-section');
    expect((await failure('createMission', data, disabled)).reason).toBe('not-staff');
    expect((await failure('createMission', data)).reason).toBe('unauthenticated');

    // A temporada é da seção ranking.
    const season = {
      expectedVersion: 0,
      season: {
        id: 'temporada-1',
        name: 'Temporada 1',
        startsAt: Date.now() + DAY_MS,
        endsAt: Date.now() + 30 * DAY_MS,
        leaderTitle: null,
      },
    };
    expect((await failure('updateSeason', season, editor)).reason).toBe('no-section');
    expect(await ok('updateSeason', season, ranking)).toMatchObject({ version: 1 });
  });
});

describe('carga da versão 1 (seedGameConfig, bloco 11, 26.9)', () => {
  it('grava o padrão do código como a versão 1, uma vez; rodar de novo não muda nada', async () => {
    const now = Date.parse('2026-10-08T03:30:00.000Z');
    expect(await seedGameConfig(db, now)).toEqual(['points', 'achievements']);
    const points = await read('config/points');
    expect(points).toMatchObject({
      version: 1,
      updatedBy: null,
      values: DEFAULT_POINTS_CONFIG.values,
      dailyLimits: DEFAULT_POINTS_CONFIG.dailyLimits,
      actionCaps: DEFAULT_POINTS_CONFIG.actionCaps,
      levels: DEFAULT_POINTS_CONFIG.levels,
    });
    // O bloco do check-in diário vai na carga com a chave desligada (seção 40):
    // a mesma carga roda em produção, e quem liga a chave é o painel.
    expect(points!.checkin).toEqual({ enabled: false, cycle: [3, 3, 4, 4, 5, 6, 15] });
    expect(points!.dailyLimits.checkin).toBeNull();
    expect(await read('config/points/versions/1')).toEqual(points);
    const achievements = await read('config/achievements');
    expect(achievements!.version).toBe(1);
    expect(achievements!.achievements.map((item: { id: string }) => item.id)).toEqual(
      DEFAULT_ACHIEVEMENTS_CONFIG.achievements.map((item) => item.id),
    );
    const active = achievements!.achievements.filter(
      (item: { status: string }) => item.status === 'active',
    );
    expect(
      active.every((item: { activatedAt: Timestamp }) => item.activatedAt.toMillis() === now),
    ).toBe(true);
    expect(await read('config/achievements/versions/1')).toEqual(achievements);

    // O lido pelas funções é o mesmo padrão, agora na versão 1.
    const loaded = await createConfigSource(db, { ttlMs: 0 }).get();
    expect(loaded.points).toEqual({ ...DEFAULT_POINTS_CONFIG, version: 1 });
    expect(loaded.game.achievements.map((item) => item.id)).toEqual(
      DEFAULT_ACHIEVEMENTS_CONFIG.achievements.map((item) => item.id),
    );

    const seeded = await audits('config.seeded');
    expect(seeded.map((entry) => entry.details.doc).sort()).toEqual(['achievements', 'points']);
    expect(seeded[0]).toMatchObject({
      actorUid: null,
      actorName: 'Carga inicial',
      targetEmail: '',
      targetUid: null,
      section: 'missions',
      targets: [],
    });

    // De novo: nada muda, nem a auditoria.
    expect(await seedGameConfig(db, now + 60_000)).toEqual([]);
    expect(await read('config/points')).toEqual(points);
    expect(await read('config/achievements')).toEqual(achievements);
    expect(await audits('config.seeded')).toHaveLength(2);
  });

  it('o documento que existe nunca é tocado: só o que falta é gravado', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    await ok('updatePointsConfig', { expectedVersion: 0, values: { like: 7 } }, editor);
    expect(await seedGameConfig(db)).toEqual(['achievements']);
    expect(await read('config/points')).toMatchObject({ version: 1, values: { like: 7 } });
  });

  it('depois da carga, o painel muda a régua e as conquistas com expectedVersion 1, com a seção na auditoria', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    await seedGameConfig(db);
    expect(
      await ok('updatePointsConfig', { expectedVersion: 1, values: { comment: 3 } }, editor),
    ).toEqual({ ok: true, version: 2 });
    const created = await ok<{ achievementId: string; version: number }>(
      'createAchievement',
      {
        expectedVersion: 1,
        achievement: {
          title: 'Primeiro comentário',
          icon: 'heart',
          tone: 'action',
          rule: { type: 'first', action: 'comment' },
        },
      },
      editor,
    );
    expect(created.version).toBe(2);
    expect((await audits('points.config.updated'))[0]).toMatchObject({
      section: 'missions',
      targets: [],
    });
    expect((await audits('achievement.created'))[0]).toMatchObject({
      section: 'missions',
      targets: [`achievement:${created.achievementId}`],
    });
  });
});

describe('régua (updatePointsConfig)', () => {
  it('muda só o que veio, guarda a versão e audita; nada mudou não grava; versão velha é config-changed', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const first = await ok(
      'updatePointsConfig',
      { expectedVersion: 0, values: { like: 3 }, actionCaps: { like_set: 500 } },
      editor,
    );
    expect(first).toEqual({ ok: true, version: 1 });
    const doc = await read('config/points');
    expect(doc).toMatchObject({
      version: 1,
      values: { like: 3, comment: 2 },
      actionCaps: { like_set: 500, comment_sent: 100 },
      dailyLimits: { mission: null },
      updatedBy: { name: 'Editora' },
    });
    expect(await read('config/points/versions/1')).toMatchObject({ version: 1 });
    expect(await audits('points.config.updated')).toHaveLength(1);
    expect((await audits('points.config.updated'))[0]!.details).toMatchObject({
      fields: ['values', 'actionCaps'],
      fromVersion: 0,
      toVersion: 1,
    });

    expect(
      await ok('updatePointsConfig', { expectedVersion: 1, values: { like: 3 } }, editor),
    ).toEqual({ ok: true, version: 1 });
    expect(await audits('points.config.updated')).toHaveLength(1);

    expect(
      await failure('updatePointsConfig', { expectedVersion: 0, values: { like: 4 } }, editor),
    ).toMatchObject({ reason: 'config-changed', version: 1 });
    expect(
      await failure(
        'updatePointsConfig',
        { expectedVersion: 1, dailyLimits: { mission: 5 } },
        editor,
      ),
    ).toMatchObject({ reason: 'invalid-request', field: 'dailyLimits.mission' });
  });

  it('o bloco do check-in (seção 40): liga só a chave, muda só o ciclo, audita a chave e não some no salvar de outro bloco', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const CYCLE = [3, 3, 4, 4, 5, 6, 15];
    const NEW_CYCLE = [1, 2, 3, 4, 5, 6, 7];
    /** As auditorias da régua, na ordem das versões. */
    const history = async () =>
      (await audits('points.config.updated')).sort(
        (a, b) => (a.details.toVersion as number) - (b.details.toVersion as number),
      );

    // Só a chave: o ciclo fica o do padrão, e o resto da régua também.
    expect(
      await ok('updatePointsConfig', { expectedVersion: 0, checkin: { enabled: true } }, editor),
    ).toEqual({ ok: true, version: 1 });
    const first = (await read('config/points'))!;
    expect(first).toMatchObject({
      version: 1,
      values: DEFAULT_POINTS_CONFIG.values,
      levels: DEFAULT_POINTS_CONFIG.levels,
      actionCaps: DEFAULT_POINTS_CONFIG.actionCaps,
      dailyLimits: { mission: null, checkin: null, comment: 20 },
      updatedBy: { name: 'Editora' },
    });
    expect(first.checkin).toEqual({ enabled: true, cycle: CYCLE });
    expect(await read('config/points/versions/1')).toEqual(first);
    expect((await history()).map((entry) => entry.details)).toEqual([
      { fields: ['checkin'], checkinEnabled: true, fromVersion: 0, toVersion: 1 },
    ]);
    expect((await history())[0]).toMatchObject({ section: 'missions', targets: [] });

    // Só o ciclo: a chave continua ligada, e a auditoria não repete a chave.
    expect(
      await ok('updatePointsConfig', { expectedVersion: 1, checkin: { cycle: NEW_CYCLE } }, editor),
    ).toEqual({ ok: true, version: 2 });
    expect((await read('config/points'))!.checkin).toEqual({ enabled: true, cycle: NEW_CYCLE });
    expect((await history())[1]!.details).toEqual({
      fields: ['checkin'],
      fromVersion: 1,
      toVersion: 2,
    });

    // Salvar outro bloco não perde o do check-in (o documento é gravado inteiro).
    expect(
      await ok('updatePointsConfig', { expectedVersion: 2, values: { like: 3 } }, editor),
    ).toEqual({ ok: true, version: 3 });
    const third = (await read('config/points'))!;
    expect(third.checkin).toEqual({ enabled: true, cycle: NEW_CYCLE });
    expect(third.values).toMatchObject({ like: 3 });
    expect((await history())[2]!.details).toEqual({
      fields: ['values'],
      fromVersion: 2,
      toVersion: 3,
    });

    // O bloco inteiro igual ao de agora: nada mudou, nada gravado.
    expect(
      await ok(
        'updatePointsConfig',
        { expectedVersion: 3, checkin: { enabled: true, cycle: NEW_CYCLE } },
        editor,
      ),
    ).toEqual({ ok: true, version: 3 });
    expect(await history()).toHaveLength(3);

    // Desligar junto de outro campo: os dois em `fields`, e o valor novo da chave.
    expect(
      await ok(
        'updatePointsConfig',
        { expectedVersion: 3, values: { like: 4 }, checkin: { enabled: false } },
        editor,
      ),
    ).toEqual({ ok: true, version: 4 });
    expect((await history())[3]!.details).toEqual({
      fields: ['values', 'checkin'],
      checkinEnabled: false,
      fromVersion: 3,
      toVersion: 4,
    });
    // O que as funções leem: a chave desligada, com o ciclo que a equipe deixou.
    const loaded = await createConfigSource(db, { ttlMs: 0 }).get();
    expect(loaded.points.checkin).toEqual({ enabled: false, cycle: NEW_CYCLE });
    expect(loaded.points.dailyLimits.checkin).toBeNull();
    expect(loaded.points.version).toBe(4);
  });

  it('o bloco do check-in fora do formato: invalid-request com o campo, sem gravar; o Leitor não liga a chave', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['missions']);
    for (const [checkin, field] of [
      [{ enabled: 'sim' }, 'checkin.enabled'],
      [{ cycle: [3, 3, 4] }, 'checkin.cycle'],
      // O 0 é recusado: quem desliga o check-in é a chave.
      [{ cycle: [3, 3, 4, 4, 5, 6, 0] }, 'checkin.cycle.6'],
      // O teto de um dia do ciclo é 999 (o da régua, 10.000, é outro).
      [{ cycle: [3, 1_000, 4, 4, 5, 6, 15] }, 'checkin.cycle.1'],
      [{}, 'checkin'],
      [{ enabled: true, bonus: 50 }, 'checkin'],
      [null, 'checkin'],
    ] as const) {
      expect(
        await failure('updatePointsConfig', { expectedVersion: 0, checkin }, editor),
        JSON.stringify(checkin),
      ).toMatchObject({ reason: 'invalid-request', field });
    }
    // O check-in não tem limite do dia nem valor por evento.
    expect(
      await failure(
        'updatePointsConfig',
        { expectedVersion: 0, dailyLimits: { checkin: 5 } },
        editor,
      ),
    ).toMatchObject({ reason: 'invalid-request', field: 'dailyLimits.checkin' });
    expect(
      await failure('updatePointsConfig', { expectedVersion: 0, values: { checkin: 3 } }, editor),
    ).toMatchObject({ reason: 'invalid-request', field: 'values.checkin' });
    expect(
      (
        await failure(
          'updatePointsConfig',
          { expectedVersion: 0, checkin: { enabled: true } },
          viewer,
        )
      ).reason,
    ).toBe('no-section');
    expect(await exists('config/points')).toBe(false);
    expect(await audits('points.config.updated')).toHaveLength(0);
  });

  it('o config/points de produção, salvo antes do check-in e sem o bloco, lido do Firestore: desligado, não paga nem grava; o painel liga e o POST paga; desliga e o POST recusa de novo (seção 40)', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const CYCLE = [3, 3, 4, 4, 5, 6, 15];
    // O documento como o painel de antes gravou: a versão 7, um valor fora do
    // padrão, os limites do dia sem `checkin` e nenhum bloco `checkin`.
    const saved = {
      version: 7,
      values: { ...DEFAULT_POINTS_CONFIG.values, comment: 3 },
      dailyLimits: Object.fromEntries(
        Object.entries(DEFAULT_POINTS_CONFIG.dailyLimits).filter(
          ([source]) => source !== 'checkin',
        ),
      ),
      levels: DEFAULT_POINTS_CONFIG.levels,
      actionCaps: DEFAULT_POINTS_CONFIG.actionCaps,
      updatedAt: Timestamp.fromMillis(Date.parse('2026-11-01T15:00:00.000Z')),
      updatedBy: { uid: 'admin-de-antes', name: 'Admin' },
    };
    expect(saved.dailyLimits).toMatchObject({ comment: 20, mission: null });
    expect(saved.dailyLimits).not.toHaveProperty('checkin');
    expect(saved).not.toHaveProperty('checkin');
    await db.doc('config/points').set(saved);

    // A api no processo do teste, com o relógio fixo (terça-feira, 10/11/2026,
    // meio-dia em São Paulo) e a configuração lida do Firestore a cada pedido.
    // Nunca a `api` de verdade: ela guarda a configuração por 60 s, e a chave
    // ligada ficaria na memória dela para os arquivos seguintes.
    const NOW = Date.parse('2026-11-10T15:00:00.000Z');
    const logged: string[] = [];
    const config = createConfigSource(db, {
      ttlMs: 0,
      log: { warn: (message) => logged.push(message), error: (message) => logged.push(message) },
    });
    const api = localApi(env, { now: () => NOW, config });
    const fan = await signUpFan(db);
    let keys = 0;
    const key = () => `chave-regua-checkin-${++keys}`;
    const checkIn = () => api('POST', '/me/checkin', { token: fan.token, key: key() });
    const state = () => api('GET', '/me/checkin', { token: fan.token });
    const wallet = () => db.doc(`wallets/${fan.uid}`).get();
    const storedKeys = async () =>
      (await db.collection('idempotency').where('uid', '==', fan.uid).get()).size;
    const OFF = {
      status: 200,
      body: {
        enabled: false,
        checkedInToday: false,
        streak: 0,
        best: 0,
        cycle: [],
        cycleDay: 0,
        todayPoints: 0,
        resetsAt: '2026-11-11T03:00:00.000Z',
      },
    };
    const REFUSED = {
      status: 409,
      body: { code: 'checkin_disabled', message: 'O check-in diário não está disponível agora.' },
    };

    // 1. Desligado (o documento não tem o bloco): o que as funções leem é o
    // documento salvo, em silêncio, e o check-in não existe para o fã.
    const loaded = await config.get();
    expect(loaded.points).toMatchObject({
      version: 7,
      values: { comment: 3 },
      checkin: { enabled: false, cycle: CYCLE },
    });
    expect(loaded.points.dailyLimits.checkin).toBeNull();
    expect(await state()).toEqual(OFF);
    expect(await checkIn()).toEqual(REFUSED);
    expect((await wallet()).exists).toBe(false);
    expect(await storedKeys()).toBe(0);
    // A gravação de outra rota (a mensagem do Suporte) cria a carteira sem o campo.
    const sent = await api('POST', '/me/support', {
      token: fan.token,
      key: key(),
      body: { kind: 'idea', text: 'Um check-in diário seria legal.' },
    });
    expect(sent.status).toBe(200);
    const created = (await wallet()).data()!;
    expect(created).toMatchObject({ balance: 0, xp: 0 });
    expect(created).not.toHaveProperty('checkin');
    expect(logged).toEqual([]);

    // 2. O painel liga a chave, pela callable de verdade: a versão 8 ganha o
    // bloco, com o ciclo padrão, e o resto da régua fica como estava.
    expect(
      await ok('updatePointsConfig', { expectedVersion: 7, checkin: { enabled: true } }, editor),
    ).toEqual({ ok: true, version: 8 });
    const on = (await read('config/points'))!;
    expect(on).toMatchObject({
      version: 8,
      values: { comment: 3 },
      dailyLimits: { mission: null, checkin: null },
      updatedBy: { name: 'Editora' },
    });
    expect(on.checkin).toEqual({ enabled: true, cycle: CYCLE });
    // O POST paga o dia 1 do ciclo, com a configuração que veio do Firestore.
    const checkin = {
      enabled: true,
      checkedInToday: true,
      streak: 1,
      best: 1,
      cycle: CYCLE,
      cycleDay: 1,
      todayPoints: 3,
      resetsAt: '2026-11-11T03:00:00.000Z',
    };
    expect(await checkIn()).toEqual({
      status: 200,
      body: {
        pointsAwarded: 3,
        checkin,
        completedMissions: [],
        levelUp: null,
        unlockedAchievements: [],
        missionsChanged: false,
      },
    });
    expect(await state()).toEqual({ status: 200, body: checkin });
    const paid = await wallet();
    expect(paid.data()).toMatchObject({ balance: 3, xp: 3, earnedTotal: 3 });
    expect(paid.get('checkin')).toEqual({ streak: 1, best: 1, lastDay: '2026-11-10' });
    // O lançamento leva a versão nova da régua: a que o painel acabou de gravar.
    expect(await read(`wallets/${fan.uid}/ledger/checkin:2026-11-10`)).toMatchObject({
      kind: 'earn',
      source: 'checkin',
      eventId: '2026-11-10',
      points: 3,
      balanceAfter: 3,
      configVersion: 8,
    });

    // 3. O painel desliga: o POST volta a recusar, e a carteira fica como estava.
    expect(
      await ok('updatePointsConfig', { expectedVersion: 8, checkin: { enabled: false } }, editor),
    ).toEqual({ ok: true, version: 9 });
    expect(await checkIn()).toEqual(REFUSED);
    expect(await state()).toEqual(OFF);
    expect((await wallet()).updateTime).toEqual(paid.updateTime);
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(1);
    // As duas chaves guardadas são as dos pedidos aceitos: o Suporte e o check-in pago.
    expect(await storedKeys()).toBe(2);
    expect(logged).toEqual([]);
    // A auditoria das duas mudanças, na ordem das versões, com o valor novo da chave.
    const history = (await audits('points.config.updated'))
      .map((entry) => entry.details)
      .sort((a, b) => (a.toVersion as number) - (b.toVersion as number));
    expect(history).toEqual([
      { fields: ['checkin'], checkinEnabled: true, fromVersion: 7, toVersion: 8 },
      { fields: ['checkin'], checkinEnabled: false, fromVersion: 8, toVersion: 9 },
    ]);
  });

  it('régua com menos degraus do que uma conquista de nível pede: level-in-use, também sem config/achievements', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const levels = DEFAULT_POINTS_CONFIG.levels.slice(0, 7);
    const details = await failure('updatePointsConfig', { expectedVersion: 0, levels }, editor);
    expect(details).toMatchObject({
      reason: 'level-in-use',
      achievementIds: ['backstage', 'lenda'],
    });
  });
});

describe('temporada (updateSeason)', () => {
  it('o id da temporada que já começou não muda; id usado numa versão antiga é recusado (bloco 8: encerra pelo endSeason e pela virada)', async () => {
    const ranking = await seedMember(env, 'Ranking', 'editor', ['ranking']);
    const now = Date.now();
    const s1 = {
      id: 'temporada-1',
      name: 'T1',
      startsAt: now - DAY_MS,
      endsAt: now + DAY_MS,
      leaderTitle: null,
    };
    await ok('updateSeason', { expectedVersion: 0, season: s1 }, ranking);
    expect(
      (
        await failure(
          'updateSeason',
          { expectedVersion: 1, season: { ...s1, id: 'outra' } },
          ranking,
        )
      ).reason,
    ).toBe('season-id-locked');
    // Nome e fim continuam editáveis.
    await ok(
      'updateSeason',
      { expectedVersion: 1, season: { ...s1, name: 'Temporada 1' } },
      ranking,
    );
    // A começada não sai pelo updateSeason (bloco 8, 23.10): encerra pelo
    // endSeason, a virada fecha (o handler, com o relógio depois da folga) e
    // voltar ao id antigo é season-id-used.
    expect(
      (await failure('updateSeason', { expectedVersion: 2, season: null }, ranking)).reason,
    ).toBe('season-started');
    const ended = await ok<{ version: number; endsAt: number }>(
      'endSeason',
      { expectedVersion: 2, seasonId: 'temporada-1' },
      ranking,
    );
    expect(ended.version).toBe(3);
    const closed = await runSeasonClose(db, {
      now: ended.endsAt + CLOSE_GRACE_MS,
      budgetMs: 60_000,
    });
    expect(closed.status).toBe('closed');
    expect(
      (
        await failure(
          'updateSeason',
          {
            expectedVersion: 4,
            season: { ...s1, startsAt: now + DAY_MS, endsAt: now + 2 * DAY_MS },
          },
          ranking,
        )
      ).reason,
    ).toBe('season-id-used');
    expect(await audits('season.updated')).toHaveLength(2);
    expect(await audits('season.ended')).toHaveLength(1);
  });
});

describe('missões', () => {
  it('cria em rascunho com o id do servidor, o alvo conferido e a central do post gravada', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const nenho = await central(env);
    const p1 = await post(env, nenho);
    const created = await ok<{ missionId: string; version: number }>(
      'createMission',
      { expectedVersion: 0, mission: missionInput({ goal: 1, target: { postId: p1 } }) },
      editor,
    );
    expect(created.missionId).toMatch(/^curta-5-posts-do-nenho-[a-z0-9]{4}$/);
    const doc = await read('config/missions');
    expect(doc!.missions[0]).toMatchObject({
      id: created.missionId,
      status: 'draft',
      activatedAt: null,
      target: { postId: p1, artistId: nenho, eventId: null },
    });
    expect(await audits('mission.created')).toHaveLength(1);
  });

  it('alvo que não existe, alvo que o tipo não aceita, join sem central e meta do alvo único', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const create = (mission: Record<string, unknown>) =>
      failure('createMission', { expectedVersion: 0, mission: missionInput(mission) }, editor);
    expect((await create({ target: { postId: 'nao-existe' }, goal: 1 })).reason).toBe(
      'target-not-found',
    );
    expect((await create({ action: 'join', target: null, goal: 1 })).reason).toBe('invalid-target');
    expect((await create({ action: 'invite', target: { artistId: 'nenho' } })).reason).toBe(
      'invalid-target',
    );
    expect(await create({ target: { eventId: 'x' }, action: 'rsvp', goal: 2 })).toMatchObject({
      reason: 'invalid-request',
      field: 'mission.goal',
    });
  });

  it('publica, trava as regras depois do início, muda o título e o valor; arquiva e traz de volta com o mesmo id', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const nenho = await central(env);
    const { missionId } = await ok<{ missionId: string }>(
      'createMission',
      { expectedVersion: 0, mission: missionInput({ target: { artistId: nenho } }) },
      editor,
    );
    await ok('setMissionStatus', { expectedVersion: 1, missionId, status: 'active' }, editor);
    const published = (await read('config/missions'))!.missions[0];
    expect(published.status).toBe('active');
    expect(published.activatedAt).toBeInstanceOf(Timestamp);

    expect(
      (
        await failure(
          'updateMission',
          { expectedVersion: 2, missionId, changes: { goal: 3 } },
          editor,
        )
      ).reason,
    ).toBe('mission-locked');
    await ok(
      'updateMission',
      {
        expectedVersion: 2,
        missionId,
        changes: { title: 'Curta 5 posts do Nenho hoje', rewardPoints: 25 },
      },
      editor,
    );
    expect((await read('config/missions'))!.missions[0]).toMatchObject({
      title: 'Curta 5 posts do Nenho hoje',
      rewardPoints: 25,
    });

    await ok('setMissionStatus', { expectedVersion: 3, missionId, status: 'archived' }, editor);
    expect((await read('config/missions'))!.missions).toEqual([]);
    expect(await read(`missionArchive/${missionId}`)).toMatchObject({
      status: 'archived',
      archivedBy: { name: 'Editora' },
    });
    expect(
      (
        await failure(
          'updateMission',
          { expectedVersion: 4, missionId, changes: { title: 'x' } },
          editor,
        )
      ).reason,
    ).toBe('mission-not-found');
    await ok('setMissionStatus', { expectedVersion: 4, missionId, status: 'active' }, editor);
    expect(await exists(`missionArchive/${missionId}`)).toBe(false);
    expect((await read('config/missions'))!.missions[0]).toMatchObject({
      id: missionId,
      status: 'active',
      activatedAt: published.activatedAt,
    });
    expect(await read('config/missions/versions/5')).toMatchObject({ version: 5 });
    expect((await audits('mission.published')).length).toBe(2);
    expect((await audits('mission.archived')).length).toBe(1);
  });

  it('a trava começa um cache antes do início: a publicada que começa em 30 s não muda o período; em 2 h, muda', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const nenho = await central(env);
    const publish = async (startsAt: number, version: number) => {
      const { missionId } = await ok<{ missionId: string }>(
        'createMission',
        {
          expectedVersion: version,
          mission: missionInput({ target: { artistId: nenho }, startsAt }),
        },
        editor,
      );
      await ok(
        'setMissionStatus',
        { expectedVersion: version + 1, missionId, status: 'active' },
        editor,
      );
      return missionId;
    };
    const soon = await publish(Date.now() + 30_000, 0);
    expect(
      (
        await failure(
          'updateMission',
          { expectedVersion: 2, missionId: soon, changes: { period: 'weekly' } },
          editor,
        )
      ).reason,
    ).toBe('mission-locked');
    const later = await publish(Date.now() + 2 * 60 * 60 * 1000, 2);
    await ok(
      'updateMission',
      { expectedVersion: 4, missionId: later, changes: { period: 'weekly' } },
      editor,
    );
    expect((await read('config/missions'))!.missions[1]).toMatchObject({
      id: later,
      period: 'weekly',
    });
  });

  it('too-many-active e too-many-missions', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const record = (id: string, status: 'draft' | 'active'): MissionRecord => ({
      id,
      title: `Missão ${id}`,
      action: 'like',
      target: null,
      goal: 3,
      period: 'daily',
      rewardPoints: 10,
      featured: false,
      startsAt: Date.now(),
      endsAt: null,
      status,
      activatedAt: status === 'active' ? Date.now() : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const missions = [
      ...Array.from({ length: 30 }, (_, i) => record(`m-ativa-${i}`, 'active')),
      ...Array.from({ length: 30 }, (_, i) => record(`m-rascunho-${i}`, 'draft')),
    ];
    await db.doc('config/missions').set({ ...catalogDoc(missions, null), version: 1 });
    expect(
      (
        await failure(
          'setMissionStatus',
          { expectedVersion: 1, missionId: 'm-rascunho-0', status: 'active' },
          editor,
        )
      ).reason,
    ).toBe('too-many-active');
    expect(
      (await failure('createMission', { expectedVersion: 1, mission: missionInput() }, editor))
        .reason,
    ).toBe('too-many-missions');
  });

  it('o id gerado é conferido no catálogo e no arquivo: tomado, sorteia de novo', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    await db
      .doc('missionArchive/curta-5-posts-do-nenho-aaaa')
      .set({ id: 'curta-5-posts-do-nenho-aaaa' });
    const draws = [0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99];
    const result = await addMission(
      { db, random: () => draws.shift() ?? 0.5 },
      { uid: editor.uid, token: { auth_time: Math.floor(Date.now() / 1000) } },
      { expectedVersion: 0, mission: missionInput() },
    );
    expect(result.missionId).toBe('curta-5-posts-do-nenho-9999');
  });

  it('a meta da temporada: sem temporada é no-season; com ela, presa ao id e com o texto do prêmio', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const goal = {
      title: 'Semana do arrocha',
      description: 'Complete 20 missões.',
      reachedDescription: 'Lote garantido.',
      metric: 'missions',
      target: 20,
    };
    expect((await failure('updateSeasonGoal', { expectedVersion: 0, goal }, editor)).reason).toBe(
      'no-season',
    );
    await db.doc('config/season').set({
      version: 1,
      season: {
        id: 'temporada-1',
        name: 'T1',
        startsAt: Timestamp.fromMillis(Date.now() - DAY_MS),
        endsAt: Timestamp.fromMillis(Date.now() + DAY_MS),
        leaderTitle: null,
      },
    });
    await ok('updateSeasonGoal', { expectedVersion: 0, goal }, editor);
    expect((await read('config/missions'))!.seasonGoal).toEqual({
      seasonId: 'temporada-1',
      ...goal,
    });
    expect(
      (
        await failure(
          'updateSeasonGoal',
          { expectedVersion: 1, goal: { ...goal, reachedDescription: '' } },
          editor,
        )
      ).field,
    ).toBe('goal.reachedDescription');
    expect(await audits('season.goal.updated')).toHaveLength(1);
  });

  it('a missão criada e o valor mudado valem na api (fonte sem cache)', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const nenho = await central(env);
    const { missionId } = await ok<{ missionId: string }>(
      'createMission',
      { expectedVersion: 0, mission: missionInput({ target: { artistId: nenho } }) },
      editor,
    );
    await ok('setMissionStatus', { expectedVersion: 1, missionId, status: 'active' }, editor);
    const fan = await signUpFan(db);
    const api = localApi(env, {
      now: () => Date.now(),
      config: createConfigSource(db, { ttlMs: 0 }),
    });
    const before = await api('GET', '/missions', { token: fan.token });
    expect((before.body.missions as { rewardPoints: number }[])[0]!.rewardPoints).toBe(10);
    await ok(
      'updateMission',
      { expectedVersion: 2, missionId, changes: { rewardPoints: 35 } },
      editor,
    );
    const after = await api('GET', '/missions', { token: fan.token });
    expect((after.body.missions as { id: string; rewardPoints: number }[])[0]).toMatchObject({
      id: missionId,
      rewardPoints: 35,
    });
  });

  it('reordena só com a lista inteira do catálogo', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const a = await ok<{ missionId: string }>(
      'createMission',
      { expectedVersion: 0, mission: missionInput({ title: 'Primeira' }) },
      editor,
    );
    const b = await ok<{ missionId: string }>(
      'createMission',
      { expectedVersion: 1, mission: missionInput({ title: 'Segunda' }) },
      editor,
    );
    expect(
      (await failure('reorderMissions', { expectedVersion: 2, missionIds: [b.missionId] }, editor))
        .reason,
    ).toBe('invalid-request');
    await ok(
      'reorderMissions',
      { expectedVersion: 2, missionIds: [b.missionId, a.missionId] },
      editor,
    );
    expect(
      (await read('config/missions'))!.missions.map((item: { id: string }) => item.id),
    ).toEqual([b.missionId, a.missionId]);
  });
});

describe('conquistas', () => {
  it('a primeira mudança parte da lista padrão, com activatedAt nas ativas; a regra trava depois de publicar', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const created = await ok<{ achievementId: string; version: number }>(
      'createAchievement',
      {
        expectedVersion: 0,
        achievement: {
          title: 'Dez curtidas',
          icon: 'heart',
          tone: 'action',
          rule: { type: 'first', action: 'like' },
        },
      },
      editor,
    );
    const doc = await read('config/achievements');
    expect(doc!.achievements).toHaveLength(11);
    expect(doc!.achievements[0]).toMatchObject({ id: 'boca-a-boca', status: 'active' });
    expect(doc!.achievements[0].activatedAt).toBeInstanceOf(Timestamp);
    expect(doc!.achievements[10]).toMatchObject({ id: created.achievementId, status: 'draft' });

    expect(
      (
        await failure(
          'updateAchievement',
          {
            expectedVersion: 1,
            achievementId: 'boca-a-boca',
            changes: { rule: { type: 'first', action: 'like' } },
          },
          editor,
        )
      ).reason,
    ).toBe('achievement-locked');
    await ok(
      'updateAchievement',
      { expectedVersion: 1, achievementId: 'boca-a-boca', changes: { title: 'Boca a boca!' } },
      editor,
    );
    // O Top 20 já está no ar (bloco 8): publicar de novo não muda nada.
    expect(
      await ok(
        'setAchievementStatus',
        { expectedVersion: 2, achievementId: 'top-20', status: 'active' },
        editor,
      ),
    ).toEqual({ ok: true, version: 2 });
    expect(
      (
        await failure(
          'createAchievement',
          {
            expectedVersion: 2,
            achievement: {
              title: 'Nível 11',
              icon: 'star',
              tone: 'points',
              rule: { type: 'level', level: 11 },
            },
          },
          editor,
        )
      ).field,
    ).toBe('achievement.rule.level');
    await ok(
      'setAchievementStatus',
      { expectedVersion: 2, achievementId: created.achievementId, status: 'active' },
      editor,
    );
    expect(await audits('achievement.published')).toHaveLength(1);
    expect(await read('config/achievements/versions/3')).toMatchObject({ version: 3 });
  });

  it('a conquista de posição pode ser criada e publicada (bloco 8, 23.9)', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const created = await ok<{ achievementId: string }>(
      'createAchievement',
      {
        expectedVersion: 0,
        achievement: {
          title: 'Top 3',
          icon: 'trophy',
          tone: 'points',
          rule: { type: 'rank', top: 3 },
        },
      },
      editor,
    );
    expect(
      await ok(
        'setAchievementStatus',
        { expectedVersion: 1, achievementId: created.achievementId, status: 'active' },
        editor,
      ),
    ).toEqual({ ok: true, version: 2 });
    expect(
      (await read('config/achievements'))!.achievements.find(
        (item: { id: string }) => item.id === created.achievementId,
      ),
    ).toMatchObject({ status: 'active', rule: { type: 'rank', top: 3 } });
  });

  it('a conquista nova no ar entra no "de N" do fã', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    await ok(
      'setAchievementStatus',
      { expectedVersion: 0, achievementId: 'lenda', status: 'archived' },
      editor,
    );
    const fan = await signUpFan(db);
    const api = localApi(env, {
      now: () => Date.now(),
      config: createConfigSource(db, { ttlMs: 0 }),
    });
    // As 10 da lista padrão (o Top 20 no ar desde o bloco 8) sem a arquivada.
    expect((await api('GET', '/me/achievements', { token: fan.token })).body).toMatchObject({
      totalCount: 9,
    });
  });

  it('a conquista de sequência de check-in (seção 40): o painel cria, publica, edita e reordena com a chave desligada, e o fã só a vê com a chave ligada', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    const achievement = {
      title: '7 dias seguidos',
      icon: 'flame',
      tone: 'action',
      rule: { type: 'streak', days: 7 },
    };
    // Os dias fora de 2 a 1.000 voltam com o campo da regra.
    for (const days of [1, 1_001, 7.5]) {
      expect(
        await failure(
          'createAchievement',
          { expectedVersion: 0, achievement: { ...achievement, rule: { type: 'streak', days } } },
          editor,
        ),
        String(days),
      ).toMatchObject({ reason: 'invalid-request', field: 'achievement.rule.days' });
    }
    const created = await ok<{ achievementId: string; version: number }>(
      'createAchievement',
      { expectedVersion: 0, achievement },
      editor,
    );
    expect(created.achievementId).toMatch(/^7-dias-seguidos-[a-z0-9]{4}$/);
    await ok(
      'setAchievementStatus',
      { expectedVersion: 1, achievementId: created.achievementId, status: 'active' },
      editor,
    );
    // Publicada, a regra trava como as outras; o título segue editável.
    expect(
      (
        await failure(
          'updateAchievement',
          {
            expectedVersion: 2,
            achievementId: created.achievementId,
            changes: { rule: { type: 'streak', days: 10 } },
          },
          editor,
        )
      ).reason,
    ).toBe('achievement-locked');
    await ok(
      'updateAchievement',
      {
        expectedVersion: 2,
        achievementId: created.achievementId,
        changes: { title: 'Uma semana inteira' },
      },
      editor,
    );
    // O painel reordena o catálogo inteiro, com a de sequência, sem a chave ligada.
    const ids = [
      created.achievementId,
      ...DEFAULT_ACHIEVEMENTS_CONFIG.achievements.map((item) => item.id),
    ];
    await ok('reorderAchievements', { expectedVersion: 3, achievementIds: ids }, editor);
    const stored = (await read('config/achievements'))!;
    expect(stored.version).toBe(4);
    expect(stored.achievements.map((item: { id: string }) => item.id)).toEqual(ids);
    expect(stored.achievements[0]).toMatchObject({
      id: created.achievementId,
      title: 'Uma semana inteira',
      status: 'active',
      rule: { type: 'streak', days: 7 },
    });

    // Com a chave desligada (sem config/points), o lado do fã não a vê.
    const fan = await signUpFan(db);
    const api = localApi(env, {
      now: () => Date.now(),
      config: createConfigSource(db, { ttlMs: 0 }),
    });
    const off = await createConfigSource(db, { ttlMs: 0 }).get();
    expect(off.game.achievements.map((item) => item.id)).toEqual(ids.slice(1));
    expect((await api('GET', '/me/achievements', { token: fan.token })).body).toMatchObject({
      totalCount: 10,
    });
    // O painel liga a chave: a conquista entra no jogo e no "de N", na ordem do catálogo.
    await ok('updatePointsConfig', { expectedVersion: 0, checkin: { enabled: true } }, editor);
    const on = await createConfigSource(db, { ttlMs: 0 }).get();
    expect(on.game.achievements.map((item) => item.id)).toEqual(ids);
    expect((await api('GET', '/me/achievements', { token: fan.token })).body).toMatchObject({
      unlockedCount: 0,
      totalCount: 11,
    });
  });
});
