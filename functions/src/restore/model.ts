import { DocumentReference, type DocumentData } from 'firebase-admin/firestore';

import { FAN_DATA_SOURCES, type FanDataSource } from '../fan-data/sources';

// O roteiro de restauração (docs/arquitetura-api.md, 31.3): a linha de
// comando, os caminhos, as contas que a cópia conhece, a comparação dos
// documentos e o resumo que o script imprime. Puro: nada aqui lê o Firestore.

/** O banco de onde os documentos voltam tem este prefixo (o `recuperacao-AAAAMMDD` da 31.3). */
export const RECOVERY_DATABASE_PREFIX = 'recuperacao-';

/** O banco do app, para onde os documentos voltam. */
export const TARGET_DATABASE = '(default)';

export const RESTORE_USAGE = [
  'Uso: node scripts/restore-from-copy.mjs --from <recuperacao-...> --path <caminho> [--path <caminho>...]',
  '                                        [--overwrite] [--dry-run] [--project <id>]',
  '  --from: o banco criado pelo clone ou pelo restore (31.3), com o prefixo recuperacao-;',
  '  --path: uma coleção (rewards) ou um documento (users/<uid>), com tudo o que fica debaixo dele;',
  '  --overwrite: substitui também o documento que existe e está diferente (sem ele, só o que falta);',
  '  --dry-run: só conta e lista o que mudaria no (default);',
  '  com FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST: nos emuladores;',
  '  sem eles: só com --project (ex.: --project imagine-up-app), no projeto de verdade.',
].join('\n');

export type RestoreArgs = {
  from: string;
  paths: string[];
  overwrite: boolean;
  dryRun: boolean;
  project?: string;
};

/**
 * O id de um banco de recuperação: o prefixo e o resto como o Firestore
 * aceita (minúsculas, números e hífen, terminando em letra ou número, até 63).
 * O roteiro roda o `deleteUserData` nele: um banco que não é cópia nunca passa.
 */
export function isRecoveryDatabase(id: string): boolean {
  return id.length <= 63 && /^recuperacao-[a-z0-9-]*[a-z0-9]$/.test(id);
}

/**
 * O caminho de um `--path`, sem barra no começo nem no fim, sem trecho vazio,
 * sem `.` ou `..` e sem id reservado (`__...__`); null fora disso. Número
 * ímpar de trechos é coleção, par é documento.
 */
export function parseRestorePath(raw: string): string | null {
  const segments = raw.split('/');
  const bad = (segment: string) =>
    segment.trim() === '' || segment === '.' || segment === '..' || /^__.*__$/.test(segment);
  return segments.some(bad) ? null : segments.join('/');
}

/**
 * As coleções que dão acesso ao painel. Um membro removido ou um convite
 * cancelado depois da cópia faltam no (default) como um documento perdido, e
 * voltariam com o acesso: por elas, só documento a documento.
 */
export const ACCESS_COLLECTIONS: readonly string[] = ['staff', 'staffInvites'];

/** A linha de comando do script; `{ error }` com o motivo quando ela não está no formato. */
export function parseRestoreArgs(args: readonly string[]): RestoreArgs | { error: string } {
  let from: string | undefined;
  let project: string | undefined;
  const paths: string[] = [];
  let overwrite = false;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? splitOnce(arg) : [arg, null];
    const value = (): string | null => {
      if (inline !== null) return inline === '' ? null : inline;
      const next = args[index + 1];
      if (next === undefined || next.startsWith('-')) return null;
      index += 1;
      return next;
    };
    if (name === '--dry-run' && inline === null) {
      dryRun = true;
    } else if (name === '--overwrite' && inline === null) {
      overwrite = true;
    } else if (name === '--from') {
      const db = value();
      if (db === null) return { error: '--from sem o banco.' };
      from = db;
    } else if (name === '--path') {
      const raw = value();
      if (raw === null) return { error: '--path sem o caminho.' };
      const path = parseRestorePath(raw);
      if (path === null) return { error: `Caminho fora do formato: ${raw}` };
      if (ACCESS_COLLECTIONS.includes(path)) {
        return {
          error: `${path} não volta pela coleção: quem perdeu o acesso depois da cópia voltaria a entrar no painel. Use ${path}/<id>, conferindo na Equipe do painel quem ainda deve ter acesso.`,
        };
      }
      if (!paths.includes(path)) paths.push(path);
    } else if (name === '--project') {
      const id = value();
      if (id === null) return { error: '--project sem o id.' };
      project = id;
    } else {
      return { error: `Argumento desconhecido: ${arg}` };
    }
  }
  if (from === undefined) return { error: 'Falta o --from.' };
  if (!isRecoveryDatabase(from)) {
    return {
      error: `O --from precisa ser um banco de recuperação (${RECOVERY_DATABASE_PREFIX}...), nunca o ${TARGET_DATABASE}: ${from}`,
    };
  }
  if (paths.length === 0) return { error: 'Falta ao menos um --path.' };
  return { from, paths, overwrite, dryRun, ...(project === undefined ? {} : { project }) };
}

function splitOnce(arg: string): [string, string] {
  const at = arg.indexOf('=');
  return [arg.slice(0, at), arg.slice(at + 1)];
}

/** Onde a cópia guarda os uids das contas, tirado da `FAN_DATA_SOURCES`. */
export type AccountSource =
  /** O id dos documentos de `<collection>` (com os que só têm subcoleções). */
  | { kind: 'ids'; collection: string }
  /** O campo `<field>` de `<collection>`, ou do grupo de coleção com esse nome. */
  | { kind: 'field'; collection: string; field: string; group: boolean }
  /** Os itens da lista `<field>` de `<collection>`. */
  | { kind: 'list'; collection: string; field: string }
  /** O id das linhas `seasons/{id}/standings/{uid}`. */
  | { kind: 'standings' };

/**
 * O uid nas listas de bloqueio dos outros: a exclusão o tira de lá
 * (`removeFanEngagement`), mas a lista das fontes não o traz como fonte
 * própria (é dado de quem bloqueou).
 */
const BLOCKED_BY_OTHERS: AccountSource = {
  kind: 'list',
  collection: 'blockLists',
  field: 'blocked',
};

/**
 * As contas que a cópia conhece, pela lista das fontes do fã: toda fonte lida
 * pelo uid (o documento, a subcoleção, o campo e as temporadas), mais o uid
 * nas listas de bloqueio dos outros. O Auth e o que não se acha pelo uid (a
 * carteira de outra pessoa, o Storage, os logs) ficam de fora. Fonte nova na
 * lista entra aqui sozinha.
 */
export function accountSources(
  sources: readonly FanDataSource[] = FAN_DATA_SOURCES,
): AccountSource[] {
  const out = new Map<string, AccountSource>();
  for (const { read } of sources) {
    switch (read.kind) {
      case 'doc':
        out.set(`ids:${read.collection}`, { kind: 'ids', collection: read.collection });
        break;
      case 'sub':
        out.set(`ids:${read.parent}`, { kind: 'ids', collection: read.parent });
        break;
      case 'equal':
      case 'count':
        out.set(`field:${read.collection}.${read.field}`, {
          kind: 'field',
          collection: read.collection,
          field: read.field,
          group: false,
        });
        break;
      case 'group':
        out.set(`group:${read.group}.${read.field}`, {
          kind: 'field',
          collection: read.group,
          field: read.field,
          group: true,
        });
        break;
      case 'standings':
        out.set('standings', { kind: 'standings' });
        break;
      case 'auth':
      case 'none':
        break;
    }
  }
  return [...out.values(), BLOCKED_BY_OTHERS];
}

/**
 * Um valor que pode ser o uid de uma conta do Auth: texto de 1 a 128
 * caracteres (o limite do Auth), sem barra (é id de documento). Não é o
 * `FAN_UID_PATTERN`: a conta criada com uid escolhido, como as da equipe no
 * seed (`seed-equipe`), tem hífen.
 */
export function isAccountUid(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/')
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

type Comparable = { isEqual(other: unknown): boolean };
const hasIsEqual = (value: unknown): value is Comparable =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<Comparable>).isEqual === 'function';

/**
 * Dois valores do Firestore iguais: a referência pelo caminho (a da cópia
 * aponta para o outro banco), os bytes byte a byte, o `Timestamp`, o
 * `GeoPoint` e o vetor pelo `isEqual` deles, mapas e listas por item.
 */
export function sameFirestoreValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a instanceof DocumentReference || b instanceof DocumentReference) {
    return a instanceof DocumentReference && b instanceof DocumentReference && a.path === b.path;
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && Buffer.compare(a, b) === 0;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameFirestoreValue(item, b[index]))
    );
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameFirestoreValue(a[key], b[key]))
    );
  }
  if (hasIsEqual(a) && hasIsEqual(b) && Object.getPrototypeOf(a) === Object.getPrototypeOf(b)) {
    return a.isEqual(b);
  }
  return false;
}

/**
 * O que acontece com um documento da cópia:
 * - `create`: falta no (default) e volta;
 * - `replace`: existe diferente e é substituído (só com `--overwrite`);
 * - `differs`: existe diferente e fica como está (sem `--overwrite`);
 * - `profile`: o perfil com outra foto ou outro @ fica como está mesmo com
 *   `--overwrite`. Com outra foto, o gatilho do perfil (`queueFanProfileSync`)
 *   apagaria o arquivo da foto de agora, como numa troca de foto, e o da cópia
 *   pode nem existir mais; com outro @, a reserva do @ da cópia já saiu (ou é
 *   de outro fã) e a do @ de agora ficaria sem dono;
 * - `reexclusion`: o documento nasceu na cópia pela reexclusão (o shard da
 *   contagem com o -1 de quem saiu, os cancelamentos do dia nos números do
 *   painel) e fica de fora: no (default), a exclusão já descontou;
 * - `same`: igual, nada a fazer.
 */
export type RestoreKind = 'create' | 'replace' | 'differs' | 'profile' | 'reexclusion' | 'same';

export const RESTORE_KINDS: readonly RestoreKind[] = [
  'create',
  'replace',
  'differs',
  'profile',
  'reexclusion',
  'same',
];

const PROFILE_PATH = /^users\/[^/]+$/;

/** Um campo de texto do perfil (vazio vale null, como o gatilho lê o caminho da foto). */
const textOf = (data: DocumentData, field: string): string | null => {
  const value: unknown = data[field];
  return typeof value === 'string' && value !== '' ? value : null;
};

/**
 * O que fazer com o documento da cópia em `path`, dado o do (default)
 * (undefined se falta). O que a reexclusão criou na cópia é decidido antes,
 * por quem lê a cópia (`reexclusion`).
 */
export function restoreKind(
  path: string,
  copy: DocumentData,
  target: DocumentData | undefined,
  overwrite: boolean,
): RestoreKind {
  if (target === undefined) return 'create';
  if (sameFirestoreValue(copy, target)) return 'same';
  if (!overwrite) return 'differs';
  if (
    PROFILE_PATH.test(path) &&
    (textOf(target, 'photoPath') !== textOf(copy, 'photoPath') ||
      textOf(target, 'username') !== textOf(copy, 'username'))
  ) {
    return 'profile';
  }
  return 'replace';
}

export type RestoreItem = { path: string; kind: RestoreKind };

/** O resultado de uma rodada, para o script imprimir. */
export type RestoreReport = {
  /** O banco de onde os documentos voltam. */
  copy: string;
  paths: string[];
  overwrite: boolean;
  dryRun: boolean;
  /** Quantas contas a cópia conhece. */
  accounts: number;
  /** As contas da cópia sem conta no Auth hoje, tiradas da cópia antes de comparar. */
  reexcluded: string[];
  /** Os documentos da cópia debaixo dos caminhos, com o que acontece com cada um. */
  items: RestoreItem[];
  /** O que foi gravado no (default); null no --dry-run. */
  written: { created: number; replaced: number } | null;
  /** Os documentos que mudaram no (default) entre a comparação e a gravação, e ficaram como estavam. */
  changed: string[];
  /** As contas que saíram do Auth durante a rodada (depois da reexclusão na cópia). */
  late: string[];
  /** O erro que parou a gravação no meio (as páginas de antes ficaram gravadas); null sem erro. */
  error: string | null;
};

const KIND_LABEL: Record<RestoreKind, string> = {
  create: 'criar',
  replace: 'substituir',
  differs: 'diferente',
  profile: 'perfil',
  reexclusion: 'reexclusão',
  same: 'igual',
};

const list = (values: readonly string[]) => values.join(', ');

/** As linhas que o script imprime, na ordem da rodada. */
export function formatRestoreReport(report: RestoreReport): string[] {
  const count = (kind: RestoreKind) => report.items.filter((item) => item.kind === kind).length;
  const lines = [
    `Cópia: banco ${report.copy}. Destino: ${TARGET_DATABASE}.`,
    `Contas que a cópia conhece: ${report.accounts}.`,
    report.reexcluded.length === 0
      ? 'Sem conta no Auth hoje: nenhuma.'
      : `Sem conta no Auth hoje: ${report.reexcluded.length}, tiradas da cópia pelo deleteUserData antes de comparar (o ${TARGET_DATABASE} não muda): ${list(report.reexcluded)}.`,
    `Caminhos: ${list(report.paths)}.`,
    [
      `Na cópia: ${report.items.length} documentos.`,
      `Criar: ${count('create')}.`,
      report.overwrite
        ? `Substituir: ${count('replace')}. Perfis mantidos (a foto ou o @ de agora): ${count('profile')}.`
        : `Diferentes, mantidos (sem --overwrite): ${count('differs')}.`,
      ...(count('reexclusion') > 0
        ? [`Criados pela reexclusão, de fora: ${count('reexclusion')}.`]
        : []),
      `Iguais: ${count('same')}.`,
    ].join(' '),
  ];
  for (const item of report.items) {
    if (item.kind !== 'same') lines.push(`  ${KIND_LABEL[item.kind]} ${item.path}`);
  }
  if (report.written === null) {
    lines.push(`--dry-run: nada gravado no ${TARGET_DATABASE}.`);
    return lines;
  }
  lines.push(
    `Gravados no ${TARGET_DATABASE}: ${report.written.created} criados, ${report.written.replaced} substituídos.`,
  );
  if (report.changed.length > 0) {
    lines.push(
      `Mudaram no ${TARGET_DATABASE} durante a rodada e ficaram como estavam: ${report.changed.length}.`,
    );
    for (const path of report.changed) lines.push(`  mudou ${path}`);
  }
  if (report.error !== null) {
    lines.push(
      `A gravação parou no meio, com o erro abaixo; o que foi gravado antes ficou. Rodar de novo é seguro (o que já voltou sai como igual): ${report.error}`,
    );
  }
  if (report.late.length > 0) {
    lines.push(
      `Atenção: saíram do Auth durante a rodada: ${list(report.late)}. Os documentos delas podem ter voltado; confira antes de seguir (31.3).`,
    );
  }
  return lines;
}
