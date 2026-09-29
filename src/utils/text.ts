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

// Acentos e outros sinais que o NFD separa da letra.
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Forma de comparar na busca: sem acento, sem maiúscula e com os espaços
 * juntados ("  São  João " e "sao joao" dão o mesmo).
 */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ');
}

/** O texto contém a busca, sem ligar para acento nem maiúscula. Busca vazia casa com tudo. */
export function matchesSearch(text: string, query: string): boolean {
  const needle = searchKey(query);
  return needle === '' || searchKey(text).includes(needle);
}
