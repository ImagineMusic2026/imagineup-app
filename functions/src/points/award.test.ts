import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { missionIndex, type MissionRecord, type MissionTick } from '../missions/model';
import {
  addDailyCount,
  addInviteCounts,
  mergeFanAwards,
  missionsToRead,
  planAwards,
  rewardsOf,
  type AwardPlan,
  type FanContext,
} from './award';
import { DEFAULT_POINTS_CONFIG } from './config';
import {
  emptyRewards,
  emptyWallet,
  type AwardEntry,
  type GameConfig,
  type WalletState,
} from './model';

const comment = (id: string): AwardEntry => ({ kind: 'earn', source: 'comment', eventId: id });
const invite = (id: string): AwardEntry => ({ kind: 'earn', source: 'invite_signup', eventId: id });

function context(uid: string): FanContext {
  return {
    uid,
    profileCreatedAt: null,
    displayName: null,
    photoURL: null,
    wallet: emptyWallet(),
    activity: {
      day: '2026-10-05',
      week: '2026-W41',
      month: '2026-10',
      newDay: true,
      newWeek: false,
      newMonth: false,
      cohort: null,
    },
  };
}

describe('entradas do plano', () => {
  it('o mesmo fã duas vezes vira uma entrada, na ordem, com o retrato de quem chama', () => {
    // O claim do próprio convite (bloco 5): quem chama e quem convidou são o mesmo fã.
    const fan = context('uid-a');
    const merged = mergeFanAwards([
      { uid: 'uid-a', fan, entries: [comment('c1')] },
      { uid: 'uid-b', entries: [invite('CODIGO:uid-a')] },
      { uid: 'uid-a', entries: [invite('CODIGO:uid-a')] },
    ]);
    expect(merged.caller).toBe(fan);
    expect(merged.fans).toEqual([
      { uid: 'uid-a', fan, entries: [comment('c1'), invite('CODIGO:uid-a')], ticks: [] },
      { uid: 'uid-b', fan: undefined, entries: [invite('CODIGO:uid-a')], ticks: [] },
    ]);
  });

  it('o retrato vale mesmo quando chega na segunda entrada do fã', () => {
    const fan = context('uid-a');
    const merged = mergeFanAwards([
      { uid: 'uid-a', entries: [invite('CODIGO:uid-a')] },
      { uid: 'uid-a', fan, entries: [] },
    ]);
    expect(merged.caller).toBe(fan);
    expect(merged.fans).toEqual([
      { uid: 'uid-a', fan, entries: [invite('CODIGO:uid-a')], ticks: [] },
    ]);
  });

  it('sem retrato nenhum, caller null (o ajuste e o seed passam o deles)', () => {
    expect(mergeFanAwards([{ uid: 'uid-a', entries: [comment('c1')] }]).caller).toBeNull();
  });

  it('não muda as listas de quem chama', () => {
    const entries = [comment('c1')];
    mergeFanAwards([
      { uid: 'uid-a', entries },
      { uid: 'uid-a', entries: [comment('c2')] },
    ]);
    expect(entries).toEqual([comment('c1')]);
  });

  it('dois retratos, ou retrato de outro fã, é erro de programação', () => {
    expect(() =>
      mergeFanAwards([
        { uid: 'uid-a', fan: context('uid-a'), entries: [] },
        { uid: 'uid-b', fan: context('uid-b'), entries: [] },
      ]),
    ).toThrow(/uma vez/);
    expect(() =>
      mergeFanAwards([
        { uid: 'uid-a', fan: context('uid-a'), entries: [] },
        { uid: 'uid-a', fan: context('uid-a'), entries: [] },
      ]),
    ).toThrow(/uma vez/);
    expect(() => mergeFanAwards([{ uid: 'uid-a', fan: context('uid-b'), entries: [] }])).toThrow(
      /outro fã/,
    );
  });
});

describe('contador do dia sem ponto (addDailyCount)', () => {
  const NOW = Date.parse('2026-10-05T15:00:00.000Z');

  function plan(fan: FanContext, wallet: AwardPlan['fans'][number]['wallet'] = null): AwardPlan {
    return {
      day: '2026-10-05',
      results: [],
      pointsAwarded: 0,
      fans: [{ uid: fan.uid, wallet, ledger: [], centrals: [] }],
      shard: null,
      now: NOW,
      shardIndex: 0,
      caller: fan,
      rewards: emptyRewards(),
    };
  }

  const stored = (): WalletState => ({
    ...emptyWallet(),
    exists: true,
    balance: 40,
    days: {
      '2026-09-20': { earned: 5, count: { comment: 1 } },
      '2026-10-05': { earned: 10, count: { central_join: 1, central_entry: 2 } },
    },
  });

  it('sem nada a gravar no plano, grava a carteira lida, sem os dias velhos, com o contador +1', () => {
    const fan = { ...context('uid-a'), wallet: stored() };
    const result = plan(fan);
    addDailyCount(result, fan, 'central_entry');
    expect(result.fans[0]!.wallet).toEqual({
      create: false,
      state: {
        ...stored(),
        days: { '2026-10-05': { earned: 10, count: { central_join: 1, central_entry: 3 } } },
      },
    });
    // A carteira lida (o retrato do pedido) fica como estava.
    expect(fan.wallet).toEqual(stored());
  });

  it('carteira que ainda não existe nasce com o contador', () => {
    const fan = context('uid-a');
    const result = plan(fan);
    addDailyCount(result, fan, 'central_entry');
    expect(result.fans[0]!.wallet).toMatchObject({
      create: true,
      state: { exists: true, days: { '2026-10-05': { earned: 0, count: { central_entry: 1 } } } },
    });
  });

  it('com a carteira já no plano (um lançamento aplicado), soma nela', () => {
    const fan = context('uid-a');
    const state = { ...emptyWallet(), exists: true, balance: 10, days: {} };
    const result = plan(fan, { create: true, state });
    addDailyCount(result, fan, 'central_entry');
    addDailyCount(result, fan, 'central_entry');
    expect(result.fans[0]!.wallet).toEqual({
      create: true,
      state: { ...state, days: { '2026-10-05': { earned: 0, count: { central_entry: 2 } } } },
    });
  });

  it('fã fora do plano é erro de programação', () => {
    expect(() => addDailyCount(plan(context('uid-a')), context('uid-b'), 'central_entry')).toThrow(
      /não está no plano/,
    );
  });

  it('as chaves do convite (bloco 5): visitas mandadas e links novos, ao lado das outras', () => {
    const fan = { ...context('uid-a'), wallet: stored() };
    const result = plan(fan);
    addDailyCount(result, fan, 'invite_visit_sent');
    addDailyCount(result, fan, 'invite_visit_sent');
    addDailyCount(result, fan, 'invite_link');
    expect(result.fans[0]!.wallet!.state.days['2026-10-05']).toEqual({
      earned: 10,
      count: { central_join: 1, central_entry: 2, invite_visit_sent: 2, invite_link: 1 },
    });
  });

  it('as chaves dos tetos do bloco 6, ao lado das outras', () => {
    const fan = { ...context('uid-a'), wallet: stored() };
    const result = plan(fan);
    for (const key of [
      'like_set',
      'comment_sent',
      'rsvp_set',
      'comment_report',
      'fan_block',
    ] as const) {
      addDailyCount(result, fan, key);
    }
    addDailyCount(result, fan, 'like_set');
    expect(result.fans[0]!.wallet!.state.days['2026-10-05']).toEqual({
      earned: 10,
      count: {
        central_join: 1,
        central_entry: 2,
        like_set: 2,
        comment_sent: 1,
        rsvp_set: 1,
        comment_report: 1,
        fan_block: 1,
      },
    });
  });
});

describe('convite nos agregados (addInviteCounts)', () => {
  it('cria o shard do plano quando ele veio nulo, e soma no que já tinha', () => {
    const empty = { shard: null } as unknown as AwardPlan;
    addInviteCounts(empty, { event: 'link', kind: 'post' });
    expect(empty.shard).toMatchObject({
      invites: { visits: 0, links: 1 },
      byOrigin: { kind: { post: { signups: 0, visits: 0, links: 1 } } },
    });

    const withPoints = { shard: null } as unknown as AwardPlan;
    addInviteCounts(withPoints, { event: 'visit', kind: 'invite' });
    const shard = withPoints.shard!;
    addInviteCounts(withPoints, {
      event: 'signup',
      kind: 'invite',
      utmSource: 'instagram',
      utmCampaign: null,
    });
    expect(withPoints.shard).toBe(shard);
    expect(shard.signups).toEqual({ total: 0, invited: 1 });
    expect(shard.byOrigin.kind.invite).toEqual({ signups: 1, visits: 1, links: 0 });
    expect(shard.byOrigin.utmSource).toEqual({ instagram: { signups: 1 } });
    expect(shard.byOrigin.utmCampaign).toEqual({ _none: { signups: 1 } });
  });
});

// --- Bloco 7: as missões no plano (22.4) ---------------------------------------------

describe('missões no planAwards (bloco 7)', () => {
  const NOW = Date.parse('2026-10-05T15:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const base = {
    period: 'daily' as const,
    featured: false,
    startsAt: NOW - DAY_MS,
    endsAt: null,
    status: 'active' as const,
    activatedAt: NOW - DAY_MS,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
  };
  const curtir: MissionRecord = {
    ...base,
    id: 'm-curtir-nenho',
    title: 'Curta 5 posts do Nenho',
    action: 'like',
    target: { postId: null, artistId: 'nenho', eventId: null },
    goal: 2,
    rewardPoints: 10,
  };
  const outra: MissionRecord = { ...curtir, id: 'm-curtir-nenho-2', goal: 5 };
  const link: MissionRecord = {
    ...base,
    id: 'm-clipe-netto',
    title: 'Leve 5 pessoas para o clipe novo do Netto',
    action: 'share',
    target: { postId: 'p-clipe', artistId: 'nettobrito', eventId: null },
    goal: 5,
    rewardPoints: 20,
  };
  const game: GameConfig = {
    missions: missionIndex({ version: 1, missions: [curtir, outra, link] }),
    achievements: [],
    seasonGoal: null,
  };

  /** Um Firestore falso que só lê: guarda os caminhos lidos no getAll. */
  function fakeTx(existing: Record<string, Record<string, unknown>> = {}) {
    const reads: string[] = [];
    const ref = (path: string): unknown => ({
      path,
      id: path.slice(path.lastIndexOf('/') + 1),
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    });
    const db = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    } as unknown as Firestore;
    const snap = (path: string) => ({
      exists: path in existing,
      data: () => existing[path],
      get: (field: string) => existing[path]?.[field],
    });
    const tx = {
      getAll: async (...refs: { path: string }[]) => {
        reads.push(...refs.map((item) => item.path));
        return refs.map((item) => snap(item.path));
      },
    } as unknown as Transaction;
    return { db, tx, reads };
  }

  const award = {
    now: NOW,
    config: DEFAULT_POINTS_CONFIG,
    shard: 0,
    actor: { type: 'fan' as const, uid: 'fa', name: null },
    game,
  };

  it('para quem chama, lê o extrato e a central só das missões que vão concluir', async () => {
    const fan = context('fa');
    fan.wallet = {
      ...emptyWallet(),
      exists: true,
      missions: {
        daily: {
          key: '2026-10-05',
          items: {
            'm-curtir-nenho': { current: 1, keys: [], completedAt: null, rewardPaid: 0 },
          },
        },
        weekly: null,
      },
    };
    const { db, tx, reads } = fakeTx();
    const plan = await planAwards(
      tx,
      db,
      [
        {
          uid: 'fa',
          fan,
          entries: [],
          ticks: [{ action: 'like', key: 'p1', on: { postId: 'p1', artistIds: ['nenho'] } }],
        },
      ],
      award,
    );
    expect(reads).toEqual([
      'config/season',
      'wallets/fa/ledger/mission:m-curtir-nenho:2026-10-05',
      'wallets/fa/centralPoints/nenho',
    ]);
    expect(rewardsOf(plan)).toEqual({
      completedMissions: [
        {
          id: 'm-curtir-nenho',
          title: 'Curta 5 posts do Nenho',
          rewardPoints: 10,
          completedAt: new Date(NOW).toISOString(),
        },
      ],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: true,
    });
  });

  it('para outro fã (quem convidou), lê todas as candidatas', async () => {
    const { db, tx, reads } = fakeTx({ 'users/quem-convidou': { displayName: 'Camila' } });
    await planAwards(
      tx,
      db,
      [
        { uid: 'fa', fan: context('fa'), entries: [] },
        {
          uid: 'quem-convidou',
          entries: [],
          ticks: [{ action: 'share', key: 'e1', on: { postId: 'p-clipe', artistIds: [] } }],
        },
      ],
      award,
    );
    expect(reads).toEqual([
      'config/season',
      'users/quem-convidou',
      'wallets/quem-convidou',
      'wallets/quem-convidou/ledger/mission:m-clipe-netto:2026-10-05',
    ]);
  });

  it('sem lançamento nem unidade, não lê nada', async () => {
    const { db, tx, reads } = fakeTx();
    const plan = await planAwards(tx, db, [{ uid: 'fa', fan: context('fa'), entries: [] }], award);
    expect(reads).toEqual([]);
    expect(rewardsOf(plan)).toEqual({
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
  });

  it('as missões que vão ler: as que concluem para quem chama, as candidatas para os outros', () => {
    const ticks: MissionTick[] = [
      { action: 'like', key: 'p1', on: { postId: 'p1', artistIds: ['nenho'] } },
    ];
    expect(
      missionsToRead({ uid: 'fa', fan: context('fa'), entries: [], ticks }, game, NOW),
    ).toEqual([]);
    expect(
      missionsToRead({ uid: 'x', entries: [], ticks }, game, NOW).map((item) => item.mission.id),
    ).toEqual(['m-curtir-nenho', 'm-curtir-nenho-2']);
  });
});
