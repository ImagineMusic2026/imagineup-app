import { describe, expect, it } from 'vitest';

import { isVisibleLine } from './visible-line';

// Casos em comum com tests/firestore-rules.test.ts, na raiz, mais um por item da lista de
// caracteres em branco: as duas validações precisam concordar.
describe('isVisibleLine', () => {
  it.each([
    'Camila Ribeiro 🎶',
    'Camila ❤\uFE0F',
    'Nº 1\uFE0F\u20E3',
    'Nguyễn Thị Ánh',
    'Nguyễn Thị Ánh'.normalize('NFD'),
    'प्रिया',
    'กิ่ง',
    'שָּׁלוֹם',
    'محمد',
    '张伟',
    "D'Ávila-Souza Jr.",
    'Camila \u{1F469}\u200D\u{1F3A4}',
    'Camila ❤\uFE0F\u200D\u{1F525}',
    'Camila \u{1F3F3}\uFE0F\u200D\u{1F308}',
    'Camila \u{1F64B}\u200D\u2640\uFE0F',
    'Camila \u{1F642}\u200D\u2194\uFE0F',
    '\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Silva',
  ])('aceita %s', (text) => {
    expect(isVisibleLine(text)).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['espaço', ' '],
    ['espaço na ponta', ' Camila'],
    ['espaço no fim', 'Camila '],
    ['quebra de linha', 'A\nB'],
    ['separador de linha', 'Camila\u2028Oficial'],
    ['largura zero', '\u200B'],
    ['Hangul em branco', '\u3164'],
    ['inversão bidi', '\u202Egpj.exe'],
    ['NUL', 'a\u0000b'],
    ['acento solto', '\u0301'],
    ['acento no início', '\u0301Camila'],
    ['invisível novo', '\u2065'],
    ['isolante bidi', 'A\u2067B'],
    ['tag', '\u{E0000}'],
    ['zalgo', 'a' + '\u0336'.repeat(59)],
    ['zalgo com acento novo', 'a' + '\u1DF6'.repeat(20)],
    ['ZWJ entre letras', 'A\u200DB'],
    ['ZWJ no fim', 'Camila\u200D'],
    ['ZWJ duplo', 'A\u200D\u200DB'],
    ['em branco U+034F', 'Camila \u034F Ribeiro'],
    ['em branco U+061C', 'Camila \u061C Ribeiro'],
    ['em branco U+115F', 'Camila \u115F Ribeiro'],
    ['em branco U+1160', 'Camila \u1160 Ribeiro'],
    ['em branco U+17B4', 'Camila \u17B4 Ribeiro'],
    ['em branco U+17B5', 'Camila \u17B5 Ribeiro'],
    ['em branco U+180E', 'Camila \u180E Ribeiro'],
    ['em branco U+180F', 'Camila \u180F Ribeiro'],
    ['em branco U+2065', 'Camila \u2065 Ribeiro'],
    ['em branco U+2066', 'Camila \u2066 Ribeiro'],
    ['em branco U+2069', 'Camila \u2069 Ribeiro'],
    ['em branco U+2800', 'Camila \u2800 Ribeiro'],
    ['em branco U+3164', 'Camila \u3164 Ribeiro'],
    ['em branco U+FFA0', 'Camila \uFFA0 Ribeiro'],
    ['em branco U+FFF0', 'Camila \uFFF0 Ribeiro'],
    ['em branco U+FFF8', 'Camila \uFFF8 Ribeiro'],
    ['em branco U+13430', 'Camila \u{13430} Ribeiro'],
    ['em branco U+1343F', 'Camila \u{1343F} Ribeiro'],
    ['em branco U+16FE4', 'Camila \u{16FE4} Ribeiro'],
    ['em branco U+1BCA0', 'Camila \u{1BCA0} Ribeiro'],
    ['em branco U+1BCA3', 'Camila \u{1BCA3} Ribeiro'],
    ['em branco U+1D159', 'Camila \u{1D159} Ribeiro'],
    ['em branco U+E0000', 'Camila \u{E0000} Ribeiro'],
    ['em branco U+E0FFF', 'Camila \u{E0FFF} Ribeiro'],
  ])('recusa %s', (_, text) => {
    expect(isVisibleLine(text)).toBe(false);
  });
});
