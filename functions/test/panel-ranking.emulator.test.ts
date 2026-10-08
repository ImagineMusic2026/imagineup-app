import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SEASON_CONFIG, type SeasonConfig, type SeasonInfo } from '../src/points';
import { writeSeasonConfig } from '../src/points/config';
import {
  callable,
  central,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type CallError,
  type Member,
} from './support';

/**
 * O ranking ao vivo do painel (bloco 11, docs/arquitetura-api.md, 26.4 e
 * 26.14): o `getPanelRanking` no geral e numa central fora do ar, o cursor, a
 * temporada fechada lida do arquivo e o acesso só de leitura da seção ranking.
 * Os fãs do ranking são carteiras gravadas no formato do núcleo.
 */
const env = useEmulators('ranking-painel', ['getPanelRanking', 'createUserProfile']);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const SJ: SeasonInfo = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: NOW - 18 * DAY_MS,
  endsAt: NOW + 12 * DAY_MS,
  leaderTitle: null,
  topTarget: 10,
  endedEarly: null,
};

type Entry = { position: number; userId: string; points: number; isMe: boolean };
type RankingPage = {
  season: { id: string; status: string } | null;
  items: Entry[];
  nextCursor: string | null;
};

async function seasons(config: Partial<Omit<SeasonConfig, 'version'>>): Promise<void> {
  await db.runTransaction(async (tx) => {
    writeSeasonConfig(
      tx,
      db,
      { ...DEFAULT_SEASON_CONFIG, version: 1, season: SJ, ...config },
      { now: NOW, updatedBy: null },
    );
  });
}

/** A carteira de um fã da temporada, com a central (membro), no formato do núcleo. */
async function ghost(uid: string, points: number, artistId?: string): Promise<void> {
  const at = Timestamp.fromMillis(NOW - DAY_MS);
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), {
    displayName: `Fã ${uid}`,
    username: uid,
    city: 'Irará, BA',
    photoURL: null,
    createdAt: at,
  });
  batch.set(db.doc(`wallets/${uid}`), {
    uid,
    balance: points,
    xp: points,
    seasonId: SJ.id,
    seasonPoints: points,
    seasonPointsAt: at,
    earnedTotal: points,
    spentTotal: 0,
    days: {},
    stats: { pastSeasons: 0, closedSeasonId: null },
    activity: { lastDay: null, lastWeek: null, lastMonth: null },
    seasonMissions: 0,
    goalReached: null,
    missions: { daily: null, weekly: null },
    achievements: {},
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
  });
  if (artistId) {
    batch.set(db.doc(`wallets/${uid}/centralPoints/${artistId}`), {
      uid,
      artistId,
      seasonId: SJ.id,
      seasonPoints: points,
      seasonPointsAt: at,
      totalPoints: points,
      member: true,
      updatedAt: at,
    });
  }
  await batch.commit();
}

async function ranking(member: Member, data: Record<string, unknown> = {}): Promise<RankingPage> {
  const { result, error } = await callable<RankingPage>(env, 'getPanelRanking', data, member.token);
  if (error) throw new Error(`getPanelRanking falhou: ${error.details?.reason} ${error.message}`);
  return result!;
}

async function failure(member: Member | undefined, data: unknown): Promise<CallError> {
  const { error } = await callable(env, 'getPanelRanking', data, member?.token);
  if (!error) throw new Error('getPanelRanking deveria ter falhado.');
  return error;
}

describe('getPanelRanking', () => {
  it('o geral em páginas de 20 com o cursor, e a central fora do ar', async () => {
    const viewer = await seedMember(env, 'Leitor', 'viewer', ['ranking']);
    const draft = await central(env, { status: 'draft' }, unique('rascunho'));
    await seasons({});
    for (let index = 0; index < 23; index += 1) {
      await ghost(
        `r${String(index + 1).padStart(2, '0')}`,
        1_000 - index * 10,
        index < 3 ? draft : undefined,
      );
    }

    const first = await ranking(viewer);
    expect(first.season).toMatchObject({ id: SJ.id });
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toMatchObject({
      position: 1,
      userId: 'r01',
      points: 1_000,
      isMe: false,
    });
    expect(first.items.every((item) => item.isMe === false)).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await ranking(viewer, { cursor: first.nextCursor });
    expect(second.items.map((item) => [item.position, item.userId])).toEqual([
      [21, 'r21'],
      [22, 'r22'],
      [23, 'r23'],
    ]);
    expect(second.nextCursor).toBeNull();

    // A central em rascunho (o app recusaria): o painel vê.
    const byCentral = await ranking(viewer, { artistId: draft });
    expect(byCentral.items.map((item) => item.userId)).toEqual(['r01', 'r02', 'r03']);
    expect((await failure(viewer, { artistId: 'naoexiste' })).details?.reason).toBe(
      'artist-not-found',
    );
    expect((await failure(viewer, { artistId: 'Fora Do Formato' })).details?.reason).toBe(
      'artist-not-found',
    );
    expect((await failure(viewer, { cursor: 'nao-e-cursor' })).details).toEqual({
      reason: 'invalid-request',
      field: 'cursor',
    });
  });

  it('a temporada fechada vem do arquivo; sem temporada, lista vazia', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    expect(await ranking(admin)).toEqual({ season: null, items: [], nextCursor: null });

    await seasons({
      season: null,
      lastClosed: {
        ...SJ,
        startsAt: NOW - 40 * DAY_MS,
        endsAt: NOW - 2 * DAY_MS,
        closedAt: NOW - DAY_MS,
      },
    });
    await db.doc(`seasons/${SJ.id}`).set({ id: SJ.id, status: 'closed' });
    await db.doc(`seasons/${SJ.id}/standings/arquivo1`).set({
      uid: 'arquivo1',
      seasonId: SJ.id,
      displayName: 'Fã do arquivo',
      photoURL: null,
      city: null,
      position: 1,
      points: 900,
      centrals: {},
    });
    const page = await ranking(admin);
    expect(page.season).toMatchObject({ id: SJ.id, status: 'ended' });
    expect(page.items).toEqual([
      expect.objectContaining({ position: 1, userId: 'arquivo1', points: 900, isMe: false }),
    ]);
  });

  it('só a seção ranking (ver basta); sem a seção, desativado e sem login não', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['fans', 'missions']);
    const disabled = await seedMember(env, 'Desativado', 'viewer', ['ranking'], 'disabled');
    const fan = await signUpFan(db);
    await seasons({});
    expect((await failure(editor, {})).details?.reason).toBe('no-section');
    expect((await failure(disabled, {})).details?.reason).toBe('not-staff');
    expect((await failure(undefined, {})).details?.reason).toBe('unauthenticated');
    expect(
      (await failure({ uid: fan.uid, token: fan.token, email: fan.email, password: '' }, {}))
        .details?.reason,
    ).toBe('not-staff');
    // Nenhuma auditoria: é leitura.
    expect((await db.collection('staffAudit').get()).size).toBe(0);
  });
});
