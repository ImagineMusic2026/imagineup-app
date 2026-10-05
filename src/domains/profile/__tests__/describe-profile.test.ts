import type { FanCentral } from '@/domains/artists';

import {
  achievementLabel,
  centralLabel,
  centralMeta,
  heroLabel,
  levelBadgeText,
  levelFraction,
  nextLevelCaption,
  nextLevelSpoken,
  pointsCardLabel,
  pointsToNextLevel,
  profileMeta,
  statLabel,
  weekEarnedText,
} from '../describe-profile';
import type { Achievement, MyProgress } from '../types';

const PURAINHA = { number: 7, name: 'Purainha', minXp: 7_000 };
const XODO = { number: 8, name: 'Xodó', minXp: 15_000 };

function progress(overrides: Partial<MyProgress> = {}): MyProgress {
  return {
    xp: 12_480,
    level: PURAINHA,
    nextLevel: XODO,
    weekEarned: 840,
    stats: { linksCreated: 63, peopleBrought: 418, seasons: 3 },
    ...overrides,
  };
}

const NETTO: FanCentral = {
  artistId: 'nettobrito',
  name: 'Netto Brito',
  shortName: null,
  photoURL: null,
  fanCount: 412_000,
  fanRank: 12,
  seasonPoints: 4_120,
};

describe('progresso do nível', () => {
  it('a barra e o anel do protótipo: 12.480 de XP entre 7.000 e 15.000 dá 68,5%', () => {
    expect(levelFraction(progress())).toBeCloseTo(0.685);
    expect(pointsToNextLevel(progress())).toBe(2_520);
  });

  it.each([
    ['no começo do nível', 7_000, 0],
    ['a um ponto do próximo', 14_999, 7_999 / 8_000],
    ['passou do próximo (resposta atrasada)', 16_000, 1],
    ['abaixo do mínimo (régua trocada no painel)', 6_000, 0],
  ])('%s, a fração fica entre 0 e 1', (_when, xp, fraction) => {
    expect(levelFraction(progress({ xp }))).toBeCloseTo(fraction);
  });

  it('no nível máximo, a barra fica cheia e não falta nada', () => {
    const max = progress({ level: XODO, nextLevel: null, xp: 20_000 });
    expect(levelFraction(max)).toBe(1);
    expect(pointsToNextLevel(max)).toBeNull();
    expect(nextLevelCaption(max)).toEqual({ text: 'Você chegou ao nível máximo' });
    expect(nextLevelSpoken(max)).toBe('Você chegou ao nível máximo');
  });

  it('a legenda sai em três pedaços, com os pontos em negrito no meio', () => {
    expect(nextLevelCaption(progress())).toEqual({
      before: 'Faltam ',
      amount: '2.520 pts',
      after: ' para o nível 8 · Xodó',
    });
    expect(nextLevelSpoken(progress())).toBe('Faltam 2.520 pontos para o nível 8, Xodó');
  });

  it('falta 1 ponto no singular', () => {
    const one = progress({ xp: 14_999 });
    expect(nextLevelCaption(one)).toEqual({
      before: 'Falta ',
      amount: '1 pt',
      after: ' para o nível 8 · Xodó',
    });
    expect(nextLevelSpoken(one)).toBe('Falta 1 ponto para o nível 8, Xodó');
  });

  it('o selo diz o número e o nome do nível', () => {
    expect(levelBadgeText(PURAINHA)).toBe('Nível 7 · Purainha');
  });
});

describe('card de pontos', () => {
  it('um elemento só para o leitor: saldo, semana e o que falta', () => {
    expect(pointsCardLabel(12_480, progress())).toBe(
      'Seus pontos: 12.480. Esta semana: mais 840. Faltam 2.520 pontos para o nível 8, Xodó.',
    );
  });

  it('o saldo que caiu no resgate não mexe no que falta para o nível', () => {
    expect(pointsCardLabel(3_980, progress())).toBe(
      'Seus pontos: 3.980. Esta semana: mais 840. Faltam 2.520 pontos para o nível 8, Xodó.',
    );
  });

  it('semana sem ganhos mostra 0, sem o sinal', () => {
    expect(weekEarnedText(840)).toBe('+840');
    expect(weekEarnedText(1_250)).toBe('+1.250');
    expect(weekEarnedText(0)).toBe('0');
    expect(pointsCardLabel(100, progress({ weekEarned: 0 }))).toContain('Esta semana: 0.');
  });
});

describe('hero', () => {
  it('@ e cidade numa linha só, com o que o perfil tiver', () => {
    expect(profileMeta('camilarib', 'Feira de Santana, BA')).toBe(
      '@camilarib · Feira de Santana, BA',
    );
    expect(profileMeta('camilarib', null)).toBe('@camilarib');
    expect(profileMeta(null, 'Irará, BA')).toBe('Irará, BA');
    expect(profileMeta(null, null)).toBeNull();
  });

  it('o leitor ouve nome, @, cidade e nível numa frase', () => {
    expect(
      heroLabel({
        name: 'Camila Ribeiro',
        username: 'camilarib',
        city: 'Feira de Santana, BA',
        level: PURAINHA,
      }),
    ).toBe('Camila Ribeiro, @camilarib, Feira de Santana, BA. Nível 7, Purainha.');
    expect(heroLabel({ name: 'Camila Ribeiro', username: null, city: null, level: null })).toBe(
      'Camila Ribeiro.',
    );
  });
});

describe('números do fã', () => {
  it.each([
    ['linksCreated', 63, 'links criados'],
    ['linksCreated', 1, 'link criado'],
    ['peopleBrought', 418, 'pessoas trazidas'],
    ['peopleBrought', 1, 'pessoa trazida'],
    ['seasons', 3, 'temporadas'],
    ['seasons', 1, 'temporada'],
    ['seasons', 0, 'temporadas'],
  ] as const)('%s com %s: "%s"', (kind, value, label) => {
    expect(statLabel(kind, value)).toBe(label);
  });
});

describe('conquistas', () => {
  const base: Achievement = {
    id: 'boca-a-boca',
    title: 'Boca a boca',
    icon: 'share',
    tone: 'action',
    unlockedAt: '2026-09-27T12:00:00.000Z',
  };

  it('o leitor ouve o nome e se está conquistada', () => {
    expect(achievementLabel(base)).toBe('Boca a boca, conquistada');
    expect(achievementLabel({ ...base, title: 'Backstage', unlockedAt: null })).toBe(
      'Backstage, bloqueada',
    );
  });
});

describe('centrais do fã', () => {
  it('posição entre os fãs da central e os pontos da temporada', () => {
    expect(centralMeta(NETTO)).toBe('#12 entre 412 mil fãs');
    expect(centralLabel(NETTO)).toBe(
      'Netto Brito, 12º lugar entre 412 mil fãs, 4.120 pontos na temporada.',
    );
  });

  it('sem posição, diz que ainda não pontuou ali', () => {
    const juninho: FanCentral = {
      ...NETTO,
      artistId: 'juninhomoraes',
      name: 'Juninho Moraes',
      fanCount: 141_000,
      fanRank: null,
      seasonPoints: 0,
    };
    expect(centralMeta(juninho)).toBe('Sem posição ainda · 141 mil fãs');
    expect(centralLabel(juninho)).toBe('Juninho Moraes, ainda sem posição, entre 141 mil fãs.');
  });

  it('central com 1 fã no singular, e sem posição com pontos diz os pontos', () => {
    const alone: FanCentral = { ...NETTO, fanCount: 1, fanRank: null, seasonPoints: 0 };
    expect(centralMeta(alone)).toBe('Sem posição ainda · 1 fã');
    expect(centralLabel(alone)).toBe('Netto Brito, ainda sem posição, 1 fã.');
    expect(centralLabel({ ...alone, seasonPoints: 4_120 })).toBe(
      'Netto Brito, ainda sem posição, 1 fã, 4.120 pontos na temporada.',
    );
    expect(centralLabel({ ...alone, fanCount: 2, seasonPoints: 4_120 })).toBe(
      'Netto Brito, ainda sem posição, entre 2 fãs, 4.120 pontos na temporada.',
    );
  });
});
