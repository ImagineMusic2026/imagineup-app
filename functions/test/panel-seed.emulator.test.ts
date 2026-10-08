import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { seedEvents } from '../src/agenda';
import { seedCamilaCentrals, seedCentrals } from '../src/centrals';
import { dayKey, shiftDay } from '../src/day';
import {
  editableProfileOf,
  fanPhotoFiles,
  SEED_FAN_DETAILS,
  SEED_SPAM_PHOTO_FILE,
  seedFanDetails,
  seedFanDetailsChanges,
  seedFanPhoto,
} from '../src/fan-profile';
import { seedCamilaInvite } from '../src/invites';
import { SEED_SEASON_GOAL, seedGoalReached, seedMissionsCatalog } from '../src/missions';
import {
  SEED_HIDDEN_SPAM_COMMENT,
  SEED_SPAM_COMMENTS,
  SEED_SUSPENSION_NOTE,
  seedModeration,
  seedSuspension,
} from '../src/moderation';
import { seedCamilaWallet } from '../src/points';
import { seedGameConfig } from '../src/points/config-seed';
import {
  buildSeedStats,
  readClosedTotals,
  SEED_STATS_DAYS,
  SEED_STATS_SHARD,
  seedPanelClose,
  seedPanelStats,
} from '../src/points/stats-seed';
import { seedCamilaLikes, seedEngagement, seedPosts } from '../src/posts';
import {
  RANKING_SEED,
  rankingAccountKey,
  seedPastSeasons,
  seedRankingBase,
  seedRankingSnapshot,
  seedRankingWeek,
} from '../src/ranking';
import {
  SEED_OPEN_REDEMPTION_REWARD,
  SEED_OPEN_REDEMPTIONS,
  seedCamilaRedemptions,
  seedOpenRedemptions,
  seedRewards,
} from '../src/rewards';
import { SEED_STAFF, SEED_STAFF_ADMIN, seedPanelAudit, seedStaffMember } from '../src/staff/seed';
import { localApi, signIn, useEmulators } from './support';

/**
 * O seed das telas do painel (bloco 11, docs/arquitetura-api.md, 26.13 e
 * 26.14), pelos mesmos núcleos que o scripts/seed-emulators.mjs chama, na
 * mesma ordem, com o relógio fixo: as três contas da equipe, a versão 1 dos
 * catálogos, a foto e a fila da Moderação, a suspensão, os pedidos abertos
 * dos rank-*, a meta do rank-02, a auditoria com a seção e os alvos em toda
 * entrada, os 60 dias fechados com o retrato e os totais fechados de 7 e 30
 * dias que a conferência no navegador compara (o documento do seed mais os
 * shards reais dos seeds dos blocos anteriores), e rodar duas vezes sem mudar
 * nada. Os perfis nascem direto (como no teste do seed do ranking), sem
 * passar pelo gatilho de cadastro; os claims e as visitas do convite, que só
 * gravam no dia de hoje, ficam com os testes do bloco 5 e do bloco 7. Desde o
 * perfil novo (28.10), também os detalhes da tabela (bio, gênero, conta
 * privada e redes), no fim, antes dos números, como o script.
 */
const env = useEmulators('painel-seed', ['api', 'createUserProfile']);
const { db, bucket } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-07T18:00:00.000Z');
const TODAY = dayKey(T0);
const YESTERDAY = shiftDay(TODAY, -1);
const JPEG = readFileSync(resolve(__dirname, '../../scripts/seed-assets/foto-teste.jpg'));
const ACTOR = { uid: SEED_STAFF_ADMIN.uid, name: SEED_STAFF_ADMIN.displayName };
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

const read = async (path: string) => (await db.doc(path).get()).data();

/** Os fãs de teste, com o uid igual ao nome curto (os perfis nascem direto). */
const FANS = {
  camila: { name: 'Camila Ribeiro', email: 'camila@teste.imagineup' },
  alan: { name: 'Alan Ferreira', email: 'alan@teste.imagineup' },
  bia: { name: 'Bia Santos', email: 'bia@teste.imagineup' },
  duda: { name: 'Duda Lima', email: 'duda@teste.imagineup' },
  enzo: { name: 'Enzo Rocha', email: 'enzo@teste.imagineup' },
  spam: { name: 'Promo Seguidores', email: 'spam@teste.imagineup' },
} as const;

async function profile(uid: string, displayName: string): Promise<void> {
  await db.doc(`users/${uid}`).set({
    displayName,
    username: uid,
    city: null,
    photoURL: null,
    createdAt: Timestamp.fromMillis(T0 - 200 * DAY_MS),
  });
}

/** O uid de um fã de teste ou de uma conta de ranking, pelo e-mail. */
function uidOf(ranking: Map<string, string>, email: string): string {
  const fan = Object.entries(FANS).find(([, item]) => item.email === email);
  const uid = fan?.[0] ?? ranking.get(email);
  if (!uid) throw new Error(`Sem conta para ${email}.`);
  return uid;
}

/** As contas de ranking: `rank01` a `rank48`, pelo e-mail. */
async function rankingProfiles(): Promise<Map<string, string>> {
  const uids = new Map<string, string>();
  for (const [index, account] of RANKING_SEED.entries()) {
    const uid = rankingAccountKey(index + 1).replace('-', '');
    uids.set(account.email, uid);
    await profile(uid, account.name);
  }
  return uids;
}

const upload = async (path: string, bytes: Uint8Array) => {
  await bucket.file(path).save(Buffer.from(bytes), { resumable: false, contentType: 'image/jpeg' });
};

/** O seed na ordem do script: os blocos anteriores e, depois, os passos do bloco 11. */
async function seed(ranking: Map<string, string>): Promise<void> {
  await seedCentrals(db, T0);
  await seedEvents(db, T0);
  await seedPosts(db, T0);
  await seedRewards(db, T0);
  for (const member of SEED_STAFF) {
    await seedStaffMember(db, env.auth, member, 'senha-da-equipe', T0);
  }
  await seedGameConfig(db, T0);
  await seedPastSeasons(db, ranking, 'camila', { now: T0 });
  await seedCamilaWallet(db, 'camila', { now: T0, steps: 'early' });
  await seedCamilaCentrals(db, 'camila', { now: T0 });
  await seedCamilaInvite(db, { uid: 'camila', email: FANS.camila.email }, T0);
  await seedRankingBase(db, ranking, { now: T0 });
  await seedRankingSnapshot(db, { now: T0 });
  await seedCamilaWallet(db, 'camila', { now: T0, steps: 'week' });
  await seedRankingWeek(db, ranking, { now: T0 });
  await seedMissionsCatalog(db, T0);
  await seedCamilaLikes(db, 'camila', T0);
  await seedEngagement(db, { alan: 'alan', bia: 'bia', duda: 'duda', enzo: 'enzo' }, T0);
  await seedCamilaRedemptions(db, 'camila', T0);

  // Bloco 11, 26.13.
  await seedFanPhoto(
    db,
    fanPhotoFiles(() => bucket),
    upload,
    'spam',
    new Uint8Array(JPEG),
    {
      fileName: SEED_SPAM_PHOTO_FILE,
    },
  );
  await seedModeration(db, { spam: 'spam', reporters: ['bia', 'duda'] }, ACTOR, T0);
  await seedSuspension(db, ranking.get('rank-48@teste.imagineup')!, ACTOR, T0);
  await seedOpenRedemptions(db, ranking, T0);
  await seedGoalReached(db, ranking.get('rank-02@teste.imagineup')!, T0);
  await seedPanelAudit(db, { bia: 'bia' }, T0);
  // O perfil novo (28.10), pelo mesmo núcleo do PUT /me/profile.
  for (const details of SEED_FAN_DETAILS) {
    await seedFanDetails(db, uidOf(ranking, details.email), seedFanDetailsChanges(details), {
      now: T0,
    });
  }
  await seedPanelStats(db, T0);
  await seedPanelClose(db, T0, quiet);
}

/** O conteúdo das coleções que o seed do bloco 11 grava (sem as que os gatilhos mexem sozinhos). */
async function dump(): Promise<Record<string, [string, DocumentData][]>> {
  const out: Record<string, [string, DocumentData][]> = {};
  for (const name of [
    'users',
    'staff',
    'staffAudit',
    'statsDaily',
    'statsMeta',
    'moderationQueue',
    'commentReports',
    'redemptions',
    'wallets',
    'config',
  ]) {
    out[name] = (await db.collection(name).get()).docs.map((doc) => [doc.id, doc.data()]);
  }
  out.statsShards = (await db.collectionGroup('statsShards').get()).docs
    .map((doc) => [doc.ref.path, doc.data()] as [string, DocumentData])
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return out;
}

/** Toda folha numérica de um mapa. */
function numbers(value: unknown, path = ''): [string, number][] {
  if (typeof value === 'number') return [[path, value]];
  if (typeof value !== 'object' || value === null || value instanceof Timestamp) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    numbers(child, path ? `${path}.${key}` : key),
  );
}

describe('o seed das telas do painel (26.13)', () => {
  it('equipe, catálogos, moderação, suspensão, pedidos, meta, auditoria e 60 dias fechados; rodar de novo não muda nada', async () => {
    for (const [uid, fan] of Object.entries(FANS)) await profile(uid, fan.name);
    const ranking = await rankingProfiles();
    // O rank-48 entra pela API (a conta vem depois do perfil: o gatilho não grava nada).
    await env.auth.createUser({
      uid: 'rank48',
      email: 'rank-48@teste.imagineup',
      password: 'fa-do-ranking',
    });
    await seed(ranking);

    // A equipe: três contas, uma de cada nível, sem perfil de fã.
    for (const member of SEED_STAFF) {
      expect(await read(`staff/${member.uid}`)).toMatchObject({
        email: member.email,
        displayName: member.displayName,
        role: member.role,
        sections: member.sections,
        status: 'active',
      });
      expect((await env.auth.getUser(member.uid)).email).toBe(member.email);
      expect(await read(`users/${member.uid}`)).toBeUndefined();
    }
    expect(await signIn('editora@teste.imagineup', 'senha-da-equipe')).toBeTruthy();
    expect((await read('staff/seed-editora'))!.sections).not.toContain('artists');

    // A versão 1 dos catálogos, com as duas auditorias da carga.
    expect(await read('config/points')).toMatchObject({ version: 1, updatedBy: null });
    expect(await read('config/achievements')).toMatchObject({ version: 1, updatedBy: null });

    // A foto e a fila da Moderação.
    const spam = (await read('users/spam'))!;
    expect(spam.photoPath).toBe(`fans/spam/${SEED_SPAM_PHOTO_FILE}`);
    for (const comment of SEED_SPAM_COMMENTS) {
      expect(await read(`posts/p-clipe/postComments/${comment.id}`)).toMatchObject({
        authorUid: 'spam',
        authorPhotoURL: spam.photoURL,
        status: comment.id === SEED_HIDDEN_SPAM_COMMENT ? 'hidden' : 'visible',
      });
    }
    const queue = await db.collection('moderationQueue').get();
    const open = queue.docs.filter((doc) => doc.get('status') === 'open').map((doc) => doc.id);
    expect(open.sort()).toEqual(['seed-c-show-enzo', 'seed-c-spam-2', 'seed-c-spam-3']);
    expect(await read(`moderationQueue/${SEED_HIDDEN_SPAM_COMMENT}`)).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
      reportCount: 2,
      resolvedBy: { uid: SEED_STAFF_ADMIN.uid, name: SEED_STAFF_ADMIN.displayName },
    });
    expect(await read('moderationQueue/seed-c-spam-2')).toMatchObject({
      reportCount: 2,
      reasons: { spam: 2 },
    });

    // A suspensão: o perfil, e a api recusa o que grava e responde ao que lê.
    expect(await read('users/rank48')).toMatchObject({
      suspendedAt: Timestamp.fromMillis(T0),
      suspensionReason: 'other',
    });
    const api = localApi(env, { now: () => T0 });
    const token = await signIn('rank-48@teste.imagineup', 'fa-do-ranking');
    expect(
      await api('PUT', '/posts/p-clipe/like', { token, key: 'chave-do-suspenso-1' }),
    ).toMatchObject({ status: 403, body: { code: 'account_suspended' } });
    expect((await api('GET', '/me/wallet', { token })).status).toBe(200);

    // Os pedidos: os 4 da Camila e os 4 solicitados dos rank-01 a rank-04.
    const requested = await db.collection('redemptions').where('status', '==', 'requested').get();
    expect(requested.docs.map((doc) => doc.id).sort()).toEqual(
      ['UP-C3NWPB', ...SEED_OPEN_REDEMPTIONS.map((item) => item.code)].sort(),
    );
    for (const [index, item] of SEED_OPEN_REDEMPTIONS.entries()) {
      expect(await read(`redemptions/${item.code}`)).toMatchObject({
        uid: ranking.get(item.email),
        rewardId: SEED_OPEN_REDEMPTION_REWARD,
        fanName: RANKING_SEED[index]!.name,
        points: 6_000,
      });
    }
    expect((await read('wallets/rank01'))!.balance).toBe(RANKING_SEED[0]!.now - 6_000);
    expect((await db.collection('redemptions').get()).size).toBe(8);

    // A meta: só o rank-02 bateu.
    const goal = await db
      .collection('wallets')
      .where('goalReached.seasonId', '==', SEED_SEASON_GOAL.seasonId)
      .get();
    expect(goal.docs.map((doc) => doc.id)).toEqual(['rank02']);
    expect((await read('wallets/rank02'))!.seasonMissions).toBe(20);

    // O perfil novo (28.10): a bio, o gênero, a privada e as redes da tabela; a
    // Renata (rank-48, suspensa) e os outros sem detalhes.
    for (const details of SEED_FAN_DETAILS) {
      const profile = editableProfileOf((await read(`users/${uidOf(ranking, details.email)}`))!);
      expect(profile, details.email).toMatchObject({
        displayName: details.displayName,
        bio: details.bio,
        gender: details.gender,
        privateAccount: details.privateAccount,
        socials: { instagram: null, tiktok: null, linkedin: null, x: null, ...details.socials },
      });
    }
    expect(await read('users/rank05')).toMatchObject({ privateAccount: true });
    for (const uid of ['rank48', 'alan', 'duda', 'rank02']) {
      expect(await read(`users/${uid}`)).not.toHaveProperty('bio');
      expect(await read(`users/${uid}`)).not.toHaveProperty('socials');
    }
    // O seed não grava o updatedAt (só o primeiro nome do fã leva).
    expect(await read('users/spam')).not.toHaveProperty('updatedAt');

    // A auditoria: toda entrada com a seção e os alvos, todas as seções com ação e os autores.
    const audit = (await db.collection('staffAudit').get()).docs.map((doc) => doc.data());
    for (const entry of audit) {
      expect(typeof entry.section, entry.action as string).toBe('string');
      expect(Array.isArray(entry.targets), entry.action as string).toBe(true);
    }
    expect(new Set(audit.map((entry) => entry.section))).toEqual(
      new Set(['team', 'artists', 'missions', 'ranking', 'rewards', 'moderation', 'fans']),
    );
    expect(new Set(audit.map((entry) => entry.actorName))).toEqual(
      new Set([
        'Equipe de Teste',
        'Editora de Teste',
        'Leitor de Teste',
        'Virada automática',
        'Carga inicial',
      ]),
    );
    expect(audit.filter((entry) => entry.action === 'wallet.adjusted')).toEqual([]);
    expect(audit.filter((entry) => entry.action === 'config.seeded')).toHaveLength(2);
    expect(audit.filter((entry) => entry.action === 'season.closed')).toHaveLength(2);
    expect(audit.find((entry) => entry.action === 'fan.suspended')).toMatchObject({
      actorUid: SEED_STAFF_ADMIN.uid,
      section: 'moderation',
      targets: ['fan:rank48'],
      details: { uid: 'rank48', reason: 'other', note: SEED_SUSPENSION_NOTE },
    });
    expect(audit.find((entry) => entry.action === 'comment.hidden')).toMatchObject({
      section: 'moderation',
      targets: expect.arrayContaining([`comment:${SEED_HIDDEN_SPAM_COMMENT}`, 'fan:spam']),
    });
    for (let index = 1; index <= 20; index += 1) {
      const id = `seed-audit-${String(index).padStart(2, '0')}`;
      const entry = (await read(`staffAudit/${id}`))!;
      expect(entry.createdAt.toMillis()).toBeGreaterThan(T0 - 10 * DAY_MS);
      expect(entry.createdAt.toMillis()).toBeLessThan(T0);
    }

    // Os 60 dias fechados, com o retrato e sem número negativo; hoje aberto.
    expect(await read('statsMeta/close')).toMatchObject({
      lastClosedDay: YESTERDAY,
      startedBy: 'seed',
    });
    const closed = (await db.collection('statsDaily').get()).docs.map((doc) => doc.data());
    expect(closed).toHaveLength(SEED_STATS_DAYS);
    expect(closed.map((doc) => doc.day)).toEqual(buildSeedStats(T0).map((item) => item.day));
    for (const doc of closed) {
      expect(doc.closed).toBe(true);
      expect(doc.snapshot).not.toBeNull();
      for (const [path, value] of numbers(doc.snapshot)) {
        expect(value, `${doc.day} snapshot.${path}`).toBeGreaterThanOrEqual(0);
      }
      for (const [path, value] of numbers(doc.signups)) {
        expect(value, `${doc.day} signups.${path}`).toBeGreaterThanOrEqual(0);
      }
    }
    expect((await db.doc(`statsDaily/${TODAY}`).get()).exists).toBe(false);
    expect((await db.collection(`statsDaily/${TODAY}/statsShards`).get()).size).toBeGreaterThan(0);
    expect(
      (await db.doc(`statsDaily/${YESTERDAY}/statsShards/${SEED_STATS_SHARD}`).get()).exists,
    ).toBe(true);

    // O dia de 8 atrás soma o documento do seed e as entradas reais do ranking com a Camila.
    const eightAgo = shiftDay(TODAY, -8);
    const seedEight = buildSeedStats(T0).find((item) => item.day === eightAgo)!.tree;
    const joined = (tree: DocumentData, id: string) =>
      ((tree.byArtist as DocumentData)[id] as DocumentData | undefined)?.joined ?? 0;
    const closedEight = closed.find((doc) => doc.day === eightAgo)!;
    expect(joined(closedEight, 'nenho')).toBe(joined(seedEight, 'nenho') + 49);
    expect(joined(closedEight, 'nettobrito')).toBe(joined(seedEight, 'nettobrito') + 30);
    expect(joined(closedEight, 'juninhomoraes')).toBe(joined(seedEight, 'juninhomoraes') + 7);

    // Os totais fechados que a conferência no navegador compara (o seed imprime os do dia em
    // que roda): o documento do seed mais os shards reais. Nos 7 dias, a semana da Camila
    // (+840 em missões), o comentário da Duda de ontem e os 4 pedidos dela; nos 30, também as
    // missões antigas dela e as 86 entradas do ranking de 8 dias atrás.
    expect(await readClosedTotals(db, T0, 7)).toEqual({
      from: '2026-09-30',
      to: YESTERDAY,
      closedDays: 7,
      fans: 2_905,
      signups: 299,
      invited: 118,
      earned: 12_914,
      adjustmentPoints: 400,
      adjustmentEvents: 1,
      activesAverage: 249,
      likes: 2_965,
      comments: 560,
      rsvps: 89,
      reports: 2,
      joined: 553,
      redeemRequested: 7,
      redeemSpent: 73_500,
      refunded: 23_500,
      redeemDelivered: 2,
    });
    expect(await readClosedTotals(db, T0, 30)).toEqual({
      from: '2026-09-07',
      to: YESTERDAY,
      closedDays: 30,
      fans: 2_905,
      signups: 1_121,
      invited: 418,
      earned: 45_245,
      adjustmentPoints: 1_000,
      adjustmentEvents: 3,
      activesAverage: 208,
      likes: 10_600,
      comments: 1_997,
      rsvps: 315,
      reports: 8,
      joined: 2_145,
      redeemRequested: 15,
      redeemSpent: 172_500,
      refunded: 32_000,
      redeemDelivered: 9,
    });

    // Rodar de novo não muda nada.
    const before = await dump();
    await seed(ranking);
    expect(await dump()).toEqual(before);
  }, 600_000);
});
