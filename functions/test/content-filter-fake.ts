import { vi } from 'vitest';

import type * as ContentFilter from '../src/content-filter';

/**
 * O filtro falso dos testes puros dos ganchos (docs/arquitetura-api.md,
 * 30.11): nenhum termo da lista de verdade entra no repositório (resposta 1 do
 * dono, 30.4), então os testes trocam o `content-filter` por um filtro do
 * `createFilter` com palavras neutras. O `abacaxi` faz o papel do palavrão
 * (`profanity`), e a "Vila Berinjela", o de uma cidade com um termo dentro.
 *
 * Uso, no topo do teste (o `vi.mock` sobe para antes dos imports):
 *
 *   vi.mock('../content-filter', async (importOriginal) => {
 *     const { fakeContentFilter } = await import('../../test/content-filter-fake.js');
 *     return fakeContentFilter(await importOriginal());
 *   });
 */
export const FAKE_FILTER_TERMS: readonly ContentFilter.FilterTerm[] = [
  { term: 'pepino', category: 'insult', forms: ['pepina'] },
  { term: 'abacaxi', category: 'profanity' },
  { term: 'berinjela', category: 'hate', inHandle: true },
  { term: 'chuchu azedo', category: 'violence' },
];

export const FAKE_FILTER_EXCEPTIONS: readonly string[] = ['Vila Berinjela'];

/**
 * O módulo de verdade com as três conferências trocadas pelas do filtro falso,
 * em `vi.fn` (o teste confere quando o gancho chama e quando não chama). O
 * resto (o `FILTERED_NAME`, o `createFilter`) fica o de verdade. Só tipos do
 * módulo são importados aqui: o valor dele já é o falso dentro do teste.
 */
export function fakeContentFilter(real: typeof ContentFilter): typeof ContentFilter {
  const fake = real.createFilter(FAKE_FILTER_TERMS, {
    exceptions: FAKE_FILTER_EXCEPTIONS,
    key: real.plainKey,
  });
  return {
    ...real,
    isBlockedText: vi.fn(fake.isBlockedText),
    isBlockedHandle: vi.fn(fake.isBlockedHandle),
    isBlockedSocial: vi.fn(fake.isBlockedSocial),
  };
}
