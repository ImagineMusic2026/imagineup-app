import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { seedCamilaCentrals, seedCentrals } from '../src/centrals';
import { dayKey, weekStart } from '../src/day';
import { SEED_FAN_DETAILS, seedFanDetails, seedFanDetailsChanges } from '../src/fan-profile';
import {
  createConfigSource,
  DEFAULT_POINTS_CONFIG,
  runAward,
  SEED_ACTOR,
  seedCamilaWallet,
  type SeasonConfig,
  type SeasonInfo,
} from '../src/points';
import { writeSeasonConfig } from '../src/points/config';
import {
  CLOSE_GRACE_MS,
  closeJobId,
  decodeRankCursor,
  RANKING_SEED,
  rankingAccountKey,
  runRankSnapshot,
  runRankingTick,
  runSeasonClose,
  SEED_PAST_SEASONS,
  seedPastSeasons,
  seedRankingBase,
  seedRankingSnapshot,
  seedRankingWeek,
  snapshotJobId,
  type JobOptions,
} from '../src/ranking';
import { deleteUserData } from '../src/store';
import {
  central,
  http,
  localApi,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  type Fan,
} from './support';

/**
 * O ranking e as temporadas do bloco 8 nos emuladores (docs/arquitetura-api.md,
 * 23.16): a lista, a posição e a meta pelo handler da `api` no processo do
 * teste (relógio fixo, configuração sem cache) e pela `api` de verdade, com o
 * ID token do emulador de Auth; o `member` pelas rotas de entrar e sair; o
 * retrato semanal e a virada pelo handler da função agendada, com relógio
 * fixo (o emulador não roda função agendada); a exclusão de conta; e o seed.
 * Os fãs do ranking nascem no próprio teste: quem chama se cadastra, e os
 * outros são carteiras gravadas no formato do núcleo.
 */
const env = useEmulators('ranking', ['api', 'createUserProfile', 'deleteUserProfile']);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60_000;
// Quarta-feira, 7 de outubro de 2026, 15:00 de São Paulo (semana 2026-W41).
const T0 = Date.parse('2026-10-07T18:00:00.000Z');
const MONDAY = weekStart(T0);

const SJ: SeasonInfo = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: T0 - 18 * DAY_MS,
  endsAt: T0 + 12 * DAY_MS,
  leaderTitle: null,
  topTarget: 10,
  endedEarly: null,
};
const NEXT: SeasonInfo = {
  ...SJ,
  id: 'temporada-verao',
  name: 'Verão',
  startsAt: T0 + 13 * DAY_MS,
  endsAt: T0 + 43 * DAY_MS,
};

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

/** O handler com o relógio fixo e a configuração sem cache. */
function apiAt(now: number | (() => number)) {
  return localApi(env, {
    now: typeof now === 'number' ? () => now : now,
    config: createConfigSource(db, { ttlMs: 0 }),
  });
}

type Api = ReturnType<typeof apiAt>;

/** config/season inteiro, como a virada e as callables gravam. */
async function seasons(config: Partial<Omit<SeasonConfig, 'version'>> = {}, version = 1) {
  await db.runTransaction(async (tx) => {
    writeSeasonConfig(
      tx,
      db,
      { version, season: SJ, next: null, lastClosed: null, ...config },
      { now: T0, updatedBy: null },
    );
  });
}

type CentralSeed = { points: number; at?: number; member?: boolean; seasonId?: string };

type Ghost = {
  points: number;
  at?: number;
  seasonId?: string;
  name?: string | null;
  city?: string | null;
  /** false: sem perfil (conta sendo excluída). */
  profile?: boolean;
  centrals?: Record<string, CentralSeed>;
  achievements?: Record<string, number>;
};

/**
 * A carteira (e as centrais) de um fã no formato que o núcleo grava, sem
 * conta no Auth: os outros fãs do ranking. Com `profile`, o perfil também.
 */
async function ghost(uid: string, data: Ghost): Promise<void> {
  const at = Timestamp.fromMillis(data.at ?? T0 - DAY_MS);
  const batch = db.batch();
  if (data.profile !== false) {
    batch.set(db.doc(`users/${uid}`), {
      displayName: data.name === undefined ? `Fã ${uid}` : data.name,
      username: uid,
      city: data.city ?? null,
      photoURL: null,
      createdAt: Timestamp.fromMillis(T0 - 30 * DAY_MS),
    });
  }
  batch.set(db.doc(`wallets/${uid}`), {
    uid,
    balance: data.points,
    xp: data.points,
    seasonId: data.seasonId ?? SJ.id,
    seasonPoints: data.points,
    seasonPointsAt: data.points > 0 ? at : null,
    earnedTotal: data.points,
    spentTotal: 0,
    days: {},
    stats: { pastSeasons: 0, closedSeasonId: null },
    activity: { lastDay: null, lastWeek: null, lastMonth: null },
    seasonMissions: 0,
    goalReached: null,
    missions: { daily: null, weekly: null },
    achievements: Object.fromEntries(
      Object.entries(data.achievements ?? {}).map(([id, ms]) => [id, Timestamp.fromMillis(ms)]),
    ),
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
  });
  for (const [artistId, seed] of Object.entries(data.centrals ?? {})) {
    batch.set(db.doc(`wallets/${uid}/centralPoints/${artistId}`), {
      uid,
      artistId,
      seasonId: seed.seasonId ?? SJ.id,
      seasonPoints: seed.points,
      seasonPointsAt: seed.points > 0 ? Timestamp.fromMillis(seed.at ?? T0 - DAY_MS) : null,
      totalPoints: seed.points,
      member: seed.member ?? true,
      updatedAt: at,
    });
  }
  await batch.commit();
}

/** A carteira de quem chama (já cadastrado), gravada como a de um fantasma. */
const mine = (fan: Fan, data: Ghost) => ghost(fan.uid, { ...data, profile: false });

type Entry = {
  position: number;
  userId: string;
  displayName: string | null;
  city: string | null;
  points: number;
  change: number;
  isMe: boolean;
};
type Page = { items: Entry[]; nextCursor: string | null };

async function page(api: Api, fan: Fan, query: Record<string, string> = {}): Promise<Page> {
  const result = await api('GET', '/ranking', { token: fan.token, query });
  expect(result.status).toBe(200);
  return result.body as unknown as Page;
}

/** Todas as páginas do recorte, seguindo o cursor. */
async function allPages(api: Api, fan: Fan, artistId?: string): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const query: Record<string, string> = {};
    if (artistId) query.artistId = artistId;
    if (cursor) query.cursor = cursor;
    const next = await page(api, fan, query);
    pages.push(next);
    cursor = next.nextCursor;
  } while (cursor && pages.length < 20);
  return pages;
}

const rows = (pages: Page[]) => pages.flatMap((item) => item.items);

async function myRank(api: Api, fan: Fan, artistId?: string) {
  const result = await api('GET', '/me/rank', {
    token: fan.token,
    query: artistId ? { artistId } : {},
  });
  expect(result.status).toBe(200);
  return result.body as {
    position: number | null;
    points: number;
    target: { kind: string; position: number; pointsLeft: number } | null;
    member?: boolean;
  };
}

const run = (options: Partial<JobOptions> & { now: number }) => ({
  budgetMs: 60_000,
  ...options,
});

async function closeAll(now: number, extra: Partial<JobOptions> = {}) {
  for (let round = 0; round < 30; round += 1) {
    const result = await runSeasonClose(db, run({ now, ...extra }));
    if (result.status !== 'running') return result;
  }
  throw new Error('A virada não terminou.');
}

async function snapshotAll(now: number, extra: Partial<JobOptions> = {}) {
  for (let round = 0; round < 30; round += 1) {
    const result = await runRankSnapshot(db, run({ now, ...extra }));
    if (result.status !== 'running') return result;
  }
  throw new Error('O retrato não terminou.');
}

/** Os uids em ordem de ranking pela regra da lista: pontos, chegada, id. */
function expectedOrder(fans: { uid: string; points: number; at: number }[]): string[] {
  return [...fans]
    .sort((a, b) => b.points - a.points || a.at - b.at || (a.uid < b.uid ? -1 : 1))
    .map((fan) => fan.uid);
}

describe('a lista do ranking', () => {
  it('ordem por pontos, empate pela chegada e pelo id; páginas de 20 com cursor; perfil, isMe e só quem pontuou na temporada', async () => {
    await seasons();
    const me = await signUpFan(db, 'Camila Ribeiro');
    await db.doc(`users/${me.uid}`).update({ city: 'Feira de Santana, BA' });
    const fans: { uid: string; points: number; at: number }[] = [];
    // 24 fantasmas com pontos distintos, mais dois empates: mesmos pontos com
    // instantes diferentes, e mesmos pontos no mesmo milissegundo.
    for (let index = 0; index < 24; index += 1) {
      const uid = `fa${String(index).padStart(2, '0')}x`;
      const points = 5_000 - index * 100;
      fans.push({ uid, points, at: T0 - DAY_MS });
      await ghost(uid, { points, city: index % 2 === 0 ? 'Irará, BA' : null });
    }
    fans.push({ uid: 'empateTarde', points: 4_550, at: T0 - DAY_MS + 5_000 });
    await ghost('empateTarde', { points: 4_550, at: T0 - DAY_MS + 5_000 });
    fans.push({ uid: 'empateCedo', points: 4_550, at: T0 - 2 * DAY_MS });
    await ghost('empateCedo', { points: 4_550, at: T0 - 2 * DAY_MS });
    for (const uid of ['mesmoMsB', 'mesmoMsA']) {
      fans.push({ uid, points: 4_450, at: T0 - DAY_MS });
      await ghost(uid, { points: 4_450 });
    }
    // Perfil apagado com a carteira ainda lá (a exclusão no meio): "Fã" no app.
    fans.push({ uid: 'semPerfil', points: 3_150, at: T0 - DAY_MS });
    await ghost('semPerfil', { points: 3_150, profile: false });
    fans.push({ uid: me.uid, points: 4_120, at: T0 - DAY_MS + 1 });
    await mine(me, { points: 4_120, at: T0 - DAY_MS + 1 });
    // Fora: sem pontos, pontos de outra temporada e sem carteira.
    await ghost('zerado', { points: 0 });
    await ghost('outraTemporada', { points: 9_999, seasonId: 'temporada-carnaval' });
    await db.doc('users/semCarteira').set({ displayName: 'Sem Carteira' });

    const api = apiAt(T0);
    const pages = await allPages(api, me);
    expect(pages.map((item) => item.items.length)).toEqual([20, 10]);
    expect(pages[1]!.nextCursor).toBeNull();
    const list = rows(pages);
    expect(list.map((item) => item.userId)).toEqual(expectedOrder(fans));
    expect(list.map((item) => item.position)).toEqual(list.map((_, index) => index + 1));
    // O empate: quem chegou primeiro na frente; no mesmo milissegundo, o id.
    const ids = list.map((item) => item.userId);
    expect(ids.indexOf('empateCedo')).toBeLessThan(ids.indexOf('empateTarde'));
    expect(ids.indexOf('mesmoMsA')).toBeLessThan(ids.indexOf('mesmoMsB'));
    expect(list.find((item) => item.isMe)).toMatchObject({
      userId: me.uid,
      displayName: 'Camila Ribeiro',
      city: 'Feira de Santana, BA',
      points: 4_120,
      change: 0,
    });
    expect(list.filter((item) => item.isMe)).toHaveLength(1);
    expect(list.find((item) => item.userId === 'fa00x')).toMatchObject({
      position: 1,
      displayName: 'Fã fa00x',
      city: 'Irará, BA',
    });
    expect(list.find((item) => item.userId === 'semPerfil')).toMatchObject({
      displayName: null,
      city: null,
    });
    for (const out of ['zerado', 'outraTemporada', 'semCarteira']) expect(ids).not.toContain(out);

    // O cursor leva a posição da última linha, e a primeira da página seguinte vem das contagens.
    expect(decodeRankCursor(pages[0]!.nextCursor!)).toMatchObject({ position: 20 });
    expect(pages[1]!.items[0]!.position).toBe(21);
  });

  it('o recorte da central só tem membros com pontos nela; central fora do ar ou inexistente é 404; cursor montado à mão é 400', async () => {
    await seasons();
    const netto = await central(env, {}, unique('netto'));
    const off = await central(env, { status: 'unpublished' }, unique('fora'));
    const me = await signUpFan(db, 'Camila Ribeiro');
    await mine(me, { points: 100, centrals: { [netto]: { points: 80 } } });
    await ghost('membroA', { points: 300, centrals: { [netto]: { points: 200 } } });
    await ghost('saiu', { points: 900, centrals: { [netto]: { points: 900, member: false } } });
    await ghost('outra', {
      points: 500,
      centrals: { [netto]: { points: 500, seasonId: 'temporada-carnaval' } },
    });
    const api = apiAt(T0);
    const list = (await page(api, me, { artistId: netto })).items;
    expect(list.map((item) => [item.userId, item.position, item.points])).toEqual([
      ['membroA', 1, 200],
      [me.uid, 2, 80],
    ]);
    for (const artistId of [off, 'naoexiste']) {
      const result = await api('GET', '/ranking', { token: me.token, query: { artistId } });
      expect(result).toMatchObject({ status: 404, body: { code: 'artist_not_found' } });
      expect(await api('GET', '/me/rank', { token: me.token, query: { artistId } })).toMatchObject({
        status: 404,
      });
    }
    const forged = Buffer.from(JSON.stringify([10, T0, 'uid/outro', 1])).toString('base64url');
    expect(
      await api('GET', '/ranking', { token: me.token, query: { cursor: forged } }),
    ).toMatchObject({
      status: 400,
      body: { code: 'invalid_request', details: { field: 'cursor' } },
    });
  });

  it('a api de verdade, pelo HTTP do emulador, com o ID token: a temporada, o ranking e a posição', async () => {
    await seasons();
    const me = await signUpFan(db, 'Camila Ribeiro');
    await mine(me, { points: 120 });
    await ghost('lider', { points: 900 });
    // A função guarda a configuração por 60 s: espera a temporada chegar a ela.
    const deadline = Date.now() + 70_000;
    let season = await http(env, '/ranking/season', { token: me.token });
    while ((season.body.season as { id?: string } | null)?.id !== SJ.id && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      season = await http(env, '/ranking/season', { token: me.token });
    }
    expect(season).toMatchObject({
      status: 200,
      body: { season: { id: SJ.id, name: 'São João', status: 'active', leaderTitle: null } },
    });
    const list = await http(env, '/ranking', { token: me.token });
    expect(
      (list.body.items as Entry[]).map((item) => [item.userId, item.position, item.isMe]),
    ).toEqual([
      ['lider', 1, false],
      [me.uid, 2, true],
    ]);
    expect(await http(env, '/me/rank', { token: me.token })).toMatchObject({
      status: 200,
      body: {
        position: 2,
        points: 120,
        target: { kind: 'position', position: 1, pointsLeft: 781 },
      },
    });
    expect((await http(env, '/ranking', { token: me.token, method: 'POST' })).status).toBe(405);
    expect((await http(env, '/ranking')).status).toBe(401);
  });
});

describe('a posição do fã', () => {
  it('o /me/rank é a posição da linha do fã em qualquer página e nos empates; a meta', async () => {
    await seasons();
    const [a, b, c] = await Promise.all([
      signUpFan(db, 'Fã A'),
      signUpFan(db, 'Fã B'),
      signUpFan(db, 'Fã C'),
    ]);
    // 25 fantasmas acima de 3.000, e os três: a e b empatados no mesmo milissegundo.
    for (let index = 0; index < 25; index += 1) {
      await ghost(`acima${String(index).padStart(2, '0')}`, { points: 5_000 - index * 50 });
    }
    await mine(a, { points: 2_900 });
    await mine(b, { points: 2_900 });
    await mine(c, { points: 4_990, at: T0 - 3 * DAY_MS });
    const api = apiAt(T0);
    const list = rows(await allPages(api, a));
    for (const fan of [a, b, c]) {
      const row = list.find((item) => item.userId === fan.uid)!;
      expect((await myRank(api, fan)).position).toBe(row.position);
    }
    // c empata com acima00? Não: 4.990 fica entre o 1º (5.000) e o 2º (4.950).
    expect(await myRank(api, c)).toEqual({
      position: 2,
      points: 4_990,
      target: { kind: 'position', position: 1, pointsLeft: 11 },
    });
    // Fora do top 10: a 10ª linha mais 1.
    const tenth = list[9]!;
    const target = (await myRank(api, a)).target!;
    expect(target).toEqual({ kind: 'top', position: 10, pointsLeft: tenth.points - 2_900 + 1 });
    // No meio do top, a linha logo acima (a 5ª, 4.800), e não a do líder.
    await mine(c, { points: 4_760, at: T0 - 3 * DAY_MS });
    expect(await myRank(api, c)).toEqual({
      position: 6,
      points: 4_760,
      target: { kind: 'position', position: 5, pointsLeft: 41 },
    });

    // O 1º lugar não tem meta; sem pontos, sem posição.
    await ghost('acima00', { points: 4_000 });
    await mine(c, { points: 6_000 });
    expect(await myRank(api, c)).toMatchObject({ position: 1, target: null });
    await mine(c, { points: 0 });
    expect(await myRank(api, c)).toEqual({ position: null, points: 0, target: null });

    // O top da temporada: 5.
    await seasons({ season: { ...SJ, topTarget: 5 } }, 2);
    expect((await myRank(api, a)).target).toMatchObject({ kind: 'top', position: 5 });
    // Temporada encerrada (esperando a virada): posição sem meta.
    await seasons({ season: { ...SJ, endsAt: T0 - MIN_MS } }, 3);
    expect(await myRank(api, a)).toMatchObject({ position: expect.any(Number), target: null });
  });

  it('na central: member false fora dela; o fanRank do /me/centrals é o /me/rank da central', async () => {
    await seasons();
    const netto = await central(env, {}, unique('netto'));
    const nenho = await central(env, {}, unique('nenho'));
    const me = await signUpFan(db, 'Camila Ribeiro');
    const api = apiAt(T0);
    expect(
      await api('PUT', `/me/centrals/${netto}`, { token: me.token, key: 'entrar-netto-1' }),
    ).toMatchObject({ status: 200 });
    for (const [uid, points] of [
      ['n1', 900],
      ['n2', 700],
    ] as const) {
      await ghost(uid, { points, centrals: { [netto]: { points }, [nenho]: { points } } });
    }
    // A Camila pontuou nas duas, mas só é membro do Netto.
    await db.doc(`wallets/${me.uid}/centralPoints/${netto}`).update({
      seasonPoints: 800,
      seasonPointsAt: Timestamp.fromMillis(T0 - DAY_MS),
      totalPoints: 810,
    });
    await db.doc(`wallets/${me.uid}/centralPoints/${nenho}`).set({
      uid: me.uid,
      artistId: nenho,
      seasonId: SJ.id,
      seasonPoints: 750,
      seasonPointsAt: Timestamp.fromMillis(T0 - DAY_MS),
      totalPoints: 750,
      member: false,
      updatedAt: Timestamp.fromMillis(T0),
    });
    expect(await myRank(api, me, netto)).toEqual({
      position: 2,
      points: 800,
      target: { kind: 'position', position: 1, pointsLeft: 101 },
      member: true,
    });
    expect(await myRank(api, me, nenho)).toEqual({
      position: null,
      points: 750,
      target: null,
      member: false,
    });
    const centrals = (await api('GET', '/me/centrals', { token: me.token })).body as unknown as {
      artistId: string;
      fanRank: number | null;
      seasonPoints: number;
    }[];
    expect(centrals.map((item) => [item.artistId, item.fanRank, item.seasonPoints])).toEqual([
      [netto, 2, 800],
    ]);
  });
});

describe('membro da central nas rotas de entrar e sair', () => {
  it('entrar grava member pagando e sem pagar (o documento nasce zerado); sair tira do ranking e guarda os pontos; entrar de novo devolve', async () => {
    await seasons();
    const paga = await central(env, {}, unique('paga'));
    const naoPaga = await central(env, {}, unique('naopaga'));
    const me = await signUpFan(db, 'Camila Ribeiro');
    // A entrada desta já foi paga antes (sair e entrar de novo não paga).
    await db.doc(`wallets/${me.uid}/ledger/central_join:${naoPaga}`).set({ points: 10 });
    const api = apiAt(T0);
    const follow = await api('POST', '/me/artists', {
      token: me.token,
      key: 'seguir-duas-1',
      body: { artistIds: [paga, naoPaga] },
    });
    expect(follow).toMatchObject({ status: 200, body: { pointsAwarded: 10 } });
    expect(await read(`wallets/${me.uid}/centralPoints/${paga}`)).toMatchObject({
      member: true,
      seasonId: SJ.id,
      seasonPoints: 10,
    });
    expect(await read(`wallets/${me.uid}/centralPoints/${naoPaga}`)).toMatchObject({
      member: true,
      seasonId: SJ.id,
      seasonPoints: 0,
      totalPoints: 0,
      seasonPointsAt: null,
    });
    expect((await page(api, me, { artistId: paga })).items.map((item) => item.userId)).toEqual([
      me.uid,
    ]);
    // Sem pontos na central: membro, mas fora da lista.
    expect((await page(api, me, { artistId: naoPaga })).items).toEqual([]);
    expect(await myRank(api, me, naoPaga)).toMatchObject({ position: null, member: true });

    expect(
      await api('DELETE', `/me/centrals/${paga}`, { token: me.token, key: 'sair-paga-1' }),
    ).toMatchObject({ status: 200 });
    expect(await read(`wallets/${me.uid}/centralPoints/${paga}`)).toMatchObject({
      member: false,
      seasonPoints: 10,
    });
    expect((await page(api, me, { artistId: paga })).items).toEqual([]);
    expect(await myRank(api, me, paga)).toEqual({
      position: null,
      points: 10,
      target: null,
      member: false,
    });
    expect(
      await api('PUT', `/me/centrals/${paga}`, { token: me.token, key: 'entrar-paga-2' }),
    ).toMatchObject({ status: 200, body: { pointsAwarded: 0 } });
    expect(await myRank(api, me, paga)).toMatchObject({ position: 1, points: 10, member: true });
  });
});

describe('o retrato semanal e a seta', () => {
  it('grava o rankWeek no geral e em cada central; a seta depois das mudanças; de novo na semana não grava; a primeira semana não tira retrato', async () => {
    await seasons();
    const netto = await central(env, {}, unique('netto'));
    for (const [uid, points] of [
      ['r1', 900],
      ['r2', 800],
      ['r3', 700],
    ] as const) {
      await ghost(uid, { points, centrals: { [netto]: { points: points / 10 } } });
    }
    const first = await snapshotAll(MONDAY + MIN_MS);
    expect(first).toMatchObject({ status: 'done', week: '2026-W41' });
    expect((await read('wallets/r3'))!.rankWeek).toEqual({
      seasonId: SJ.id,
      week: '2026-W41',
      position: 3,
    });
    expect((await read(`wallets/r1/centralPoints/${netto}`))!.rankWeek).toEqual({
      seasonId: SJ.id,
      week: '2026-W41',
      position: 1,
    });
    expect(await read(`rankingJobs/${snapshotJobId(SJ.id, '2026-W41')}`)).toMatchObject({
      status: 'done',
      cursor: null,
      counts: { global: 3, [`artist:${netto}`]: 3 },
    });

    // O 3º passa os dois: sobe 2; os outros caem 1.
    await db.doc('wallets/r3').update({ seasonPoints: 950 });
    const me = await signUpFan(db, 'Camila Ribeiro');
    const list = (await page(apiAt(T0), me)).items;
    expect(list.map((item) => [item.userId, item.change])).toEqual([
      ['r3', 2],
      ['r1', -1],
      ['r2', -1],
    ]);

    // De novo na mesma semana: nada (o trabalho está feito).
    await db
      .doc('wallets/r1')
      .update({ rankWeek: { seasonId: SJ.id, week: '2026-W41', position: 9 } });
    expect(await runRankSnapshot(db, run({ now: T0 }))).toMatchObject({ status: 'idle' });
    expect((await read('wallets/r1'))!.rankWeek.position).toBe(9);

    // O retrato de duas semanas atrás não vale; de outra temporada também não.
    await db
      .doc('wallets/r1')
      .update({ rankWeek: { seasonId: SJ.id, week: '2026-W39', position: 9 } });
    await db
      .doc('wallets/r2')
      .update({ rankWeek: { seasonId: 'outra', week: '2026-W41', position: 9 } });
    const later = (await page(apiAt(T0), me)).items;
    expect(later.map((item) => item.change)).toEqual([2, 0, 0]);

    // A temporada que começou nesta semana não tira retrato.
    await seasons({ season: { ...SJ, id: 'temporada-nova', startsAt: MONDAY + DAY_MS } }, 2);
    expect(await runRankSnapshot(db, run({ now: T0 }))).toMatchObject({ status: 'idle' });
  });

  it('o Top 20 a quem está até o 20º, com a data da rodada, e não a quem já tinha; a rodada sem tempo para entre páginas e a seguinte termina igual', async () => {
    await seasons();
    for (let index = 0; index < 22; index += 1) {
      const uid = `t${String(index + 1).padStart(2, '0')}`;
      await ghost(uid, {
        points: 3_000 - index * 10,
        ...(uid === 't03' ? { achievements: { 'top-20': T0 - 30 * DAY_MS } } : {}),
      });
    }
    const at = MONDAY + 5 * MIN_MS;
    // Páginas de 5 e tempo zero: uma página por rodada.
    const first = await runRankSnapshot(db, run({ now: at, budgetMs: 0, pageSize: 5 }));
    expect(first).toMatchObject({ status: 'running', pages: 1 });
    expect((await read('wallets/t05'))!.rankWeek).toBeDefined();
    expect((await read('wallets/t06'))!.rankWeek).toBeUndefined();
    await snapshotAll(at, { budgetMs: 0, pageSize: 5 });
    for (let index = 0; index < 22; index += 1) {
      const uid = `t${String(index + 1).padStart(2, '0')}`;
      const wallet = (await read(`wallets/${uid}`))!;
      expect(wallet.rankWeek.position).toBe(index + 1);
      const top20 = wallet.achievements['top-20'] as Timestamp | undefined;
      if (uid === 't03') expect(top20!.toMillis()).toBe(T0 - 30 * DAY_MS);
      else if (index < 20) expect(top20!.toMillis()).toBe(at);
      else expect(top20).toBeUndefined();
    }
  });

  it('a exclusão de conta no meio de uma página: a página é lida de novo, sem o fã', async () => {
    await seasons();
    for (const [uid, points] of [
      ['e1', 300],
      ['e2', 200],
      ['e3', 100],
    ] as const) {
      await ghost(uid, { points });
    }
    let deleted = false;
    const result = await snapshotAll(MONDAY + MIN_MS, {
      onPage: async (uids) => {
        if (deleted || !uids.includes('e2')) return;
        deleted = true;
        await deleteUserData(db, 'e2');
      },
    });
    expect(result.status).toBe('done');
    expect(await exists('wallets/e2')).toBe(false);
    expect((await read('wallets/e3'))!.rankWeek.position).toBe(2);
  });
});

describe('a virada de temporada', () => {
  async function scenario() {
    const netto = await central(env, {}, unique('netto'));
    await seasons({ season: { ...SJ, endsAt: T0 - 5 * MIN_MS }, next: NEXT });
    const me = await signUpFan(db, 'Camila Ribeiro');
    await mine(me, { points: 400, centrals: { [netto]: { points: 450 } } });
    await db.doc(`users/${me.uid}/centrals/${netto}`).set({
      uid: me.uid,
      artistId: netto,
      via: 'page',
      joinedAt: Timestamp.fromMillis(T0 - 10 * DAY_MS),
      schemaVersion: 1,
    });
    for (let index = 0; index < 24; index += 1) {
      const uid = `v${String(index + 1).padStart(2, '0')}`;
      await ghost(uid, {
        points: 1_000 - index * 10,
        name: `Fã ${index + 1}`,
        city: 'Irará, BA',
        centrals: index < 3 ? { [netto]: { points: 500 - index * 100 } } : {},
      });
    }
    // Só pontos de central (por ajuste); e um ex-membro, fora do ranking da central.
    await ghost('soCentral', { points: 0, centrals: { [netto]: { points: 50 } } });
    await ghost('exMembro', { points: 10, centrals: { [netto]: { points: 999, member: false } } });
    return { netto, me };
  }

  it('antes do fim mais a folga, nada; depois, o arquivo, as temporadas, o Top 20, a próxima e a auditoria', async () => {
    const { netto, me } = await scenario();
    const endsAt = T0 - 5 * MIN_MS;
    expect(await runSeasonClose(db, run({ now: endsAt + CLOSE_GRACE_MS - 1 }))).toMatchObject({
      status: 'idle',
    });
    expect(await exists(`seasons/${SJ.id}`)).toBe(false);

    const closedAt = endsAt + 2 * MIN_MS;
    expect(await closeAll(closedAt, { pageSize: 10 })).toMatchObject({ status: 'closed' });
    expect(await read(`seasons/${SJ.id}`)).toMatchObject({
      id: SJ.id,
      status: 'closed',
      rankedFans: 26,
      centrals: { [netto]: { rankedFans: 5 } },
      schemaVersion: 1,
    });
    expect(await read(`seasons/${SJ.id}/standings/v01`)).toEqual({
      uid: 'v01',
      seasonId: SJ.id,
      displayName: 'Fã 1',
      photoURL: null,
      city: 'Irará, BA',
      position: 1,
      points: 1_000,
      pointsAt: expect.any(Timestamp),
      centrals: { [netto]: { position: 1, points: 500 } },
    });
    // A Camila (400) fica depois dos 24 (o último tem 770) e antes do exMembro (10).
    expect(await read(`seasons/${SJ.id}/standings/${me.uid}`)).toMatchObject({
      position: 25,
      points: 400,
      centrals: { [netto]: { position: 2, points: 450 } },
    });
    const soCentral = (await read(`seasons/${SJ.id}/standings/soCentral`))!;
    expect(soCentral).toMatchObject({ centrals: { [netto]: { position: 5, points: 50 } } });
    expect(soCentral).not.toHaveProperty('position');
    expect(soCentral).not.toHaveProperty('points');
    expect(Object.keys(soCentral).some((key) => key.includes('.'))).toBe(false);
    expect((await read(`seasons/${SJ.id}/standings/exMembro`))!.centrals).toEqual({});

    expect((await read('wallets/v01'))!.stats).toEqual({ pastSeasons: 1, closedSeasonId: SJ.id });
    expect((await read('wallets/soCentral'))!.stats).toEqual({
      pastSeasons: 0,
      closedSeasonId: null,
    });
    expect(((await read('wallets/v20'))!.achievements['top-20'] as Timestamp).toMillis()).toBe(
      endsAt,
    );
    expect((await read('wallets/v21'))!.achievements['top-20']).toBeUndefined();

    const config = await read('config/season');
    expect(config).toMatchObject({
      version: 2,
      season: { id: NEXT.id },
      next: null,
      lastClosed: { id: SJ.id, closedAt: Timestamp.fromMillis(closedAt) },
      updatedBy: null,
    });
    expect(await read('config/season/versions/2')).toMatchObject({ version: 2 });
    const audit = (await db.collection('staffAudit').where('action', '==', 'season.closed').get())
      .docs;
    expect(audit.map((doc) => doc.data())).toEqual([
      expect.objectContaining({
        actorUid: null,
        actorName: 'Virada automática',
        details: expect.objectContaining({
          seasonId: SJ.id,
          rankedFans: 26,
          nextSeasonId: NEXT.id,
          expiredNextSeasonId: null,
        }),
      }),
    ]);
    expect(await read(`rankingJobs/${closeJobId(SJ.id)}`)).toMatchObject({
      status: 'done',
      cursor: null,
    });
  });

  it('a virada atrasada soma o Top 20 no shard do dia da rodada, e a carteira fica com o endsAt (bloco 11)', async () => {
    await scenario();
    const endsAt = T0 - 5 * MIN_MS;
    // A virada que roda três dias depois (um closeSeasonNow tardio): o dia do
    // `endsAt` pode já estar fechado, e o número sumiria do painel (26.5).
    const late = endsAt + 3 * DAY_MS;
    expect(await closeAll(late, { pageSize: 10 })).toMatchObject({ status: 'closed' });
    const top20 = (data: DocumentData) =>
      (data.byAchievement as Record<string, { unlocked?: number }> | undefined)?.['top-20']
        ?.unlocked ?? 0;
    expect(await statsSum(db, [dayKey(late)], top20)).toBe(20);
    expect(await statsSum(db, [dayKey(endsAt)], top20)).toBe(0);
    expect(((await read('wallets/v20'))!.achievements['top-20'] as Timestamp).toMillis()).toBe(
      endsAt,
    );
  });

  it('duas rodadas em paralelo e uma repetida somam 1 uma vez só; a interrompida continua do cursor', async () => {
    await scenario();
    const at = T0;
    const first = await runSeasonClose(db, run({ now: at, budgetMs: 0, pageSize: 5 }));
    expect(first).toMatchObject({ status: 'running', pages: 1 });
    const job = await read(`rankingJobs/${closeJobId(SJ.id)}`);
    expect(job).toMatchObject({ status: 'running', scopeIndex: 0, position: 5 });
    await Promise.all([
      closeAll(at, { pageSize: 5 }),
      closeAll(at, { pageSize: 5 }),
      closeAll(at, { pageSize: 7 }),
    ]);
    await closeAll(at);
    for (const uid of ['v01', 'v05', 'v06', 'v24']) {
      expect((await read(`wallets/${uid}`))!.stats.pastSeasons).toBe(1);
    }
    const standings = await db.collection(`seasons/${SJ.id}/standings`).get();
    const positions = standings.docs
      .map((doc) => doc.get('position') as number | undefined)
      .filter((item): item is number => item !== undefined)
      .sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
    expect(
      (await db.collection('staffAudit').where('action', '==', 'season.closed').get()).size,
    ).toBe(1);
  });

  it('a temporada fechada, antes de a próxima começar, é lida do arquivo; entrar e sair de uma central depois não mudam nada', async () => {
    const { netto, me } = await scenario();
    const before = apiAt(T0);
    // Ao vivo, esperando a virada: a primeira página com cursor.
    const live = await page(before, me);
    expect(live.items).toHaveLength(20);
    await closeAll(T0);
    // O nome mudou depois da virada: o arquivo guarda o da hora.
    await db.doc('users/v01').update({ displayName: 'Outro Nome' });
    const api = apiAt(T0 + MIN_MS);
    expect((await api('GET', '/ranking/season', { token: me.token })).body).toEqual({
      season: {
        id: SJ.id,
        name: 'São João',
        startsAt: new Date(SJ.startsAt).toISOString(),
        endsAt: new Date(T0 - 5 * MIN_MS).toISOString(),
        status: 'ended',
        leaderTitle: null,
      },
    });
    const archived = await page(api, me);
    expect(archived.items[0]).toEqual({
      position: 1,
      userId: 'v01',
      displayName: 'Fã 1',
      photoURL: null,
      city: 'Irará, BA',
      points: 1_000,
      change: 0,
      isMe: false,
    });
    // O cursor da página ao vivo continua no arquivo.
    const rest = await page(api, me, { cursor: live.nextCursor! });
    expect(rest.items[0]!.position).toBe(21);
    expect(rest.items.find((item) => item.isMe)).toMatchObject({ position: 25, points: 400 });
    expect(await myRank(api, me)).toEqual({ position: 25, points: 400, target: null });
    expect(await myRank(api, me, netto)).toEqual({ position: 2, points: 450, target: null });
    const centrals = (await api('GET', '/me/centrals', { token: me.token })).body as unknown as {
      fanRank: number | null;
      seasonPoints: number;
    }[];
    expect(centrals).toMatchObject([{ fanRank: 2, seasonPoints: 450 }]);
    // Sair da central agora não muda o resultado dela.
    expect(
      await api('DELETE', `/me/centrals/${netto}`, { token: me.token, key: 'sair-depois-1' }),
    ).toMatchObject({ status: 200 });
    expect((await read(`wallets/${me.uid}/centralPoints/${netto}`))!.member).toBe(false);
    expect(await myRank(api, me, netto)).toEqual({ position: 2, points: 450, target: null });
    expect(
      (await page(api, me, { artistId: netto })).items.map((item) => [item.userId, item.position]),
    ).toEqual([
      ['v01', 1],
      [me.uid, 2],
      ['v02', 3],
      ['v03', 4],
      ['soCentral', 5],
    ]);
    expect((await api('GET', '/me/centrals', { token: me.token })).body).toEqual([]);
  });

  it('a próxima vencida não é promovida; o retrato no meio é encerrado pela virada', async () => {
    await scenario();
    await seasons({
      season: { ...SJ, endsAt: T0 - 5 * MIN_MS },
      next: { ...NEXT, startsAt: T0 - 4 * MIN_MS, endsAt: T0 - MIN_MS },
    });
    // Um retrato da semana que ficou no meio quando a temporada acabou.
    await db.doc(`rankingJobs/${snapshotJobId(SJ.id, '2026-W41')}`).set({
      kind: 'snapshot',
      seasonId: SJ.id,
      week: '2026-W41',
      status: 'running',
      scopes: ['global'],
      scopeIndex: 0,
      cursor: { points: 900, atMs: T0 - DAY_MS, uid: 'v11' },
      position: 11,
      counts: {},
    });
    expect(await closeAll(T0)).toMatchObject({ status: 'closed' });
    expect(await read('config/season')).toMatchObject({
      season: null,
      next: null,
      lastClosed: { id: SJ.id },
    });
    expect(await read(`rankingJobs/${snapshotJobId(SJ.id, '2026-W41')}`)).toMatchObject({
      status: 'done',
      cursor: null,
    });
    const audit = (
      await db.collection('staffAudit').where('action', '==', 'season.closed').get()
    ).docs[0]!.data();
    expect(audit.details).toMatchObject({ nextSeasonId: null, expiredNextSeasonId: NEXT.id });
  });

  it('o ponto ganho entre o fim e a virada entra no saldo e em nenhuma temporada; depois da promoção, na nova; as temporadas do fã contam certo', async () => {
    const endsAt = T0 - 5 * MIN_MS;
    await seasons({ season: { ...SJ, endsAt }, next: { ...NEXT, startsAt: T0 + MIN_MS } });
    const me = await signUpFan(db, 'Camila Ribeiro');
    const options = (now: number) => ({
      now,
      config: DEFAULT_POINTS_CONFIG,
      actor: SEED_ACTOR,
    });
    await runAward(
      db,
      me.uid,
      [{ kind: 'adjust', source: 'seed', eventId: 'antes', balance: 100, xp: 100, season: 100 }],
      options(endsAt - DAY_MS),
    );
    const progress = async (now: number) =>
      (
        (await apiAt(now)('GET', '/me/progress', { token: me.token })).body as {
          stats: { seasons: number };
        }
      ).stats.seasons;
    expect(await progress(T0)).toBe(1);
    // Entre o fim e a virada: saldo sim, temporada não.
    await runAward(
      db,
      me.uid,
      [{ kind: 'adjust', source: 'seed', eventId: 'no-meio', balance: 5, xp: 5 }],
      options(T0),
    );
    await expect(
      runAward(
        db,
        me.uid,
        [{ kind: 'adjust', source: 'seed', eventId: 'no-meio-2', season: 5 }],
        options(T0),
      ),
    ).rejects.toMatchObject({ reason: 'season_required' });
    expect(await read(`wallets/${me.uid}`)).toMatchObject({
      balance: 105,
      seasonId: SJ.id,
      seasonPoints: 100,
    });
    await closeAll(T0);
    expect(await read(`wallets/${me.uid}`)).toMatchObject({
      stats: { pastSeasons: 1, closedSeasonId: SJ.id },
    });
    // Entre a virada e a primeira ação na nova: 1 (a virada já contou a guardada).
    expect(await progress(T0 + 2 * MIN_MS)).toBe(1);
    await runAward(
      db,
      me.uid,
      [{ kind: 'adjust', source: 'seed', eventId: 'na-nova', balance: 7, xp: 7, season: 7 }],
      options(T0 + 2 * MIN_MS),
    );
    expect(await read(`wallets/${me.uid}`)).toMatchObject({
      seasonId: NEXT.id,
      seasonPoints: 7,
      stats: { pastSeasons: 1, closedSeasonId: SJ.id },
    });
    expect(await progress(T0 + 3 * MIN_MS)).toBe(2);
  });

  it('a função agendada (o handler) fecha a temporada encerrada pelo endSeason, com o fim de verdade e o endedEarly', async () => {
    await scenario();
    const endedEarly = {
      plannedEndsAt: T0 + 12 * DAY_MS,
      at: T0 - 5 * MIN_MS,
      by: { uid: 'admin', name: 'Admin' },
    };
    await seasons({ season: { ...SJ, endsAt: T0 - 5 * MIN_MS, endedEarly }, next: NEXT });
    const tick = await runRankingTick({ db, now: () => T0, budgetMs: 60_000 });
    expect(tick.close).toMatchObject({ status: 'closed', seasonId: SJ.id });
    expect(await read(`seasons/${SJ.id}`)).toMatchObject({
      endsAt: Timestamp.fromMillis(T0 - 5 * MIN_MS),
      endedEarly: {
        plannedEndsAt: Timestamp.fromMillis(T0 + 12 * DAY_MS),
        by: { uid: 'admin', name: 'Admin' },
      },
    });
    // A rodada seguinte não tem o que fazer.
    expect(
      (await runRankingTick({ db, now: () => T0 + MIN_MS, budgetMs: 60_000 })).close,
    ).toMatchObject({
      status: 'idle',
    });
  });
});

describe('exclusão de conta', () => {
  it('o fã sai do ranking ao vivo e da linha de cada temporada fechada; as posições dos outros ficam (o buraco)', async () => {
    const netto = await central(env, {}, unique('netto'));
    await seasons({ season: { ...SJ, endsAt: T0 - 5 * MIN_MS } });
    for (const [uid, points] of [
      ['x1', 300],
      ['x2', 200],
      ['x3', 100],
    ] as const) {
      await ghost(uid, { points, centrals: { [netto]: { points } } });
    }
    const me = await signUpFan(db, 'Camila Ribeiro');
    await closeAll(T0);
    await deleteUserData(db, 'x2');
    expect(await exists(`seasons/${SJ.id}/standings/x2`)).toBe(false);
    const api = apiAt(T0 + MIN_MS);
    expect((await page(api, me)).items.map((item) => [item.userId, item.position])).toEqual([
      ['x1', 1],
      ['x3', 3],
    ]);
    expect((await read(`seasons/${SJ.id}`))!.rankedFans).toBe(3);
  });

  it('a exclusão no meio de uma página de central da virada não deixa linha órfã', async () => {
    const netto = await central(env, {}, unique('netto'));
    await seasons({ season: { ...SJ, endsAt: T0 - 5 * MIN_MS } });
    for (const [uid, points] of [
      ['o1', 300],
      ['o2', 200],
    ] as const) {
      await ghost(uid, { points, centrals: { [netto]: { points } } });
    }
    let deleted = false;
    await closeAll(T0, {
      onPage: async (uids, scope) => {
        if (deleted || scope.kind !== 'artist' || !uids.includes('o2')) return;
        deleted = true;
        await deleteUserData(db, 'o2');
      },
    });
    expect(deleted).toBe(true);
    expect(await exists(`seasons/${SJ.id}/standings/o2`)).toBe(false);
    expect((await read(`seasons/${SJ.id}/standings/o1`))!.centrals).toEqual({
      [netto]: { position: 1, points: 300 },
    });
  });

  it('a exclusão no meio de uma página do geral da virada: a carteira não renasce, sem linha órfã e sem buraco', async () => {
    await seasons({ season: { ...SJ, endsAt: T0 - 5 * MIN_MS } });
    for (const [uid, points] of [
      ['d1', 300],
      ['d2', 200],
      ['d3', 100],
    ] as const) {
      await ghost(uid, { points });
    }
    let deleted = false;
    const result = await closeAll(T0, {
      onPage: async (uids, scope) => {
        if (deleted || scope.kind !== 'global' || !uids.includes('d2')) return;
        deleted = true;
        await deleteUserData(db, 'd2');
      },
    });
    expect(deleted).toBe(true);
    expect(result.status).toBe('closed');
    // O `tx.update` da carteira apagada cai com NOT_FOUND e leva a página
    // inteira: nem a carteira volta (com `stats` e conquistas), nem a linha.
    expect(await exists('wallets/d2')).toBe(false);
    expect(await exists(`seasons/${SJ.id}/standings/d2`)).toBe(false);
    // A página é lida de novo, já sem ela: as posições seguem de 1 em 1.
    expect((await read(`seasons/${SJ.id}/standings/d1`))!.position).toBe(1);
    expect((await read(`seasons/${SJ.id}/standings/d3`))!.position).toBe(2);
    expect((await read('wallets/d3'))!.stats.pastSeasons).toBe(1);
    expect((await read(`seasons/${SJ.id}`))!.rankedFans).toBe(2);
  });
});

describe('o seed do ranking (23.15)', () => {
  it('a Camila 12ª com 4.120 e +2, 840 do top 10, Netto 12º, Nenho 41º, Juninho sem posição, 3 temporadas, o Top 20 do retrato e as passadas fechadas; rodar de novo não muda nada', async () => {
    await seedCentrals(db, T0);
    const camila = await signUpFan(db, 'Camila Ribeiro', 'camila@teste.imagineup');
    const uids = new Map<string, string>();
    for (const [index, account] of RANKING_SEED.entries()) {
      const uid = rankingAccountKey(index + 1).replace('-', '');
      uids.set(account.email, uid);
      await db.doc(`users/${uid}`).set({
        displayName: account.name,
        username: uid,
        city: account.city,
        photoURL: null,
        createdAt: Timestamp.fromMillis(T0 - 200 * DAY_MS),
      });
    }
    const seed = async () => {
      await seedPastSeasons(db, uids, camila.uid, { now: T0 });
      await seedCamilaWallet(db, camila.uid, { now: T0, steps: 'early' });
      await seedCamilaCentrals(db, camila.uid, { now: T0 });
      await seedRankingBase(db, uids, { now: T0 });
      await seedRankingSnapshot(db, { now: T0 });
      await seedCamilaWallet(db, camila.uid, { now: T0, steps: 'week' });
      await seedRankingWeek(db, uids, { now: T0 });
      // O perfil novo (28.10): os detalhes das contas de ranking da tabela (a
      // Thalita e a Aline), no fim, como o script.
      for (const details of SEED_FAN_DETAILS) {
        const uid = uids.get(details.email);
        if (uid) await seedFanDetails(db, uid, seedFanDetailsChanges(details), { now: T0 });
      }
    };
    await seed();

    const api = apiAt(T0);
    const pages = await allPages(api, camila);
    expect(pages.map((item) => item.items.length)).toEqual([20, 20, 9]);
    const list = rows(pages);
    expect(list.slice(0, 3).map((item) => [item.displayName, item.points, item.change])).toEqual([
      ['Thalita Santos', 9_140, 1],
      ['Davi Lima', 7_902, -1],
      ['Jean Pereira', 7_318, 0],
    ]);
    expect(list.slice(3, 11).map((item) => [item.displayName, item.change])).toEqual([
      ['Maria Clara Souza', 3],
      ['Aline Ferreira', 1],
      ['Bruna Andrade', 7],
      ['Igor Nascimento', 2],
      ['Leila Matos', 4],
      ['Rafael Costa', -1],
      ['Júlia Ramos', 0],
      ['Pedro Henrique Alves', 0],
    ]);
    expect(list[11]).toMatchObject({ isMe: true, position: 12, points: 4_120, change: 2 });
    expect(list.slice(12, 14).map((item) => item.change)).toEqual([-9, -9]);
    expect(await myRank(api, camila)).toEqual({
      position: 12,
      points: 4_120,
      target: { kind: 'top', position: 10, pointsLeft: 840 },
    });
    expect(await myRank(api, camila, 'nettobrito')).toMatchObject({ position: 12, member: true });
    expect(await myRank(api, camila, 'nenho')).toMatchObject({ position: 41, member: true });
    expect(await myRank(api, camila, 'juninhomoraes')).toEqual({
      position: null,
      points: 0,
      target: null,
      member: true,
    });
    expect(rows(await allPages(api, camila, 'nettobrito'))).toHaveLength(30);
    expect(rows(await allPages(api, camila, 'nenho'))).toHaveLength(49);
    expect(rows(await allPages(api, camila, 'juninhomoraes'))).toHaveLength(6);
    const centrals = (await api('GET', '/me/centrals', { token: camila.token }))
      .body as unknown as {
      artistId: string;
      fanRank: number | null;
    }[];
    expect(centrals.map((item) => [item.artistId, item.fanRank])).toEqual([
      ['nettobrito', 12],
      ['nenho', 41],
      ['juninhomoraes', null],
    ]);
    expect((await api('GET', '/me/progress', { token: camila.token })).body).toMatchObject({
      stats: { seasons: 3 },
    });
    const wallet = (await read(`wallets/${camila.uid}`))!;
    expect((wallet.achievements['top-20'] as Timestamp).toMillis()).toBe(weekStart(T0));
    expect(wallet.stats).toEqual({ pastSeasons: 2, closedSeasonId: 'temporada-carnaval' });
    for (const [index, past] of SEED_PAST_SEASONS.entries()) {
      expect(await read(`seasons/${past.id}`)).toMatchObject({ status: 'closed', rankedFans: 49 });
      expect(await read(`seasons/${past.id}/standings/${camila.uid}`)).toMatchObject({
        position: index === 0 ? 25 : 36,
        points: past.camila,
      });
    }
    expect(await read('config/season')).toMatchObject({
      season: { id: 'temporada-sao-joao' },
      lastClosed: { id: 'temporada-carnaval' },
    });

    // Os detalhes da tabela: a Thalita completa e a Aline privada, sem mudar o ranking.
    expect(await read('users/rank01')).toMatchObject({
      bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
      gender: 'woman',
      socials: {
        instagram: 'thalita.teste.up',
        tiktok: 'thalita.teste.up',
        linkedin: 'thalita-teste-imagineup',
        x: 'thalitatesteup',
      },
    });
    expect(await read('users/rank05')).toMatchObject({
      privateAccount: true,
      gender: 'undisclosed',
    });
    expect(await read('users/rank48')).not.toHaveProperty('bio');

    // Rodar de novo não muda nada (nem a carteira, nem os perfis).
    const dump = async (name: string) =>
      (await db.collection(name).get()).docs.map(
        (doc) => [doc.id, doc.data()] as [string, DocumentData],
      );
    const before = await dump('wallets');
    const profiles = await dump('users');
    await seed();
    expect(await dump('wallets')).toEqual(before);
    expect(await dump('users')).toEqual(profiles);
  }, 300_000);

  it('nenhum valor se repete no mesmo recorte e no mesmo momento (a ordem nunca depende do uid)', () => {
    const camila = { base: 3_280, now: 4_120, netto: [3_620, 4_120], nenho: [2_640, 2_980] };
    const check = (values: number[]) => expect(new Set(values).size).toBe(values.length);
    for (const moment of ['base', 'now'] as const) {
      check([...RANKING_SEED.map((account) => account[moment]), camila[moment]]);
      for (const [central, mine] of [
        ['nettobrito', camila.netto],
        ['nenho', camila.nenho],
        ['juninhomoraes', null],
      ] as const) {
        const values = RANKING_SEED.flatMap((account) => {
          const points = account.centrals[central];
          return points ? [points[moment]] : [];
        });
        check(mine ? [...values, mine[moment === 'base' ? 0 : 1]!] : values);
      }
    }
  });
});
