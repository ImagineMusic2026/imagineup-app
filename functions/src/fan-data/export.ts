import type { Auth, UserRecord } from 'firebase-admin/auth';
import {
  FieldPath,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';

import { dayKey } from '../day';
import { parseLookupEmail } from '../fan-profile/panel';
import {
  addStaffLimit,
  checkStaffLimit,
  parseStaffLimit,
  readStaffLimit,
  staffLimitRef,
  type StaffLimitCheck,
} from '../staff/limits';
import { requestFields } from '../staff/model';
import { directRead, readPanelAdmin, transactionRead, type PanelActor } from '../staff/panel-actor';
import { panelError, targetFanUid } from '../staff/panel-errors';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import {
  EXPORT_PAGE_SIZE,
  exportAccount,
  exportFields,
  exportHeader,
  exportList,
  isRecentLogin,
  parseAfter,
  parsePart,
  sameEmail,
  type ExportDoc,
  type ExportRecord,
  type ExportValue,
} from './model';
import {
  FAN_DATA_FIRST_KEYS,
  FAN_DATA_PARTS,
  firstKeySource,
  partSource,
  type FanDataPart,
  type FanDataSource,
} from './sources';

// A exportação dos dados de um fã pela LGPD (seção 32, decisões 6, 7, 10, 12
// e 13, 32.2 e 32.4 de docs/arquitetura-api.md): a callable `exportFanData`,
// só de admin. A primeira chamada (sem `part`) confere o e-mail da conta e o
// login recente, conta no teto do dia, audita e devolve o começo do arquivo,
// com a conta, os documentos únicos e as listas curtas, e as denúncias
// inteiras, lidas em páginas internas de 500. As partes longas vêm depois, em
// páginas de até 500 (`part` e `after`), só com o admin: sem teto e sem
// auditoria, porque trazem o que o admin já lê pelas regras. O que vai ao
// arquivo sai da `FAN_DATA_SOURCES`, com o `omit` de cada fonte. Nada fica
// guardado no servidor, e nada do arquivo vai ao log. O que as duas callables
// dividem (as dependências, a conta do Auth, o login recente e a auditoria)
// mora aqui, e a exclusão (delete.ts) usa daqui.

export type FanDataDeps = {
  db: Firestore;
  auth: Pick<Auth, 'getUser' | 'deleteUser'>;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
};

export const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();

/** O erro do Admin SDK de Auth para a conta que não existe. */
export const isUserNotFound = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'auth/user-not-found';

/** A conta do Authentication do fã, ou null quando ela não existe. */
export async function fanAccount(
  auth: Pick<Auth, 'getUser'>,
  uid: string,
): Promise<UserRecord | null> {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (isUserNotFound(error)) return null;
    throw error;
  }
}

/** O login de quem chama tem até 10 minutos (decisão 10); senão `recent-login-required`. */
export function requireRecentLogin(caller: CallerAuth | undefined, now: number): void {
  if (!isRecentLogin(caller?.token.auth_time, now)) throw panelError('recent-login-required');
}

/** A recusa do teto do dia dos pedidos de dados, com o número dele em `details.max`. */
export function staffLimitError(check: Extract<StaffLimitCheck, { ok: false }>): HttpsError {
  if (check.reason === 'export-daily-limit' || check.reason === 'deletion-daily-limit') {
    return panelError(check.reason, { max: check.max });
  }
  // O ajuste e a busca por e-mail têm as recusas deles e não passam por aqui.
  return new HttpsError('internal', `Recusa do teto fora dos pedidos de dados: ${check.reason}`);
}

/**
 * A auditoria dos pedidos de dados (decisão 12): só o uid em `details`, o
 * alvo `fan:<uid>` pelo prefixo `fan.` e o `targetEmail` vazio. Nunca o
 * e-mail digitado nem o da conta.
 */
export function auditFanData(
  tx: Transaction,
  db: Firestore,
  action: Extract<AuditAction, 'fan.data.exported' | 'fan.account.deleted'>,
  actor: PanelActor,
  uid: string,
  now: number,
): void {
  writeAudit(
    tx,
    db,
    {
      action,
      actorUid: actor.uid,
      actorName: actor.name,
      targetEmail: '',
      targetUid: uid,
      details: { uid },
    },
    Timestamp.fromMillis(now),
  );
}

/** Uma página de uma parte longa (32.2). */
export type ExportPage = { part: FanDataPart; items: ExportValue[]; after: string | null };

const toDoc = (snap: QueryDocumentSnapshot): ExportDoc => ({
  id: snap.id,
  path: snap.ref.path,
  data: snap.data(),
});

/** A consulta de uma fonte lida em lista, pelo uid do fã (sem a ordem). */
function listQuery(db: Firestore, source: FanDataSource, uid: string): Query {
  const { read } = source;
  if (read.kind === 'sub') return db.collection(read.parent).doc(uid).collection(read.name);
  if (read.kind === 'equal') return db.collection(read.collection).where(read.field, '==', uid);
  if (read.kind === 'group') return db.collectionGroup(read.group).where(read.field, '==', uid);
  throw new Error(`A fonte ${source.id} não é lida em lista.`);
}

/**
 * O cursor de uma lista: o id de verdade do documento, ou o caminho no grupo
 * (o id sozinho não serve de `startAfter` no grupo `postComments`, 32.17).
 */
const cursorOf = (source: FanDataSource, snap: QueryDocumentSnapshot): string =>
  source.read.kind === 'group' ? snap.ref.path : snap.id;

/** Até 500 documentos da fonte, pela ordem do id, depois do `after`. */
async function readListPage(
  db: Firestore,
  source: FanDataSource,
  uid: string,
  after: string | null,
): Promise<QueryDocumentSnapshot[]> {
  let query = listQuery(db, source, uid).orderBy(FieldPath.documentId());
  if (after !== null) {
    query = query.startAfter(source.read.kind === 'group' ? db.doc(after) : after);
  }
  return (await query.limit(EXPORT_PAGE_SIZE).get()).docs;
}

/**
 * A lista inteira de uma fonte da primeira chamada, em páginas internas de
 * 500 até o fim, sem corte: as denúncias não têm teto de tamanho (o teto do
 * dia não limita o histórico, 32.17), e um `limit` cortaria a resposta ao
 * titular sem aviso.
 */
async function readWholeList(
  db: Firestore,
  source: FanDataSource,
  uid: string,
): Promise<ExportDoc[]> {
  const docs: ExportDoc[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await readListPage(db, source, uid, after);
    docs.push(...page.map(toDoc));
    if (page.length < EXPORT_PAGE_SIZE) return docs;
    after = cursorOf(source, page[page.length - 1]!);
  }
}

/** A linha do fã em cada temporada fechada: os ids das temporadas e um `getAll`. */
async function readStandings(db: Firestore, uid: string): Promise<ExportDoc[]> {
  const seasons = await db.collection('seasons').select().get();
  if (seasons.empty) return [];
  const rows = await db.getAll(
    ...seasons.docs.map((season) => season.ref.collection('standings').doc(uid)),
  );
  return rows.flatMap((row) =>
    row.exists ? [{ id: row.id, path: row.ref.path, data: row.data()! }] : [],
  );
}

/**
 * O documento de uma fonte lida pelo documento: `<collection>/{uid}`, ou o
 * único da subcoleção (`<parent>/{uid}/<name>/<id>`, o contato do fã).
 */
function docRef(db: Firestore, source: FanDataSource, uid: string): DocumentReference {
  const { read } = source;
  if (read.kind === 'doc') return db.collection(read.collection).doc(uid);
  if (read.kind === 'subdoc') {
    return db.collection(read.parent).doc(uid).collection(read.name).doc(read.id);
  }
  throw new Error(`A fonte ${source.id} não é um documento.`);
}

/**
 * As chaves da primeira chamada, na ordem do arquivo (32.3), cada uma pelo
 * leitor da fonte dela: a conta, os documentos únicos num `getAll` (o
 * ausente é null), as listas por igualdade e as subcoleções inteiras (os
 * fã-clubes seguidos, até 50), a contagem e as temporadas.
 */
async function readFirstKeys(db: Firestore, uid: string, user: UserRecord): Promise<ExportRecord> {
  const sources = FAN_DATA_FIRST_KEYS.map((key) => ({ key, source: firstKeySource(key) }));
  const single = sources.filter(
    ({ source }) => source.read.kind === 'doc' || source.read.kind === 'subdoc',
  );
  const snaps = await db.getAll(...single.map(({ source }) => docRef(db, source, uid)));
  const docs = new Map<string, DocumentSnapshot>(
    single.map(({ key }, index) => [key, snaps[index]!]),
  );

  const values = await Promise.all(
    sources.map(async ({ key, source }): Promise<ExportValue> => {
      const { read } = source;
      switch (read.kind) {
        case 'auth':
          return exportAccount(user);
        case 'doc':
        case 'subdoc': {
          const snap = docs.get(key);
          return snap?.exists ? exportFields(source, snap.data()!) : null;
        }
        case 'equal':
        case 'sub':
          return exportList(source, await readWholeList(db, source, uid));
        case 'count': {
          const counted = await db
            .collection(read.collection)
            .where(read.field, '==', uid)
            .count()
            .get();
          return counted.data().count;
        }
        case 'standings':
          return exportList(source, await readStandings(db, uid));
        default:
          throw new Error(`A fonte ${source.id} não tem leitor na primeira chamada.`);
      }
    }),
  );
  const out: ExportRecord = {};
  sources.forEach(({ key }, index) => {
    out[key] = values[index]!;
  });
  return out;
}

/**
 * A primeira chamada (32.4): o admin e o login recente; o teto do dia, fora
 * de transação; a conta do Auth (sem ela, `fan-not-found`) e o e-mail
 * digitado contra o dela (`email-mismatch`); as leituras, fora de transação;
 * e uma transação curta com o admin relido, o teto relido e somado e a
 * auditoria `fan.data.exported`. Se a transação falhar, nada sai.
 */
async function exportStart(
  deps: FanDataDeps,
  caller: CallerAuth | undefined,
  uid: string,
  email: string,
): Promise<ExportRecord> {
  const { db } = deps;
  const admin = await readPanelAdmin(directRead, db, caller);
  const now = clock(deps);
  requireRecentLogin(caller, now);
  const used = parseStaffLimit((await staffLimitRef(db, admin.uid, now).get()).data(), dayKey(now));
  const before = checkStaffLimit(used, { kind: 'data-export' });
  if (!before.ok) throw staffLimitError(before);

  const user = await fanAccount(deps.auth, uid);
  if (user === null) throw panelError('fan-not-found');
  if (!sameEmail(user.email, email)) throw panelError('email-mismatch');

  const first = await readFirstKeys(db, uid, user);

  await db.runTransaction(async (tx) => {
    const actor = await readPanelAdmin(transactionRead(tx), db, caller);
    const limit = checkStaffLimit(await readStaffLimit(tx, db, actor.uid, now), {
      kind: 'data-export',
    });
    if (!limit.ok) throw staffLimitError(limit);
    addStaffLimit(tx, db, actor.uid, now, limit.next);
    auditFanData(tx, db, 'fan.data.exported', actor, uid, now);
  });

  return { ...exportHeader(uid, now), ...first, partes: [...FAN_DATA_PARTS] };
}

/**
 * Uma página de uma parte longa (32.4): só o admin, sem login recente, sem
 * teto e sem auditoria (decisão 12). Até 500 documentos pela ordem do id,
 * depois do `after`, com o `omit` da fonte (no extrato, também a máscara do
 * id dos `invite_*`). O `after` da resposta é o id de verdade do último
 * documento (o caminho, nos comentários), ou null quando a página vem com
 * menos de 500.
 */
async function exportPage(
  deps: FanDataDeps,
  caller: CallerAuth | undefined,
  uid: string,
  part: FanDataPart,
  after: string | null,
): Promise<ExportPage> {
  const { db } = deps;
  await readPanelAdmin(directRead, db, caller);
  const source = partSource(part);
  const page = await readListPage(db, source, uid, after);
  return {
    part,
    items: exportList(source, page.map(toDoc)),
    after: page.length === EXPORT_PAGE_SIZE ? cursorOf(source, page[page.length - 1]!) : null,
  };
}

/**
 * exportFanData (32.2): sem `part`, a primeira chamada, com `{ uid, email }`;
 * com `part`, uma página, com `{ uid, part, after? }`. As recusas vêm na ordem
 * de 32.2: o login, o uid, a própria conta (`self`), o e-mail, a parte e o
 * `after`, e então o acesso de admin.
 */
export async function exportFanData(
  deps: FanDataDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<ExportRecord | ExportPage> {
  const input = requestFields(data);
  const uid = targetFanUid(caller, input.uid);
  if (input.part === undefined) {
    const email = parseLookupEmail(input.email);
    return exportStart(deps, caller, uid, email);
  }
  const part = parsePart(input.part);
  const after = parseAfter(part, input.after);
  return exportPage(deps, caller, uid, part, after);
}
