import { passwordStrength, type PasswordStrength } from '../password-strength';
import { PASSWORD_MIN_LENGTH, signInSchema } from '../schemas';

type Case = [password: string, strength: PasswordStrength, why: string];

// Um "é" decomposto: a letra e o acento agudo solto (U+0301), em dois pontos de código.
const DECOMPOSED = `abcdefghie${String.fromCodePoint(0x301)}`;

const CASES: Case[] = [
  ['', 'empty', 'nada digitado'],
  ['a', 'short', 'um caractere'],
  ['12345', 'short', 'um a menos que o mínimo'],
  ['Ab1!x', 'short', 'variada, mas abaixo do mínimo'],
  ['😀😀😀', 'short', 'três emojis são três caracteres, e não seis'],
  ['123456', 'good', 'o mínimo, só números'],
  ['abcdef', 'good', 'o mínimo, só minúsculas'],
  ['😀😀😀😀😀😀', 'good', 'seis emojis'],
  ['senha-123', 'good', 'três tipos, mas com 9 caracteres'],
  ['abcdefghij', 'good', '10 minúsculas são um tipo só'],
  ['ABCDEFGHIJ', 'good', '10 maiúsculas são um tipo só'],
  ['1234567890', 'good', '10 números são um tipo só'],
  ['!!!!!!!!!!', 'good', '10 símbolos são um tipo só'],
  ['çãéíõúàâêô', 'good', 'minúscula com acento continua minúscula'],
  [DECOMPOSED, 'good', 'o acento solto de uma letra decomposta não vira símbolo'],
  ['漢字漢字漢字漢字漢字', 'good', 'letra sem caixa não entra em nenhum tipo'],
  ['abcdefghi1', 'strong', 'minúscula e número'],
  ['Abcdefghij', 'strong', 'minúscula e maiúscula'],
  ['abcdefghi!', 'strong', 'minúscula e símbolo'],
  ['ABCDEFGHI ', 'strong', 'o espaço conta como símbolo'],
  ['123456789#', 'strong', 'número e símbolo'],
  ['coração123', 'strong', 'letra com acento e número'],
  ['senha😀😀😀😀😀', 'strong', 'o emoji conta como símbolo'],
  ['Senha-Forte-2026', 'strong', 'os quatro tipos'],
];

describe('força da senha do cadastro', () => {
  it.each(CASES)('"%s" é %s: %s', (password, strength) => {
    expect(passwordStrength(password)).toBe(strength);
  });

  it('a senha deixa de ser curta no mínimo do formulário', () => {
    expect(passwordStrength('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('short');
    expect(passwordStrength('a'.repeat(PASSWORD_MIN_LENGTH))).toBe('good');
  });

  it('forte pede 10 caracteres: com 9, dois tipos ainda são só uma senha boa', () => {
    expect(passwordStrength('abcdefgh1')).toBe('good');
    expect(passwordStrength('abcdefgh12')).toBe('strong');
  });

  // O medidor é só um apoio: ele nunca chama de boa a senha que o envio recusa,
  // nem de curta a que o envio aceita.
  it.each(CASES)('"%s": o formulário só recusa a que o medidor chama de curta', (password) => {
    const accepted = signInSchema.safeParse({ email: 'fa@x.com', password }).success;
    const strength = passwordStrength(password);
    expect(accepted).toBe(strength === 'good' || strength === 'strong');
  });
});
