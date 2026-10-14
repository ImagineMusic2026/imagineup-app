/**
 * Gera o functions/src/content-filter/terms.ts, a lista do filtro do que o fã
 * publica por chaves (docs/arquitetura-api.md, 30.4, opção (a') da pergunta 1
 * do dono):
 *
 *   npm --prefix functions run build
 *   node scripts/content-filter-keys.mjs [--lista <caminho do termos.json>]
 *   npx prettier --write functions/src/content-filter/terms.ts
 *
 * A lista legível fica fora de todo repositório: por padrão, em
 * filtro-lista/termos.json, na pasta que guarda este repositório (ou no
 * caminho da variável CONTENT_FILTER_LIST). O terms.ts leva, de cada termo e
 * de cada forma, o SHA-256 de cada pedaço normalizado e o do texto com os
 * pedaços juntos, a categoria e, nos inHandle, os tamanhos. As exceções vão
 * legíveis, porque são palavras comuns. Nenhum termo legível entra no
 * repositório.
 *
 * Usa o build das funções (a mesma normalização da conferência). Mudou a
 * normalização, rode de novo. Fora do package.json de propósito (os scripts
 * entram no fingerprint da EAS).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USAGE = 'Uso: node scripts/content-filter-keys.mjs [--lista <caminho do termos.json>]';

/** O caminho da lista: --lista, a variável CONTENT_FILTER_LIST ou o padrão. */
function listPath(args) {
  if (args.length === 0) {
    return (
      process.env.CONTENT_FILTER_LIST ??
      fileURLToPath(new URL('../../filtro-lista/termos.json', import.meta.url))
    );
  }
  if (args.length === 2 && args[0] === '--lista' && args[1]) return args[1];
  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const path = listPath(process.argv.slice(2));
if (!path) fail(USAGE);
if (!existsSync(path)) fail(`Não achei a lista legível em ${path}.\n${USAGE}`);

const matchBuild = fileURLToPath(
  new URL('../functions/lib/content-filter/match.js', import.meta.url),
);
if (!existsSync(matchBuild)) {
  fail('Falta o build das funções: rode npm --prefix functions run build.');
}

// O código das funções sai do build, com a mesma normalização da conferência.
const require = createRequire(import.meta.url);
const { createFilter, entryKeysOf, FILTER_LIMITS, sha256Key } = require(matchBuild);
const { FILTER_NORMALIZATION_VERSION } = require(
  fileURLToPath(new URL('../functions/lib/content-filter/normalize.js', import.meta.url)),
);

const list = JSON.parse(readFileSync(path, 'utf8'));
const { terms, exceptions = [] } = list;
if (!Array.isArray(terms)) fail('A lista precisa de "terms", uma lista de termos.');
if (!Array.isArray(exceptions) || !exceptions.every((text) => typeof text === 'string')) {
  fail('"exceptions" precisa ser uma lista de textos.');
}
if (terms.length > FILTER_LIMITS.entries) {
  fail(`A lista tem ${terms.length} entradas, acima do teto de ${FILTER_LIMITS.entries}.`);
}
if (exceptions.length > FILTER_LIMITS.exceptions) {
  fail(`A lista tem ${exceptions.length} exceções, acima do teto de ${FILTER_LIMITS.exceptions}.`);
}

// Só os campos do FilterTerm: a nota de revisão fica na lista legível.
const entries = terms.map((term, index) => {
  const clean = { term: term?.term, category: term?.category };
  if (term?.forms !== undefined) clean.forms = term.forms;
  if (term?.inHandle !== undefined) clean.inHandle = term.inHandle;
  try {
    return entryKeysOf(clean, sha256Key, index);
  } catch {
    // Aqui pode dizer o termo: a mensagem fica no terminal de quem gera.
    return fail(`A entrada ${index} ("${term?.term}") está fora da forma (30.4).`);
  }
});

// A mesma forma (os mesmos pedaços) em duas entradas, ou duas vezes na mesma.
const seen = new Map();
entries.forEach((entry, index) => {
  entry.forms.forEach((form, formIndex) => {
    const signature = form.join(' ');
    const before = seen.get(signature);
    if (before) {
      fail(
        `A forma ${formIndex} da entrada ${index} ("${terms[index].term}") repete a forma ` +
          `${before.formIndex} da entrada ${before.index} ("${terms[before.index].term}").`,
      );
    }
    seen.set(signature, { index, formIndex });
  });
});

// As exceções compilam com a lista (a conferência lança na exceção fora da forma).
try {
  createFilter(
    terms.map(({ term, category, forms, inHandle }) => ({ term, category, forms, inHandle })),
    { exceptions },
  ).isBlockedText('', 'comment');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const header = `import type { FilterEntryKeys } from './match';

/**
 * A lista do filtro do que o fã publica (docs/arquitetura-api.md, 30.4), por
 * chaves: o SHA-256 de cada pedaço normalizado e das frases com os pedaços
 * juntos, com a categoria e os tamanhos dos \`inHandle\`. A lista legível fica
 * fora de todo repositório (\`filtro-lista/termos.json\`, opção (a') da pergunta
 * 1 do dono), e nenhum termo legível entra aqui.
 *
 * Gerado por \`node scripts/content-filter-keys.mjs\`, depois do
 * \`npm --prefix functions run build\`. Não edite à mão: mude a lista legível e
 * gere de novo.
 */
`;

const body = [
  header,
  '/** A `FILTER_NORMALIZATION_VERSION` do `normalize.ts` com que as chaves foram geradas. */',
  `export const FILTER_NORMALIZATION_VERSION = ${FILTER_NORMALIZATION_VERSION};`,
  '',
  `export const FILTER_ENTRIES: readonly FilterEntryKeys[] = ${JSON.stringify(entries)};`,
  '',
  '/** Palavras e frases inocentes, legíveis (palavras comuns), que nunca batem. */',
  `export const FILTER_EXCEPTIONS: readonly string[] = ${JSON.stringify(exceptions)};`,
  '',
].join('\n');

const target = fileURLToPath(new URL('../functions/src/content-filter/terms.ts', import.meta.url));
writeFileSync(target, body, 'utf8');
const inHandle = entries.filter((entry) => entry.handleLengths).length;
console.log(
  `terms.ts gerado: ${entries.length} entradas (${inHandle} com trecho) e ${exceptions.length} exceções, ` +
    `normalização ${FILTER_NORMALIZATION_VERSION}.`,
);
console.log('Agora: npx prettier --write functions/src/content-filter/terms.ts');
