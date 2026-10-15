import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';

import { panelError } from '../staff/panel-errors';
import { FAN_DATA_PARTS, partSource, type FanDataPart, type FanDataSource } from './sources';

// O arquivo dos dados do fã (seção 32, 32.3 de docs/arquitetura-api.md), puro:
// os valores do Firestore em JSON, o filtro de campos de cada fonte (o `omit`
// e a máscara do extrato), a conta do Authentication, as entradas das páginas
// (`part` e `after`) e o login recente. Nada aqui lê ou grava: as callables
// (`exportFanData` e `deleteFanAccount`) leem e chamam daqui.

/** O `formato` do arquivo. */
export const EXPORT_FORMAT = 'imagineup-dados-do-fa';

/** A `versao` do arquivo: sobe quando a forma do arquivo muda. */
export const EXPORT_VERSION = 1;

/** Documentos por página das partes longas, e das leituras internas das denúncias. */
export const EXPORT_PAGE_SIZE = 500;

/** O login de quem exporta ou exclui precisa ter até 10 minutos (decisão 10). */
export const RECENT_LOGIN_MAX_SECONDS = 600;

/** O `after` das páginas: o id de um documento (até 1.500 bytes no Firestore) ou o caminho do comentário. */
export const AFTER_MAX_LENGTH = 1500;

/** Os avisos do arquivo, nesta ordem (32.3). */
export const EXPORT_NOTICES: readonly string[] = [
  'Este arquivo traz os dados da sua conta no ImagineUP no momento em que foi gerado.',
  'As datas estão em UTC, no formato ISO 8601.',
  'Os campos com uid no nome, como reporterUid e targetUid, guardam o identificador interno de uma conta.',
  'A foto do perfil está no endereço do campo photoURL.',
  'Os registros de acesso (data, hora e endereço IP) ficam guardados por 6 meses, como pede o Marco Civil da Internet (art. 15). Eles não estão neste arquivo. Para pedir, responda ao e-mail da equipe.',
];

/** Um valor do arquivo: o JSON que a resposta da callable leva. */
export type ExportValue =
  null | boolean | number | string | ExportValue[] | { [key: string]: ExportValue };

export type ExportRecord = { [key: string]: ExportValue };

/**
 * Um valor lido do Firestore, em JSON (32.3): o `Timestamp` vira ISO em UTC;
 * a referência de documento, o caminho; o `GeoPoint`, `{ latitude,
 * longitude }`; os bytes, base64; mapas e listas, recursivos. O `undefined`
 * (que o Firestore não guarda) vira null.
 */
export function toExportValue(value: unknown): ExportValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof DocumentReference) return value.path;
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(toExportValue);
  if (typeof value === 'object') {
    const out: ExportRecord = {};
    for (const [key, item] of Object.entries(value)) out[key] = toExportValue(item);
    return out;
  }
  // bigint, símbolo e função não existem num documento lido.
  return null;
}

const isExportRecord = (value: ExportValue | undefined): value is ExportRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Tira um caminho com ponto (`*` vale qualquer chave de um mapa) de um registro do arquivo. */
function removePath(record: ExportRecord, segments: readonly string[]): void {
  const [head, ...rest] = segments;
  if (head === undefined) return;
  const keys = head === '*' ? Object.keys(record) : [head];
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    if (rest.length === 0) {
      delete record[key];
      continue;
    }
    const child = record[key];
    if (isExportRecord(child)) removePath(child, rest);
  }
}

/** As origens do extrato cujo `eventId` é a chave da pessoa trazida (o HMAC do e-mail dela). */
const INVITE_SOURCES = ['invite_visit', 'invite_signup'] as const;

/** A origem de convite de um lançamento, pelo id (`<origem>:<eventId>`) ou pelo campo `source`. */
function inviteSourceOf(id: string, fields: ExportRecord): string | null {
  const prefix = id.split(':')[0] ?? '';
  if ((INVITE_SOURCES as readonly string[]).includes(prefix)) return prefix;
  const source = fields.source;
  return typeof source === 'string' && (INVITE_SOURCES as readonly string[]).includes(source)
    ? source
    : null;
}

/**
 * A máscara do extrato (decisão 8): o `actor` fica só com o `type` (no
 * convite e nas missões que o convidado pagou, o uid dele; no ajuste e na
 * devolução do resgate, o uid e o nome de quem é da equipe), e nos
 * `invite_visit` e `invite_signup` o id fica só com a origem, sem o
 * `eventId`. Devolve o id do arquivo.
 */
function maskLedger(id: string, fields: ExportRecord): string {
  const actor = fields.actor;
  if (isExportRecord(actor)) {
    fields.actor = Object.hasOwn(actor, 'type') ? { type: actor.type! } : {};
  }
  const invite = inviteSourceOf(id, fields);
  if (invite === null) return id;
  delete fields.eventId;
  return invite;
}

/**
 * Os campos de um documento como vão ao arquivo: em JSON, sem o `omit` da
 * fonte e com a máscara do extrato. Para os documentos únicos da primeira
 * chamada (o perfil, a carteira, o convite, a origem e os bloqueios).
 */
export function exportFields(source: FanDataSource, data: Record<string, unknown>): ExportRecord {
  const fields = withoutOmitted(source, data);
  if (source.mask === 'ledger') maskLedger('', fields);
  return fields;
}

/** Os campos em JSON, sem o `omit` da fonte. */
function withoutOmitted(source: FanDataSource, data: Record<string, unknown>): ExportRecord {
  const value = toExportValue(data);
  const fields: ExportRecord = isExportRecord(value) ? value : {};
  for (const path of source.omit) removePath(fields, path.split('.'));
  return fields;
}

/** Um documento lido de uma lista: o id, o caminho completo e os campos. */
export type ExportDoc = { id: string; path: string; data: Record<string, unknown> };

/**
 * Um documento de lista como vai ao arquivo: o `id` primeiro (na temporada,
 * o id dela; no extrato, a máscara dos `invite_*`), o id do pai quando a
 * fonte pede (o `postId` do comentário, pelo caminho) e os campos de
 * `exportFields`. Um campo gravado com o nome `id` perde para o id do
 * documento.
 */
export function exportItem(source: FanDataSource, doc: ExportDoc): ExportRecord {
  const segments = doc.path.split('/');
  const parentId = segments.length >= 3 ? segments[segments.length - 3]! : null;
  const fields = withoutOmitted(source, doc.data);
  let id = source.idFromParent && parentId !== null ? parentId : doc.id;
  if (source.mask === 'ledger') id = maskLedger(doc.id, fields);
  const out: ExportRecord = { id };
  if (source.parentField && parentId !== null) out[source.parentField] = parentId;
  for (const [key, item] of Object.entries(fields)) {
    if (Object.hasOwn(out, key)) continue;
    out[key] = item;
  }
  return out;
}

/** Uma lista do arquivo: só os ids (as reservas de @, `idsOnly`) ou cada documento pelo `exportItem`. */
export function exportList(source: FanDataSource, docs: readonly ExportDoc[]): ExportValue[] {
  return source.idsOnly ? docs.map((doc) => doc.id) : docs.map((doc) => exportItem(source, doc));
}

/** A conta do Authentication como o Admin SDK entrega (`UserRecord`), só o que o arquivo usa. */
export type ExportAuthUser = {
  displayName?: string;
  email?: string;
  emailVerified: boolean;
  providerData: readonly { providerId: string; email?: string }[];
  metadata: { creationTime?: string | null; lastSignInTime?: string | null };
};

/** A `conta` do arquivo (32.3). */
export type ExportAccount = {
  nome: string | null;
  email: string | null;
  emailConfirmado: boolean;
  provedores: { id: string; email: string | null }[];
  criadaEm: string | null;
  ultimoLoginEm: string | null;
};

/** A data do Auth (texto RFC 1123, "Tue, 13 Oct 2026 12:00:00 GMT") em ISO, ou null. */
function authDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * A `conta` do arquivo, campo a campo (32.3): o nome do Auth (o do cadastro,
 * que a edição do perfil não muda), o e-mail, se ele foi confirmado, cada
 * provedor com o e-mail dele, a criação e o último login. Nunca o hash da
 * senha, os tokens nem as declarações da conta.
 */
export function exportAccount(user: ExportAuthUser): ExportAccount {
  return {
    nome: textOrNull(user.displayName),
    email: textOrNull(user.email),
    emailConfirmado: user.emailVerified === true,
    provedores: user.providerData.map((provider) => ({
      id: provider.providerId,
      email: textOrNull(provider.email),
    })),
    criadaEm: authDate(user.metadata.creationTime),
    ultimoLoginEm: authDate(user.metadata.lastSignInTime),
  };
}

/** O começo do arquivo, antes da conta (32.3). */
export function exportHeader(
  uid: string,
  now: number,
): { formato: string; versao: number; geradoEm: string; uid: string; avisos: string[] } {
  return {
    formato: EXPORT_FORMAT,
    versao: EXPORT_VERSION,
    geradoEm: new Date(now).toISOString(),
    uid,
    avisos: [...EXPORT_NOTICES],
  };
}

/**
 * O e-mail digitado (já pelo `parseLookupEmail`, em minúsculas) confere com o
 * da conta, sem diferença de maiúsculas (decisão 10). Sem e-mail na conta,
 * nunca confere.
 */
export function sameEmail(accountEmail: string | null | undefined, typed: string): boolean {
  return typeof accountEmail === 'string' && accountEmail.trim().toLowerCase() === typed;
}

/** O `part` de uma página: uma das 8 partes; outro valor é `invalid-request` com o campo. */
export function parsePart(value: unknown): FanDataPart {
  if ((FAN_DATA_PARTS as readonly unknown[]).includes(value)) return value as FanDataPart;
  throw panelError('invalid-request', { field: 'part' });
}

/** Um id de documento que o Firestore aceita: sem `/`, nem `.` e `..`, nem `__x__`. */
const isDocumentId = (value: string): boolean =>
  value !== '' &&
  !value.includes('/') &&
  value !== '.' &&
  value !== '..' &&
  !/^__.*__$/.test(value);

/**
 * O `after` de uma página (32.4): ausente é a primeira página; senão, um
 * texto de até 1.500 caracteres: nas partes de coleção, um id; nos
 * comentários (o grupo), o caminho `posts/<id>/postComments/<id>`. Fora disso,
 * `invalid-request` com o campo `after`. O null é recusado: é o `after` da
 * página que fecha a parte, e o painel que o devolvesse recomeçaria a parte
 * sem fim.
 */
export function parseAfter(part: FanDataPart, value: unknown): string | null {
  if (value === undefined) return null;
  const invalid = () => panelError('invalid-request', { field: 'after' });
  if (typeof value !== 'string' || value.length > AFTER_MAX_LENGTH) throw invalid();
  const { read } = partSource(part);
  if (read.kind === 'group') {
    const segments = value.split('/');
    if (
      segments.length !== 4 ||
      segments[0] !== read.parent ||
      segments[2] !== read.group ||
      !isDocumentId(segments[1]!) ||
      !isDocumentId(segments[3]!)
    ) {
      throw invalid();
    }
    return value;
  }
  if (!isDocumentId(value)) throw invalid();
  return value;
}

/**
 * O login de quem chama tem até 10 minutos (decisão 10): o `auth_time` do
 * token, em segundos, contra o relógio em ms. No limite exato de 600 s, passa;
 * um instante depois, não. Sem o `auth_time` (ou fora do formato), não passa.
 */
export function isRecentLogin(authTime: unknown, now: number): boolean {
  if (typeof authTime !== 'number' || !Number.isFinite(authTime)) return false;
  return now - authTime * 1000 <= RECENT_LOGIN_MAX_SECONDS * 1000;
}
