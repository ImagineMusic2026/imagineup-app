import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  addEngagementCounts,
  addMembershipCounts,
  addRedemptionCounts,
  type AwardPlan,
} from './award';
import {
  addAchievementToShard,
  addEngagementToShard,
  addInviteToShard,
  addMissionToShard,
  addMembershipToShard,
  addRedemptionToShard,
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
      likes: 0,
      unlikes: 0,
      comments: 0,
      rsvps: 0,
      rsvpsUndone: 0,
      reports: 0,
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

describe('engajamento nos shards (bloco 6)', () => {
  it('curtidas, comentários, presenças e denúncias no total e por central; bloqueios só no total', () => {
    const delta = emptyShardDelta();
    addEngagementToShard(delta, 'likes', ['nettobrito']);
    addEngagementToShard(delta, 'comments', ['nettobrito']);
    addEngagementToShard(delta, 'rsvps', ['nettobrito', 'nenho', 'nenho']);
    addEngagementToShard(delta, 'blocks', []);
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      totals: {
        likes: FieldValue.increment(1),
        comments: FieldValue.increment(1),
        rsvps: FieldValue.increment(1),
        blocks: FieldValue.increment(1),
      },
      byArtist: {
        nettobrito: {
          likes: FieldValue.increment(1),
          comments: FieldValue.increment(1),
          rsvps: FieldValue.increment(1),
        },
        nenho: { rsvps: FieldValue.increment(1) },
      },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  it('addEngagementCounts cria o shard do plano quando ele veio nulo, e não cria sem mudança', () => {
    const empty = { shard: null } as unknown as AwardPlan;
    addEngagementCounts(empty, []);
    expect(empty.shard).toBeNull();
    addEngagementCounts(empty, [{ kind: 'unlikes', artistIds: ['nenho'] }]);
    expect(empty.shard?.totals.unlikes).toBe(1);
    expect(empty.shard?.byArtist.nenho?.unlikes).toBe(1);
  });
});

describe('missões e conquistas nos shards (bloco 7)', () => {
  it('as conclusões por missão e os desbloqueios por conquista, como increments', () => {
    const delta = emptyShardDelta();
    addMissionToShard(delta, 'm-clipe-netto');
    addMissionToShard(delta, 'm-clipe-netto');
    addAchievementToShard(delta, 'fa-de-show');
    expect(delta.byMission).toEqual({ 'm-clipe-netto': { completed: 2 } });
    expect(delta.byAchievement).toEqual({ 'fa-de-show': { unlocked: 1 } });
    const write = shardWrite(delta, '2026-10-05', Date.parse('2026-10-05T15:00:00.000Z'));
    expect(write.byMission).toEqual({ 'm-clipe-netto': { completed: FieldValue.increment(2) } });
    expect(write.byAchievement).toEqual({ 'fa-de-show': { unlocked: FieldValue.increment(1) } });
  });

  it('sem conclusão nem desbloqueio, os mapas não são gravados (pruneZeros)', () => {
    const delta = emptyShardDelta();
    expect(isEmptyShardDelta(delta)).toBe(true);
    expect(shardWrite(delta, '2026-10-05', 0)).not.toHaveProperty('byMission');
  });
});

describe('loja nos shards (bloco 10, 25.9)', () => {
  it('cada passo do pedido no total e na recompensa; os pontos gastos e devolvidos por recompensa', () => {
    const delta = emptyShardDelta();
    addRedemptionToShard(delta, 'ingressos', 'requested', 6_000);
    addRedemptionToShard(delta, 'ingressos', 'approved');
    addRedemptionToShard(delta, 'ingressos', 'delivered');
    addRedemptionToShard(delta, 'videochamada', 'requested', 8_500);
    addRedemptionToShard(delta, 'videochamada', 'refused', 8_500);
    addRedemptionToShard(delta, 'camisa', 'canceled');
    expect(shardWrite(delta, '2026-10-05', NOW)).toEqual({
      day: '2026-10-05',
      totals: {
        redeemRequested: FieldValue.increment(2),
        redeemApproved: FieldValue.increment(1),
        redeemDelivered: FieldValue.increment(1),
        redeemRefused: FieldValue.increment(1),
        redeemCanceled: FieldValue.increment(1),
      },
      byReward: {
        ingressos: {
          requested: FieldValue.increment(1),
          spent: FieldValue.increment(6_000),
          approved: FieldValue.increment(1),
          delivered: FieldValue.increment(1),
        },
        videochamada: {
          requested: FieldValue.increment(1),
          spent: FieldValue.increment(8_500),
          refused: FieldValue.increment(1),
          refunded: FieldValue.increment(8_500),
        },
        camisa: { canceled: FieldValue.increment(1) },
      },
      updatedAt: Timestamp.fromMillis(NOW),
    });
  });

  it('a recusa sem pontos de volta (fã sem perfil) conta a recusa, sem os pontos', () => {
    const delta = emptyShardDelta();
    addRedemptionToShard(delta, 'videochamada', 'refused', 0);
    expect(delta.byReward.videochamada).toMatchObject({ refused: 1, refunded: 0 });
    expect(shardWrite(delta, '2026-10-05', NOW).byReward).toEqual({
      videochamada: { refused: FieldValue.increment(1) },
    });
  });

  it('addRedemptionCounts cria o shard do plano sem fã (aprovar e entregar), e não cria sem mudança', () => {
    const empty = { shard: null } as unknown as AwardPlan;
    addRedemptionCounts(empty, []);
    expect(empty.shard).toBeNull();
    addRedemptionCounts(empty, [{ rewardId: 'ingressos', kind: 'approved' }]);
    expect(empty.shard?.totals.redeemApproved).toBe(1);
    expect(empty.shard?.byReward.ingressos?.approved).toBe(1);
  });

  it('sem pedido, o mapa da loja não é gravado (pruneZeros)', () => {
    expect(shardWrite(emptyShardDelta(), '2026-10-05', 0)).not.toHaveProperty('byReward');
  });
});
