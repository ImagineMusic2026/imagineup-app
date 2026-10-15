import { createFilterFromKeys, sha256Key, type FilterTextField } from './match';
import {
  FILTER_ENTRIES,
  FILTER_EXCEPTIONS,
  FILTER_NORMALIZATION_VERSION as TERMS_NORMALIZATION_VERSION,
} from './terms';

/**
 * O filtro do que o fã publica (docs/arquitetura-api.md, seção 30): o
 * comentário, o nome, o @, a bio, a cidade e as redes. Tudo puro e sem
 * leitura. A lista compila na primeira conferência, nunca na carga do módulo
 * (as 68 funções dividem o pacote, e as fracionadas não pagam isso na partida
 * a frio), e as respostas são só sim ou não.
 */

const filter = createFilterFromKeys(FILTER_ENTRIES, {
  exceptions: FILTER_EXCEPTIONS,
  key: sha256Key,
  normalizationVersion: TERMS_NORMALIZATION_VERSION,
});

/** O nome que entra no lugar do nome do cadastro barrado (decisão 11): o mesmo do app sem nome. */
export const FILTERED_NAME = 'Fã';

/** O texto do campo bate na lista: palavra e frase e, no nome e na cidade, o trecho. */
export const isBlockedText = (text: string, field: FilterTextField): boolean =>
  filter.isBlockedText(text, field);

/** O @ bate na lista: o esqueleto inteiro e o trecho. */
export const isBlockedHandle = (username: string): boolean => filter.isBlockedHandle(username);

/** O usuário de uma rede bate na lista: cada pedaço e o esqueleto colado por igualdade. */
export const isBlockedSocial = (handle: string): boolean => filter.isBlockedSocial(handle);

export {
  createFilter,
  createFilterFromKeys,
  entryKeysOf,
  FIELD_BLOCKS,
  FILTER_CATEGORIES,
  FILTER_LIMITS,
  plainKey,
  sha256Key,
} from './match';
export type {
  ContentFilter,
  FieldBlocks,
  FilterCategory,
  FilterEntryKeys,
  FilterField,
  FilterOptions,
  FilterTerm,
  FilterTextField,
} from './match';
export { FILTER_NORMALIZATION_VERSION, filterTokens, handleSkeleton } from './normalize';
export type { FilterPiece, FilterRun, FilterTokens } from './normalize';
