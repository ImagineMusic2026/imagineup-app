import {
  cleanLine,
  cleanMultiline,
  DISPLAY_NAME_MAX,
  displayNameOrNull,
  isVisibleLine,
  isVisibleMultiline,
} from '../visible-line';

// Os mesmos casos de functions/src/visible-line.test.ts e de
// tests/firestore-rules.test.ts: as três validações precisam concordar.
describe('uma linha de texto visível (espelho do firestore.rules)', () => {
  it.each([
    'Camila Ribeiro 🎶',
    'Camila ❤️',
    'Nº 1️⃣',
    '1️⃣ Camila',
    'Nguyễn Thị Ánh',
    'Nguyễn Thị Ánh'.normalize('NFD'),
    'Cámila José'.normalize('NFD'),
    'प्रिया',
    'กิ่ง',
    'שָּׁלוֹם',
    'محمد',
    '张伟',
    "D'Ávila-Souza Jr.",
    'Camila \u{1F1E7}\u{1F1F7}',
    'Camila \u{1F44D}\u{1F3FD}',
    'Camila \u{1F469}‍\u{1F3A4}',
    'Camila \u{1F469}\u{1F3FD}‍\u{1F3A4}',
    'Camila ❤️‍\u{1F525}',
    'Camila \u{1F3F3}️‍\u{1F308}',
    'Camila \u{1F64B}‍♀️',
    'Camila \u{1F642}‍↔️',
    '\u{1F468}‍\u{1F469}‍\u{1F467} Silva',
  ])('aceita %s', (text) => {
    expect(isVisibleLine(text)).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['espaço', ' '],
    ['espaço na ponta', ' Camila'],
    ['espaço no fim', 'Camila '],
    ['quebra de linha', 'A\nB'],
    ['separador de linha', 'Camila Oficial'],
    ['separador de parágrafo', 'A B'],
    ['largura zero', '​'],
    ['Hangul em branco', 'ㅤ'],
    ['inversão bidi', '‮gpj.exe'],
    ['NUL', 'a\u0000b'],
    ['acento solto', '́'],
    ['acento no início', '́Camila'],
    ['seletor de variação sozinho', '️'],
    ['invisível novo', '⁥'],
    ['isolante bidi', 'A⁧B'],
    ['tag', '\u{E0000}'],
    ['zalgo', 'a' + '̶'.repeat(59)],
    ['zalgo com acento novo', 'a' + '᷶'.repeat(20)],
    ['ZWJ entre letras', 'A‍B'],
    ['ZWJ no fim', 'Camila‍'],
    ['ZWJ no começo', '‍Camila'],
    ['ZWJ duplo', 'A‍‍B'],
    ['ZWJ antes de emoji, depois de letra', 'A‍\u{1F3A4}'],
    ['em branco U+034F', 'Camila ͏ Ribeiro'],
    ['em branco U+061C', 'Camila ؜ Ribeiro'],
    ['em branco U+115F', 'Camila ᅟ Ribeiro'],
    ['em branco U+1160', 'Camila ᅠ Ribeiro'],
    ['em branco U+17B4', 'Camila ឴ Ribeiro'],
    ['em branco U+17B5', 'Camila ឵ Ribeiro'],
    ['em branco U+180E', 'Camila ᠎ Ribeiro'],
    ['em branco U+180F', 'Camila ᠏ Ribeiro'],
    ['em branco U+2065', 'Camila ⁥ Ribeiro'],
    ['em branco U+2066', 'Camila ⁦ Ribeiro'],
    ['em branco U+2069', 'Camila ⁩ Ribeiro'],
    ['em branco U+2800', 'Camila ⠀ Ribeiro'],
    ['em branco U+3164', 'Camila ㅤ Ribeiro'],
    ['em branco U+FFA0', 'Camila ﾠ Ribeiro'],
    ['em branco U+FFF0', 'Camila ￰ Ribeiro'],
    ['em branco U+FFF8', 'Camila ￸ Ribeiro'],
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

describe('limpeza do texto digitado', () => {
  it.each([
    ['  Camila Ribeiro  ', 'Camila Ribeiro'],
    ['⁦Camila⁩', 'Camila'],
    ['Camila ⁧Ribeiro⁨', 'Camila Ribeiro'],
    ['Cámila'.normalize('NFD'), 'Cámila'],
    ['\n Camila \t', 'Camila'],
  ])('%j vira %j', (typed, expected) => {
    expect(cleanLine(typed)).toBe(expected);
  });

  it('só tira as pontas: o que sobra no meio continua sendo validado', () => {
    expect(cleanLine('A\nB')).toBe('A\nB');
    expect(isVisibleLine(cleanLine('A\nB'))).toBe(false);
  });
});

describe('nome que as regras deixam gravar no perfil', () => {
  it.each([
    ['  Camila Ribeiro ', 'Camila Ribeiro'],
    ['Cámila'.normalize('NFD'), 'Cámila'],
    ['x'.repeat(DISPLAY_NAME_MAX), 'x'.repeat(DISPLAY_NAME_MAX)],
  ])('%j vira %j', (name, expected) => {
    expect(displayNameOrNull(name)).toBe(expected);
  });

  it.each([
    ['sem nome', null],
    ['vazio', ''],
    ['só espaços', '   '],
    ['longo demais', 'x'.repeat(DISPLAY_NAME_MAX + 1)],
    ['com quebra de linha', 'Camila\nRibeiro'],
    ['só de caracteres em branco', 'ㅤㅤ'],
  ])('%s fica null', (_, name) => {
    expect(displayNameOrNull(name)).toBeNull();
  });
});

// A mesma tabela de functions/src/visible-line.test.ts: o comentário é limpo
// e validado igual no app e no servidor (docs/arquitetura-api.md, 21.1, decisão 20).
describe('texto de várias linhas (cleanMultiline e isVisibleMultiline)', () => {
  it.each([
    ['texto simples', 'Que música boa!', 'Que música boa!', true],
    ['espaços nas pontas de cada linha', '  oi  \n  tudo bem?  ', 'oi\ntudo bem?', true],
    ['linhas vazias seguidas viram uma', 'a\n\n\n\nb', 'a\n\nb', true],
    ['linhas vazias nas pontas saem', '\n\n  a  \n\n', 'a', true],
    ['isolantes bidi colados saem', '⁦Camila⁩ arrasou', 'Camila arrasou', true],
    ['acento decomposto vira NFC', 'Irará', 'Irará', true],
    ['\\r\\n vira \\n', 'a\r\nb', 'a\nb', true],
    ['\\r sozinho vira \\n e não é invisível', 'a\rb', 'a\nb', true],
    ['emoji com ZWJ', 'Arrasou \u{1F469}‍\u{1F3A4}', 'Arrasou \u{1F469}‍\u{1F3A4}', true],
    ['só espaços fica vazio', ' \n \t ', '', true],
    ['invisível no meio de uma linha', 'oi ​ tchau', 'oi ​ tchau', false],
    ['linha só de invisível', 'oi\nㅤ\ntchau', 'oi\nㅤ\ntchau', false],
    ['controle no meio', 'a\u0007b', 'a\u0007b', false],
  ])('%s', (_, input, cleaned, visible) => {
    expect(cleanMultiline(input)).toBe(cleaned);
    expect(isVisibleMultiline(cleanMultiline(input))).toBe(visible);
  });
});
