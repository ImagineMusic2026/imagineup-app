import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FilterTerm } from '../src/content-filter';

/**
 * A lista legível do filtro do que o fã publica, fora de todo repositório
 * (resposta 1 do dono, docs/arquitetura-api.md, 30.4 e 30.11): a variável
 * CONTENT_FILTER_LIST ou `filtro-lista/termos.json`, na pasta que guarda este
 * repositório (assim vale no clone e no worktree). Sem ela (o CI), quem
 * precisa de um termo barrado pula o caso com um aviso. Nenhum termo é escrito
 * no repositório, nem em mensagem de teste ou log: o termo só vive em memória.
 */
export const LEGIBLE_LIST_PATH =
  process.env.CONTENT_FILTER_LIST ?? resolve(__dirname, '../../../filtro-lista/termos.json');

export type LegibleList = { readonly terms: FilterTerm[]; readonly exceptions: string[] };

/** A lista legível, só com os campos do `FilterTerm` (a nota de revisão fica de fora), ou null. */
export function readLegibleList(): LegibleList | null {
  if (!existsSync(LEGIBLE_LIST_PATH)) return null;
  const raw = JSON.parse(readFileSync(LEGIBLE_LIST_PATH, 'utf8')) as {
    terms: FilterTerm[];
    exceptions?: string[];
  };
  const terms = raw.terms.map(({ term, category, forms, inHandle }) => ({
    term,
    category,
    ...(forms === undefined ? {} : { forms }),
    ...(inHandle === undefined ? {} : { inHandle }),
  }));
  return { terms, exceptions: raw.exceptions ?? [] };
}

/** Sem acento e em minúsculas: o @ que o fã digitaria com o termo. */
const folded = (text: string): string =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** O termo barrado dos testes de emulador: como se escreve, e como @ (de 3 a 20 letras). */
export type BarredWord = { readonly text: string; readonly handle: string };

/**
 * O termo barrado escolhido por regra, sem nunca ser escrito: a primeira
 * entrada de uma palavra só, da categoria `insult`, que vale como trecho
 * (`inHandle`) e cabe num @ (só letras, de 3 a 20). Null sem a lista.
 */
export function barredWordOf(list: LegibleList | null): BarredWord | null {
  const entry = list?.terms.find(
    (item) =>
      item.category === 'insult' &&
      item.inHandle === true &&
      !/\s/.test(item.term.trim()) &&
      /^[a-z]{3,20}$/.test(folded(item.term)),
  );
  return entry ? { text: entry.term, handle: folded(entry.term) } : null;
}

/**
 * O aviso dos casos pulados (`what`: o arquivo e o que ficou de fora), direto
 * no stderr: o vitest esconde o console dos testes que passam.
 */
export function warnWithoutList(what: string): void {
  process.stderr.write(
    `Filtro de conteúdo: sem a lista legível (filtro-lista/termos.json), os casos do filtro em ${what} foram pulados. ` +
      'É o esperado no CI: a lista fica fora de todo repositório.\n',
  );
}
