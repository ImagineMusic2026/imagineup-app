/**
 * Espelho de `visibleLine()` do `firestore.rules` (e de `functions/src/visible-line.ts`),
 * para o formulário recusar antes o que as regras e a função de cadastro
 * recusariam. Mudou lá, mude aqui, e nos testes dos três lados.
 *
 * As listas explícitas existem porque o motor de regras usa tabelas antigas do
 * Unicode. O JavaScript conhece os caracteres novos, mas as listas ficam iguais
 * para as validações concordarem.
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

// Isolantes bidi (U+2066 a U+2069): o teclado não digita, mas vêm em texto
// colado de outros apps, e a regra recusa.
const BIDI_ISOLATES = /[⁦-⁩]/g;

/**
 * Prepara um texto de uma linha digitado pelo fã (nome, cidade) para ser
 * validado e gravado: tira os isolantes bidi do texto colado, junta os acentos
 * (NFC, como a função de cadastro faz) e corta os espaços das pontas.
 */
export function cleanLine(text: string): string {
  return text.replace(BIDI_ISOLATES, '').normalize('NFC').trim();
}

/** Limite do nome no `firestore.rules` e na função de cadastro, em unidades de UTF-16. */
export const DISPLAY_NAME_MAX = 60;

/**
 * O nome como as regras deixam gravar no perfil (`validDisplayName()`): uma
 * linha visível de 1 a 60, em NFC e sem espaço nas pontas. O que não passa
 * vira `null`, como a função de cadastro deixaria.
 */
export function displayNameOrNull(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.normalize('NFC').trim();
  return trimmed.length <= DISPLAY_NAME_MAX && isVisibleLine(trimmed) ? trimmed : null;
}

/**
 * Prepara um texto de várias linhas digitado pelo fã (o comentário), nesta
 * ordem: tira os isolantes bidi colados; junta os acentos (NFC); troca `\r\n`
 * e `\r` por `\n`; tira os espaços das pontas de cada linha; junta as linhas
 * vazias seguidas numa e tira as das pontas. Espelho do `cleanMultiline` de
 * `functions/src/visible-line.ts`: mudou um, mude o outro e a tabela dos dois
 * testes (docs/arquitetura-api.md, 21.1, decisão 20).
 */
export function cleanMultiline(text: string): string {
  const lines: string[] = [];
  const normalized = text.replace(BIDI_ISOLATES, '').normalize('NFC').replace(/\r\n?/g, '\n');
  for (const raw of normalized.split('\n')) {
    const line = raw.trim();
    if (line === '' && (lines.length === 0 || lines.at(-1) === '')) continue;
    lines.push(line);
  }
  while (lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

/** Toda linha não vazia de um texto já limpo (`cleanMultiline`) é visível. */
export function isVisibleMultiline(text: string): boolean {
  return text.split('\n').every((line) => line === '' || isVisibleLine(line));
}
