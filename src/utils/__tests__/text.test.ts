import { initialsOf, matchesSearch, searchKey } from '../text';

describe('iniciais do avatar sem foto', () => {
  it.each([
    ['Davi Lima', 'DL'],
    ['Maria Clara Souza', 'MS'],
    ['Thalita S.', 'TS'],
    ['Nenho', 'NE'],
    ['nenho', 'NE'],
    ['A', 'A'],
    ["D'Ávila", 'DÁ'],
    ['  camila   ribeiro ', 'CR'],
    ['ângela maria', 'ÂM'],
    ['👩‍🎤 Ana', 'AN'],
    ['Ana 👩‍🎤', 'AN'],
    ['Ana 👩‍🎤 Lima', 'AL'],
    ['', ''],
    ['   ', ''],
  ])('"%s" vira "%s"', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it('junta o acento separado antes de pegar a letra', () => {
    expect(initialsOf('Álvaro Neto')).toBe('ÁN');
  });
});

describe('busca sem acento e sem maiúscula', () => {
  it.each([
    ['São João', 'sao joao'],
    ['  JUNINHO   Moraes ', 'juninho moraes'],
    ['Ângela', 'angela'],
    ['Açaí', 'acai'],
    ['', ''],
  ])('"%s" compara como "%s"', (text, expected) => {
    expect(searchKey(text)).toBe(expected);
  });

  it.each([
    ['Netto Brito', 'netto', true],
    ['Netto Brito', 'BRITO', true],
    ['Juninho Moraes', 'juninho  mor', true],
    ['Ângela Maria', 'angela', true],
    ['Angela Maria', 'Ângela', true],
    ['Nenho', 'rock', false],
    ['Nenho', '', true],
    ['Nenho', '   ', true],
  ])('"%s" com a busca "%s" casa: %s', (text, query, expected) => {
    expect(matchesSearch(text, query)).toBe(expected);
  });
});
