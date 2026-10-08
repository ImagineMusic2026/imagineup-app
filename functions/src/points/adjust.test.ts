import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  ADJUST_ADMIN_MAX,
  ADJUST_EDITOR_DAILY_MAX,
  ADJUST_EDITOR_MAX,
  adjustDailyMaxFor,
  adjustDeltas,
  adjustEntry,
  adjustmentView,
  NOTE_MAX,
  parseAdjustInput,
  sameAdjustment,
  type AdjustInput,
} from './adjust';

// O pedido do ajuste da equipe (bloco 11, 26.4), puro: cada campo nas pontas,
// os tetos por papel, o lançamento que vai para o núcleo e a comparação com o
// lançamento já gravado (a repetição da mesma tentativa).

const BASE = { uid: 'uidCamila', adjustmentId: 'ajuste-0001', balance: 100, note: 'Correção' };

function reasonOf(run: () => unknown): { reason?: unknown; field?: unknown; max?: unknown } {
  try {
    run();
  } catch (error) {
    return (error as { details?: Record<string, unknown> }).details ?? {};
  }
  return {};
}

describe('parseAdjustInput', () => {
  it('aceita o ajuste com um contador, com vários e com a central', () => {
    expect(parseAdjustInput(BASE, 'editor')).toEqual({
      uid: 'uidCamila',
      adjustmentId: 'ajuste-0001',
      balance: 100,
      note: 'Correção',
    });
    expect(
      parseAdjustInput(
        {
          ...BASE,
          balance: -5,
          xp: 20,
          season: 3,
          central: { artistId: 'nenho', season: -2, total: 7 },
          note: '  Devolução do show  ',
        },
        'admin',
      ),
    ).toEqual({
      uid: 'uidCamila',
      adjustmentId: 'ajuste-0001',
      balance: -5,
      xp: 20,
      season: 3,
      central: { artistId: 'nenho', season: -2, total: 7 },
      note: 'Devolução do show',
    });
    // Só a central, sem outro contador.
    expect(
      parseAdjustInput(
        {
          uid: 'uidCamila',
          adjustmentId: 'ajuste-0001',
          central: { artistId: 'nenho', total: 1 },
          note: 'x',
        },
        'editor',
      ).central,
    ).toEqual({ artistId: 'nenho', total: 1 });
  });

  it.each([
    [{ ...BASE, balance: undefined }, 'balance'],
    [{ ...BASE, balance: 0 }, 'balance'],
    [{ ...BASE, balance: 1.5 }, 'balance'],
    [{ ...BASE, balance: '10' }, 'balance'],
    [{ ...BASE, xp: 0 }, 'xp'],
    [{ ...BASE, season: Number.NaN }, 'season'],
    [{ ...BASE, note: '' }, 'note'],
    [{ ...BASE, note: '   ' }, 'note'],
    [{ ...BASE, note: 'a'.repeat(NOTE_MAX + 1) }, 'note'],
    [{ ...BASE, note: 'linha\nquebrada' }, 'note'],
    [{ ...BASE, note: 'com invisível \u200b' }, 'note'],
    [{ ...BASE, note: 42 }, 'note'],
    [{ ...BASE, adjustmentId: 'curto' }, 'adjustmentId'],
    [{ ...BASE, adjustmentId: 'a'.repeat(65) }, 'adjustmentId'],
    [{ ...BASE, adjustmentId: 'com espaço 123' }, 'adjustmentId'],
    [{ ...BASE, uid: 'uid-com-hifen' }, 'uid'],
    [{ ...BASE, uid: undefined }, 'uid'],
    [{ ...BASE, central: { artistId: 'nenho' } }, 'central'],
    [{ ...BASE, central: { artistId: 'Nenho!', total: 1 } }, 'central.artistId'],
    [{ ...BASE, central: { artistId: 'nenho', total: 0 } }, 'central.total'],
    [{ ...BASE, central: 'nenho' }, 'central'],
  ])('recusa %j com invalid-request no campo %s', (data, field) => {
    expect(reasonOf(() => parseAdjustInput(data, 'admin'))).toMatchObject({
      reason: 'invalid-request',
      field,
    });
  });

  it('o motivo de 200 passa; o corpo que não é objeto é pedido inválido', () => {
    expect(parseAdjustInput({ ...BASE, note: 'a'.repeat(NOTE_MAX) }, 'editor').note).toHaveLength(
      NOTE_MAX,
    );
    expect(reasonOf(() => parseAdjustInput([], 'editor')).reason).toBe('invalid-request');
  });

  it.each([
    ['editor', ADJUST_EDITOR_MAX, true],
    ['editor', ADJUST_EDITOR_MAX + 1, false],
    ['editor', -ADJUST_EDITOR_MAX - 1, false],
    ['admin', ADJUST_ADMIN_MAX, true],
    ['admin', ADJUST_ADMIN_MAX + 1, false],
  ] as const)('%s com %d: passa = %s', (role, value, passes) => {
    for (const data of [
      { ...BASE, balance: value },
      { ...BASE, balance: undefined, xp: value },
      { ...BASE, balance: undefined, central: { artistId: 'nenho', season: value } },
    ]) {
      if (passes) expect(() => parseAdjustInput(data, role)).not.toThrow();
      else {
        expect(reasonOf(() => parseAdjustInput(data, role))).toEqual({
          reason: 'adjust-above-limit',
          max: role === 'admin' ? ADJUST_ADMIN_MAX : ADJUST_EDITOR_MAX,
        });
      }
    }
  });

  it('a mensagem do teto diz o número em pt-BR', () => {
    expect(() => parseAdjustInput({ ...BASE, balance: 60_000 }, 'editor')).toThrow(
      'O ajuste passa do limite de 50.000 pontos por contador. Fale com um admin.',
    );
  });
});

describe('o lançamento e a repetição', () => {
  const input: AdjustInput = {
    uid: 'uidCamila',
    adjustmentId: 'ajuste-0001',
    balance: -50,
    central: { artistId: 'nenho', total: 20 },
    note: 'Correção',
  };

  it('os deltas por contador e o orçamento do papel', () => {
    expect(adjustDeltas(input)).toEqual({ balance: -50, centralTotal: 20 });
    expect(adjustDailyMaxFor('editor')).toBe(ADJUST_EDITOR_DAILY_MAX);
    expect(adjustDailyMaxFor('admin')).toBeNull();
  });

  it('o lançamento é o ajuste do núcleo, com o id da tentativa e o motivo', () => {
    expect(adjustEntry(input)).toEqual({
      kind: 'adjust',
      source: 'adjustment',
      eventId: 'ajuste-0001',
      balance: -50,
      central: { artistId: 'nenho', total: 20 },
      note: 'Correção',
    });
  });

  const stored = {
    source: 'adjustment',
    points: -50,
    xpDelta: 0,
    seasonDelta: 0,
    artistId: 'nenho',
    centralSeasonDelta: 0,
    centralTotalDelta: 20,
    note: 'Correção',
    balanceAfter: 950,
    createdAt: Timestamp.fromMillis(Date.parse('2026-10-07T15:00:00.000Z')),
  };

  it('o mesmo corpo é a mesma tentativa; qualquer diferença não é', () => {
    expect(sameAdjustment(stored, input)).toBe(true);
    expect(sameAdjustment(stored, { ...input, balance: -51 })).toBe(false);
    expect(sameAdjustment(stored, { ...input, note: 'Outro motivo' })).toBe(false);
    expect(sameAdjustment(stored, { ...input, central: { artistId: 'netto', total: 20 } })).toBe(
      false,
    );
    expect(sameAdjustment(stored, { ...input, xp: 1 })).toBe(false);
    expect(sameAdjustment({ ...stored, source: 'seed' }, input)).toBe(false);
  });

  it('o lançamento gravado, como o adjustment-id-reused mostra', () => {
    expect(adjustmentView(stored)).toEqual({
      balance: -50,
      xp: 0,
      season: 0,
      central: { artistId: 'nenho', season: 0, total: 20 },
      note: 'Correção',
      balanceAfter: 950,
      createdAt: '2026-10-07T15:00:00.000Z',
    });
    expect(adjustmentView({ ...stored, artistId: null }).central).toBeNull();
  });
});
