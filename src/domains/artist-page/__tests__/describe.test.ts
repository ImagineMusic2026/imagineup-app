import type { Post } from '@/domains/posts';

import { compactHeaderHeight, coverButtonsTop, coverHeight } from '../consts';
import {
  artistHeadingLabel,
  compactSpoken,
  postCellLabel,
  splitCoverName,
  statLabel,
  statValue,
} from '../describe';

// Relógio fixo: terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const HOUR_MS = 60 * 60 * 1000;

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p-1',
    kind: 'photo',
    artist: { id: 'nettobrito', name: 'Netto Brito', verified: true, photoURL: null },
    text: 'Obrigado, Feira de Santana!',
    media: { url: null, thumbnailUrl: null, width: null, height: null },
    event: null,
    createdAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString(),
    likeCount: 10,
    commentCount: 2,
    likedByMe: false,
    sharePointsPerVisit: 2,
    ...overrides,
  };
}

describe('números da central', () => {
  it.each([
    [412_000, '412 mil', false],
    [8_400_000, '8,4 milhões', true],
    [1_000_000, '1 milhão', true],
    [2_300_000_000, '2,3 bilhões', true],
    [1_000_000_000, '1 bilhão', true],
    [1_284, '1,3 mil', false],
    [950, '950', false],
  ])('%d por extenso é "%s"', (value, amount, of) => {
    expect(compactSpoken(value)).toEqual({ amount, of });
  });

  it.each([
    ['fans', 412_000, '412 mil fãs'],
    ['fans', 1_000_000, '1 milhão de fãs'],
    ['fans', 1, '1 fã'],
    ['posts', 1_284, '1.284 posts'],
    ['posts', 1, '1 post'],
    ['points', 8_400_000, '8,4 milhões de pontos da central'],
    ['points', 96_000, '96 mil pontos da central'],
  ] as const)('o leitor ouve a coluna %s de %d como "%s"', (stat, value, label) => {
    expect(statLabel(stat, value)).toBe(label);
  });

  it('a tela mostra os fãs e os pontos compactos e os posts inteiros, como no protótipo', () => {
    expect(statValue('fans', 412_000)).toBe('412 mil');
    expect(statValue('posts', 1_284)).toBe('1.284');
    expect(statValue('points', 8_400_000)).toBe('8,4 mi');
  });
});

describe('nome da capa', () => {
  it.each([
    ['Netto Brito', 'Netto\nBrito'],
    ['Nenho', 'Nenho'],
    ['Juninho Moraes Filho', 'Juninho\nMoraes Filho'],
    ['  Rock Salles ', 'Rock\nSalles'],
  ])('"%s" quebra no primeiro espaço', (name, shown) => {
    expect(splitCoverName(name)).toBe(shown);
  });

  it('o título lido junta o selo e a gestão oficial', () => {
    expect(
      artistHeadingLabel({ name: 'Netto Brito', verified: true, managedByImagine: true }),
    ).toBe('Netto Brito, artista verificado, gestão oficial Imagine');
    expect(
      artistHeadingLabel({ name: 'Artista 5', verified: false, managedByImagine: false }),
    ).toBe('Artista 5');
  });
});

describe('célula da grade', () => {
  it.each([
    ['photo', 'Post de Netto Brito, há 2 horas: Obrigado, Feira de Santana!'],
    ['video', 'Vídeo de Netto Brito, há 2 horas: Obrigado, Feira de Santana!'],
    ['event', 'Show de Netto Brito, há 2 horas: Obrigado, Feira de Santana!'],
    ['text', 'Post de Netto Brito, há 2 horas: Obrigado, Feira de Santana!'],
  ] as const)('post de %s é lido com o autor, a hora e o texto', (kind, label) => {
    expect(postCellLabel(post({ kind }), NOW)).toBe(label);
  });
});

describe('medidas da capa e do header compacto', () => {
  it('com ilha ou entalhe, os botões sobem 8 para dentro da área segura, como no protótipo', () => {
    expect(coverButtonsTop(62)).toBe(54);
    expect(compactHeaderHeight(62)).toBe(100);
    expect(coverHeight(62)).toBe(296);
  });

  it('sem entalhe, os botões ficam 4 abaixo da barra de status', () => {
    expect(coverButtonsTop(24)).toBe(28);
    expect(compactHeaderHeight(24)).toBe(74);
  });
});
