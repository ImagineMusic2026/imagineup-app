import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { addMembershipCounts, type AwardPlan } from './award';
import {
  addInviteToShard,
  addMembershipToShard,
  emptyShardDelta,
  isEmptyShardDelta,
  ORIGIN_NONE,
  originKey,
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

describe('convite e cadastros nos shards (bloco 5)', () => {
  it('cadastro convidado: o total, o tipo e os recortes de utm_source e utm_campaign', () => {
    const delta = emptyShardDelta();
    addInviteToShard(delta, {
      event: 'signup',
      kind: 'post',
      utmSource: 'instagram',
      utmCampaign: 'sao-joao',
    });
    addInviteToShard(delta, { event: 'signup', kind: 'code' });
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      signups: { invited: FieldValue.increment(2) },
      byOrigin: {
        kind: {
          post: { signups: FieldValue.increment(1) },
          code: { signups: FieldValue.increment(1) },
        },
        utmSource: {
          instagram: { signups: FieldValue.increment(1) },
          _none: { signups: FieldValue.increment(1) },
        },
        utmCampaign: {
          'sao-joao': { signups: FieldValue.increment(1) },
          _none: { signups: FieldValue.increment(1) },
        },
      },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  it('visita e link só pelo tipo: os utm_* nunca entram (cada valor novo seria uma chave nova)', () => {
    const delta = emptyShardDelta();
    addInviteToShard(delta, { event: 'visit', kind: 'artist', utmSource: 'x', utmCampaign: 'y' });
    addInviteToShard(delta, { event: 'link', kind: 'artist', utmSource: 'x', utmCampaign: 'y' });
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      invites: { visits: FieldValue.increment(1), links: FieldValue.increment(1) },
      byOrigin: {
        kind: { artist: { visits: FieldValue.increment(1), links: FieldValue.increment(1) } },
      },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  it('a chave do recorte: o valor cortado em 40; sem valor, _none', () => {
    expect(originKey('x'.repeat(60))).toBe('x'.repeat(40));
    expect(originKey(null)).toBe('_none');
    expect(originKey(undefined)).toBe('_none');
    expect(originKey('')).toBe('_none');
    expect(ORIGIN_NONE).toBe('_none');
  });

  it('o cadastro do dia (gatilho de cadastro): só signups.total', () => {
    const delta = emptyShardDelta();
    delta.signups.total = 1;
    expect(isEmptyShardDelta(delta)).toBe(false);
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      signups: { total: FieldValue.increment(1) },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  it('shard vazio continua vazio com os campos novos zerados', () => {
    expect(isEmptyShardDelta(emptyShardDelta())).toBe(true);
  });
});
