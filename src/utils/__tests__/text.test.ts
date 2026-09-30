import { firstNameAndInitial, initialsOf, matchesSearch, searchKey } from '../text';

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

describe('nome curto do pódio', () => {
  it.each([
    ['Thalita Santos', 'Thalita S.'],
    ['Davi Lima', 'Davi L.'],
    ['Maria Clara Souza', 'Maria S.'],
    ['João da Silva', 'João S.'],
    ['Júlia Ávila', 'Júlia Á.'],
    ['Thalita S.', 'Thalita S.'],
    ['Nenho', 'Nenho'],
    ['  camila   ribeiro ', 'camila R.'],
    ["Ana D'Ávila", 'Ana D.'],
    ['👩‍🎤 Ana', 'Ana'],
    ['Ana 👩‍🎤', 'Ana'],
    ['Ana 👩‍🎤 Lima', 'Ana L.'],
    ['', ''],
    ['   ', ''],
  ])('"%s" vira "%s"', (name, expected) => {
    expect(firstNameAndInitial(name)).toBe(expected);
  });

  it('junta o acento separado antes de pegar a inicial', () => {
    // "A" e o acento agudo combinante (U+0301) em separado.
    expect(firstNameAndInitial(`Ana A${String.fromCharCode(0x301)}vila`)).toBe('Ana Á.');
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
