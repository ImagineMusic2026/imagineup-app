import type { Auth } from 'firebase-admin/auth';
import {
  DocumentReference,
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';

import { deleteUserData } from '../store';
import {
  accountSources,
  isAccountUid,
  isRecoveryDatabase,
  restoreKind,
  TARGET_DATABASE,
  type RestoreItem,
  type RestoreReport,
} from './model';

// O roteiro de restauração (docs/arquitetura-api.md, 31.3), contra o Firestore:
// as contas que a cópia conhece, a reexclusão na cópia de quem não tem mais
// conta no Auth, a comparação com o (default) e a gravação. O script
// scripts/restore-from-copy.mjs chama o restoreFromCopy.

/** Documentos por leitura e por transação de gravação. */
export const RESTORE_PAGE = 100;

/** Uids por consulta ao Auth (o limite do `getUsers`). */
const AUTH_LOOKUP_MAX = 100;

/** Documentos listados ao mesmo tempo ao descer pelas subcoleções. */
const LIST_CONCURRENCY = 16;

/** Roda `work` em cada item, com no máximo `limit` ao mesmo tempo, na ordem dos itens. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

function pages<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/** Recusa a cópia que não é banco de recuperação e o destino que não é o (default). */
export function assertRestoreDatabases(copy: Firestore, target: Firestore): void {
  if (!isRecoveryDatabase(copy.databaseId)) {
    throw new Error(`A cópia precisa ser um banco recuperacao-...: ${copy.databaseId}`);
  }
  if (target.databaseId !== TARGET_DATABASE) {
    throw new Error(`O destino precisa ser o ${TARGET_DATABASE}: ${target.databaseId}`);
  }
}

/**
 * Os uids que a cópia conhece, de toda fonte da `FAN_DATA_SOURCES` lida pelo
 * uid (`accountSources`): o id dos documentos (com os que só têm
 * subcoleções, de uma cópia tirada no meio de uma exclusão), os campos e as
 * listas de bloqueio dos outros.
 */
export async function copyAccountUids(copy: Firestore): Promise<string[]> {
  const uids = new Set<string>();
  const add = (value: unknown) => {
    if (isAccountUid(value)) uids.add(value);
  };
  for (const source of accountSources()) {
    if (source.kind === 'ids') {
      for (const ref of await copy.collection(source.collection).listDocuments()) add(ref.id);
    } else if (source.kind === 'field') {
      const query = source.group
        ? copy.collectionGroup(source.collection)
        : copy.collection(source.collection);
      const snap = await query.select(source.field).get();
      for (const doc of snap.docs) add(doc.get(source.field));
    } else if (source.kind === 'list') {
      const snap = await copy.collection(source.collection).select(source.field).get();
      for (const doc of snap.docs) {
        const items: unknown = doc.get(source.field);
        if (Array.isArray(items)) items.forEach(add);
      }
    } else {
      const snap = await copy.collectionGroup('standings').select().get();
      for (const doc of snap.docs) {
        if (doc.ref.parent.parent?.parent.id === 'seasons') add(doc.id);
      }
    }
  }
  return [...uids].sort();
}

/** Os uids sem conta no Auth, pelo `getUsers` de 100 em 100. */
export async function missingAccounts(auth: Auth, uids: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const page of pages(uids, AUTH_LOOKUP_MAX)) {
    const { notFound } = await auth.getUsers(page.map((uid) => ({ uid })));
    for (const identifier of notFound) {
      if ('uid' in identifier) missing.push(identifier.uid);
    }
  }
  return missing.sort();
}

/**
 * Tira da cópia cada conta excluída, pelo mesmo `deleteUserData` do gatilho
 * `deleteUserProfile` (seção 12): os dados dela e o que a exclusão muda nos
 * dos outros (as contagens, os pedidos da loja, os convidados, as filas da
 * moderação e os bloqueios). Sem o Storage: as fotos não estão na cópia, e o
 * gatilho já apagou as de verdade. Só num banco de recuperação.
 */
export async function reexcludeInCopy(copy: Firestore, uids: readonly string[]): Promise<void> {
  if (!isRecoveryDatabase(copy.databaseId)) {
    throw new Error(`A reexclusão só roda num banco recuperacao-...: ${copy.databaseId}`);
  }
  for (const uid of uids) await deleteUserData(copy, uid);
}

/**
 * Os documentos da cópia debaixo de um caminho: a coleção (com os documentos
 * que só têm subcoleções) ou o documento, e tudo abaixo deles, nível por nível.
 */
async function documentsUnder(copy: Firestore, path: string): Promise<DocumentReference[]> {
  const out: DocumentReference[] = [];
  let level =
    path.split('/').length % 2 === 0
      ? [copy.doc(path)]
      : await copy.collection(path).listDocuments();
  while (level.length > 0) {
    out.push(...level);
    const children = await mapLimit(level, LIST_CONCURRENCY, async (ref) => {
      const collections = await ref.listCollections();
      const nested = await Promise.all(collections.map((collection) => collection.listDocuments()));
      return nested.flat();
    });
    level = children.flat();
  }
  return out;
}

/** Os documentos da cópia debaixo dos caminhos, sem repetir, pela ordem do caminho. */
export async function copyDocuments(
  copy: Firestore,
  paths: readonly string[],
): Promise<DocumentReference[]> {
  const byPath = new Map<string, DocumentReference>();
  for (const path of paths) {
    for (const ref of await documentsUnder(copy, path)) byPath.set(ref.path, ref);
  }
  return [...byPath.keys()].sort().map((path) => byPath.get(path)!);
}

/** O valor da cópia pronto para o (default): a referência passa a apontar para ele. */
function restoredValue(value: unknown, target: Firestore): unknown {
  if (value instanceof DocumentReference) return target.doc(value.path);
  if (Array.isArray(value)) return value.map((item) => restoredValue(item, target));
  if (typeof value === 'object' && value !== null) {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, restoredValue(item, target)]),
      );
    }
  }
  return value;
}

/** Uma gravação planejada: o documento da cópia e o `updateTime` do (default) lido na comparação. */
export type RestoreWrite = {
  path: string;
  kind: 'create' | 'replace';
  data: DocumentData;
  updateTime: Timestamp | null;
};

export type RestorePlan = { items: RestoreItem[]; writes: RestoreWrite[] };

/**
 * A marca da primeira rodada numa cópia, só na cópia: a hora do servidor
 * antes da primeira reexclusão. O que nasceu na cópia depois dela nasceu da
 * reexclusão, desta rodada ou de uma anterior (o clone e o restore criam os
 * documentos antes, e ninguém mais grava na cópia).
 */
export const RESTORE_MARK = 'restoreFromCopy/start';

/** A hora da marca, gravada na primeira rodada com a hora da leitura (a do servidor). */
export async function reexclusionStart(copy: Firestore): Promise<Timestamp> {
  const ref = copy.doc(RESTORE_MARK);
  return copy.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored: unknown = snap.get('startedAt');
    if (stored instanceof Timestamp) return stored;
    tx.set(ref, { startedAt: snap.readTime });
    return snap.readTime;
  });
}

const isAfter = (a: Timestamp, b: Timestamp) =>
  a.seconds > b.seconds || (a.seconds === b.seconds && a.nanoseconds > b.nanoseconds);

/**
 * Compara cada documento da cópia debaixo dos caminhos com o do (default),
 * de 100 em 100 (`restoreKind`). O documento da cópia que só tem subcoleções
 * fica de fora (os de baixo entram), e o que nasceu na cópia depois de
 * `createdAfter` (a marca da reexclusão) sai como `reexclusion`, sem
 * gravação. Não grava nada.
 */
export async function planRestore(
  copy: Firestore,
  target: Firestore,
  paths: readonly string[],
  overwrite: boolean,
  createdAfter: Timestamp | null = null,
): Promise<RestorePlan> {
  const items: RestoreItem[] = [];
  const writes: RestoreWrite[] = [];
  for (const page of pages(await copyDocuments(copy, paths), RESTORE_PAGE)) {
    const [copySnaps, targetSnaps] = await Promise.all([
      copy.getAll(...page),
      target.getAll(...page.map((ref) => target.doc(ref.path))),
    ]);
    page.forEach((ref, index) => {
      const source = copySnaps[index]!;
      if (!source.exists) return;
      if (createdAfter !== null && source.createTime && isAfter(source.createTime, createdAfter)) {
        items.push({ path: ref.path, kind: 'reexclusion' });
        return;
      }
      const live = targetSnaps[index]!;
      const data = restoredValue(source.data(), target) as DocumentData;
      const kind = restoreKind(ref.path, data, live.exists ? live.data() : undefined, overwrite);
      items.push({ path: ref.path, kind });
      if (kind === 'create' || kind === 'replace') {
        writes.push({ path: ref.path, kind, data, updateTime: live.updateTime ?? null });
      }
    });
  }
  return { items, writes };
}

/**
 * Grava o plano no (default), de 100 em 100, cada página numa transação que
 * relê os documentos: o que falta só é criado se ainda faltar, e o diferente
 * só é substituído se não mudou desde a comparação (o mesmo `updateTime`). O
 * que mudou no meio fica como está e volta na lista. A página que falha
 * (depois das tentativas da transação) para a gravação: as de antes ficaram,
 * e o erro volta com o que foi gravado, para o resumo sair igual.
 */
export async function applyRestore(
  target: Firestore,
  writes: readonly RestoreWrite[],
): Promise<{ created: number; replaced: number; changed: string[]; error: string | null }> {
  let created = 0;
  let replaced = 0;
  const changed: string[] = [];
  for (const page of pages(writes, RESTORE_PAGE)) {
    const result = await commitPage(target, page).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );
    if (typeof result === 'string') return { created, replaced, changed, error: result };
    created += result.created;
    replaced += result.replaced;
    changed.push(...result.changed);
  }
  return { created, replaced, changed, error: null };
}

/** Uma página do plano numa transação que relê cada documento. */
function commitPage(target: Firestore, page: readonly RestoreWrite[]) {
  return target.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...page.map((write) => target.doc(write.path)));
    const out = { created: 0, replaced: 0, changed: [] as string[] };
    page.forEach((write, index) => {
      const snap = snaps[index]!;
      const still =
        write.kind === 'create'
          ? !snap.exists
          : snap.exists && write.updateTime !== null && snap.updateTime!.isEqual(write.updateTime);
      if (!still) {
        out.changed.push(write.path);
        return;
      }
      tx.set(snap.ref, write.data);
      if (write.kind === 'create') out.created += 1;
      else out.replaced += 1;
    });
    return out;
  });
}

export type RestoreDeps = {
  /** O banco de recuperação (o clone ou o restore da 31.3). */
  copy: Firestore;
  /** O (default). */
  target: Firestore;
  auth: Auth;
};

/**
 * A rodada inteira do roteiro (31.3):
 * 1. as contas que a cópia conhece e, delas, as que não têm conta no Auth
 *    hoje (a exclusão começa sempre pelo Auth, e nenhuma das cópias leva o
 *    Auth): saem da cópia pelo `deleteUserData`, também no --dry-run, porque
 *    a cópia é descartável e a lista tem de sair igual à da rodada de verdade.
 *    Antes, a marca da primeira rodada (`reexclusionStart`);
 * 2. a comparação dos caminhos com o (default), com o que a reexclusão criou
 *    na cópia de fora;
 * 3. sem --dry-run, a gravação, e o Auth de novo: a conta que saiu no meio
 *    da rodada volta no `late`, para a conferência.
 */
export async function restoreFromCopy(
  deps: RestoreDeps,
  input: { paths: readonly string[]; overwrite: boolean; dryRun: boolean },
): Promise<RestoreReport> {
  const { copy, target, auth } = deps;
  assertRestoreDatabases(copy, target);
  const start = await reexclusionStart(copy);
  const accounts = await copyAccountUids(copy);
  const reexcluded = await missingAccounts(auth, accounts);
  await reexcludeInCopy(copy, reexcluded);
  const plan = await planRestore(copy, target, input.paths, input.overwrite, start);
  const report: RestoreReport = {
    copy: copy.databaseId,
    paths: [...input.paths],
    overwrite: input.overwrite,
    dryRun: input.dryRun,
    accounts: accounts.length,
    reexcluded,
    items: plan.items,
    written: null,
    changed: [],
    late: [],
    error: null,
  };
  if (input.dryRun) return report;
  const applied = await applyRestore(target, plan.writes);
  const remaining = accounts.filter((uid) => !reexcluded.includes(uid));
  return {
    ...report,
    written: { created: applied.created, replaced: applied.replaced },
    changed: applied.changed,
    late: await missingAccounts(auth, remaining),
    error: applied.error,
  };
}
