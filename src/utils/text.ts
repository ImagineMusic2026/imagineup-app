const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Iniciais do avatar sem foto: primeira e última palavra ("Davi Lima" dá "DL",
 * "Maria Clara Souza" dá "MS"). Palavra sem letra nem número, como um emoji,
 * fica de fora; nome vazio devolve vazio.
 */
export function initialsOf(name: string): string {
  const initials = name
    .normalize('NFC')
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).find((char) => LETTER_OR_DIGIT.test(char)))
    .filter((char): char is string => char !== undefined);

  if (initials.length === 0) return '';
  const first = initials[0] ?? '';
  const last = initials.length > 1 ? (initials[initials.length - 1] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase('pt-BR');
}
