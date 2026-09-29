const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Iniciais do avatar sem foto: primeira e última palavra ("Davi Lima" dá "DL",
 * "Maria Clara Souza" dá "MS"). Com uma palavra só, as duas primeiras letras
 * dela ("Nenho" dá "NE", como no protótipo). Palavra sem letra nem número,
 * como um emoji, fica de fora; nome vazio devolve vazio.
 */
export function initialsOf(name: string): string {
  const words = name
    .normalize('NFC')
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).filter((char) => LETTER_OR_DIGIT.test(char)))
    .filter((chars) => chars.length > 0);

  const first = words[0];
  if (!first) return '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const initials = last ? `${first[0] ?? ''}${last[0] ?? ''}` : first.slice(0, 2).join('');
  return initials.toLocaleUpperCase('pt-BR');
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
