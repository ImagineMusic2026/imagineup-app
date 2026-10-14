import { createHash } from 'node:crypto';

import {
  FILTER_NORMALIZATION_VERSION,
  filterTokens,
  handleSkeleton,
  joinSingles,
  type FilterPiece,
  type FilterRun,
} from './normalize';

/**
 * Casamento do filtro do que o fã publica (docs/arquitetura-api.md, 30.3 e
 * 30.4). A lista chega como chaves (o SHA-256 de cada pedaço normalizado, opção
 * (a') da pergunta 1 do dono), compila na primeira conferência e responde só
 * sim ou não: a categoria e o termo nunca saem deste módulo. Nada de expressão
 * regular montada com termo.
 */

/** As categorias da lista (30.4). */
export type FilterCategory = 'insult' | 'profanity' | 'hate' | 'sexual' | 'violence';

export const FILTER_CATEGORIES: readonly FilterCategory[] = [
  'insult',
  'profanity',
  'hate',
  'sexual',
  'violence',
];

/**
 * Uma entrada legível: a lista fora do repositório (`filtro-lista/termos.json`)
 * e a lista falsa dos testes do motor. Nunca no repositório com termo de
 * verdade.
 */
export type FilterTerm = {
  /** Como se escreve, com acento; a frase com espaço entre as palavras. */
  readonly term: string;
  readonly category: FilterCategory;
  /** Feminino, plural em -ões e -ães, diminutivo, aumentativo, formas verbais. */
  readonly forms?: readonly string[];
  /** Vale como trecho dentro de um pedaço dos campos de identidade. */
  readonly inHandle?: true;
};

/** Uma entrada como o `terms.ts` guarda: as chaves, nunca o texto. */
export type FilterEntryKeys = {
  readonly category: FilterCategory;
  /** O termo e cada forma, como as chaves dos pedaços. */
  readonly forms: readonly (readonly string[])[];
  /** A chave de cada um com os pedaços juntos. */
  readonly joined: readonly string[];
  /** Com `inHandle`: o tamanho de cada um junto, para os trechos. */
  readonly handleLengths?: readonly number[];
};

/** Os campos de texto que o `isBlockedText` confere. */
export type FilterTextField = 'comment' | 'bio' | 'displayName' | 'city';
export type FilterField = FilterTextField | 'username' | 'socials';
export type FieldBlocks = Readonly<Record<FilterField, readonly FilterCategory[]>>;

const FIELDS: readonly FilterField[] = [
  'comment',
  'bio',
  'displayName',
  'city',
  'username',
  'socials',
];

/**
 * O que cada campo barra, num lugar só (decisão 8): no começo, toda categoria
 * em todo campo. Liberar o palavrão no comentário e na bio depois da aprovação
 * das lojas é tirar o `profanity` dos dois e publicar a `api`.
 */
export const FIELD_BLOCKS: FieldBlocks = {
  comment: FILTER_CATEGORIES,
  bio: FILTER_CATEGORIES,
  displayName: FILTER_CATEGORIES,
  city: FILTER_CATEGORIES,
  username: FILTER_CATEGORIES,
  socials: FILTER_CATEGORIES,
};

/** Os tetos da lista (30.4). */
export const FILTER_LIMITS = {
  /** Entradas; as formas não contam. */
  entries: 400,
  /** Formas por entrada, além do termo. */
  forms: 12,
  exceptions: 200,
  /** Tamanho do termo, da forma e da exceção normalizados, com os pedaços juntos. */
  minLength: 2,
  maxLength: 40,
  /** Pedaços de uma frase (a palavra tem 1). */
  phrasePieces: 5,
  /** Tamanho mínimo do `inHandle`, com os pedaços juntos. */
  handleMinLength: 5,
} as const;

/** A chave de um pedaço normalizado. */
export type PieceKey = (piece: string) => string;

/** O próprio pedaço: só nos testes do motor. */
export const plainKey: PieceKey = (piece) => piece;

/** O SHA-256 do pedaço, em hexadecimal: a chave do `terms.ts`. */
export const sha256Key: PieceKey = (piece) =>
  createHash('sha256').update(piece, 'utf8').digest('hex');

export type FilterOptions = {
  /** Palavras e frases inocentes, legíveis (Ponta Porã). */
  readonly exceptions?: readonly string[];
  readonly fieldBlocks?: FieldBlocks;
  /** Padrão: `sha256Key`. */
  readonly key?: PieceKey;
};

export type KeyedFilterOptions = FilterOptions & {
  /** A `FILTER_NORMALIZATION_VERSION` com que as chaves foram geradas. */
  readonly normalizationVersion?: number;
};

export type ContentFilter = {
  isBlockedText(text: string, field: FilterTextField): boolean;
  isBlockedHandle(username: string): boolean;
  isBlockedSocial(handle: string): boolean;
};

// --- Forma da lista ------------------------------------------------------------

// A mensagem leva só o índice, nunca o termo: o `logger.error` da `api` leva a
// `error.message`.
const entryError = (index: number) =>
  new Error(`Filtro de conteúdo: a entrada ${index} está fora da forma.`);
const exceptionError = (index: number) =>
  new Error(`Filtro de conteúdo: a exceção ${index} está fora da forma.`);

const LETTER = /[a-z]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCategory = (value: unknown): value is FilterCategory =>
  FILTER_CATEGORIES.includes(value as FilterCategory);

const isKey = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Um termo, uma forma ou uma exceção normalizados: os pedaços e o esqueleto. */
type NormalTerm = { readonly pieces: readonly string[]; readonly skeleton: string };

/**
 * Os passos de 30.3 num termo, numa forma ou numa exceção, ou `null` fora da
 * forma: de 1 a 5 pedaços, cada um com uma versão só (sem número nem símbolo
 * nas pontas, e sem o 1 nem símbolo no miolo: o termo é escrito com letras) e
 * com letra (nenhum termo é número), e de 2 a 40 caracteres com os pedaços
 * juntos.
 */
function normalTerm(text: unknown): NormalTerm | null {
  if (typeof text !== 'string') return null;
  const { pieces } = filterTokens(text);
  if (pieces.length === 0 || pieces.length > FILTER_LIMITS.phrasePieces) return null;
  const plain: string[] = [];
  for (const piece of pieces) {
    const [only] = piece;
    if (piece.length !== 1 || only === undefined || !LETTER.test(only)) return null;
    plain.push(only);
  }
  const skeleton = handleSkeleton(text);
  const [glued] = skeleton;
  if (skeleton.length !== 1 || glued === undefined) return null;
  if (glued.length < FILTER_LIMITS.minLength || glued.length > FILTER_LIMITS.maxLength) return null;
  return { pieces: plain, skeleton: glued };
}

/**
 * As chaves de uma entrada legível, com a entrada conferida contra os tetos.
 * Usado pelo `createFilter` (a lista falsa dos testes) e pelo
 * `scripts/content-filter-keys.mjs`, que gera o `terms.ts` a partir da lista
 * fora do repositório. Fora da forma, lança com só o índice.
 */
export function entryKeysOf(term: FilterTerm, key: PieceKey, index: number): FilterEntryKeys {
  if (!isRecord(term) || !isCategory(term.category)) throw entryError(index);
  const forms: unknown = term.forms ?? [];
  if (!Array.isArray(forms) || forms.length > FILTER_LIMITS.forms) throw entryError(index);
  if (term.inHandle !== undefined && term.inHandle !== true) throw entryError(index);
  const keys: string[][] = [];
  const joined: string[] = [];
  const lengths: number[] = [];
  for (const text of [term.term, ...(forms as unknown[])]) {
    const normal = normalTerm(text);
    if (!normal) throw entryError(index);
    if (term.inHandle && normal.skeleton.length < FILTER_LIMITS.handleMinLength) {
      throw entryError(index);
    }
    keys.push(normal.pieces.map(key));
    joined.push(key(normal.skeleton));
    lengths.push(normal.skeleton.length);
  }
  return term.inHandle
    ? { category: term.category, forms: keys, joined, handleLengths: lengths }
    : { category: term.category, forms: keys, joined };
}

/** Uma entrada do `terms.ts` conferida (as chaves não dizem o tamanho do termo). */
function checkEntry(entry: unknown, index: number): FilterEntryKeys {
  if (!isRecord(entry) || !isCategory(entry.category)) throw entryError(index);
  const { forms, joined, handleLengths } = entry;
  if (!Array.isArray(forms) || forms.length < 1 || forms.length > FILTER_LIMITS.forms + 1) {
    throw entryError(index);
  }
  const formsFit = forms.every(
    (form) =>
      Array.isArray(form) &&
      form.length >= 1 &&
      form.length <= FILTER_LIMITS.phrasePieces &&
      form.every(isKey),
  );
  if (!formsFit) throw entryError(index);
  if (!Array.isArray(joined) || joined.length !== forms.length || !joined.every(isKey)) {
    throw entryError(index);
  }
  const lengthsFit =
    handleLengths === undefined ||
    (Array.isArray(handleLengths) &&
      handleLengths.length === forms.length &&
      handleLengths.every(
        (length) =>
          Number.isInteger(length) &&
          length >= FILTER_LIMITS.handleMinLength &&
          length <= FILTER_LIMITS.maxLength,
      ));
  if (!lengthsFit) throw entryError(index);
  return entry as FilterEntryKeys;
}

// --- Compilação ----------------------------------------------------------------

type Categories = ReadonlySet<FilterCategory>;
type Phrase = { readonly rest: readonly string[]; readonly category: FilterCategory };

type Compiled = {
  readonly key: PieceKey;
  readonly blocks: Readonly<Record<FilterField, Categories>>;
  /** O pedaço inteiro: a palavra, ou a frase com os pedaços juntos. */
  readonly wholes: ReadonlyMap<string, Categories>;
  /** As frases, pela chave do primeiro pedaço. */
  readonly phrases: ReadonlyMap<string, readonly Phrase[]>;
  /** Os `inHandle`, pela chave junta, com os tamanhos que a lista tem. */
  readonly handles: ReadonlyMap<string, Categories>;
  readonly handleLengths: readonly number[];
  readonly exceptions: readonly NormalTerm[];
};

function addCategory(
  map: Map<string, Set<FilterCategory>>,
  key: string,
  category: FilterCategory,
): void {
  const categories = map.get(key);
  if (categories) categories.add(category);
  else map.set(key, new Set([category]));
}

function compile(entries: readonly unknown[], options: KeyedFilterOptions): Compiled {
  const version = options.normalizationVersion;
  if (version !== undefined && version !== FILTER_NORMALIZATION_VERSION) {
    throw new Error('Filtro de conteúdo: as chaves são de outra versão da normalização.');
  }
  if (!Array.isArray(entries) || entries.length > FILTER_LIMITS.entries) {
    throw new Error('Filtro de conteúdo: a lista passa do teto de entradas.');
  }
  const exceptionTexts: unknown = options.exceptions ?? [];
  if (!Array.isArray(exceptionTexts) || exceptionTexts.length > FILTER_LIMITS.exceptions) {
    throw new Error('Filtro de conteúdo: a lista passa do teto de exceções.');
  }

  const wholes = new Map<string, Set<FilterCategory>>();
  const phrases = new Map<string, Phrase[]>();
  const handles = new Map<string, Set<FilterCategory>>();
  const lengths = new Set<number>();
  entries.forEach((raw, index) => {
    const entry = checkEntry(raw, index);
    entry.forms.forEach((form, formIndex) => {
      const joined = entry.joined[formIndex]!;
      addCategory(wholes, joined, entry.category);
      const [first, ...rest] = form;
      if (first !== undefined && rest.length > 0) {
        const list = phrases.get(first) ?? [];
        list.push({ rest, category: entry.category });
        phrases.set(first, list);
      }
      const length = entry.handleLengths?.[formIndex];
      if (length !== undefined) {
        addCategory(handles, joined, entry.category);
        lengths.add(length);
      }
    });
  });

  const exceptions = (exceptionTexts as unknown[]).map((text, index) => {
    const normal = normalTerm(text);
    if (!normal) throw exceptionError(index);
    return normal;
  });

  const fieldBlocks = options.fieldBlocks ?? FIELD_BLOCKS;
  const blocks = {} as Record<FilterField, Categories>;
  // Campo sem conjunto barra tudo: nunca filtro desligado por engano.
  for (const field of FIELDS) blocks[field] = new Set(fieldBlocks[field] ?? FILTER_CATEGORIES);

  return {
    key: options.key ?? sha256Key,
    blocks,
    wholes,
    phrases,
    handles,
    handleLengths: [...lengths].sort((a, b) => a - b),
    exceptions,
  };
}

/** Compila na primeira chamada e guarda o resultado ou a falha (sem compilar de novo). */
function lazily<T>(build: () => T): () => T {
  let done: { readonly value: T } | { readonly error: unknown } | undefined;
  return () => {
    if (done === undefined) {
      try {
        done = { value: build() };
      } catch (error) {
        done = { error };
      }
    }
    if ('error' in done) throw done.error;
    return done.value;
  };
}

// --- Conferência ---------------------------------------------------------------

/** Um pedaço na sequência do texto, coberto quando faz parte de uma exceção. */
type Token = { readonly versions: FilterPiece; covered: boolean; readonly run?: true };

/** A palavra com `s` ou `es` no fim também vale (30.3). */
function stems(versions: FilterPiece): string[] {
  const out = new Set<string>();
  for (const version of versions) {
    out.add(version);
    if (version.length > 1 && version.endsWith('s')) out.add(version.slice(0, -1));
    if (version.length > 2 && version.endsWith('es')) out.add(version.slice(0, -2));
  }
  return [...out];
}

/** Uma conferência: o campo, as categorias que ele barra e as chaves já calculadas. */
class Scan {
  private readonly keys = new Map<string, string>();
  private readonly allowed: Categories;

  constructor(
    private readonly compiled: Compiled,
    field: FilterField,
  ) {
    this.allowed = compiled.blocks[field];
  }

  private key(text: string): string {
    let key = this.keys.get(text);
    if (key === undefined) {
      key = this.compiled.key(text);
      this.keys.set(text, key);
    }
    return key;
  }

  private barred(categories: Categories | undefined): boolean {
    if (!categories) return false;
    for (const category of categories) if (this.allowed.has(category)) return true;
    return false;
  }

  /** O pedaço inteiro é uma palavra ou uma frase com os pedaços juntos. */
  whole(versions: FilterPiece): boolean {
    return stems(versions).some((stem) => this.barred(this.compiled.wholes.get(this.key(stem))));
  }

  /** Uma frase com os pedaços seguidos, cada um pela regra da palavra. */
  phrase(sequence: readonly Token[]): boolean {
    for (let start = 0; start < sequence.length; start++) {
      const first = sequence[start]!;
      if (first.covered) continue;
      for (const stem of stems(first.versions)) {
        for (const phrase of this.compiled.phrases.get(this.key(stem)) ?? []) {
          if (!this.allowed.has(phrase.category)) continue;
          const follows = phrase.rest.every((key, offset) => {
            const token = sequence[start + 1 + offset];
            return (
              token !== undefined &&
              !token.covered &&
              stems(token.versions).some((next) => this.key(next) === key)
            );
          });
          if (follows) return true;
        }
      }
    }
    return false;
  }

  /** Um termo `inHandle` dentro do texto, fora do trecho que uma exceção cobre. */
  inHandle(text: string): boolean {
    if (this.compiled.handleLengths.length === 0) return false;
    const ranges = this.exceptionRanges(text);
    for (const length of this.compiled.handleLengths) {
      for (let start = 0; start + length <= text.length; start++) {
        const end = start + length;
        if (ranges.some(([from, to]) => from <= start && end <= to)) continue;
        if (this.barred(this.compiled.handles.get(this.key(text.slice(start, end))))) return true;
      }
    }
    return false;
  }

  /** O pedaço inteiro é uma exceção escrita junta ("pontapora"). */
  isException(versions: FilterPiece): boolean {
    return versions.some((version) =>
      this.compiled.exceptions.some((exception) => exception.skeleton === version),
    );
  }

  /** Marca os pedaços seguidos que formam uma exceção. */
  cover(sequence: Token[]): void {
    for (const exception of this.compiled.exceptions) {
      const size = exception.pieces.length;
      for (let start = 0; start + size <= sequence.length; start++) {
        const found = exception.pieces.every((piece, offset) =>
          sequence[start + offset]!.versions.includes(piece),
        );
        if (!found) continue;
        for (let offset = 0; offset < size; offset++) sequence[start + offset]!.covered = true;
      }
    }
  }

  private exceptionRanges(text: string): [number, number][] {
    const ranges: [number, number][] = [];
    for (const { skeleton } of this.compiled.exceptions) {
      for (let at = text.indexOf(skeleton); at !== -1; at = text.indexOf(skeleton, at + 1)) {
        ranges.push([at, at + skeleton.length]);
      }
    }
    return ranges;
  }
}

/** A sequência com cada grupo de letras soltas trocado pelo pedaço junto. */
function withRuns(sequence: readonly Token[], runs: readonly FilterRun[], scan: Scan): Token[] {
  const out: Token[] = [];
  let index = 0;
  for (const run of runs) {
    out.push(...sequence.slice(index, run.start).map((token) => ({ ...token })));
    const singles = sequence.slice(run.start, run.end);
    const covered = singles.every((token) => token.covered) || scan.isException(run.piece);
    out.push({ versions: run.piece, covered, run: true });
    index = run.end;
  }
  out.push(...sequence.slice(index).map((token) => ({ ...token })));
  return out;
}

// Cada modo tira de todo grupo até duas letras da cabeça e até duas do rabo.
const TRIMS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 0],
  [0, 2],
  [2, 1],
  [1, 2],
  [2, 2],
] as const;

/**
 * Os grupos de letras soltas sem as letras das pontas, quando sobram 3 ou
 * mais: a palavra soletrada ao lado de palavras de uma letra ("a", "e", "o",
 * "é" e o "i" do inglês, e as duas juntas, como "é o" e "e a") juntava as
 * letras delas ao grupo, e a frase escapava. Um modo de cada vez, em todos os
 * grupos do texto.
 */
function trimmedRuns(pieces: readonly FilterPiece[], runs: readonly FilterRun[]): FilterRun[][] {
  const out: FilterRun[][] = [];
  for (const [head, tail] of TRIMS) {
    let trimmedAny = false;
    const trimmed = runs.map((run) => {
      const start = run.start + head;
      const end = run.end - tail;
      if (end - start < 3) return run;
      trimmedAny = true;
      // A letra solta tem uma versão só, ela mesma (normalize.ts, joinSingles).
      const singles = pieces.slice(start, end).map(([single]) => single!);
      return { start, end, piece: joinSingles(singles) };
    });
    if (trimmedAny) out.push(trimmed);
  }
  return out;
}

/**
 * Um texto: todo pedaço pela palavra e pela frase junta, a frase pelos
 * pedaços seguidos e, nos campos de identidade, o trecho `inHandle` dentro de
 * cada pedaço. As letras soltas juntadas entram como um pedaço a mais, numa
 * segunda sequência, e de novo sem a letra de uma ponta do grupo.
 */
function textBlocked(scan: Scan, text: string, identity: boolean): boolean {
  const { pieces, runs } = filterTokens(text);
  const sequence: Token[] = pieces.map((versions) => ({
    versions,
    covered: scan.isException(versions),
  }));
  scan.cover(sequence);
  const pieceBlocked = (token: Token) =>
    !token.covered &&
    (scan.whole(token.versions) ||
      (identity && token.versions.some((version) => scan.inHandle(version))));
  if (sequence.some(pieceBlocked) || scan.phrase(sequence)) return true;
  if (runs.length === 0) return false;
  for (const grouping of [runs, ...trimmedRuns(pieces, runs)]) {
    const joined = withRuns(sequence, grouping, scan);
    scan.cover(joined);
    const blocked =
      joined.some((token) => token.run === true && pieceBlocked(token)) || scan.phrase(joined);
    if (blocked) return true;
  }
  return false;
}

/** O @: o esqueleto inteiro pela palavra e pela frase junta, e o trecho `inHandle`. */
function handleBlocked(scan: Scan, username: string): boolean {
  return handleSkeleton(username).some(
    (version) => (!scan.isException([version]) && scan.whole([version])) || scan.inHandle(version),
  );
}

/**
 * O usuário de uma rede: cada pedaço (separados por `.`, `_` e `-`) como no
 * nome, e o esqueleto colado só por igualdade, nunca por trecho (nomes comuns
 * colados com "do" e "da" formam trechos ofensivos).
 */
function socialBlocked(scan: Scan, handle: string): boolean {
  if (textBlocked(scan, handle, true)) return true;
  return handleSkeleton(handle).some(
    (version) => !scan.isException([version]) && scan.whole([version]),
  );
}

function filterOf(compiled: () => Compiled): ContentFilter {
  return {
    isBlockedText: (text, field) =>
      textBlocked(new Scan(compiled(), field), text, field === 'displayName' || field === 'city'),
    isBlockedHandle: (username) => handleBlocked(new Scan(compiled(), 'username'), username),
    isBlockedSocial: (handle) => socialBlocked(new Scan(compiled(), 'socials'), handle),
  };
}

/**
 * O filtro a partir das chaves (o `terms.ts`). Nada compila aqui: a lista
 * compila na primeira conferência, e a falha fica guardada.
 */
export function createFilterFromKeys(
  entries: readonly FilterEntryKeys[],
  options: KeyedFilterOptions = {},
): ContentFilter {
  return filterOf(lazily(() => compile(entries, options)));
}

/**
 * O filtro a partir de uma lista legível, com exceções e um `FIELD_BLOCKS`
 * quaisquer: a lista falsa dos testes. A chave padrão é a de produção.
 */
export function createFilter(
  terms: readonly FilterTerm[],
  options: FilterOptions = {},
): ContentFilter {
  const key = options.key ?? sha256Key;
  return filterOf(
    lazily(() => {
      if (terms.length > FILTER_LIMITS.entries) {
        throw new Error('Filtro de conteúdo: a lista passa do teto de entradas.');
      }
      return compile(
        terms.map((term, index) => entryKeysOf(term, key, index)),
        { ...options, key },
      );
    }),
  );
}
