/**
 * Espelho de visibleLine() do firestore.rules. O Admin SDK passa por cima das
 * regras, então o que o servidor grava a partir de dados do cadastro (o nome
 * que chega do Auth) passa aqui pela mesma validação que o celular enfrenta.
 * Mudou lá, mude aqui, e nos testes dos dois lados.
 *
 * As listas explícitas existem porque o motor de regras usa tabelas antigas do
 * Unicode. O JavaScript conhece os caracteres novos, mas as listas ficam iguais
 * para as duas validações concordarem.
 */

// Caracteres que o aparelho desenha em branco (invisíveis, Hangul e Braille vazios).
const BLANK_CHARS =
  '\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u180F\\u2065-\\u2069\\u2800\\u3164\\uFFA0\\uFFF0-\\uFFF8\\u{13430}-\\u{1343F}\\u{16FE4}\\u{1BCA0}-\\u{1BCA3}\\u{1D159}\\u{E0000}-\\u{E0FFF}';

// Marcas combinantes (acentos), com os blocos que o motor de regras não conhece.
const MARK_CHARS =
  '\\p{M}\\u0300-\\u036F\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F';

const LINE = new RegExp(
  `^[^\\s\\p{Z}\\p{C}${MARK_CHARS}](?:(?:[^\\p{C}\\p{Zl}\\p{Zp}]|\\u200D)*[^\\s\\p{Z}\\p{C}])?$`,
  'u',
);
const BLANK = new RegExp(`[${BLANK_CHARS}]`, 'u');
const STACKED_MARKS = new RegExp(`[${MARK_CHARS}]{4,}`, 'u');
// O ZWJ (U+200D) só vale entre emoji, como na cantora ou no coração em chamas.
const LOOSE_ZWJ = new RegExp(
  '[^\\p{So}\\p{Sk}\\uFE0F\\u{1F000}-\\u{1FAFF}]\\u200D|\\u200D[^\\p{So}\\u2190-\\u21FF\\u{1F000}-\\u{1FAFF}]',
  'u',
);

/**
 * Uma linha de texto visível: não começa por acento solto, sem espaço nas
 * pontas, sem controle, quebra de linha ou caractere em branco, sem mais de 3
 * acentos seguidos e com o ZWJ só entre emoji.
 */
export function isVisibleLine(text: string): boolean {
  return LINE.test(text) && !BLANK.test(text) && !STACKED_MARKS.test(text) && !LOOSE_ZWJ.test(text);
}
