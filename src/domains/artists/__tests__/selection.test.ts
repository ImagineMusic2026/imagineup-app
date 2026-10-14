import { artistCardLabel, fansText, filterArtists, sortByOrder } from '../selection';
import type { Artist } from '../types';

const artist = (id: string, name: string, order: number): Artist => ({
  id,
  name,
  photoURL: null,
  fanCount: 1_000,
  order,
});

const artists = [
  artist('rock', 'Rock Salles', 3),
  artist('netto', 'Netto Brito', 0),
  artist('a5', 'Artista 5', 4),
  artist('nenho', 'Nenho', 1),
  artist('angela', 'Ângela Maria', 5),
  artist('juninho', 'Juninho Moraes', 2),
];

describe('ordem de destaque', () => {
  it('ordena pelo `order` da API', () => {
    expect(sortByOrder(artists).map((item) => item.id)).toEqual([
      'netto',
      'nenho',
      'juninho',
      'rock',
      'a5',
      'angela',
    ]);
  });

  it('ordenar não mexe na lista que veio do cache', () => {
    const original = [...artists];
    sortByOrder(artists);
    expect(artists).toEqual(original);
  });
});

describe('busca por nome', () => {
  it.each([
    ['netto', ['netto']],
    ['NENHO', ['nenho']],
    ['angela', ['angela']],
    ['ângela', ['angela']],
    ['juninho mor', ['juninho']],
    ['artista', ['a5']],
    ['o', ['rock', 'netto', 'nenho', 'juninho']],
    ['xyz', []],
    ['', ['rock', 'netto', 'a5', 'nenho', 'angela', 'juninho']],
  ])('"%s" encontra %j', (query, ids) => {
    expect(filterArtists(artists, query).map((item) => item.id)).toEqual(ids);
  });
});

describe('fãs no card', () => {
  it('"1 fã" no singular, o resto abreviado', () => {
    expect(fansText(1)).toBe('1 fã');
    expect(fansText(0)).toBe('0 fãs');
    expect(fansText(412_000)).toBe('412 mil fãs');
    expect(artistCardLabel({ name: 'Nenho', fanCount: 1 })).toBe('Nenho, 1 fã');
    expect(artistCardLabel({ name: 'Netto Brito', fanCount: 412_000 })).toBe(
      'Netto Brito, 412 mil fãs',
    );
  });
});
