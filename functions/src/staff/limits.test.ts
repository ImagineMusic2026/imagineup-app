import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DELETIONS_DAILY_MAX,
  addStaffLimit,
  checkStaffLimit,
  DATA_EXPORTS_DAILY_MAX,
  EMAIL_LOOKUPS_DAILY_MAX,
  emptyStaffLimit,
  parseStaffLimit,
  STAFF_LIMIT_TTL_MS,
  staffLimitDoc,
  staffLimitId,
  type StaffLimitState,
} from './limits';

// O orçamento do dia da equipe (26.4): o teto diário do ajuste do editor, por
// contador e em valor absoluto, e as buscas por e-mail de todos. Desde os
// pedidos de dados (seção 32, decisão 13), também as exportações e as
// exclusões de conta do dia.

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
        dataExports: 0,
        deletedUids: [],
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

describe('checkStaffLimit: exportação de dados (seção 32)', () => {
  it('a 20ª passa e a 21ª recusa, com o teto nos detalhes', () => {
    expect(DATA_EXPORTS_DAILY_MAX).toBe(20);
    const at19 = { ...emptyStaffLimit(), dataExports: 19 };
    expect(checkStaffLimit(at19, { kind: 'data-export' })).toEqual({
      ok: true,
      next: { ...at19, dataExports: 20 },
    });
    expect(checkStaffLimit({ ...at19, dataExports: 20 }, { kind: 'data-export' })).toEqual({
      ok: false,
      reason: 'export-daily-limit',
      max: 20,
    });
  });

  it('cada teto conta à parte: as buscas no fim não barram a exportação, e o contrário', () => {
    const lookups = { ...emptyStaffLimit(), emailLookups: EMAIL_LOOKUPS_DAILY_MAX };
    expect(checkStaffLimit(lookups, { kind: 'data-export' }).ok).toBe(true);
    const exports = { ...emptyStaffLimit(), dataExports: DATA_EXPORTS_DAILY_MAX };
    expect(checkStaffLimit(exports, { kind: 'email-lookup' }).ok).toBe(true);
    expect(checkStaffLimit(exports, { kind: 'account-deletion', uid: 'uidBia' }).ok).toBe(true);
  });
});

describe('checkStaffLimit: exclusão de conta (seção 32)', () => {
  const deleted = (uids: string[]): StaffLimitState => ({
    ...emptyStaffLimit(),
    deletedUids: uids,
  });

  it('o uid novo entra na lista, e a 6ª exclusão recusa', () => {
    expect(ACCOUNT_DELETIONS_DAILY_MAX).toBe(5);
    const four = deleted(['uidA', 'uidB', 'uidC', 'uidD']);
    expect(checkStaffLimit(four, { kind: 'account-deletion', uid: 'uidE' })).toEqual({
      ok: true,
      next: deleted(['uidA', 'uidB', 'uidC', 'uidD', 'uidE']),
    });
    expect(
      checkStaffLimit(deleted(['uidA', 'uidB', 'uidC', 'uidD', 'uidE']), {
        kind: 'account-deletion',
        uid: 'uidF',
      }),
    ).toEqual({ ok: false, reason: 'deletion-daily-limit', max: 5 });
  });

  it('o uid que já está na lista passa sem somar, também com 5 na lista', () => {
    const five = deleted(['uidA', 'uidB', 'uidC', 'uidD', 'uidE']);
    expect(checkStaffLimit(five, { kind: 'account-deletion', uid: 'uidC' })).toEqual({
      ok: true,
      next: five,
      repeat: true,
    });
    const first = checkStaffLimit(deleted([]), { kind: 'account-deletion', uid: 'uidA' });
    expect(first).toEqual({ ok: true, next: deleted(['uidA']) });
    expect(first).not.toHaveProperty('repeat');
  });

  it('a conferência não muda o estado lido', () => {
    const state = deleted(['uidA']);
    checkStaffLimit(state, { kind: 'account-deletion', uid: 'uidB' });
    checkStaffLimit(state, { kind: 'account-deletion', uid: 'uidA' });
    expect(state.deletedUids).toEqual(['uidA']);
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
      dataExports: 0,
      deletedUids: [],
    });
  });

  it('lê as exportações e as exclusões do dia (seção 32)', () => {
    expect(
      parseStaffLimit(
        { day: '2026-10-14', dataExports: 4, deletedUids: ['uidBia', 'uidDuda'] },
        '2026-10-14',
      ),
    ).toEqual({ ...emptyStaffLimit(), dataExports: 4, deletedUids: ['uidBia', 'uidDuda'] });
  });

  it('a lista de excluídos é lida com tolerância: só uids no formato, sem repetir', () => {
    expect(
      parseStaffLimit(
        {
          day: '2026-10-14',
          dataExports: -2,
          deletedUids: ['uidBia', 'uidBia', 'uid-com-hifen', '', 42, null, { uid: 'x' }, 'uidDuda'],
        },
        '2026-10-14',
      ),
    ).toEqual({ ...emptyStaffLimit(), deletedUids: ['uidBia', 'uidDuda'] });
    expect(
      parseStaffLimit({ day: '2026-10-14', deletedUids: 'uidBia', dataExports: 'x' }, '2026-10-14'),
    ).toEqual(emptyStaffLimit());
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

  // 13:00 de 14/10/2026 em São Paulo.
  const NOW = Date.parse('2026-10-14T16:00:00.000Z');

  it('grava todos os campos, com o dia de São Paulo e o TTL', () => {
    const state: StaffLimitState = {
      ...withAdjusted({ balance: 10 }),
      emailLookups: 2,
      dataExports: 3,
      deletedUids: ['uidBia'],
    };
    expect(staffLimitDoc('uidAdmin', NOW, state)).toEqual({
      uid: 'uidAdmin',
      day: '2026-10-14',
      adjusted: state.adjusted,
      emailLookups: 2,
      dataExports: 3,
      deletedUids: ['uidBia'],
      updatedAt: Timestamp.fromMillis(NOW),
      expiresAt: Timestamp.fromMillis(NOW + STAFF_LIMIT_TTL_MS),
    });
  });

  it('o addStaffLimit grava o documento inteiro: a busca por e-mail depois de uma exportação não zera a contagem', () => {
    const writes: { id: string; data: Record<string, unknown> }[] = [];
    const tx = {
      set: (ref: DocumentReference, data: Record<string, unknown>) => {
        writes.push({ id: ref.id, data });
      },
    } as unknown as Transaction;
    const db = {
      collection: (name: string) => ({ doc: (id: string) => ({ id: `${name}/${id}` }) }),
    } as unknown as Firestore;

    const exported = checkStaffLimit(emptyStaffLimit(), { kind: 'data-export' });
    if (!exported.ok) throw new Error('A exportação deveria passar.');
    addStaffLimit(tx, db, 'uidAdmin', NOW, exported.next);
    const deleted = checkStaffLimit(parseStaffLimit(writes[0]!.data, '2026-10-14'), {
      kind: 'account-deletion',
      uid: 'uidBia',
    });
    if (!deleted.ok) throw new Error('A exclusão deveria passar.');
    addStaffLimit(tx, db, 'uidAdmin', NOW, deleted.next);
    const lookup = checkStaffLimit(parseStaffLimit(writes[1]!.data, '2026-10-14'), {
      kind: 'email-lookup',
    });
    if (!lookup.ok) throw new Error('A busca deveria passar.');
    addStaffLimit(tx, db, 'uidAdmin', NOW, lookup.next);

    expect(writes.map((write) => write.id)).toEqual(
      Array(3).fill('staffLimits/uidAdmin_2026-10-14'),
    );
    expect(parseStaffLimit(writes[2]!.data, '2026-10-14')).toEqual({
      ...emptyStaffLimit(),
      emailLookups: 1,
      dataExports: 1,
      deletedUids: ['uidBia'],
    });
  });
});
