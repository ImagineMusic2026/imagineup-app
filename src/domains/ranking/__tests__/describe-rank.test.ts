import {
  describeChange,
  describeMyRank,
  describeMyRankStatus,
  describePodium,
  describeRow,
  describeSeason,
  entryName,
  isSeasonOver,
} from '../describe-rank';
import type { LeaderboardEntry, MyRank, Season } from '../types';

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: 'temporada-sao-joao',
    name: 'São João',
    startsAt: new Date(2026, 8, 1).toISOString(),
    endsAt: new Date(2026, 9, 11, 20, 0).toISOString(),
    status: 'active',
    leaderTitle: null,
    ...overrides,
  };
}

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    position: 4,
    userId: 'fa-maria-clara',
    displayName: 'Maria Clara Souza',
    photoURL: null,
    city: 'Salvador, BA',
    points: 6_844,
    change: 3,
    isMe: false,
    ...overrides,
  };
}

describe('linha da temporada', () => {
  it.each([
    ['daqui a 12 dias', new Date(2026, 9, 11, 20, 0), 'Temporada de São João · encerra em 12 dias'],
    ['amanhã cedo', new Date(2026, 8, 30, 8, 0), 'Temporada de São João · encerra amanhã'],
    ['hoje à noite', new Date(2026, 8, 29, 23, 0), 'Temporada de São João · encerra hoje'],
    ['uma hora atrás', new Date(2026, 8, 29, 19, 0), 'Temporada de São João encerrada'],
  ])('com o fim %s', (_when, endsAt, expected) => {
    expect(describeSeason(season({ endsAt: endsAt.toISOString() }), NOW)).toBe(expected);
  });

  it('encerrada pelo servidor, mesmo antes do prazo', () => {
    const ended = season({ status: 'ended' });
    expect(isSeasonOver(ended, NOW)).toBe(true);
    expect(describeSeason(ended, NOW)).toBe('Temporada de São João encerrada');
  });

  it('sem temporada em andamento', () => {
    expect(describeSeason(null, NOW)).toBe('Nenhuma temporada em andamento');
  });
});

describe('variação de posição', () => {
  it.each([
    [3, 'subiu 3 posições'],
    [1, 'subiu 1 posição'],
    [-1, 'caiu 1 posição'],
    [-4, 'caiu 4 posições'],
    [0, ''],
  ])('%i vira "%s"', (change, expected) => {
    expect(describeChange(change)).toBe(expected);
  });
});

describe('rótulos das posições', () => {
  it('a linha diz posição, nome, cidade, pontos e variação', () => {
    expect(describeRow(entry(), 'Maria Clara Souza')).toBe(
      '4º, Maria Clara Souza, Salvador, BA, 6.844 pontos, subiu 3 posições',
    );
  });

  it('sem cidade e sem variação, as partes somem', () => {
    expect(describeRow(entry({ city: null, change: 0, position: 10 }), 'Júlia Ramos')).toBe(
      '10º, Júlia Ramos, 6.844 pontos',
    );
  });

  it('sem nome visível, a linha diz "Fã"', () => {
    expect(entryName(entry({ displayName: null }))).toBe('Fã');
  });

  it('o pódio diz o lugar e, no 1º, o título', () => {
    const first = entry({ position: 1, points: 9_140 });
    expect(describePodium(1, first, 'Thalita S.', 'Líder da temporada')).toBe(
      '1º lugar, Thalita S., 9.140 pontos, Líder da temporada',
    );
    expect(describePodium(2, entry({ position: 2, points: 7_902 }), 'Davi L.', null)).toBe(
      '2º lugar, Davi L., 7.902 pontos',
    );
    expect(describePodium(3, null, '', null)).toBe('3º lugar, vago');
  });
});

describe('card "Você" por situação', () => {
  const cases: [string, MyRank, boolean, string, string][] = [
    [
      'fora do top 10',
      { position: 12, points: 4_120, target: { kind: 'top', position: 10, pointsLeft: 840 } },
      false,
      '840 pts para entrar no top 10',
      'Você, 12º lugar, 4.120 pontos. Faltam 840 pontos para entrar no top 10.',
    ],
    [
      'no top 10, fora do pódio',
      { position: 7, points: 5_412, target: { kind: 'position', position: 6, pointsLeft: 518 } },
      false,
      '518 pts para o 6º lugar',
      'Você, 7º lugar, 5.412 pontos. Faltam 518 pontos para o 6º lugar.',
    ],
    [
      'a 1 ponto do de cima',
      { position: 5, points: 6_200, target: { kind: 'position', position: 4, pointsLeft: 1 } },
      false,
      '1 pt para o 4º lugar',
      'Você, 5º lugar, 6.200 pontos. Falta 1 ponto para o 4º lugar.',
    ],
    [
      'a 1 ponto do top 10',
      { position: 11, points: 4_959, target: { kind: 'top', position: 10, pointsLeft: 1 } },
      false,
      '1 pt para entrar no top 10',
      'Você, 11º lugar, 4.959 pontos. Falta 1 ponto para entrar no top 10.',
    ],
    [
      'no pódio',
      { position: 2, points: 7_902, target: { kind: 'position', position: 1, pointsLeft: 1_238 } },
      false,
      'No pódio da temporada',
      'Você, 2º lugar, 7.902 pontos. No pódio da temporada.',
    ],
    [
      'em 1º',
      { position: 1, points: 9_140, target: null },
      false,
      'No pódio da temporada',
      'Você, 1º lugar, 9.140 pontos. No pódio da temporada.',
    ],
    [
      'sem pontos',
      { position: null, points: 0, target: null },
      false,
      'Ganhe pontos para entrar no ranking',
      'Você. Ganhe pontos para entrar no ranking.',
    ],
    [
      'temporada encerrada',
      { position: 12, points: 4_120, target: null },
      true,
      'Terminou em 12º',
      'Você, 12º lugar, 4.120 pontos. Terminou em 12º.',
    ],
    [
      'temporada encerrada sem pontos',
      { position: null, points: 0, target: null },
      true,
      'Não pontuou nesta temporada',
      'Você. Não pontuou nesta temporada.',
    ],
    [
      'central de que o fã não é membro (bloco 8), com pontos de antes',
      { position: null, points: 750, target: null, member: false },
      false,
      'Entre na central para aparecer no ranking',
      'Você. Entre na central para aparecer no ranking.',
    ],
    [
      'membro da central sem pontos',
      { position: null, points: 0, target: null, member: true },
      false,
      'Ganhe pontos para entrar no ranking',
      'Você. Ganhe pontos para entrar no ranking.',
    ],
    [
      'temporada encerrada vem antes do member: sem posição, não chama para a central',
      { position: null, points: 750, target: null, member: false },
      true,
      'Não pontuou nesta temporada',
      'Você. Não pontuou nesta temporada.',
    ],
    [
      'temporada encerrada com um member velho no cache: o resultado, não o convite',
      { position: 12, points: 4_120, target: null, member: false },
      true,
      'Terminou em 12º',
      'Você, 12º lugar, 4.120 pontos. Terminou em 12º.',
    ],
  ];

  it.each(cases)('%s', (_situation, myRank, seasonOver, text, label) => {
    expect(describeMyRankStatus(myRank, seasonOver).text).toBe(text);
    expect(describeMyRank(myRank, seasonOver)).toBe(label);
  });
});
