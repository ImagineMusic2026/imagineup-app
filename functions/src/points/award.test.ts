import { describe, expect, it } from 'vitest';

import {
  addDailyCount,
  addInviteCounts,
  mergeFanAwards,
  type AwardPlan,
  type FanContext,
} from './award';
import { emptyWallet, type AwardEntry, type WalletState } from './model';

const comment = (id: string): AwardEntry => ({ kind: 'earn', source: 'comment', eventId: id });
const invite = (id: string): AwardEntry => ({ kind: 'earn', source: 'invite_signup', eventId: id });

function context(uid: string): FanContext {
  return {
    uid,
    profileCreatedAt: null,
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
      { uid: 'uid-a', fan, entries: [comment('c1'), invite('CODIGO:uid-a')] },
      { uid: 'uid-b', fan: undefined, entries: [invite('CODIGO:uid-a')] },
    ]);
  });

  it('o retrato vale mesmo quando chega na segunda entrada do fã', () => {
    const fan = context('uid-a');
    const merged = mergeFanAwards([
      { uid: 'uid-a', entries: [invite('CODIGO:uid-a')] },
      { uid: 'uid-a', fan, entries: [] },
    ]);
    expect(merged.caller).toBe(fan);
    expect(merged.fans).toEqual([{ uid: 'uid-a', fan, entries: [invite('CODIGO:uid-a')] }]);
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
