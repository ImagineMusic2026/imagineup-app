import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { missionIndex, type MissionRecord, type MissionTick } from '../missions/model';
import {
  addDailyCount,
  addInviteCounts,
  addRedemptionCounts,
  applyAwards,
  centralFromDoc,
  mergeFanAwards,
  missionsToRead,
  planAwards,
  rewardsOf,
  setCentralMember,
  walletFromDoc,
  type AwardPlan,
  type FanContext,
} from './award';
import { DEFAULT_POINTS_CONFIG } from './config';
import {
  emptyCentral,
  emptyRewards,
  emptyWallet,
  NO_GAME,
  type AwardEntry,
  type CentralState,
  type GameConfig,
  type PointsConfig,
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
      activeSeasonId: null,
      centralsRead: new Map(),
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

  it('a chave do teto dos resgates (bloco 10), ao lado das outras', () => {
    const fan = { ...context('uid-a'), wallet: stored() };
    const result = plan(fan);
    addDailyCount(result, fan, 'reward_redeem');
    expect(result.fans[0]!.wallet!.state.days['2026-10-05']).toEqual({
      earned: 10,
      count: { central_join: 1, central_entry: 2, reward_redeem: 1 },
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

describe('membro da central no plano (setCentralMember, bloco 8)', () => {
  const NOW = Date.parse('2026-10-05T15:00:00.000Z');

  function plan(
    centrals: AwardPlan['fans'][number]['centrals'] = [],
    read: Map<string, CentralState> = new Map(),
  ): AwardPlan {
    return {
      day: '2026-10-05',
      results: [],
      pointsAwarded: 0,
      fans: [{ uid: 'uid-a', wallet: null, ledger: [], centrals }],
      shard: null,
      now: NOW,
      shardIndex: 0,
      caller: null,
      rewards: emptyRewards(),
      activeSeasonId: 'temporada-sao-joao',
      centralsRead: new Map([['uid-a', read]]),
    };
  }

  const stored = (extra: Partial<CentralState> = {}): CentralState => ({
    ...emptyCentral('nenho'),
    exists: true,
    seasonId: 'temporada-sao-joao',
    seasonPoints: 2_980,
    seasonPointsAt: NOW - 1_000,
    totalPoints: 2_980,
    ...extra,
  });

  it('sem o documento, nasce zerado com a temporada ativa', () => {
    const result = plan();
    setCentralMember(result, 'uid-a', 'nenho', true);
    expect(result.fans[0]!.centrals).toEqual([
      {
        create: true,
        state: {
          ...emptyCentral('nenho'),
          exists: true,
          seasonId: 'temporada-sao-joao',
          member: true,
        },
      },
    ]);
  });

  it('o lido pelo plano muda só o member, com os pontos que já tinha', () => {
    const result = plan([], new Map([['nenho', stored()]]));
    setCentralMember(result, 'uid-a', 'nenho', true);
    expect(result.fans[0]!.centrals).toEqual([
      { create: false, state: { ...stored(), member: true } },
    ]);
  });

  it('a central que um lançamento já mexe sai numa gravação só, com o member', () => {
    const touched = { create: false, state: { ...stored(), seasonPoints: 2_990 } };
    const result = plan([touched]);
    setCentralMember(result, 'uid-a', 'nenho', true);
    expect(result.fans[0]!.centrals).toEqual([
      { create: false, state: { ...stored(), seasonPoints: 2_990, member: true } },
    ]);
  });

  it('a lida pela rota (a saída) grava false; o mesmo valor não grava nada', () => {
    const result = plan();
    setCentralMember(result, 'uid-a', 'nenho', false, stored({ member: true }));
    expect(result.fans[0]!.centrals).toEqual([{ create: false, state: stored({ member: false }) }]);
    const same = plan();
    setCentralMember(same, 'uid-a', 'nenho', false, stored({ member: false }));
    expect(same.fans[0]!.centrals).toEqual([]);
  });

  it('fã fora do plano é erro de programação', () => {
    expect(() => setCentralMember(plan(), 'uid-b', 'nenho', true)).toThrow(/não está no plano/);
  });
});

describe('leitura e gravação dos campos do bloco 8', () => {
  const NOW = Date.parse('2026-10-05T15:00:00.000Z');

  it('a carteira lê as temporadas fechadas e a última contada; a central lê o member', () => {
    expect(
      walletFromDoc({ stats: { pastSeasons: 2, closedSeasonId: 'temporada-carnaval' } }),
    ).toMatchObject({ pastSeasons: 2, closedSeasonId: 'temporada-carnaval' });
    expect(walletFromDoc({ stats: { pastSeasons: 2 } }).closedSeasonId).toBeNull();
    expect(centralFromDoc('nenho', { member: true }).member).toBe(true);
    expect(centralFromDoc('nenho', { member: 'sim' }).member).toBe(false);
    expect(centralFromDoc('nenho', {}).member).toBe(false);
  });

  it('o núcleo cria as temporadas zeradas e nunca mais grava o stats; a central leva o member', () => {
    const writes: { op: string; path: string; data: Record<string, unknown> }[] = [];
    const ref = (path: string): unknown => ({
      path,
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    });
    const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) };
    const tx = {
      create: (r: { path: string }, data: Record<string, unknown>) =>
        writes.push({ op: 'create', path: r.path, data }),
      update: (r: { path: string }, data: Record<string, unknown>) =>
        writes.push({ op: 'update', path: r.path, data }),
      set: () => undefined,
    };
    const state = { ...emptyWallet(), exists: true, pastSeasons: 3, closedSeasonId: 'carnaval' };
    const central: CentralState = { ...emptyCentral('nenho'), exists: true, member: true };
    const plan: AwardPlan = {
      day: '2026-10-05',
      results: [],
      pointsAwarded: 0,
      fans: [
        {
          uid: 'uid-a',
          wallet: { create: false, state },
          ledger: [],
          centrals: [{ create: false, state: central }],
        },
        { uid: 'uid-b', wallet: { create: true, state }, ledger: [], centrals: [] },
      ],
      shard: null,
      now: NOW,
      shardIndex: 0,
      caller: null,
      rewards: emptyRewards(),
      activeSeasonId: null,
      centralsRead: new Map(),
    };
    applyAwards(tx as unknown as Transaction, db as unknown as Firestore, plan);
    const update = writes.find((w) => w.op === 'update' && w.path === 'wallets/uid-a')!;
    expect(Object.keys(update.data).some((key) => key.startsWith('stats'))).toBe(false);
    const create = writes.find((w) => w.op === 'create' && w.path === 'wallets/uid-b')!;
    expect(create.data.stats).toEqual({ pastSeasons: 0, closedSeasonId: null });
    const centralWrite = writes.find((w) => w.path === 'wallets/uid-a/centralPoints/nenho')!;
    expect(centralWrite.data).toMatchObject({ member: true, updatedAt: Timestamp.fromMillis(NOW) });
  });
});

// --- Bloco 10: o plano sem fã das transições do pedido (25.4, passo 6) -----------------

describe('plano sem fã (aprovar e entregar um pedido)', () => {
  const NOW = Date.parse('2026-10-05T21:00:00.000Z');

  it('o planAwards com a lista vazia não lê nada, e o applyAwards grava só o shard', async () => {
    const reads: string[] = [];
    const writes: { op: string; path: string }[] = [];
    const ref = (path: string): unknown => ({
      path,
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    });
    const db = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    } as unknown as Firestore;
    const tx = {
      getAll: async (...refs: { path: string }[]) => {
        reads.push(...refs.map((item) => item.path));
        return [];
      },
      create: (r: { path: string }) => writes.push({ op: 'create', path: r.path }),
      update: (r: { path: string }) => writes.push({ op: 'update', path: r.path }),
      set: (r: { path: string }) => writes.push({ op: 'set', path: r.path }),
    } as unknown as Transaction;
    const plan = await planAwards(tx, db, [], {
      now: NOW,
      config: DEFAULT_POINTS_CONFIG,
      shard: 7,
      actor: { type: 'staff', uid: 'equipe', name: 'Equipe' },
      game: {
        missions: missionIndex({ version: 0, missions: [] }),
        achievements: [],
        seasonGoal: null,
      },
    });
    expect(reads).toEqual([]);
    expect(plan.shard).toBeNull();
    addRedemptionCounts(plan, [{ rewardId: 'ingressos', kind: 'delivered' }]);
    applyAwards(tx, db, plan);
    expect(writes).toEqual([{ op: 'set', path: 'statsDaily/2026-10-05/statsShards/7' }]);
  });
});

// --- Check-in diário com sequência (seção 39) -----------------------------------------

describe('check-in diário no plano e na carteira (seção 39)', () => {
  const NOW = Date.parse('2026-10-05T15:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ON: PointsConfig = {
    ...DEFAULT_POINTS_CONFIG,
    checkin: { enabled: true, cycle: [3, 3, 4, 4, 5, 6, 15] },
  };
  const award = (config: PointsConfig) => ({
    now: NOW,
    config,
    shard: 0,
    actor: { type: 'fan' as const, uid: 'fa', name: null },
    game: NO_GAME,
  });
  /** O retrato de quem chama sem marca de atividade: só o check-in pode gravar a carteira. */
  const caller = (wallet: WalletState = emptyWallet()): FanContext => ({
    ...context('fa'),
    wallet,
    activity: null,
  });
  const SEASON_DOC = {
    version: 1,
    season: {
      id: 'temporada-sao-joao',
      name: 'São João',
      startsAt: Timestamp.fromMillis(NOW - 18 * DAY_MS),
      endsAt: Timestamp.fromMillis(NOW + 12 * DAY_MS),
      leaderTitle: null,
    },
  };

  /** Um Firestore falso: guarda os caminhos lidos no getAll e o que foi gravado. */
  function fakeStore(existing: Record<string, Record<string, unknown>> = {}) {
    const reads: string[] = [];
    const writes: { op: string; path: string; data: Record<string, unknown> }[] = [];
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
    const write = (op: string) => (r: { path: string }, data: Record<string, unknown>) =>
      void writes.push({ op, path: r.path, data });
    const tx = {
      getAll: async (...refs: { path: string }[]) => {
        reads.push(...refs.map((item) => item.path));
        return refs.map((item) => snap(item.path));
      },
      create: write('create'),
      update: write('update'),
      set: write('set'),
    } as unknown as Transaction;
    return { db, tx, reads, writes };
  }

  it('o pedido de check-in entra no fã junto das entradas, só quando é true', () => {
    const fan = context('uid-a');
    expect(mergeFanAwards([{ uid: 'uid-a', fan, entries: [], checkin: true }]).fans).toEqual([
      { uid: 'uid-a', fan, entries: [], ticks: [], checkin: true },
    ]);
    // Chega na segunda entrada do mesmo fã (o plano junta as duas).
    const merged = mergeFanAwards([
      { uid: 'uid-a', fan, entries: [comment('c1')] },
      { uid: 'uid-a', entries: [], checkin: true },
    ]);
    expect(merged.fans).toEqual([
      { uid: 'uid-a', fan, entries: [comment('c1')], ticks: [], checkin: true },
    ]);
    for (const input of [
      { uid: 'uid-a', entries: [] },
      { uid: 'uid-a', entries: [], checkin: false },
    ]) {
      expect('checkin' in mergeFanAwards([input]).fans[0]!).toBe(false);
    }
  });

  it('com a chave ligada, lê a temporada e o lançamento do dia, paga o ciclo e os pontos entram na temporada', async () => {
    const fan = caller();
    const { db, tx, reads } = fakeStore({ 'config/season': SEASON_DOC });
    const plan = await planAwards(
      tx,
      db,
      [{ uid: 'fa', fan, entries: [], checkin: true }],
      award(ON),
    );
    expect(reads).toEqual(['config/season', 'wallets/fa/ledger/checkin:2026-10-05']);
    expect(plan.pointsAwarded).toBe(3);
    expect(plan.checkin).toEqual({
      status: 'checked',
      record: { streak: 1, best: 1, lastDay: '2026-10-05' },
      cycleDay: 1,
      points: 3,
    });
    expect(plan.fans[0]!.wallet!.state).toMatchObject({
      balance: 3,
      seasonId: 'temporada-sao-joao',
      seasonPoints: 3,
      checkin: { streak: 1, best: 1, lastDay: '2026-10-05' },
    });
    expect(plan.caller).toBe(fan);
  });

  it('o plano gravado: a carteira com a sequência, o lançamento checkin:<dia> e o shard', async () => {
    const stored = { ...emptyWallet(), exists: true, balance: 100, xp: 100 };
    stored.checkin = { streak: 6, best: 6, lastDay: '2026-10-04' };
    const { db, tx, writes } = fakeStore();
    const plan = await planAwards(
      tx,
      db,
      [{ uid: 'fa', fan: caller(stored), entries: [], checkin: true }],
      award(ON),
    );
    applyAwards(tx, db, plan);
    expect(writes.map((write) => [write.op, write.path])).toEqual([
      ['update', 'wallets/fa'],
      ['create', 'wallets/fa/ledger/checkin:2026-10-05'],
      ['set', 'statsDaily/2026-10-05/statsShards/0'],
    ]);
    expect(writes[0]!.data).toMatchObject({
      balance: 115,
      xp: 115,
      checkin: { streak: 7, best: 7, lastDay: '2026-10-05' },
      updatedAt: Timestamp.fromMillis(NOW),
    });
    expect(writes[1]!.data).toMatchObject({
      uid: 'fa',
      kind: 'earn',
      source: 'checkin',
      eventId: '2026-10-05',
      points: 15,
      artistId: null,
      subject: null,
      subjectTitle: null,
      createdAt: Timestamp.fromMillis(NOW),
    });
    // A carteira lida no pedido não muda.
    expect(stored.checkin).toEqual({ streak: 6, best: 6, lastDay: '2026-10-04' });
  });

  it('o lançamento do dia que já existe no extrato não paga de novo, e a sequência é gravada', async () => {
    const stored = { ...emptyWallet(), exists: true, balance: 100 };
    stored.checkin = { streak: 2, best: 2, lastDay: '2026-10-04' };
    const { db, tx, writes } = fakeStore({ 'wallets/fa/ledger/checkin:2026-10-05': { points: 4 } });
    const plan = await planAwards(
      tx,
      db,
      [{ uid: 'fa', fan: caller(stored), entries: [], checkin: true }],
      award(ON),
    );
    expect(plan.results).toEqual([
      { uid: 'fa', entryId: 'checkin:2026-10-05', status: 'duplicate', points: 0 },
    ]);
    expect(plan.pointsAwarded).toBe(0);
    applyAwards(tx, db, plan);
    expect(writes.map((write) => [write.op, write.path])).toEqual([['update', 'wallets/fa']]);
    expect(writes[0]!.data).toMatchObject({
      balance: 100,
      checkin: { streak: 3, best: 3, lastDay: '2026-10-05' },
    });
  });

  it('o segundo pedido do dia lê o mesmo e não grava nada', async () => {
    const stored = { ...emptyWallet(), exists: true, balance: 103 };
    stored.checkin = { streak: 1, best: 1, lastDay: '2026-10-05' };
    const { db, tx, reads, writes } = fakeStore({
      'wallets/fa/ledger/checkin:2026-10-05': { points: 3 },
    });
    const plan = await planAwards(
      tx,
      db,
      [{ uid: 'fa', fan: caller(stored), entries: [], checkin: true }],
      award(ON),
    );
    expect(reads).toEqual(['config/season', 'wallets/fa/ledger/checkin:2026-10-05']);
    expect(plan.checkin).toMatchObject({ status: 'already', points: 0 });
    applyAwards(tx, db, plan);
    expect(writes).toEqual([]);
  });

  it('com a chave desligada, o pedido não lê nem grava nada', async () => {
    const stored = { ...emptyWallet(), exists: true, balance: 100 };
    for (const fan of [caller(), caller(stored)]) {
      const { db, tx, reads, writes } = fakeStore({ 'config/season': SEASON_DOC });
      const plan = await planAwards(
        tx,
        db,
        [{ uid: 'fa', fan, entries: [], checkin: true }],
        award(DEFAULT_POINTS_CONFIG),
      );
      expect(reads).toEqual([]);
      expect(plan.pointsAwarded).toBe(0);
      expect(plan.fans).toEqual([{ uid: 'fa', wallet: null, ledger: [], centrals: [] }]);
      expect(plan.shard).toBeNull();
      expect('checkin' in plan).toBe(false);
      applyAwards(tx, db, plan);
      expect(writes).toEqual([]);
    }
  });

  it('a carteira lê a sequência gravada; sem o campo ou com ele fora do formato, a vazia', () => {
    const empty = { streak: 0, best: 0, lastDay: null };
    expect(walletFromDoc(undefined).checkin).toEqual(empty);
    // A carteira de antes do check-in (toda a produção): sem o campo.
    expect(walletFromDoc({ balance: 12_480, xp: 12_480 }).checkin).toEqual(empty);
    expect(
      walletFromDoc({ checkin: { streak: 4, best: 9, lastDay: '2026-10-04' } }).checkin,
    ).toEqual({ streak: 4, best: 9, lastDay: '2026-10-04' });
    for (const checkin of [
      null,
      'sequência',
      { streak: '4', best: 4, lastDay: '2026-10-04' },
      { streak: 4, best: 4, lastDay: Timestamp.fromMillis(NOW) },
      { streak: -1, best: 4, lastDay: '2026-10-04' },
    ]) {
      expect(walletFromDoc({ balance: 10, checkin }).checkin).toEqual(empty);
    }
  });

  it('a gravação só leva o campo depois do primeiro check-in: sem ele, nem o create nem o update tocam no checkin', () => {
    const { db, tx, writes } = fakeStore();
    const without = { ...emptyWallet(), exists: true, balance: 10 };
    const withStreak = {
      ...without,
      checkin: { streak: 4, best: 9, lastDay: '2026-10-04' },
    };
    const plan: AwardPlan = {
      day: '2026-10-05',
      results: [],
      pointsAwarded: 0,
      fans: [
        { uid: 'sem-update', wallet: { create: false, state: without }, ledger: [], centrals: [] },
        { uid: 'sem-create', wallet: { create: true, state: without }, ledger: [], centrals: [] },
        {
          uid: 'com-update',
          wallet: { create: false, state: withStreak },
          ledger: [],
          centrals: [],
        },
        {
          uid: 'com-create',
          wallet: { create: true, state: withStreak },
          ledger: [],
          centrals: [],
        },
      ],
      shard: null,
      now: NOW,
      shardIndex: 0,
      caller: null,
      rewards: emptyRewards(),
      activeSeasonId: null,
      centralsRead: new Map(),
    };
    applyAwards(tx, db, plan);
    const dataOf = (uid: string) => writes.find((write) => write.path === `wallets/${uid}`)!;
    expect(dataOf('sem-update').op).toBe('update');
    expect(dataOf('sem-create').op).toBe('create');
    for (const uid of ['sem-update', 'sem-create']) {
      expect('checkin' in dataOf(uid).data, uid).toBe(false);
      // O resto da carteira vai como sempre.
      expect(dataOf(uid).data, uid).toMatchObject({ balance: 10, achievements: {} });
    }
    for (const uid of ['com-update', 'com-create']) {
      expect(dataOf(uid).data.checkin, uid).toEqual({
        streak: 4,
        best: 9,
        lastDay: '2026-10-04',
      });
    }
    // O objeto gravado é uma cópia: não é o do estado calculado.
    expect(dataOf('com-update').data.checkin).not.toBe(withStreak.checkin);
  });

  it('qualquer gravação com a chave desligada (um comentário) não põe o campo na carteira', async () => {
    const { db, tx, writes } = fakeStore();
    const plan = await planAwards(
      tx,
      db,
      [{ uid: 'fa', fan: caller(), entries: [comment('c1')] }],
      award(DEFAULT_POINTS_CONFIG),
    );
    applyAwards(tx, db, plan);
    const created = writes.find((write) => write.path === 'wallets/fa')!;
    expect(created.op).toBe('create');
    expect(created.data).toMatchObject({ balance: 2 });
    expect('checkin' in created.data).toBe(false);
  });
});
