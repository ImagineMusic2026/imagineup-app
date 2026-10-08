import { describe, expect, it } from 'vitest';

import {
  fanSearchKeys,
  normalizeSearch,
  sameSearchKeys,
  SEARCH_KEYS_MAX,
  searchWords,
} from './search';

// A busca de fãs por nome e @ (26.7): o texto normalizado como o painel
// normaliza e os começos de cada palavra.

describe('normalizeSearch', () => {
  it.each([
    ['Camila Ribeiro', 'camila ribeiro'],
    ['  JOÃO   da  Silva ', 'joao da silva'],
    ['Ana-Maria', 'ana maria'],
    ['camila_rib', 'camila rib'],
    ['Thalita 👩‍🎤 Souza!', 'thalita souza'],
    ['Ñandú Çedilha', 'nandu cedilha'],
    ['Øyvind', 'yvind'],
    ['Fa 12', 'fa 12'],
    ['', ''],
  ])('%j vira %j', (input, expected) => {
    expect(normalizeSearch(input)).toBe(expected);
  });

  it('a palavra de uma letra fica de fora das palavras', () => {
    expect(searchWords('Maria J. da Silva')).toEqual(['maria', 'da', 'silva']);
  });
});

describe('fanSearchKeys', () => {
  it('os começos de 2 letras em diante de cada palavra do @ e do nome, o @ primeiro', () => {
    expect(fanSearchKeys('Camila Ribeiro', 'camilarib')).toEqual([
      'ca',
      'cam',
      'cami',
      'camil',
      'camila',
      'camilar',
      'camilari',
      'camilarib',
      // "ca" a "camila" já entraram pelo @.
      'ri',
      'rib',
      'ribe',
      'ribei',
      'ribeir',
      'ribeiro',
    ]);
  });

  it('acento, maiúscula, hífen e emoji no nome', () => {
    expect(fanSearchKeys('JÔ-Ân 🎤', 'fa123456')).toEqual([
      'fa',
      'fa1',
      'fa12',
      'fa123',
      'fa1234',
      'fa12345',
      'fa123456',
      'jo',
      'an',
    ]);
  });

  it('o @ com número e _ vira palavras, e o @ do começo sai', () => {
    expect(fanSearchKeys(null, '@dj_k2')).toEqual(['dj', 'k2']);
  });

  it('palavra longa entra até 15 letras', () => {
    const keys = fanSearchKeys('Anticonstitucionalissimamente', 'x1');
    expect(keys.at(-1)).toBe('anticonstitucio');
    expect(keys.every((key) => key.length <= 15)).toBe(true);
    expect(keys).not.toContain('x1x');
    expect(keys[0]).toBe('x1');
  });

  it('sem nome nem @, nada', () => {
    expect(fanSearchKeys(null, null)).toEqual([]);
    expect(fanSearchKeys('🎤 !', undefined)).toEqual([]);
  });

  it('nunca passa de 120', () => {
    const name = Array.from(
      { length: 20 },
      (_, index) => `palavra${String.fromCharCode(97 + index)}xyzwqk`,
    ).join(' ');
    const keys = fanSearchKeys(name, 'superfa_da_central_oficial');
    expect(SEARCH_KEYS_MAX).toBe(120);
    expect(keys).toHaveLength(120);
    expect(new Set(keys).size).toBe(120);
    // O @ entra inteiro antes do corte.
    expect(keys.slice(0, 3)).toEqual(['su', 'sup', 'supe']);
  });
});

describe('sameSearchKeys', () => {
  it('compara na ordem', () => {
    expect(sameSearchKeys(['ca', 'cam'], ['ca', 'cam'])).toBe(true);
    expect(sameSearchKeys(['cam', 'ca'], ['ca', 'cam'])).toBe(false);
    expect(sameSearchKeys(undefined, [])).toBe(false);
    expect(sameSearchKeys([], [])).toBe(true);
  });
});
