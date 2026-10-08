import { describe, expect, it } from 'vitest';

import {
  checkStaffLimit,
  EMAIL_LOOKUPS_DAILY_MAX,
  emptyStaffLimit,
  parseStaffLimit,
  STAFF_LIMIT_TTL_MS,
  staffLimitId,
  type StaffLimitState,
} from './limits';

// O orçamento do dia da equipe (26.4): o teto diário do ajuste do editor, por
// contador e em valor absoluto, e as buscas por e-mail de todos.

const EDITOR_DAILY_MAX = 100_000;

const withAdjusted = (adjusted: Partial<StaffLimitState['adjusted']>): StaffLimitState => {
  const state = emptyStaffLimit();
  return { ...state, adjusted: { ...state.adjusted, ...adjusted } };
};

describe('checkStaffLimit: ajuste do editor', () => {
  it.each([
    [99_999, true],
    [100_000, true],
    [100_001, false],
  ])('com %s somados no dia, passa: %s', (total, ok) => {
    const result = checkStaffLimit(withAdjusted({ balance: 50_000 }), {
      kind: 'adjust',
      deltas: { balance: total - 50_000 },
      dailyMax: EDITOR_DAILY_MAX,
    });
    expect(result.ok).toBe(ok);
    if (result.ok) expect(result.next.adjusted.balance).toBe(total);
    else
      expect(result).toEqual({
        ok: false,
        reason: 'adjust-daily-limit',
        counter: 'balance',
        remaining: 50_000,
      });
  });

  it('cada contador tem o seu orçamento', () => {
    const result = checkStaffLimit(withAdjusted({ balance: 100_000 }), {
      kind: 'adjust',
      deltas: { xp: 100_000, season: 1, centralSeason: 2, centralTotal: 3 },
      dailyMax: EDITOR_DAILY_MAX,
    });
    expect(result).toEqual({
      ok: true,
      next: {
        adjusted: { balance: 100_000, xp: 100_000, season: 1, centralSeason: 2, centralTotal: 3 },
        emailLookups: 0,
      },
    });
  });

  it('soma o valor absoluto dos negativos', () => {
    const first = checkStaffLimit(emptyStaffLimit(), {
      kind: 'adjust',
      deltas: { balance: -60_000 },
      dailyMax: EDITOR_DAILY_MAX,
    });
    expect(first.ok && first.next.adjusted.balance).toBe(60_000);
    const second = checkStaffLimit(first.ok ? first.next : emptyStaffLimit(), {
      kind: 'adjust',
      deltas: { balance: 50_000 },
      dailyMax: EDITOR_DAILY_MAX,
    });
    expect(second).toEqual({
      ok: false,
      reason: 'adjust-daily-limit',
      counter: 'balance',
      remaining: 40_000,
    });
  });

  it('recusa pelo primeiro contador que passa, e o que cabe nunca é negativo', () => {
    expect(
      checkStaffLimit(withAdjusted({ xp: 120_000, season: 100_000 }), {
        kind: 'adjust',
        deltas: { season: 1, xp: 1 },
        dailyMax: EDITOR_DAILY_MAX,
      }),
    ).toEqual({ ok: false, reason: 'adjust-daily-limit', counter: 'xp', remaining: 0 });
  });

  it('o admin não tem orçamento, e a soma fica registrada', () => {
    expect(
      checkStaffLimit(withAdjusted({ balance: 900_000 }), {
        kind: 'adjust',
        deltas: { balance: 1_000_000 },
        dailyMax: null,
      }),
    ).toEqual({ ok: true, next: withAdjusted({ balance: 1_900_000 }) });
  });

  it('delta 0 ou ausente não mexe no contador', () => {
    expect(
      checkStaffLimit(withAdjusted({ balance: 100_000 }), {
        kind: 'adjust',
        deltas: { balance: 0, xp: 5 },
        dailyMax: EDITOR_DAILY_MAX,
      }),
    ).toEqual({ ok: true, next: withAdjusted({ balance: 100_000, xp: 5 }) });
  });
});

describe('checkStaffLimit: busca por e-mail', () => {
  it('a 50ª passa e a 51ª recusa, para qualquer papel', () => {
    expect(EMAIL_LOOKUPS_DAILY_MAX).toBe(50);
    const at49 = { ...emptyStaffLimit(), emailLookups: 49 };
    const fiftieth = checkStaffLimit(at49, { kind: 'email-lookup' });
    expect(fiftieth).toEqual({ ok: true, next: { ...at49, emailLookups: 50 } });
    expect(checkStaffLimit({ ...at49, emailLookups: 50 }, { kind: 'email-lookup' })).toEqual({
      ok: false,
      reason: 'lookup-daily-limit',
      max: 50,
    });
  });
});

describe('parseStaffLimit', () => {
  it('lê o documento do dia', () => {
    expect(
      parseStaffLimit(
        {
          uid: 'u1',
          day: '2026-10-07',
          adjusted: { balance: 100, xp: 2, season: 0, centralSeason: 1, centralTotal: 1 },
          emailLookups: 3,
        },
        '2026-10-07',
      ),
    ).toEqual({
      adjusted: { balance: 100, xp: 2, season: 0, centralSeason: 1, centralTotal: 1 },
      emailLookups: 3,
    });
  });

  it('o dia novo começa do zero (sem documento, ou com o de outro dia)', () => {
    expect(parseStaffLimit(undefined, '2026-10-08')).toEqual(emptyStaffLimit());
    expect(
      parseStaffLimit(
        { day: '2026-10-07', adjusted: { balance: 100 }, emailLookups: 9 },
        '2026-10-08',
      ),
    ).toEqual(emptyStaffLimit());
  });

  it('campo estranho vale 0', () => {
    expect(
      parseStaffLimit(
        { day: '2026-10-07', adjusted: { balance: -5, xp: 'x', season: 1.9 }, emailLookups: null },
        '2026-10-07',
      ),
    ).toEqual(withAdjusted({ season: 1 }));
  });
});

describe('o documento', () => {
  it('um por pessoa e dia, apagado pelo TTL 30 dias depois', () => {
    expect(staffLimitId('uid-editora', '2026-10-07')).toBe('uid-editora_2026-10-07');
    expect(STAFF_LIMIT_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
