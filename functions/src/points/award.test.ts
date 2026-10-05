import { describe, expect, it } from 'vitest';

import { mergeFanAwards, type FanContext } from './award';
import { emptyWallet, type AwardEntry } from './model';

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
