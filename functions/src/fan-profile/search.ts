import {
  FieldPath,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

// A busca de fãs da seção Fãs do painel (bloco 11, docs/arquitetura-api.md,
// 26.7): `users.searchKeys` guarda os começos de cada palavra do nome e do @,
// sem acento e em minúsculas, e o painel consulta com `array-contains` a
// palavra mais longa do que foi digitado. O Firestore não busca por pedaço de
// texto. Só o servidor grava o campo: o cadastro (createProfile), o gatilho do
// perfil quando o nome ou o @ mudam e a carga scripts/backfill-fan-search.mjs,
// para os perfis de antes. O painel tem o mesmo `normalizeSearch`: mudou aqui,
// mude lá e nos dois testes.

/** Menor começo guardado: palavra de uma letra fica de fora. */
export const SEARCH_PREFIX_MIN = 2;

/** Maior começo guardado; a busca do painel corta a palavra no mesmo tamanho. */
export const SEARCH_PREFIX_MAX = 15;

/** Teto de chaves por fã (cada uma é uma entrada de índice). */
export const SEARCH_KEYS_MAX = 120;

/**
 * O texto como a busca compara: sem acento (NFD sem as marcas), em
 * minúsculas, e o que não é `a-z` ou `0-9` vira espaço (hífen, `_`, emoji,
 * pontuação, letras sem forma básica como "ø"), com os espaços juntados.
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** As palavras de 2 letras ou mais de um texto normalizado. */
export function searchWords(text: string): string[] {
  return normalizeSearch(text)
    .split(' ')
    .filter((word) => word.length >= SEARCH_PREFIX_MIN);
}

/**
 * As chaves de busca de um fã (puro): para cada palavra do @ (sem o `@`) e do
 * nome, os começos de 2 a 15 letras ("camila" dá "ca", "cam", "cami",
 * "camil" e "camila"), na ordem, sem repetir, no máximo 120. O @ vem antes,
 * para nunca ficar de fora do teto.
 */
export function fanSearchKeys(
  displayName: string | null | undefined,
  username: string | null | undefined,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const words = [
    ...searchWords((username ?? '').replace(/^@/, '')),
    ...searchWords(displayName ?? ''),
  ];
  for (const word of words) {
    const top = Math.min(word.length, SEARCH_PREFIX_MAX);
    for (let size = SEARCH_PREFIX_MIN; size <= top; size += 1) {
      if (keys.length >= SEARCH_KEYS_MAX) return keys;
      const key = word.slice(0, size);
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** As chaves de agora de um perfil lido. */
export function searchKeysOf(profile: DocumentSnapshot): string[] {
  return fanSearchKeys(text(profile.get('displayName')), text(profile.get('username')));
}

/** O `searchKeys` gravado é igual ao calculado (mesma ordem). */
export function sameSearchKeys(stored: unknown, keys: readonly string[]): boolean {
  return (
    Array.isArray(stored) &&
    stored.length === keys.length &&
    stored.every((key, index) => key === keys[index])
  );
}

/** Perfis lidos por página na carga. */
const PAGE = 500;

/** Perfis por transação na carga. */
const WRITE_CHUNK = 200;

async function* profilePages(db: Firestore): AsyncGenerator<DocumentSnapshot[]> {
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection('users')
      .orderBy(FieldPath.documentId())
      .select('displayName', 'username', 'searchKeys')
      .limit(PAGE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    yield page.docs;
    if (page.size < PAGE) return;
    last = page.docs.at(-1)!;
  }
}

const isStale = (doc: DocumentSnapshot) =>
  !sameSearchKeys(doc.get('searchKeys'), searchKeysOf(doc));

export type FanSearchBackfill = { total: number; stale: number };

/** Lê `users` em páginas e conta os perfis sem o `searchKeys` de agora. Só lê (o `--dry-run`). */
export async function countFanSearchKeys(db: Firestore): Promise<FanSearchBackfill> {
  let total = 0;
  let stale = 0;
  for await (const docs of profilePages(db)) {
    total += docs.length;
    stale += docs.filter(isStale).length;
  }
  return { total, stale };
}

/**
 * Grava o `searchKeys` dos perfis em que ele falta ou difere, em transações de
 * até 200 perfis: cada uma relê os perfis (o nome pode ter mudado no meio, e
 * o perfil que sumiu não é recriado) e grava só onde ainda difere, sem
 * `updatedAt` (o carimbo da gravação do primeiro nome pelo fã, a única que a
 * regra deixa desde o perfil novo, seção 28; o servidor nunca grava). A
 * gravação dispara o gatilho do perfil, que não vê nome nem @ mudados e não
 * faz nada. Rodar de novo não grava nada. Devolve quantos gravou.
 */
export async function writeFanSearchKeys(db: Firestore): Promise<number> {
  let written = 0;
  for await (const docs of profilePages(db)) {
    const stale = docs.filter(isStale).map((doc) => doc.ref);
    for (let start = 0; start < stale.length; start += WRITE_CHUNK) {
      written += await writeChunk(db, stale.slice(start, start + WRITE_CHUNK));
    }
  }
  return written;
}

function writeChunk(db: Firestore, refs: readonly DocumentReference[]): Promise<number> {
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    let count = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const keys = searchKeysOf(snap);
      if (sameSearchKeys(snap.get('searchKeys'), keys)) continue;
      tx.update(snap.ref, { searchKeys: keys });
      count += 1;
    }
    return count;
  });
}
