import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';

import { MIN_ARTISTS } from '../consts';
import {
  continueLabel,
  filterArtists,
  missingArtists,
  sortByOrder,
  splitFeatured,
} from '../selection';

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

describe('grade da escolha de artistas', () => {
  it('os primeiros pela ordem de destaque vão para a grade, o resto para o "+N"', () => {
    const { featured, rest } = splitFeatured(artists, 4);
    expect(featured.map((item) => item.id)).toEqual(['netto', 'nenho', 'juninho', 'rock']);
    expect(rest.map((item) => item.id)).toEqual(['a5', 'angela']);
  });

  it('com poucos artistas, todos vão para a grade', () => {
    const { featured, rest } = splitFeatured(artists.slice(0, 2), 4);
    expect(featured).toHaveLength(2);
    expect(rest).toEqual([]);
  });

  it('ordenar não mexe na lista que veio do cache', () => {
    const original = [...artists];
    sortByOrder(artists);
    expect(artists).toEqual(original);
  });
});

describe('mínimo de artistas', () => {
  it(`o mínimo aprovado é ${MIN_ARTISTS}`, () => {
    expect(MIN_ARTISTS).toBe(3);
  });

  it.each([
    [0, 3],
    [1, 2],
    [2, 1],
    [3, 0],
    [7, 0],
  ])('com %i escolhidos, faltam %i', (selected, missing) => {
    expect(missingArtists(selected)).toBe(missing);
  });

  it.each([
    [0, 'Escolha mais 3 artistas'],
    [1, 'Escolha mais 2 artistas'],
    [2, 'Escolha mais 1 artista'],
    [3, 'Continuar com 3 artistas'],
    [5, 'Continuar com 5 artistas'],
  ])('com %i escolhidos, o botão diz "%s"', (selected, label) => {
    expect(continueLabel(selected)).toBe(label);
  });

  it('os rótulos vêm das traduções', () => {
    expect(continueLabel(2)).toBe(t('onboarding.chooseArtists.needMoreOne'));
    expect(continueLabel(0)).toBe(t('onboarding.chooseArtists.needMore', { count: 3 }));
    expect(continueLabel(4)).toBe(t('onboarding.chooseArtists.continue', { count: 4 }));
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
