import { describe, expect, it } from 'vitest';

import { filterTokens, handleSkeleton, HOMOGLYPHS } from './normalize';

// Só palavras neutras: nenhum termo da lista entra no repositório (30.4).

/** Os pedaços de um texto, cada um com as versões separadas por "|". */
const pieces = (text: string): string[] =>
  filterTokens(text).pieces.map((piece) => piece.join('|'));

/** As letras soltas juntadas (passo 5). */
const runs = (text: string): string[] => filterTokens(text).runs.map((run) => run.piece.join('|'));

const hex = (char: string): string =>
  `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

describe('filterTokens: compatibilidade, acentos e minúsculas', () => {
  it.each([
    ['acento', 'Pão Doçura', ['pao', 'docura']],
    ['maiúscula', 'BOLO de Casa', ['bolo', 'de', 'casa']],
    ['letra larga', 'ＢＯＬＯ', ['bolo']],
    ['letra matemática', '\u{1D41B}\u{1D428}\u{1D425}\u{1D428}', ['bolo']],
    ['letra em círculo', 'ⓑⓞⓛⓞ', ['bolo']],
    ['letra maiúscula em círculo', 'ⒷⓄⓁⓄ', ['bolo']],
    ['letra sobrescrita', 'ᵇᵒˡᵒ', ['bolo']],
    ['ligadura', 'ﬁta', ['fita']],
    ['tachado de combinação', 'b̶o̶l̶o̶', ['bolo']],
    ['sublinhado de combinação', 'b̲o̲l̲o̲', ['bolo']],
  ])('%s', (_, text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });

  it.each([
    ['ß', 'Straße', ['strase']],
    ['æ', 'Æther', ['aether']],
    ['œ', 'cœur', ['coeur']],
    ['ø', 'Søren', ['soren']],
    ['ł', 'Łódź', ['lodz']],
    ['đ', 'Đakovo', ['dakovo']],
    ['ħ', 'Ħal', ['hal']],
    ['ı', 'Kırmızı', ['kirmizi']],
  ])('a letra que o NFKD não decompõe: %s', (_, text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });
});

describe('filterTokens: homóglifos', () => {
  it.each([
    ['cirílico maiúsculo', 'РАТО', ['pato']],
    ['cirílico minúsculo', 'рато', ['pato']],
    ['cirílico misturado ao latino', 'pаtо', ['pato']],
    ['grego maiúsculo', 'ΡΑΤΟ', ['pato']],
    ['grego minúsculo', 'ρατο', ['pato']],
    ['versaletes', 'ᴘᴀᴛᴏ', ['pato']],
    ['versaletes com o L e o B', 'ʙᴏʟᴏ', ['bolo']],
    ['sigma lunado, que o NFKD troca pelo ς', 'ϲаsа', ['casa']],
  ])('%s', (_, text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });

  it('a maiúscula grega vale pelo desenho dela, antes de virar minúscula', () => {
    // Α Η Μ Ν Υ Ζ: em minúsculas, Η, Ν e Υ virariam η ("n"), ν ("v") e υ ("u").
    expect(pieces('ΑΗΜΝΥΖ')).toEqual(['ahmnyz']);
    expect(pieces('ηνυ')).toEqual(['nvu']);
  });

  it('a maiúscula leva o alvo do desenho dela', () => {
    expect(HOMOGLYPHS.get('Η')).toBe('h');
    expect(HOMOGLYPHS.get('Ν')).toBe('n');
    expect(HOMOGLYPHS.get('Υ')).toBe('y');
    expect(HOMOGLYPHS.get('Μ')).toBe('m');
    expect(HOMOGLYPHS.get('Ζ')).toBe('z');
    expect(HOMOGLYPHS.get('Н')).toBe('h');
    expect(HOMOGLYPHS.get('В')).toBe('b');
  });

  it('toda maiúscula cuja minúscula está no mapa também está nele', () => {
    let pairs = 0;
    for (const char of HOMOGLYPHS.keys()) {
      const upper = char.toUpperCase();
      if (upper === char || [...upper].length !== 1 || upper.toLowerCase() !== char) continue;
      pairs += 1;
      expect(HOMOGLYPHS.has(upper), `${hex(upper)}, maiúscula de ${hex(char)}`).toBe(true);
    }
    expect(pairs).toBeGreaterThan(30);
  });

  it('todo alvo é uma letra de a a z', () => {
    for (const [char, target] of HOMOGLYPHS) expect(target, hex(char)).toMatch(/^[a-z]$/);
  });
});

describe('filterTokens: letras de enfeite', () => {
  it.each([
    ['indicadores regionais', '\u{1F1E7}\u{1F1F4}\u{1F1F1}\u{1F1F4}', ['bolo']],
    ['bandeira colada a uma palavra', 'gol\u{1F1E7}\u{1F1F7}', ['gol', 'br']],
    ['letras em quadrado negativo', '\u{1F171}\u{1F17E}\u{1F17B}\u{1F17E}', ['bolo']],
    [
      'letras em quadrado negativo com o seletor de emoji',
      '\u{1F171}️\u{1F17E}️\u{1F17B}️\u{1F17E}️',
      ['bolo'],
    ],
    ['letras em círculo negativo', '\u{1F151}\u{1F15E}\u{1F15B}\u{1F15E}', ['bolo']],
    ['letras em quadrado', '\u{1F131}\u{1F13E}\u{1F13B}\u{1F13E}', ['bolo']],
  ])('%s', (_, text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });
});

describe('filterTokens: espaços e separadores', () => {
  it.each([' ', ' ', ' ', ' ', ' ', ' '].map((space) => [hex(space), space]))(
    'o espaço estreito %s no meio da palavra não a separa',
    (_, space) => {
      expect(pieces(`bo${space}lo`)).toEqual(['bolo']);
    },
  );

  it.each([
    ['pontuação', 'bolo,casa;doce.', ['bolo', 'casa', 'doce']],
    ['emoji', 'bolo\u{1F382}casa', ['bolo', 'casa']],
    ['quebra de linha', 'bolo\ncasa', ['bolo', 'casa']],
    ['espaço comum', 'bolo casa', ['bolo', 'casa']],
    ['NBSP', 'bolo casa', ['bolo', 'casa']],
    ['U+3000', 'bolo　casa', ['bolo', 'casa']],
    ['ZWJ entre emoji', 'bolo\u{1F469}‍\u{1F3A4}casa', ['bolo', 'casa']],
  ])('separa: %s', (_, text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });
});

describe('filterTokens: letras soltas', () => {
  it.each([
    ['espaço', 'b o l o'],
    ['ponto', 'b.o.l.o'],
    ['hífen', 'b-o-l-o'],
    ['quebra de linha', 'b\no\nl\no'],
  ])('separadas por %s, entram juntas, e as soltas ficam', (_, text) => {
    expect(pieces(text)).toEqual(['b', 'o', 'l', 'o']);
    expect(runs(text)).toEqual(['bolo']);
  });

  it('duas letras soltas não juntam', () => {
    expect(runs('b o')).toEqual([]);
    expect(runs('um b o bolo')).toEqual([]);
  });

  it('o grupo junto guarda onde as letras estão no texto', () => {
    expect(filterTokens('comi b o l o hoje').runs).toEqual([{ start: 1, end: 5, piece: ['bolo'] }]);
    expect(runs('a b c casa d e f')).toEqual(['abc', 'def']);
  });

  it('o pedaço junto também troca os números', () => {
    expect(pieces('b 0 l 0')).toEqual(['b', '0', 'l', '0']);
    // O último 0 fica na ponta do pedaço junto: a versão aparada e a trocada.
    expect(runs('b 0 l 0')).toEqual(['bol|bolo']);
  });

  it('as letras separadas por "|" ou "!", com espaço, juntam sem os símbolos', () => {
    expect(runs('b | o | l | o')).toEqual(['bioilio|bolo']);
    expect(runs('b ! o ! l ! o')).toEqual(['bioilio|bolo']);
  });
});

describe('filterTokens: números e símbolos no lugar de letras', () => {
  it.each([
    ['4 no miolo', 'c4sa', ['casa']],
    ['3 no miolo', 'tr3m', ['trem']],
    ['0 no miolo', 'b0lo', ['bolo']],
    ['5 no miolo', 'ca5a', ['casa']],
    ['7 no miolo', 'ga7o', ['gato']],
    ['1 no miolo, lido como "i" e como "l"', 'v1da bo1o', ['vida|vlda', 'boio|bolo']],
    ['número na ponta: a versão aparada e a trocada', 'b0l0', ['bol|bolo']],
    ['@ no meio, também sem ele', 'tod@s', ['todas|tods']],
    ['$ no meio, também sem ele', 'ca$a', ['casa|ca']],
    ['| no meio, também sem ele', 'v|da', ['vida|vda']],
    ['! no meio, também sem ele', 'v!da', ['vida|vda']],
    ['letras separadas por "|", num pedaço só', 'b|o|l|o', ['bioilio|bolo']],
    ['! no fim', 'bolo!', ['bolo|boloi']],
    ['!!! no fim', 'bolo!!!', ['bolo|boloi']],
    ['!? no fim', 'bolo!?', ['bolo|boloi']],
    ['1 no fim', 'bolo1', ['bolo|boloi|bolol']],
    ['!!1 no fim', 'bolo!!1', ['bolo|boloi|boloil']],
    ['2024 no fim', 'bolo2024', ['bolo|bolo2o2a']],
    ['número no começo', '2bolo', ['bolo|2bolo']],
    ['@ no começo', '@bolo', ['bolo|abolo']],
    ['@ no fim', 'amig@', ['amig|amiga']],
    ['@ nas duas pontas', '@amig@', ['amig|amiga']],
    ['$ no começo', '$apo', ['apo|sapo']],
  ])('%s', (_, text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });

  it.each([['24'], ['171'], ['88'], ['2026'], ['!!!'], ['@']])(
    'o pedaço sem letra fica intacto: %s',
    (text) => {
      expect(pieces(text)).toEqual([text]);
    },
  );

  it('o pedaço com uma letra troca os números: "3x1", "1º" e "2ª"', () => {
    // O "º" e o "ª" viram "o" e "a" no NFKD, e os números ficam nas pontas. O
    // corpus confere que nenhuma dessas versões vira termo.
    expect(pieces('3x1')).toEqual(['x|xi|xl|ex|exi|exl']);
    expect(pieces('1º')).toEqual(['o|io|lo']);
    expect(pieces('2ª')).toEqual(['a|2a']);
  });
});

describe('filterTokens: letras repetidas', () => {
  it.each([
    ['boooolo', ['bolo']],
    ['bbbolo', ['bolo']],
    ['BoOoLo', ['bolo']],
    ['b0000lo', ['bolo']],
    ['casaaa!!!', ['casa|casai']],
  ])('%s', (text, expected) => {
    expect(pieces(text)).toEqual(expected);
  });
});

describe('filterTokens: pior caso', () => {
  it('500 caracteres do U+FDFA, a maior expansão do NFKD, em pouco tempo', () => {
    const started = performance.now();
    const tokens = filterTokens('ﷺ'.repeat(500));
    expect(tokens).toEqual({ pieces: [], runs: [] });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('250 letras soltas viram um pedaço junto só', () => {
    const tokens = filterTokens('b '.repeat(250));
    expect(tokens.pieces).toHaveLength(250);
    expect(tokens.runs).toEqual([{ start: 0, end: 250, piece: ['b'] }]);
  });

  it('texto vazio ou só de separadores não tem pedaço', () => {
    expect(filterTokens('')).toEqual({ pieces: [], runs: [] });
    expect(filterTokens(' \n.,;\u{1F382}')).toEqual({ pieces: [], runs: [] });
  });
});

describe('handleSkeleton', () => {
  it.each([
    ['os pedaços colados, sem separador', 'Bolo.Doce_Casa-X', ['bolodocecasax']],
    ['com os números trocados', 'b0l0_d0c3', ['bolodoc', 'bolodoce']],
    ['com o símbolo na ponta', 'bolo!', ['bolo', 'boloi']],
    ['com o acento e o homóglifo', 'Pа̃o', ['pao']],
    ['vazio', '', []],
    ['só separadores', '._-', []],
    ['só números', '2026', ['2026']],
  ])('%s', (_, value, expected) => {
    expect(handleSkeleton(value)).toEqual(expected);
  });
});
