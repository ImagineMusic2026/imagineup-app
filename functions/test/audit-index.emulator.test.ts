import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { SeasonInfo } from '../src/points';
import { writeSeasonConfig } from '../src/points/config';
import { countAuditIndexBackfill, writeAuditIndexBackfill } from '../src/staff/audit-index';
import {
  callable,
  central,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  type Member,
} from './support';

/**
 * A auditoria filtrável dos Logs (bloco 11, docs/arquitetura-api.md, 26.8 e
 * 26.14): uma callable de cada seção grava a `section` e os `targets` pelo
 * `writeAudit`, sem mudar a callable; e a carga preenche as entradas antigas
 * e roda de novo sem mudar nada.
 */
const env = useEmulators('auditoria', [
  'createUserProfile',
  'updateStaffMember',
  'createPost',
  'setFanSuspended',
  'updatePointsConfig',
  'scheduleNextSeason',
  'createReward',
  'adjustFanPoints',
]);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;

async function ok(name: string, data: unknown, member: Member) {
  const { result, error } = await callable(env, name, data, member.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result;
}

async function audit(action: string) {
  const snap = await db.collection('staffAudit').where('action', '==', action).get();
  expect(snap.size).toBe(1);
  return snap.docs[0]!.data();
}

describe('section e targets no writeAudit', () => {
  it('uma callable de cada seção', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['fans']);
    const fan = await signUpFan(db, 'Promo Seguidores');
    const artistId = await central(env);
    const now = Date.now();
    const current: SeasonInfo = {
      id: 'temporada-atual',
      name: 'Atual',
      startsAt: now - 10 * DAY_MS,
      endsAt: now + 20 * DAY_MS,
      leaderTitle: null,
      topTarget: 10,
      endedEarly: null,
    };
    await db.runTransaction(async (tx) => {
      writeSeasonConfig(
        tx,
        db,
        { version: 1, season: current, next: null, lastClosed: null },
        { now, updatedBy: null },
      );
    });

    await ok(
      'updateStaffMember',
      { uid: editor.uid, role: 'editor', sections: ['fans', 'audit'] },
      admin,
    );
    const { postId } = (await ok(
      'createPost',
      { artistId, kind: 'text', text: 'Bora!' },
      admin,
    )) as {
      postId: string;
    };
    await ok('setFanSuspended', { uid: fan.uid, suspended: true, reason: 'spam' }, admin);
    await ok('updatePointsConfig', { expectedVersion: 0, values: { like: 7 } }, admin);
    await ok(
      'scheduleNextSeason',
      {
        expectedVersion: 1,
        next: {
          id: 'temporada-proxima',
          name: 'Próxima',
          startsAt: now + 21 * DAY_MS,
          endsAt: now + 50 * DAY_MS,
          leaderTitle: null,
        },
      },
      admin,
    );
    const { rewardId } = (await ok(
      'createReward',
      {
        kind: 'ticket',
        title: 'Par de ingressos',
        subtitle: 'Pra Encher e Derramar',
        cost: 6_000,
        instructions: 'Retire na bilheteria com este código.',
      },
      admin,
    )) as { rewardId: string };
    await ok(
      'adjustFanPoints',
      { uid: fan.uid, adjustmentId: unique('ajuste-auditoria-'), balance: 10, note: 'Teste' },
      admin,
    );

    expect(await audit('member.updated')).toMatchObject({
      section: 'team',
      targets: expect.arrayContaining([`staff:${editor.uid}`]),
    });
    expect(await audit('post.created')).toMatchObject({
      section: 'artists',
      targets: expect.arrayContaining([`post:${postId}`, `artist:${artistId}`]),
    });
    expect(await audit('fan.suspended')).toMatchObject({
      section: 'moderation',
      targets: [`fan:${fan.uid}`],
    });
    expect(await audit('points.config.updated')).toMatchObject({ section: 'missions' });
    expect(await audit('season.next.updated')).toMatchObject({
      section: 'ranking',
      targets: expect.arrayContaining(['season:temporada-proxima']),
    });
    expect(await audit('reward.created')).toMatchObject({
      section: 'rewards',
      targets: [`reward:${rewardId}`],
    });
    // O ajuste guarda a temporada em andamento.
    expect(await audit('wallet.adjusted')).toMatchObject({
      section: 'fans',
      targets: [`fan:${fan.uid}`, 'season:temporada-atual'],
    });
    // Nenhuma entrada sem os dois campos: a carga não teria o que fazer.
    expect(await countAuditIndexBackfill(db)).toMatchObject({ missing: 0 });
  });
});

describe('a carga backfill-audit-index', () => {
  it('preenche as entradas antigas e roda de novo sem mudar nada', async () => {
    const at = Timestamp.now();
    await db.doc('staffAudit/antiga-1').set({
      action: 'reward.stock.updated',
      actorUid: 'equipe',
      actorName: 'Equipe',
      targetEmail: '',
      targetUid: null,
      details: { rewardId: 'meet-greet', before: 10, after: 20, redeemed: 3 },
      createdAt: at,
    });
    await db.doc('staffAudit/antiga-2').set({
      action: 'invite.canceled',
      actorUid: 'equipe',
      actorName: 'Equipe',
      targetEmail: 'convidada@teste.dev',
      targetUid: null,
      details: { inviteId: 'convite-1' },
      createdAt: at,
    });
    expect(await writeAuditIndexBackfill(db)).toBe(2);
    expect((await db.doc('staffAudit/antiga-1').get()).data()).toMatchObject({
      section: 'rewards',
      targets: ['reward:meet-greet'],
    });
    expect((await db.doc('staffAudit/antiga-2').get()).data()).toMatchObject({
      section: 'team',
      targets: ['invite:convite-1'],
    });
    expect(await writeAuditIndexBackfill(db)).toBe(0);
  });
});
