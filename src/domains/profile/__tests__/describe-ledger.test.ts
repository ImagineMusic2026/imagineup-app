import {
  buildLedgerItems,
  isLedgerGain,
  isVisibleLedgerEntry,
  ledgerContext,
  ledgerDayLabel,
  ledgerMeta,
  ledgerRowLabel,
  ledgerSource,
  ledgerValueText,
} from '../describe-ledger';
import type { LedgerEntry } from '../types';

// Terça, 29 de setembro de 2026, 20 h, no fuso do aparelho.
const NOW = new Date(2026, 8, 29, 20, 0);

const at = (daysAgo: number, hours: number, minutes = 0): string =>
  new Date(2026, 8, 29 - daysAgo, hours, minutes).toISOString();

function entry(id: string, fields: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id,
    kind: 'earn',
    source: 'like',
    points: 10,
    xpDelta: 10,
    seasonDelta: 10,
    artistId: 'nenho',
    centralSeasonDelta: 10,
    centralTotalDelta: 10,
    subject: null,
    createdAt: at(0, 19, 30),
    artistName: 'Nenho',
    subjectTitle: null,
    ...fields,
  };
}

describe('linha do extrato', () => {
  it.each([
    ['like', 'Curtida'],
    ['comment', 'Comentário'],
    ['rsvp', 'Presença em show'],
    ['central_join', 'Entrada na central'],
    ['mission', 'Missão concluída'],
    ['invite_visit', 'Visita pelo seu link'],
    ['invite_signup', 'Cadastro pelo seu link'],
    ['redeem', 'Resgate'],
    ['redeem_refund', 'Resgate devolvido'],
    ['adjustment', 'Ajuste da equipe'],
    ['seed', 'Ajuste'],
    ['bonus_de_amanha', 'Pontos'],
  ])('a origem %s vira "%s" (a desconhecida cai em "Pontos")', (source, title) => {
    expect(ledgerRowLabel(entry('x', { source }), NOW)).toMatch(new RegExp(`^${title},`));
    expect(ledgerSource({ source }).title).toMatch(/^ledger\.sources\./);
  });

  it('o contexto é a central nas ações e o título na missão; o convite não tem', () => {
    expect(ledgerContext(entry('like:p'))).toBe('Nenho');
    expect(
      ledgerContext(
        entry('mission:m', { source: 'mission', subjectTitle: 'Curta 5 posts do Nenho' }),
      ),
    ).toBe('Curta 5 posts do Nenho');
    expect(ledgerContext(entry('invite_signup:k', { source: 'invite_signup' }))).toBeNull();
    // Central apagada: o nome vem null, e a linha fica só com a hora.
    const gone = entry('like:q', { artistName: null });
    expect(ledgerContext(gone)).toBeNull();
    expect(ledgerMeta(gone)).toBe('19:30');
    expect(ledgerMeta(entry('like:p'))).toBe('Nenho · 19:30');
  });

  it('ganho em lima com "+"; resgate com "-" e "menos" para o leitor', () => {
    const redeem = entry('redeem:r', {
      kind: 'spend',
      source: 'redeem',
      points: -1_000,
      xpDelta: 0,
      seasonDelta: 0,
      artistName: null,
      createdAt: at(1, 9, 5),
    });
    expect(ledgerValueText(entry('like:p'))).toBe('+10');
    expect(isLedgerGain(entry('like:p'))).toBe(true);
    expect(ledgerValueText(redeem)).toBe('-1.000');
    expect(isLedgerGain(redeem)).toBe(false);
    expect(ledgerRowLabel(redeem, NOW)).toBe('Resgate, menos 1.000 pontos, ontem às 09:05.');
    expect(ledgerRowLabel(entry('like:p', { points: 1, xpDelta: 1 }), NOW)).toBe(
      'Curtida, Nenho, mais 1 ponto, hoje às 19:30.',
    );
  });

  it('o resgate e a devolução levam o título da recompensa; a devolução sobe em lima (bloco 10)', () => {
    const shop = { xpDelta: 0, seasonDelta: 0, artistId: null, artistName: null } as const;
    const redeem = entry('redeem:UP-C3NWPB', {
      ...shop,
      kind: 'spend',
      source: 'redeem',
      points: -15_000,
      subject: { type: 'reward', id: 'camisa' },
      subjectTitle: 'Camisa oficial',
      createdAt: at(2, 18),
    });
    const refund = entry('redeem_refund:UP-9FJT6V', {
      ...shop,
      kind: 'refund',
      source: 'redeem_refund',
      points: 8_500,
      subject: { type: 'reward', id: 'videochamada' },
      subjectTitle: 'Videochamada',
      createdAt: at(5, 18),
    });
    expect(ledgerMeta(redeem)).toBe('Camisa oficial · 18:00');
    expect(ledgerRowLabel(redeem, NOW)).toBe(
      'Resgate, Camisa oficial, menos 15.000 pontos, em 27 de setembro às 18:00.',
    );
    expect(isLedgerGain(redeem)).toBe(false);
    expect(ledgerValueText(refund)).toBe('+8.500');
    expect(isLedgerGain(refund)).toBe(true);
    expect(ledgerSource(refund).tone).toBe('points');
    expect(ledgerRowLabel(refund, NOW)).toBe(
      'Resgate devolvido, Videochamada, mais 8.500 pontos, em 24 de setembro às 18:00.',
    );
    // O resgate antigo, sem título guardado, fica só com a hora.
    expect(ledgerContext(entry('redeem:r', { ...redeem, subjectTitle: null }))).toBeNull();
  });

  it('o ajuste sem saldo mostra o XP ou a temporada; o só de central fica de fora', () => {
    const seasonOnly = entry('adjustment:a', {
      kind: 'adjust',
      source: 'adjustment',
      points: 0,
      xpDelta: 0,
      seasonDelta: -50,
      artistName: null,
    });
    expect(isVisibleLedgerEntry(seasonOnly)).toBe(true);
    expect(ledgerValueText(seasonOnly)).toBe('-50');
    const centralOnly = entry('seed:c', {
      kind: 'adjust',
      source: 'seed',
      points: 0,
      xpDelta: 0,
      seasonDelta: 0,
    });
    expect(isVisibleLedgerEntry(centralOnly)).toBe(false);
  });

  it('o dia é "Hoje", "Ontem" ou o dia da semana curto, e a data por extenso vai ao leitor', () => {
    expect(ledgerDayLabel(at(0, 0, 1), NOW)).toBe('Hoje');
    expect(ledgerDayLabel(at(1, 23, 59), NOW)).toBe('Ontem');
    expect(ledgerDayLabel(at(2, 12), NOW)).toBe('dom., 27 set');
    expect(ledgerRowLabel(entry('like:p', { createdAt: at(2, 12) }), NOW)).toBe(
      'Curtida, Nenho, mais 10 pontos, em 27 de setembro às 12:00.',
    );
  });
});

describe('lista do extrato', () => {
  it('uma sobrelinha a cada dia novo, sem as linhas escondidas', () => {
    const items = buildLedgerItems(
      [
        entry('like:a'),
        entry('like:b', { createdAt: at(0, 9) }),
        entry('seed:c', { points: 0, xpDelta: 0, seasonDelta: 0, createdAt: at(1, 12) }),
        entry('comment:d', { source: 'comment', createdAt: at(1, 8) }),
        entry('mission:e', { source: 'mission', createdAt: at(6, 12) }),
      ],
      NOW,
    );
    expect(items.map((item) => (item.type === 'day' ? item.label : item.key))).toEqual([
      'Hoje',
      'like:a',
      'like:b',
      'Ontem',
      'comment:d',
      'qua., 23 set',
      'mission:e',
    ]);
    expect(buildLedgerItems([], NOW)).toEqual([]);
  });
});
