import { describe, expect, it } from 'vitest';

import {
  BLOCK_LIST_MAX,
  blockedOf,
  capCount,
  DAILY_CAPS,
  dailyCapProblem,
  DailyCapError,
  isFanId,
  parseReportReason,
  reasonsOf,
  reportId,
  withoutBlocked,
} from './model';

const NOW = Date.parse('2026-10-05T15:00:00.000Z'); // meio-dia em São Paulo

describe('motivos da denúncia', () => {
  it.each([
    [undefined, null],
    [null, null],
    [{}, null],
    [{ reason: null }, null],
    [{ reason: 'spam' }, 'spam'],
    [{ reason: 'offensive' }, 'offensive'],
    [{ reason: 'harassment' }, 'harassment'],
    [{ reason: 'other' }, 'other'],
  ])('%j vale %s', (body, reason) => {
    expect(parseReportReason(body)).toBe(reason);
  });

  it.each([[{ reason: 'chato' }], [{ reason: 1 }], ['spam'], [[]]])(
    '%j é inválido (400)',
    (body) => {
      expect(parseReportReason(body)).toBeUndefined();
    },
  );

  it('a contagem por motivo lida, com os estranhos em 0', () => {
    expect(reasonsOf({ spam: 2, other: -1, none: 'x' })).toEqual({
      spam: 2,
      offensive: 0,
      harassment: 0,
      other: 0,
      none: 0,
    });
  });
});

describe('tetos do dia', () => {
  it('os valores de 21.7', () => {
    expect(DAILY_CAPS).toEqual({
      like: { key: 'like_set', limit: 300 },
      comment: { key: 'comment_sent', limit: 100 },
      rsvp: { key: 'rsvp_set', limit: 50 },
      report: { key: 'comment_report', limit: 30 },
      block: { key: 'fan_block', limit: 30 },
      // Bloco 9: as trocas de foto do perfil.
      photo: { key: 'photo_set', limit: 10 },
      // Bloco 10: os resgates da loja (25.7).
      redeem: { key: 'reward_redeem', limit: 10 },
      // Proteção contra abuso: as vagas de envio da foto (27.4).
      upload: { key: 'photo_upload', limit: 20 },
    });
    expect(BLOCK_LIST_MAX).toBe(1_000);
  });

  it('abaixo do teto passa; no teto, recusa com o Retry-After até a meia-noite de São Paulo', () => {
    expect(dailyCapProblem('like', 299, NOW)).toBeNull();
    const problem = dailyCapProblem('like', 300, NOW);
    expect(problem).toBeInstanceOf(DailyCapError);
    expect(problem).toMatchObject({ action: 'like', limit: 300, retryAfter: 12 * 60 * 60 });
  });

  it('o teto da configuração (actionCaps, bloco 7) vale no lugar do padrão', () => {
    expect(dailyCapProblem('like', 299, NOW, 10)).toMatchObject({ action: 'like', limit: 10 });
    expect(dailyCapProblem('like', 9, NOW, 10)).toBeNull();
  });

  it('a contagem é a do dia de São Paulo na carteira', () => {
    const days = {
      '2026-10-05': { earned: 0, count: { like_set: 7 } },
      '2026-10-04': { earned: 0, count: { like_set: 299 } },
    };
    expect(capCount(days, 'like', NOW)).toBe(7);
    expect(capCount(days, 'comment', NOW)).toBe(0);
    // 23:30 do dia 4 em São Paulo.
    expect(capCount(days, 'like', Date.parse('2026-10-05T02:30:00.000Z'))).toBe(299);
  });
});

describe('bloqueios', () => {
  it('o uid do Auth: letras e números', () => {
    expect(isFanId('aB3dE9fGh1')).toBe(true);
    expect(isFanId('uid-com-hifen')).toBe(false);
    expect(isFanId('')).toBe(false);
    expect(isFanId('a'.repeat(129))).toBe(false);
  });

  it('a lista lida, sem repetir e só com uids', () => {
    expect(blockedOf(['uidA', 'uidA', 'x-y', 3, 'uidB'])).toEqual(['uidA', 'uidB']);
    expect(blockedOf(undefined)).toEqual([]);
  });

  it('o filtro dos bloqueados tira só os autores da lista', () => {
    const comments = [
      { id: '1', authorUid: 'uidEnzo' },
      { id: '2', authorUid: 'uidBia' },
      { id: '3', authorUid: 'uidEnzo' },
    ];
    expect(withoutBlocked(comments, new Set(['uidEnzo'])).map((c) => c.id)).toEqual(['2']);
    expect(withoutBlocked(comments, new Set())).toHaveLength(3);
  });

  it('uma denúncia por fã e comentário', () => {
    expect(reportId('seed-c-show-enzo', 'uidAlan')).toBe('seed-c-show-enzo_uidAlan');
  });
});
