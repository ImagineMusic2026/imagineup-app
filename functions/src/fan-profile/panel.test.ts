import { describe, expect, it } from 'vitest';

import { USERNAME_RESET_REASONS } from './model';
import { parseResetReason } from './panel';

// A entrada nova do resetFanUsername (seção 32, decisões 1 e 5), puro: o
// motivo da troca do @. O painel publicado chama sem ele, e o ausente vale
// `moderation`, com o prazo de 30 dias.

describe('o motivo do resetFanUsername (parseResetReason)', () => {
  it('os dois motivos: o @ ofensivo e o @ de um artista', () => {
    expect(USERNAME_RESET_REASONS).toEqual(['moderation', 'central']);
  });

  it('ausente vale moderation (o painel publicado chama só com uid e username)', () => {
    expect(parseResetReason(undefined)).toBe('moderation');
  });

  it.each(['moderation', 'central'] as const)('%s passa', (reason) => {
    expect(parseResetReason(reason)).toBe(reason);
  });

  it.each([null, '', 'Moderation', 'CENTRAL', 'ofensivo', 0, true, ['moderation'], {}])(
    '%j é invalid-request com o campo reason',
    (value) => {
      expect(() => parseResetReason(value)).toThrow(
        expect.objectContaining({ details: { reason: 'invalid-request', field: 'reason' } }),
      );
    },
  );
});
