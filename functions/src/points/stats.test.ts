import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { addMembershipCounts, type AwardPlan } from './award';
import {
  addMembershipToShard,
  emptyShardDelta,
  isEmptyShardDelta,
  pickShard,
  SHARD_COUNT,
  shardWrite,
} from './stats';

const NOW = Date.parse('2026-10-05T15:00:00.000Z');

describe('shard sorteado', () => {
  it.each([
    [0, 0],
    [0.5, 32],
    [0.9999, SHARD_COUNT - 1],
    // Um random que devolvesse 1 cairia fora: fica no último.
    [1, SHARD_COUNT - 1],
  ])('random %s cai no shard %s', (value, shard) => {
    expect(pickShard(() => value)).toBe(shard);
  });

  it('são 64, do 0 ao 63', () => {
    expect(SHARD_COUNT).toBe(64);
  });
});

describe('documento do shard', () => {
  it('soma com increment em mapas aninhados (o merge junta), sem as folhas zeradas', () => {
    const delta = emptyShardDelta();
    delta.totals.earned = 4;
    delta.totals.earnedEvents = 2;
    delta.byArtist.nettobrito = {
      earned: 4,
      earnedEvents: 2,
      spent: 0,
      spentEvents: 0,
      joined: 0,
      left: 0,
      bySource: { comment: { points: 4, events: 2 } },
    };
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      totals: { earned: FieldValue.increment(4), earnedEvents: FieldValue.increment(2) },
      byArtist: {
        nettobrito: {
          earned: FieldValue.increment(4),
          earnedEvents: FieldValue.increment(2),
          bySource: {
            comment: { points: FieldValue.increment(4), events: FieldValue.increment(2) },
          },
        },
      },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });
});

describe('entradas e saídas de centrais (bloco 4)', () => {
  it('joined e left somam no total e na central, e o zerado não é gravado', () => {
    const delta = emptyShardDelta();
    addMembershipToShard(delta, 'nettobrito', 'joined');
    addMembershipToShard(delta, 'nettobrito', 'joined');
    addMembershipToShard(delta, 'nenho', 'left');
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      totals: { joined: FieldValue.increment(2), left: FieldValue.increment(1) },
      byArtist: {
        nettobrito: { joined: FieldValue.increment(2) },
        nenho: { left: FieldValue.increment(1) },
      },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  it('addMembershipCounts cria o shard do plano quando ele veio nulo, e não cria sem mudança', () => {
    const plan = { shard: null } as unknown as AwardPlan;
    addMembershipCounts(plan, []);
    expect(plan.shard).toBeNull();
    addMembershipCounts(plan, [{ artistId: 'nenho', kind: 'joined' }]);
    expect(plan.shard).not.toBeNull();
    expect(isEmptyShardDelta(plan.shard!)).toBe(false);
    expect(plan.shard!.totals.joined).toBe(1);
    expect(plan.shard!.byArtist.nenho).toMatchObject({ joined: 1, left: 0, earned: 0 });
  });

  it('soma no shard que o plano já tinha (uma gravação por transação)', () => {
    const shard = emptyShardDelta();
    shard.totals.earned = 10;
    const plan = { shard } as unknown as AwardPlan;
    addMembershipCounts(plan, [
      { artistId: 'nenho', kind: 'joined' },
      { artistId: 'nettobrito', kind: 'joined' },
    ]);
    expect(plan.shard).toBe(shard);
    expect(shard.totals).toMatchObject({ earned: 10, joined: 2, left: 0 });
  });
});
