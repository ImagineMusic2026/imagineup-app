import { describe, expect, it, vi } from 'vitest';

import { FILTERED_NAME, isBlockedHandle, isBlockedSocial, isBlockedText } from '.';
import {
  createFilter,
  createFilterFromKeys,
  entryKeysOf,
  FIELD_BLOCKS,
  FILTER_CATEGORIES,
  plainKey,
  sha256Key,
  type ContentFilter,
  type FieldBlocks,
  type FilterCategory,
  type FilterEntryKeys,
  type FilterTerm,
  type FilterTextField,
} from './match';
import { FILTER_NORMALIZATION_VERSION } from './normalize';
import { FILTER_NORMALIZATION_VERSION as TERMS_NORMALIZATION_VERSION } from './terms';

// Uma lista falsa de palavras neutras, uma de cada categoria: nenhum termo da
// lista de verdade entra no repositório (resposta 1 do dono, 30.4).
const TERMS: readonly FilterTerm[] = [
  { term: 'pepino', category: 'insult', forms: ['pepina', 'pepinão', 'pepinões', 'pepininho'] },
  { term: 'abacaxi', category: 'profanity' },
  { term: 'berinjela', category: 'hate', inHandle: true },
  { term: 'jiló', category: 'sexual' },
  { term: 'chuchu azedo', category: 'violence' },
  { term: 'tosse', category: 'profanity' },
];

// As exceções: o "pepino-do-mar" faz o papel do Pica-Pau, e a "Vila Berinjela",
// o de uma cidade com um termo dentro.
const EXCEPTIONS = ['Vila Berinjela', 'pepino-do-mar'];

const TEXT_FIELDS: readonly FilterTextField[] = [
  'comment',
  'bio',
  'displayName',
  'city',
  'fanClubName',
  'fanClubPitch',
  'fanClubPost',
];

const ENTRY_ERROR = 'Filtro de conteúdo: a entrada 1 está fora da forma.';

/** O erro que a chamada lança (ou `undefined`). */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.each([
  ['legível', plainKey],
  ['de SHA-256', sha256Key],
])('com a chave %s', (_, key) => {
  const filter = createFilter(TERMS, { exceptions: EXCEPTIONS, key });
  const text = (value: string, field: FilterTextField = 'comment') =>
    filter.isBlockedText(value, field);

  it('a palavra inteira e as formas, com s e es', () => {
    for (const value of [
      'pepino',
      'que PEPINO',
      'pepina',
      'pepinão',
      'pepinões',
      'pepininho',
      'pepinos',
      'pepinas',
      'jiló',
      'jilós',
      'jiloes',
    ]) {
      expect(text(value), value).toBe(true);
    }
  });

  it('nunca o trecho no comentário e na bio', () => {
    for (const value of ['pepinosa', 'apepino', 'berinjelada', 'abacaxizeiro', 'jilozinho']) {
      expect(text(value, 'comment'), value).toBe(false);
      expect(text(value, 'bio'), value).toBe(false);
    }
  });

  it('a frase só com os pedaços seguidos', () => {
    for (const value of [
      'chuchu azedo',
      'um CHUCHU AZEDO aqui',
      'chuchus azedos',
      'chuchu\nazedo',
    ]) {
      expect(text(value), value).toBe(true);
    }
    for (const value of ['chuchu muito azedo', 'azedo chuchu', 'chuchu', 'azedo']) {
      expect(text(value), value).toBe(false);
    }
  });

  it('a frase soletrada no pedaço junto, colada ou com uma palavra soletrada', () => {
    for (const value of [
      'c h u c h u a z e d o',
      'chuchu a z e d o',
      'c-h-u-c-h-u azedo',
      'chuchuazedo',
    ]) {
      expect(text(value), value).toBe(true);
    }
  });

  it('a palavra soletrada letra a letra', () => {
    expect(text('p e p i n o')).toBe(true);
    expect(text('p.e.p.i.n.o')).toBe(true);
    expect(text('p e')).toBe(false);
  });

  it('a palavra soletrada ao lado de uma palavra de uma letra, que o grupo junta', () => {
    for (const value of [
      'que a p e p i n o',
      'p e p i n o e',
      'o p e p i n o e',
      'e c h u c h u azedo',
      'chuchu a z e d o e',
      'o j i l ó a',
    ]) {
      expect(text(value), value).toBe(true);
    }
    // Sem a letra da ponta, o grupo de 3 ficaria com 2: não junta.
    expect(text('a j i')).toBe(false);
    expect(text('a b c d')).toBe(false);
  });

  it('a palavra seguida de "!", de "!!!" e de "!?", ou depois do "@"', () => {
    for (const value of ['pepino!', 'pepino!!!', 'pepino!?', '@pepino', 'que pepino!']) {
      expect(text(value), value).toBe(true);
    }
  });

  it('o número colado na ponta: "1", "!!1", "2024" e o número na frente', () => {
    for (const value of [
      'pepino1',
      'que pepino1',
      'pepino!1',
      'pepino1!',
      'pepino!!!111',
      '2pepino',
      'pepino2024',
    ]) {
      expect(text(value), value).toBe(true);
    }
    for (const value of ['pepino2', 'pepino99', '2pepino', 'pepino123']) {
      expect(filter.isBlockedHandle(value), value).toBe(true);
    }
    expect(filter.isBlockedSocial('pepino2')).toBe(true);
    expect(filter.isBlockedSocial('pepino_2')).toBe(true);
    // A palavra comum com número continua passando.
    expect(text('top10, mp3, covid19 e 3x1')).toBe(false);
    expect(filter.isBlockedHandle('camila2024')).toBe(false);
  });

  it('as letras separadas por "|" ou "!", com ou sem espaço', () => {
    for (const value of [
      'p|e|p|i|n|o',
      'p!e!p!i!n!o',
      'p | e | p | i | n | o',
      'p ! e ! p ! i ! n ! o',
    ]) {
      expect(text(value), value).toBe(true);
      expect(text(value, 'bio'), value).toBe(true);
    }
  });

  it('a palavra soletrada ao lado de duas palavras de uma letra ("é o", "e a")', () => {
    for (const value of [
      'ele é o p e p i n o',
      'isso é a p e p i n o',
      'p e p i n o e o resto',
      'é a c h u c h u azedo',
      'chuchu a z e d o e a',
    ]) {
      expect(text(value), value).toBe(true);
    }
  });

  it('o 1 no lugar do "l"', () => {
    expect(text('ji1ó')).toBe(true);
    expect(text('berinje1a')).toBe(true);
    expect(text('berinje11a')).toBe(true);
    expect(filter.isBlockedHandle('anaberinje1a')).toBe(true);
  });

  it('números e símbolos no lugar de letras, só no pedaço com letra', () => {
    expect(text('p3p1n0')).toBe(true);
    expect(text('P3P!N0')).toBe(true);
    expect(text('7o553')).toBe(true);
    expect(text('t0sse')).toBe(true);
    // Só números: nunca vira termo, nem com o mapa dando as letras de um.
    expect(text('70553')).toBe(false);
    expect(text('placar de 3x1, 1º lugar, 24 horas')).toBe(false);
  });

  it('homóglifos, letras de enfeite e o espaço estreito', () => {
    expect(text('ΡΕΡΙΝΟ')).toBe(true);
    expect(text('ＰＥＰＩＮＯ')).toBe(true);
    expect(text('\u{1F1F5}\u{1F1EA}\u{1F1F5}\u{1F1EE}\u{1F1F3}\u{1F1F4}')).toBe(true);
    expect(text('pe pino')).toBe(true);
    expect(text('pe pino')).toBe(false);
  });

  it('o trecho inHandle dentro de um pedaço do nome, da cidade, do @ e das redes', () => {
    expect(text('Ana Berinjelada', 'displayName')).toBe(true);
    expect(text('Berinjelândia', 'city')).toBe(true);
    expect(text('b e r i n j e l a d a', 'displayName')).toBe(true);
    expect(filter.isBlockedHandle('anaberinjela')).toBe(true);
    expect(filter.isBlockedSocial('ana.berinjelada')).toBe(true);
    expect(filter.isBlockedSocial('berinjelada_ana')).toBe(true);
  });

  it('nunca o trecho no esqueleto colado das redes, só a igualdade', () => {
    expect(filter.isBlockedSocial('anaberin.jela')).toBe(false);
    expect(filter.isBlockedSocial('berin.jela')).toBe(true);
    expect(filter.isBlockedSocial('chuchu.azedo')).toBe(true);
    expect(filter.isBlockedSocial('chuchu_azedo_2026')).toBe(true);
  });

  it('o nome do fã-clube confere o trecho, como o nome do fã; o texto de divulgação, não (34.8)', () => {
    expect(text('Fã-clube Berinjelada', 'fanClubName')).toBe(true);
    expect(text('Fã-clube Berinjelada', 'fanClubPitch')).toBe(false);
    expect(text('Divulgo a berinjela nas redes', 'fanClubPitch')).toBe(true);
    expect(text('Fã-clube Pepinópolis', 'fanClubName')).toBe(false);
  });

  it('o texto da publicação do fã-clube confere a palavra e a frase, como o comentário (34.8)', () => {
    expect(text('Show lindo, berinjela pura', 'fanClubPost')).toBe(true);
    expect(text('Fã-clube Berinjelada no show', 'fanClubPost')).toBe(false);
    expect(text('Que chuchu azedo esse', 'fanClubPost')).toBe(true);
  });

  it('o termo sem inHandle não vale como trecho', () => {
    expect(text('Pepinópolis', 'city')).toBe(false);
    expect(text('Ana Pepinosa', 'displayName')).toBe(false);
    expect(filter.isBlockedHandle('pepinoverde')).toBe(false);
    expect(filter.isBlockedHandle('pepino')).toBe(true);
    expect(filter.isBlockedHandle('pepinos')).toBe(true);
    expect(filter.isBlockedHandle('p3p1n0')).toBe(true);
  });

  it('o @ inteiro igual a uma frase com os pedaços juntos', () => {
    expect(filter.isBlockedHandle('chuchuazedo')).toBe(true);
    expect(filter.isBlockedHandle('chuchuazedos')).toBe(true);
    expect(filter.isBlockedHandle('chuchu')).toBe(false);
  });

  it('a exceção cobre os pedaços dela e o trecho do esqueleto', () => {
    expect(text('Vila Berinjela', 'city')).toBe(false);
    expect(text('Maria da Vila Berinjela', 'displayName')).toBe(false);
    expect(text('show em Vila Berinjela')).toBe(false);
    expect(text('Berinjela', 'city')).toBe(true);
    expect(filter.isBlockedHandle('vilaberinjela')).toBe(false);
    expect(filter.isBlockedHandle('vilaberinjelanova')).toBe(false);
    expect(filter.isBlockedHandle('anaberinjela')).toBe(true);
    expect(filter.isBlockedSocial('vila.berinjela')).toBe(false);
    expect(text('vi um pepino-do-mar')).toBe(false);
    expect(text('pepino do mar')).toBe(false);
    expect(text('pepino na Vila Pepino')).toBe(true);
    expect(text('pepino-do-mar e pepino')).toBe(true);
  });

  it('o texto comum passa em todo campo', () => {
    for (const field of TEXT_FIELDS) {
      expect(text('Que show lindo, Camila!', field)).toBe(false);
      expect(text('Ponta Grossa', field)).toBe(false);
    }
    expect(filter.isBlockedHandle('camilarib')).toBe(false);
    expect(filter.isBlockedSocial('camila.teste_up')).toBe(false);
  });

  it('o retorno é só sim ou não', () => {
    const answers: unknown[] = [
      text('pepino'),
      text('bolo'),
      filter.isBlockedHandle('pepino'),
      filter.isBlockedHandle('bolo'),
      filter.isBlockedSocial('pepino'),
      filter.isBlockedSocial('bolo'),
    ];
    expect(answers).toEqual([true, false, true, false, true, false]);
    for (const answer of answers) expect(typeof answer).toBe('boolean');
  });
});

describe('a política por campo', () => {
  it('o FIELD_BLOCKS de verdade barra toda categoria em todo campo', () => {
    for (const categories of Object.values(FIELD_BLOCKS)) {
      expect([...categories].sort()).toEqual([...FILTER_CATEGORIES].sort());
    }
    const filter = createFilter(TERMS);
    for (const field of TEXT_FIELDS)
      expect(filter.isBlockedText('abacaxi', field), field).toBe(true);
    expect(filter.isBlockedHandle('abacaxi')).toBe(true);
    expect(filter.isBlockedSocial('abacaxi')).toBe(true);
  });

  it('um FIELD_BLOCKS falso libera o palavrão no comentário e na bio', () => {
    const withoutProfanity = FILTER_CATEGORIES.filter((category) => category !== 'profanity');
    const relaxed: FieldBlocks = {
      ...FIELD_BLOCKS,
      comment: withoutProfanity,
      bio: withoutProfanity,
    };
    const filter = createFilter(TERMS, { fieldBlocks: relaxed });
    expect(filter.isBlockedText('abacaxi', 'comment')).toBe(false);
    expect(filter.isBlockedText('que abacaxi!', 'bio')).toBe(false);
    expect(filter.isBlockedText('tosse', 'comment')).toBe(false);
    expect(filter.isBlockedText('abacaxi', 'displayName')).toBe(true);
    expect(filter.isBlockedHandle('abacaxi')).toBe(true);
    expect(filter.isBlockedText('pepino', 'comment')).toBe(true);
  });

  it('cada categoria barra no campo que a tem', () => {
    const only = (category: FilterCategory): FieldBlocks => ({
      comment: [category],
      bio: [category],
      displayName: [category],
      city: [category],
      fanClubName: [category],
      fanClubPitch: [category],
      fanClubPost: [category],
      username: [category],
      socials: [category],
    });
    const cases: [FilterCategory, string][] = [
      ['insult', 'pepino'],
      ['profanity', 'abacaxi'],
      ['hate', 'berinjela'],
      ['sexual', 'jiló'],
      ['violence', 'chuchu azedo'],
    ];
    for (const [category, value] of cases) {
      for (const [other] of cases) {
        const filter = createFilter(TERMS, { fieldBlocks: only(other) });
        expect(filter.isBlockedText(value, 'comment'), `${value} com ${other}`).toBe(
          other === category,
        );
      }
    }
  });
});

describe('as chaves e a forma da lista', () => {
  it('as chaves de SHA-256 não levam o texto do termo', () => {
    const entry = entryKeysOf(
      { term: 'chuchu azedo', category: 'violence', forms: ['chuchus azedos'] },
      sha256Key,
      0,
    );
    expect(entry.category).toBe('violence');
    expect(entry.forms).toHaveLength(2);
    for (const form of entry.forms) {
      expect(form).toHaveLength(2);
      for (const key of form) expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const key of entry.joined) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.joined[0]).toBe(sha256Key('chuchuazedo'));
    expect(entry.handleLengths).toBeUndefined();
    expect(JSON.stringify(entry)).not.toMatch(/chuchu|azedo/);
  });

  it('o inHandle leva o tamanho de cada forma com os pedaços juntos', () => {
    expect(
      entryKeysOf(
        { term: 'Berinjela', category: 'hate', forms: ['berinjelas'], inHandle: true },
        plainKey,
        0,
      ),
    ).toEqual({
      category: 'hate',
      forms: [['berinjela'], ['berinjelas']],
      joined: ['berinjela', 'berinjelas'],
      handleLengths: [9, 10],
    });
  });

  it('o filtro pelas chaves responde igual ao da lista legível', () => {
    const keys = TERMS.map((term, index) => entryKeysOf(term, sha256Key, index));
    const byKeys = createFilterFromKeys(keys, {
      exceptions: EXCEPTIONS,
      key: sha256Key,
      normalizationVersion: FILTER_NORMALIZATION_VERSION,
    });
    const byTerms = createFilter(TERMS, { exceptions: EXCEPTIONS });
    const samples = ['pepino!', 'chuchu a z e d o', 'Vila Berinjela', 'Ana Berinjelada', 'bom dia'];
    for (const sample of samples) {
      for (const field of TEXT_FIELDS) {
        expect(byKeys.isBlockedText(sample, field), `${sample} em ${field}`).toBe(
          byTerms.isBlockedText(sample, field),
        );
      }
      expect(byKeys.isBlockedHandle(sample)).toBe(byTerms.isBlockedHandle(sample));
      expect(byKeys.isBlockedSocial(sample)).toBe(byTerms.isBlockedSocial(sample));
    }
  });

  it.each([
    ['termo de um caractere', { term: 'z', category: 'insult' }],
    ['termo que é número', { term: '1234', category: 'insult' }],
    ['símbolo na ponta', { term: 'manga!', category: 'insult' }],
    ['frase de 6 pedaços', { term: 'um dois tres quatro cinco seis', category: 'insult' }],
    ['termo acima de 40 caracteres', { term: 'abcdefghij'.repeat(5), category: 'insult' }],
    [
      '13 formas',
      {
        term: 'kiwi',
        category: 'insult',
        forms: [...'bcdfghjklmnpr'].map((letter) => `kiwi${letter}`),
      },
    ],
    ['inHandle com menos de 5 letras', { term: 'kiwi', category: 'insult', inHandle: true }],
    ['categoria que não existe', { term: 'kiwi', category: 'spam' }],
    ['forma vazia', { term: 'kiwi', category: 'insult', forms: [''] }],
    ['termo que não é texto', { term: 42, category: 'insult' }],
  ])('a entrada fora da forma lança na primeira conferência, com só o índice: %s', (_, bad) => {
    const filter = createFilter([
      { term: 'manga', category: 'insult' },
      bad as unknown as FilterTerm,
    ]);
    const error = thrown(() => filter.isBlockedText('bolo', 'comment'));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(ENTRY_ERROR);
  });

  it('a falha fica guardada: a segunda chamada não compila de novo', () => {
    const key = vi.fn(plainKey);
    const filter = createFilter(
      [
        { term: 'manga', category: 'insult' },
        { term: 'z', category: 'insult' },
      ],
      { key },
    );
    expect(key).not.toHaveBeenCalled();
    const first = thrown(() => filter.isBlockedText('bolo', 'comment'));
    const calls = key.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const second = thrown(() => filter.isBlockedHandle('bolo'));
    const third = thrown(() => filter.isBlockedSocial('bolo'));
    expect(first).toBeInstanceOf(Error);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(key).toHaveBeenCalledTimes(calls);
  });

  it('a lista compila na primeira conferência, nunca antes', () => {
    const key = vi.fn(sha256Key);
    const filter: ContentFilter = createFilter(TERMS, { key });
    expect(key).not.toHaveBeenCalled();
    expect(filter.isBlockedText('pepino', 'comment')).toBe(true);
    expect(key).toHaveBeenCalled();
  });

  it('a exceção fora da forma lança com só o índice', () => {
    const filter = createFilter(TERMS, { exceptions: ['Vila Berinjela', 'z'] });
    expect((thrown(() => filter.isBlockedText('bolo', 'comment')) as Error).message).toBe(
      'Filtro de conteúdo: a exceção 1 está fora da forma.',
    );
  });

  it.each([
    ['sem forma', { category: 'insult', forms: [], joined: [] }],
    [
      'frase de 6 pedaços',
      { category: 'insult', forms: [['a', 'b', 'c', 'd', 'e', 'f']], joined: ['x'] },
    ],
    ['chave vazia', { category: 'insult', forms: [['']], joined: [''] }],
    ['joined de outro tamanho', { category: 'insult', forms: [['a']], joined: ['a', 'b'] }],
    ['inHandle curto', { category: 'insult', forms: [['a']], joined: ['a'], handleLengths: [3] }],
    ['categoria que não existe', { category: 'spam', forms: [['a']], joined: ['a'] }],
  ])('a entrada do terms.ts fora da forma lança com só o índice: %s', (_, bad) => {
    const good: FilterEntryKeys = { category: 'insult', forms: [['a']], joined: ['a'] };
    const filter = createFilterFromKeys([good, bad as unknown as FilterEntryKeys], {
      key: plainKey,
    });
    expect((thrown(() => filter.isBlockedHandle('bolo')) as Error).message).toBe(ENTRY_ERROR);
  });

  it('as chaves de outra versão da normalização não valem', () => {
    const filter = createFilterFromKeys([], {
      normalizationVersion: FILTER_NORMALIZATION_VERSION + 1,
    });
    expect((thrown(() => filter.isBlockedText('bolo', 'comment')) as Error).message).toBe(
      'Filtro de conteúdo: as chaves são de outra versão da normalização.',
    );
  });

  it('os tetos de entradas e de exceções', () => {
    const many = Array.from(
      { length: 401 },
      () => ({ term: 'manga', category: 'insult' }) as const,
    );
    expect(
      (thrown(() => createFilter(many).isBlockedText('bolo', 'comment')) as Error).message,
    ).toBe('Filtro de conteúdo: a lista passa do teto de entradas.');
    const entries = Array.from({ length: 401 }, (): FilterEntryKeys => ({
      category: 'insult',
      forms: [['a']],
      joined: ['a'],
    }));
    expect(
      (thrown(() => createFilterFromKeys(entries).isBlockedText('bolo', 'comment')) as Error)
        .message,
    ).toBe('Filtro de conteúdo: a lista passa do teto de entradas.');
    const exceptions = Array.from({ length: 201 }, () => 'manga');
    expect(
      (thrown(() => createFilter(TERMS, { exceptions }).isBlockedText('bolo', 'comment')) as Error)
        .message,
    ).toBe('Filtro de conteúdo: a lista passa do teto de exceções.');
  });

  it('400 entradas com 12 formas cada compilam', () => {
    // O índice em letras: o termo é escrito com letras (o 1 no miolo teria duas leituras).
    const tag = (index: number): string =>
      [...index.toString(26)]
        .map((digit) => String.fromCharCode(97 + parseInt(digit, 26)))
        .join('');
    const terms = Array.from({ length: 400 }, (_, index): FilterTerm => ({
      term: `termo${tag(index)}x`,
      category: 'insult',
      forms: [...'bcdfghjklmnp'].map((letter) => `forma${letter}${tag(index)}x`),
    }));
    expect(createFilter(terms).isBlockedText('bolo', 'comment')).toBe(false);
  });
});

describe('o filtro do servidor', () => {
  it('responde só sim ou não e deixa passar o texto comum', () => {
    for (const field of TEXT_FIELDS)
      expect(isBlockedText('Que show lindo, Camila!', field)).toBe(false);
    expect(isBlockedHandle('camilarib')).toBe(false);
    expect(isBlockedSocial('camila.teste_up')).toBe(false);
  });

  it('as chaves do terms.ts são da versão de agora da normalização', () => {
    expect(TERMS_NORMALIZATION_VERSION).toBe(FILTER_NORMALIZATION_VERSION);
  });

  it('o nome que entra no lugar do nome barrado é "Fã"', () => {
    expect(FILTERED_NAME).toBe('Fã');
    expect(FILTERED_NAME).toBe(FILTERED_NAME.normalize('NFC'));
  });
});
