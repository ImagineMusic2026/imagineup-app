import { PASSWORD_MIN_LENGTH } from './schemas';

/**
 * Força da senha que o medidor do cadastro mostra:
 * - `empty`: nada digitado;
 * - `short`: abaixo do mínimo do formulário, que a recusa;
 * - `good`: passa na regra;
 * - `strong`: 10 caracteres ou mais, com pelo menos dois tipos entre
 *   minúscula, maiúscula, número e símbolo.
 */
export type PasswordStrength = 'empty' | 'short' | 'good' | 'strong';

// A partir de quantos caracteres, e com quantos tipos, a senha é forte.
const STRONG_MIN_LENGTH = 10;
const STRONG_MIN_KINDS = 2;

// Um tipo por expressão: minúscula, maiúscula, número e símbolo. Símbolo é o
// que não é letra nem número (espaço, pontuação, emoji); o acento solto de uma
// letra decomposta não conta, e letra sem caixa não entra em nenhum tipo.
const KINDS = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\p{M}]/u] as const;

/**
 * Só para o medidor: quem aceita ou recusa a senha é a regra do formulário
 * ("Pelo menos 6 caracteres"), e nenhuma senha boa deixa de passar por não ser
 * forte. O tamanho conta pontos de código, como o `.min()` do zod 4 (um emoji
 * vale 1): o que o medidor chama de curta é o que o formulário recusa.
 */
export function passwordStrength(password: string): PasswordStrength {
  const length = Array.from(password).length;
  if (length === 0) return 'empty';
  if (length < PASSWORD_MIN_LENGTH) return 'short';
  if (length < STRONG_MIN_LENGTH) return 'good';
  const kinds = KINDS.filter((kind) => kind.test(password)).length;
  return kinds >= STRONG_MIN_KINDS ? 'strong' : 'good';
}
