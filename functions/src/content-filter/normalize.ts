/**
 * Normalização do filtro do que o fã publica (docs/arquitetura-api.md, 30.3).
 * Serve só para comparar: o texto gravado continua o limpo de sempre (NFC), e
 * nada do que sai daqui é gravado, devolvido ou escrito no log.
 *
 * Os termos, as formas e as exceções passam pelos mesmos passos do texto
 * (o `scripts/content-filter-keys.mjs` usa este arquivo compilado). Mudou um
 * passo ou a ordem deles, suba a `FILTER_NORMALIZATION_VERSION` e gere as
 * chaves do `terms.ts` de novo: o teste recusa a versão velha.
 */

/**
 * A versão dos passos abaixo, copiada no `terms.ts` gerado. A 2 trata os
 * números das pontas como os símbolos, tira os símbolos do miolo numa versão a
 * mais e lê o 1 também como "l" (30.19, revisão do bloco).
 */
export const FILTER_NORMALIZATION_VERSION = 2;

/** Um pedaço normalizado: as versões dele, que batem se uma bater. */
export type FilterPiece = readonly string[];

/** Letras soltas juntadas (passo 5): os pedaços de `start` até `end`, sem o `end`. */
export type FilterRun = {
  readonly start: number;
  readonly end: number;
  readonly piece: FilterPiece;
};

export type FilterTokens = {
  /** Os pedaços do texto, na ordem. */
  readonly pieces: readonly FilterPiece[];
  /** Cada sequência de 3 ou mais pedaços de um caractere, junta: um pedaço a mais. */
  readonly runs: readonly FilterRun[];
};

// Passo 0: os espaços mais estreitos que o comum, que o NFKD troca pelo espaço
// comum. Saem antes dele, sem separar a palavra: o `isVisibleLine` os aceita,
// e um termo com um deles no meio aparece quase inteiro na tela.
const NARROW_SPACES = /[      ]/g;
const MARKS = /\p{M}/gu;

const pairs = (codePoints: readonly number[], targets: string): [string, string][] =>
  codePoints.map((codePoint, index) => [String.fromCodePoint(codePoint), targets.charAt(index)]);

const alphabet = (first: number): [string, string][] =>
  Array.from({ length: 26 }, (_, index) => [
    String.fromCodePoint(first + index),
    String.fromCharCode(97 + index),
  ]);

/**
 * Passo 2: as letras de outros alfabetos que se desenham como uma latina, com
 * o alvo pelo desenho. As maiúsculas vão escritas e entram antes das
 * minúsculas, porque a maiúscula grega muda de desenho ao baixar (Η é "h", e
 * η, "n"). Os pontos de código vão em número, para nenhum se passar por uma
 * letra latina no código. Nunca o `confusables` inteiro do UTS #39: ele junta
 * "rn" com "m" e "l" com "I", e criaria colisões.
 */
export const HOMOGLYPHS: ReadonlyMap<string, string> = new Map([
  // Cirílico: А В Е К М Н О Р С Т У Х Ѕ І Ј Һ Ԁ.
  ...pairs(
    [
      0x410, 0x412, 0x415, 0x41a, 0x41c, 0x41d, 0x41e, 0x420, 0x421, 0x422, 0x423, 0x425, 0x405,
      0x406, 0x408, 0x4ba, 0x500,
    ],
    'abekmhopctyxsijhd',
  ),
  // Cirílico: а в е к м н о р с т у х і ј ѕ һ ԁ.
  ...pairs(
    [
      0x430, 0x432, 0x435, 0x43a, 0x43c, 0x43d, 0x43e, 0x440, 0x441, 0x442, 0x443, 0x445, 0x456,
      0x458, 0x455, 0x4bb, 0x501,
    ],
    'abekmhopctyxijshd',
  ),
  // Grego: Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ e o sigma lunado Ϲ.
  ...pairs(
    [
      0x391, 0x392, 0x395, 0x396, 0x397, 0x399, 0x39a, 0x39c, 0x39d, 0x39f, 0x3a1, 0x3a4, 0x3a5,
      0x3a7, 0x3f9,
    ],
    'abezhikmnoptyxc',
  ),
  // Grego: α β ε η ι κ ν ο ρ τ υ χ, o sigma lunado ϲ e o ς, que é o ϲ depois do NFKD.
  ...pairs(
    [
      0x3b1, 0x3b2, 0x3b5, 0x3b7, 0x3b9, 0x3ba, 0x3bd, 0x3bf, 0x3c1, 0x3c4, 0x3c5, 0x3c7, 0x3f2,
      0x3c2,
    ],
    'abenikvoptuxcc',
  ),
  // Versaletes: ᴀ ʙ ᴄ ᴅ ᴇ ɢ ʜ ɪ ᴊ ᴋ ʟ ᴍ ɴ ᴏ ᴘ ʀ ꜱ ᴛ ᴜ ᴠ ᴡ ʏ ᴢ, e as maiúsculas de ɪ e ʀ.
  ...pairs(
    [
      0x1d00, 0x299, 0x1d04, 0x1d05, 0x1d07, 0x262, 0x29c, 0x26a, 0x1d0a, 0x1d0b, 0x29f, 0x1d0d,
      0x274, 0x1d0f, 0x1d18, 0x280, 0xa731, 0x1d1b, 0x1d1c, 0x1d20, 0x1d21, 0x28f, 0x1d22, 0xa7ae,
      0x1a6,
    ],
    'abcdeghijklmnoprstuvwyzir',
  ),
  // Letras em círculo negativo (🅐 a 🅩) e em quadrado negativo (🅰 a 🆉), que o NFKD não decompõe.
  ...alphabet(0x1f150),
  ...alphabet(0x1f170),
  // Indicadores regionais (🇦 a 🇿), as letras das bandeiras.
  ...alphabet(0x1f1e6),
]);

const REGIONAL_FIRST = 0x1f1e6;
const REGIONAL_LAST = 0x1f1ff;

const isRegional = (char: string): boolean => {
  const codePoint = char.codePointAt(0)!;
  return codePoint >= REGIONAL_FIRST && codePoint <= REGIONAL_LAST;
};

// Passo 3: as letras que o NFKD não decompõe, já em minúsculas.
const LATIN_EXTRA: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ħ: 'h',
  ı: 'i',
};
const LATIN_EXTRA_CHARS = /[ßæœøłđħı]/g;

/**
 * Passos 0 a 3: os espaços estreitos apagados; compatibilidade (NFKD) sem as
 * marcas; os homóglifos; minúsculas sem local e as letras do passo 3. A letra
 * do mapa entra antes da decomposição (o ϲ vira ς no NFKD), e o que sai da
 * decomposição passa pelo mapa de novo (o Α matemático vira Α). A sequência
 * de indicadores regionais (uma bandeira colada a uma palavra) vira um pedaço
 * à parte, para o "br" da bandeira não colar na palavra.
 */
function foldText(text: string): string {
  let folded = '';
  let regionalRun = false;
  for (const char of text.replace(NARROW_SPACES, '')) {
    const direct = HOMOGLYPHS.get(char);
    const out =
      direct ??
      [...char.normalize('NFKD').replace(MARKS, '')]
        .map((part) => HOMOGLYPHS.get(part) ?? part)
        .join('');
    if (out === '') continue;
    const regional = isRegional(char);
    if (regional !== regionalRun) {
      folded += ' ';
      regionalRun = regional;
    }
    folded += out;
  }
  return folded.toLowerCase().replace(LATIN_EXTRA_CHARS, (char) => LATIN_EXTRA[char]!);
}

// Passo 4: o que forma um pedaço. Todo o resto separa.
const PIECE = /[a-z0-9@$!|]+/g;
const LETTER = /[a-z]/;
// As pontas do pedaço: os números e os símbolos antes da primeira letra e
// depois da última.
const EDGE_HEAD = /^[0-9@$!|]*/;
const EDGE_TAIL = /[0-9@$!|]*$/;
const SYMBOL = /[@$!|]/;
const SYMBOLS = /[@$!|]/g;

// Passo 6: números e símbolos no lugar de letras.
const SWAP: Readonly<Record<string, string>> = {
  '4': 'a',
  '3': 'e',
  '1': 'i',
  '0': 'o',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
};
const SWAPPABLE = /[431057@$!|]/g;

const swap = (text: string): string => text.replace(SWAPPABLE, (char) => SWAP[char] ?? char);

/**
 * As leituras de um trecho com a troca: o 1 vira "i" e, numa leitura a mais,
 * "l" (o 1 no lugar do "l" é tão comum quanto no lugar do "i").
 */
const readings = (text: string): string[] =>
  text.includes('1') ? [swap(text), swap(text.replace(/1/g, 'l'))] : [swap(text)];

// Passo 7: letras repetidas viram uma. Só letras: "88" fica "88".
const collapse = (text: string): string => text.replace(/([a-z])\1+/g, '$1');

/**
 * Passos 6 e 7 num pedaço. Sem letra de a a z, o pedaço fica como está ("24",
 * "171", "!!!"). Com letra, o miolo (da primeira letra à última) troca os
 * números e `@ $ ! |`, e gera também a versão sem os símbolos (as letras
 * separadas por "|" ou "!" formam um pedaço só). Nas pontas, os números e os
 * símbolos geram a versão aparada e a trocada, para o "!" ou o "1" depois de
 * um termo não virar "i", o "2024" colado não esconder o termo e o "@" de uma
 * menção não colar um "a". O 1 é lido como "i" e como "l" em toda posição.
 */
function pieceVersions(raw: string): FilterPiece {
  if (!LETTER.test(raw)) return [raw];
  const head = EDGE_HEAD.exec(raw)![0];
  const tail = EDGE_TAIL.exec(raw)![0];
  const rawCore = raw.slice(head.length, raw.length - tail.length);
  const cores = new Set(readings(rawCore));
  if (SYMBOL.test(rawCore)) {
    for (const reading of readings(rawCore.replace(SYMBOLS, ''))) cores.add(reading);
  }
  const heads = head ? ['', ...readings(head)] : [''];
  const tails = tail ? ['', ...readings(tail)] : [''];
  const versions = new Set<string>();
  for (const start of heads) {
    for (const core of cores) {
      for (const end of tails) versions.add(collapse(start + core + end));
    }
  }
  return [...versions];
}

/**
 * O pedaço junto de letras soltas (passo 5), com os passos 6 e 7. Cada letra
 * solta é o pedaço de um caractere como ele veio, e a versão única dele é ele
 * mesmo: o casamento também junta um grupo sem a letra de uma ponta.
 */
export function joinSingles(singles: readonly string[]): FilterPiece {
  return pieceVersions(singles.join(''));
}

/**
 * Os pedaços de um texto (passos 0 a 7), com as letras soltas juntadas (passo
 * 5): três ou mais pedaços seguidos de um caractere também entram juntos, e os
 * soltos ficam.
 */
export function filterTokens(text: string): FilterTokens {
  const raws = foldText(text).match(PIECE) ?? [];
  const runs: FilterRun[] = [];
  let start = 0;
  for (let index = 0; index <= raws.length; index++) {
    if (index < raws.length && raws[index]!.length === 1) continue;
    if (index - start >= 3) {
      runs.push({ start, end: index, piece: joinSingles(raws.slice(start, index)) });
    }
    start = index + 1;
  }
  return { pieces: raws.map(pieceVersions), runs };
}

/**
 * O esqueleto de um identificador (o @, o usuário de uma rede, a frase com os
 * pedaços juntos): os mesmos passos, com os pedaços colados, sem separador.
 * Sem pedaço nenhum, nenhuma versão.
 */
export function handleSkeleton(value: string): FilterPiece {
  const glued = (foldText(value).match(PIECE) ?? []).join('');
  return glued === '' ? [] : pieceVersions(glued);
}
