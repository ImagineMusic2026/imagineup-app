import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { emptyShardDelta, pickShard, SHARD_COUNT, shardWrite } from './stats';

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
