import { initialsOf } from '../text';

describe('iniciais do avatar sem foto', () => {
  it.each([
    ['Davi Lima', 'DL'],
    ['Maria Clara Souza', 'MS'],
    ['Thalita S.', 'TS'],
    ['Nenho', 'N'],
    ['  camila   ribeiro ', 'CR'],
    ['ângela maria', 'ÂM'],
    ['👩‍🎤 Ana', 'A'],
    ['Ana 👩‍🎤', 'A'],
    ['', ''],
    ['   ', ''],
  ])('"%s" vira "%s"', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  it('junta o acento separado antes de pegar a letra', () => {
    expect(initialsOf('Álvaro Neto')).toBe('ÁN');
  });
});
