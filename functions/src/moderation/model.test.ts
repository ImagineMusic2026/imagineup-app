import { describe, expect, it } from 'vitest';

import {
  BLOCK_LIST_MAX,
  BLOCKED_PAGE_MAX,
  blockedOf,
  blockedPage,
  capCount,
  DAILY_CAPS,
  dailyCapProblem,
  DailyCapError,
  emptyFanClubReasons,
  FAN_CLUB_REPORT_REASONS,
  fanClubReasonKey,
  fanClubReasonsOf,
  formatBlockCursor,
  isFanId,
  ModerationError,
  parseBlockCursor,
  parseFanClubReportReason,
  parseReportReason,
  REPORT_REASONS,
  storedFanClubReasonKey,
  profileReportId,
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

describe('motivos da denúncia de publicação de fã-clube (seção 34, decisão 18)', () => {
  it('os 4 de sempre mais o uso indevido de imagem, só aqui', () => {
    expect(FAN_CLUB_REPORT_REASONS).toEqual([
      'spam',
      'offensive',
      'harassment',
      'image_misuse',
      'other',
    ]);
    // A denúncia de comentário e de perfil não muda.
    expect(REPORT_REASONS).toEqual(['spam', 'offensive', 'harassment', 'other']);
    expect(parseReportReason({ reason: 'image_misuse' })).toBeUndefined();
  });

  it.each([
    [undefined, null],
    [null, null],
    [{}, null],
    [{ reason: null }, null],
    [{ reason: 'spam' }, 'spam'],
    [{ reason: 'image_misuse' }, 'image_misuse'],
    [{ reason: 'other' }, 'other'],
  ])('%j vale %s', (body, reason) => {
    expect(parseFanClubReportReason(body)).toBe(reason);
  });

  it.each([[{ reason: 'nudez' }], [{ reason: 2 }], ['image_misuse'], [[]]])(
    '%j é inválido (400)',
    (body) => {
      expect(parseFanClubReportReason(body)).toBeUndefined();
    },
  );

  it('a contagem por motivo da fila, com as seis chaves', () => {
    expect(emptyFanClubReasons()).toEqual({
      spam: 0,
      offensive: 0,
      harassment: 0,
      image_misuse: 0,
      other: 0,
      none: 0,
    });
    expect(fanClubReasonsOf({ image_misuse: 3, spam: -1, none: 'x' })).toMatchObject({
      image_misuse: 3,
      spam: 0,
      none: 0,
    });
    expect(fanClubReasonKey(null)).toBe('none');
    expect(fanClubReasonKey('image_misuse')).toBe('image_misuse');
    expect(storedFanClubReasonKey('chato')).toBe('none');
    expect(storedFanClubReasonKey('image_misuse')).toBe('image_misuse');
  });

  it('a própria publicação é own_post (400)', () => {
    expect(new ModerationError('own_post').message).toBe('A própria publicação não se denuncia.');
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
      // O perfil novo: os salvamentos do perfil e as trocas de nome (seção 28).
      profile: { key: 'profile_save', limit: 20 },
      name: { key: 'name_change', limit: 5 },
      // O fã-clube (seção 34, decisão 11): as candidaturas, as publicações e
      // as vagas de envio da foto delas.
      club_apply: { key: 'fanclub_apply', limit: 3 },
      club_post: { key: 'fanclub_post', limit: 5 },
      club_upload: { key: 'fanclub_upload', limit: 10 },
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

describe('denúncia de perfil (seção 29)', () => {
  it('uma denúncia por alvo e fã: o _ separa os dois uids sem ambiguidade', () => {
    expect(profileReportId('uidPromo', 'uidBia')).toBe('uidPromo_uidBia');
    // Uid não tem "_": o único "_" é o separador.
    expect(profileReportId('aB3dE9fGh1', 'Zz9').split('_')).toEqual(['aB3dE9fGh1', 'Zz9']);
  });

  it('o próprio perfil não se denuncia', () => {
    const error = new ModerationError('own_profile');
    expect(error.reason).toBe('own_profile');
    expect(error.message).toBe('O próprio perfil não se denuncia.');
  });
});

describe('cursor da lista de bloqueados (seção 29, decisão 8)', () => {
  it.each([
    ['0:uidA', { index: 0, uid: 'uidA' }],
    ['999:uidA', { index: 999, uid: 'uidA' }],
    ['42:Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd', { index: 42, uid: 'Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd' }],
  ])('%s vale', (text, cursor) => {
    expect(parseBlockCursor(text)).toEqual(cursor);
    expect(formatBlockCursor(cursor)).toBe(text);
  });

  it.each([
    ['-1:uidA'],
    ['1000:uidA'],
    ['1.000:uidA'],
    ['1.5:uidA'],
    ['01:uidA'],
    ['uidA'],
    ['3'],
    ['3:'],
    [':uidA'],
    ['3:uid-com-hifen'],
    ['3:uid_a'],
    ['3:' + 'a'.repeat(129)],
    ['3:uidA:outro'],
    [''],
  ])('%j é inválido (400)', (text) => {
    expect(parseBlockCursor(text)).toBeNull();
  });
});

describe('página da lista de bloqueados', () => {
  /** A lista na ordem da inclusão: f0 (o mais antigo) até o mais novo. */
  const list = (n: number) => Array.from({ length: n }, (_, index) => `f${index}`);

  it('do mais novo ao mais antigo, em páginas de 20, com o cursor do último da página', () => {
    expect(BLOCKED_PAGE_MAX).toBe(20);
    const first = blockedPage(list(45), null, BLOCKED_PAGE_MAX);
    expect(first.uids).toEqual(list(45).slice(25).reverse());
    expect(first.next).toEqual({ index: 25, uid: 'f25' });
    const second = blockedPage(list(45), first.next, BLOCKED_PAGE_MAX);
    expect(second.uids).toEqual(list(45).slice(5, 25).reverse());
    expect(second.next).toEqual({ index: 5, uid: 'f5' });
    const last = blockedPage(list(45), second.next, BLOCKED_PAGE_MAX);
    expect(last.uids).toEqual(['f4', 'f3', 'f2', 'f1', 'f0']);
    expect(last.next).toBeNull();
  });

  it('a página que chega ao índice 0 fecha com null', () => {
    expect(blockedPage(list(20), null, 20)).toEqual({ uids: list(20).reverse(), next: null });
    expect(blockedPage(list(3), null, 20)).toEqual({ uids: ['f2', 'f1', 'f0'], next: null });
  });

  it('a lista vazia', () => {
    expect(blockedPage([], null, 20)).toEqual({ uids: [], next: null });
    expect(blockedPage([], { index: 3, uid: 'f3' }, 20)).toEqual({ uids: [], next: null });
  });

  it('o cursor com o uid que saiu usa o índice guardado', () => {
    // f10 foi desbloqueado depois de a página que terminou nele ser lida.
    const after = list(30).filter((uid) => uid !== 'f10');
    expect(blockedPage(after, { index: 10, uid: 'f10' }, 20).uids).toEqual(list(10).reverse());
  });

  it('dois desbloqueios juntos, um deles o fã do cursor, não pulam ninguém', () => {
    const first = blockedPage(list(30), null, 20);
    expect(first.next).toEqual({ index: 10, uid: 'f10' });
    // Na própria tela, desbloqueia um já visto (f15) e o do cursor (f10).
    const after = list(30).filter((uid) => uid !== 'f15' && uid !== 'f10');
    expect(blockedPage(after, first.next, 20).uids).toEqual(list(10).reverse());
    // Só o já visto: o índice do fã do cursor muda, e o uid o acha.
    const onlySeen = list(30).filter((uid) => uid !== 'f15');
    expect(blockedPage(onlySeen, first.next, 20).uids).toEqual(list(10).reverse());
  });

  it('um bloqueio novo no fim (outro aparelho) não repete ninguém', () => {
    const first = blockedPage(list(30), null, 20);
    const second = blockedPage([...list(30), 'novo'], first.next, 20);
    expect(second.uids).toEqual(list(10).reverse());
    expect(new Set([...first.uids, ...second.uids]).size).toBe(30);
  });

  it('o índice guardado maior que a lista é limitado ao tamanho dela', () => {
    expect(blockedPage(list(5), { index: 900, uid: 'saiu' }, 20).uids).toEqual(list(5).reverse());
  });

  it('o limit menor que 20', () => {
    expect(blockedPage(list(5), null, 2)).toEqual({
      uids: ['f4', 'f3'],
      next: { index: 3, uid: 'f3' },
    });
  });
});
