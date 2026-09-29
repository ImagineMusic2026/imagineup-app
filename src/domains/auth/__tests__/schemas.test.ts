import { t } from '@/i18n';

import { DISPLAY_NAME_MAX, resetEmailSchema, signInSchema, signUpSchema } from '../schemas';

const parseEmail = (email: string) => signInSchema.safeParse({ email, password: '123456' });

describe('e-mail do login', () => {
  it.each(['fa@x.com ', ' Fa@X.com', 'fa@x.com\n', 'FA@X.COM'])(
    '"%s" passa e vira fa@x.com',
    (email) => {
      const result = parseEmail(email);
      expect(result.success).toBe(true);
      expect(result.data?.email).toBe('fa@x.com');
    },
  );

  it.each(['', 'nope', 'nope ', 'fa@', '@x.com'])('"%s" é recusado', (email) => {
    expect(parseEmail(email).success).toBe(false);
  });

  it('a mensagem de erro sai em pt-BR', () => {
    const result = parseEmail('nope');
    expect(result.error?.issues[0]?.message).toBe('Digite um e-mail válido.');
  });

  it('o "Esqueci minha senha" normaliza o e-mail do mesmo jeito', () => {
    expect(resetEmailSchema.safeParse(' Fa@X.com ').data).toBe('fa@x.com');
    expect(resetEmailSchema.safeParse('').success).toBe(false);
  });
});

const parseName = (name: string) =>
  signUpSchema.safeParse({ name, email: 'fa@x.com', password: '123456' });

const nameError = (name: string) => parseName(name).error?.issues[0]?.message;

describe('nome do cadastro (mesmas regras do firestore.rules)', () => {
  it.each([
    ['Camila Ribeiro', 'Camila Ribeiro'],
    ['  Camila Ribeiro  ', 'Camila Ribeiro'],
    ['Camila Ribeiro 🎶', 'Camila Ribeiro 🎶'],
    ['Camila \u{1F469}‍\u{1F3A4}', 'Camila \u{1F469}‍\u{1F3A4}'],
    ["D'Ávila-Souza Jr.", "D'Ávila-Souza Jr."],
    ['张伟', '张伟'],
    ['x'.repeat(DISPLAY_NAME_MAX), 'x'.repeat(DISPLAY_NAME_MAX)],
  ])('%j passa como %j', (typed, saved) => {
    const result = parseName(typed);
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe(saved);
  });

  it('junta os acentos separados (NFC), como a função de cadastro', () => {
    const decomposed = 'Cámila José'.normalize('NFD');
    expect(parseName(decomposed).data?.name).toBe('Cámila José'.normalize('NFC'));
  });

  it('tira os isolantes bidi do texto colado, que a regra recusa', () => {
    expect(parseName('⁦Camila⁩ Ribeiro').data?.name).toBe('Camila Ribeiro');
    expect(parseName('Camila ⁧Ribeiro⁨').data?.name).toBe('Camila Ribeiro');
  });

  it.each(['', '   ', '⁦⁩'])('%j pede o nome', (typed) => {
    expect(nameError(typed)).toBe(t('validation.nameRequired'));
  });

  it('passa de 60 caracteres', () => {
    expect(nameError('x'.repeat(DISPLAY_NAME_MAX + 1))).toBe(
      t('validation.nameMax', { max: DISPLAY_NAME_MAX }),
    );
  });

  it('conta como a função: emoji vale 2, e o nome não chega ao perfil cortado', () => {
    const almost = 'x'.repeat(DISPLAY_NAME_MAX - 1);
    expect(parseName(`${almost}🎶`).success).toBe(false);
  });

  it.each([
    ['quebra de linha', 'Camila\nRibeiro'],
    ['largura zero', '​'],
    ['Hangul em branco', 'ㅤ'],
    ['inversão bidi', '‮gpj.exe'],
    ['acento solto no início', '́Camila'],
    ['zalgo', 'a' + '̶'.repeat(20)],
    ['ZWJ entre letras', 'A‍B'],
    ['caractere em branco novo', 'Camila ⁥ Ribeiro'],
  ])('recusa %s com a mensagem de nome inválido', (_, typed) => {
    expect(nameError(typed)).toBe(t('validation.nameInvalid'));
  });

  it('e-mail e senha seguem as regras do login', () => {
    const result = signUpSchema.safeParse({
      name: 'Camila',
      email: ' Fa@X.com',
      password: '12345',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['password']);
  });
});
