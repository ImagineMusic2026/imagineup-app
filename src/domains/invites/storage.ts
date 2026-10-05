import { storage, StorageKeys } from '@/storage/storage';

import { BOUND_INVITE_TTL_MS, PENDING_INVITE_TTL_MS } from './consts';
import { normalizeInviteCode } from './link';
import type { BoundInvite, InviteOrigin, InviteUtm, PendingInvite } from './types';

// O convite no aparelho, em dois tempos (docs/arquitetura-api.md, 20.11):
// - pendente: o link que abriu o app, guardado até alguém se cadastrar, sem
//   dono (StorageKeys.PendingInvite);
// - amarrado: o pendente (ou o código digitado) preso ao uid da conta que
//   nasceu no cadastro (StorageKeys.InviteClaims). Só a sessão confirmada
//   desse uid manda, e nunca vai para a conta de outro que entrar depois no
//   mesmo aparelho.

const listeners = new Set<() => void>();

/** Avisa quem assina (a sincronização) quando um convite novo é guardado. */
export function subscribePendingInvite(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function cleanUtm(value: unknown): InviteUtm {
  const utm: InviteUtm = {};
  if (typeof value !== 'object' || value === null) return utm;
  const record = value as Record<string, unknown>;
  for (const field of ['source', 'medium', 'campaign'] as const) {
    if (isText(record[field])) utm[field] = record[field];
  }
  return utm;
}

function cleanOrigin(value: unknown): InviteOrigin | null {
  if (typeof value !== 'object' || value === null) return null;
  const { path, utm } = value as { path?: unknown; utm?: unknown };
  return isText(path) ? { path, utm: cleanUtm(utm) } : null;
}

/** O pendente lido, conferido; formato estranho (outra versão, gravação quebrada) vira null. */
function pendingOf(value: unknown): PendingInvite | null {
  if (typeof value !== 'object' || value === null) return null;
  const { code, receivedAt, origin } = value as Record<string, unknown>;
  const normalized = normalizeInviteCode(code);
  const parsedOrigin = cleanOrigin(origin);
  if (!normalized || !isText(receivedAt) || Number.isNaN(Date.parse(receivedAt))) return null;
  return { code: normalized, receivedAt, origin: parsedOrigin ?? { path: '/', utm: {} } };
}

const expired = (iso: string, ttl: number, now: number) => Date.parse(iso) + ttl < now;

/**
 * O convite do link, se ainda vale. A v1 (só o código, sem a origem) é
 * apagada na primeira leitura, sem migração: nenhuma build mandou convite ao
 * servidor antes do bloco 5, e qualquer convite v1 já passou dos 7 dias quando
 * a API entrar nas builds. Vencido, sai na leitura.
 */
export async function readPendingInvite(now: number = Date.now()): Promise<PendingInvite | null> {
  await storage.remove(StorageKeys.LegacyPendingInvite).catch(() => undefined);
  const raw = await storage.getJSON<unknown>(StorageKeys.PendingInvite);
  if (raw === null) return null;
  const pending = pendingOf(raw);
  if (!pending || expired(pending.receivedAt, PENDING_INVITE_TTL_MS, now)) {
    await storage.remove(StorageKeys.PendingInvite);
    return null;
  }
  return pending;
}

/**
 * Guarda o convite do link que abriu o app, já com o código normalizado e a
 * origem (a página e os `utm_*`), até o cadastro. O primeiro convite vale: um
 * segundo link não troca quem trouxe a pessoa, até o primeiro vencer.
 */
export async function savePendingInvite(
  code: string,
  origin: InviteOrigin,
  now: number = Date.now(),
): Promise<void> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return;
  const current = await readPendingInvite(now);
  if (current) return;
  await storage.setJSON<PendingInvite>(StorageKeys.PendingInvite, {
    code: normalized,
    receivedAt: new Date(now).toISOString(),
    origin: { path: origin.path || '/', utm: cleanUtm(origin.utm) },
  });
  for (const listener of [...listeners]) listener();
}

export function clearPendingInvite(): Promise<void> {
  return storage.remove(StorageKeys.PendingInvite);
}

// --- Convite amarrado à conta -------------------------------------------------------

type BoundInvites = Record<string, BoundInvite>;

function boundOf(uid: string, value: unknown): BoundInvite | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const code = normalizeInviteCode(record.code);
  const via = record.via === 'link' || record.via === 'code' ? record.via : null;
  const { receivedAt, boundAt, idempotencyKey } = record;
  if (!code || !via || record.uid !== uid) return null;
  if (!isText(receivedAt) || !isText(boundAt) || !isText(idempotencyKey)) return null;
  if (Number.isNaN(Date.parse(boundAt))) return null;
  return {
    uid,
    code,
    via,
    origin: via === 'link' ? cleanOrigin(record.origin) : null,
    receivedAt,
    boundAt,
    idempotencyKey,
  };
}

async function readAllBound(): Promise<BoundInvites> {
  const raw = await storage.getJSON<unknown>(StorageKeys.InviteClaims);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as BoundInvites)
    : {};
}

async function writeAllBound(all: BoundInvites): Promise<void> {
  if (Object.keys(all).length === 0) await storage.remove(StorageKeys.InviteClaims);
  else await storage.setJSON<BoundInvites>(StorageKeys.InviteClaims, all);
}

/** A chave do claim: a mesma em toda tentativa enquanto o convite estiver amarrado. */
export function claimIdempotencyKey(code: string, receivedAt: string): string {
  return `invite-${code}-${receivedAt}`;
}

/**
 * Amarra o convite à conta que acabou de nascer (o cadastro) e tira o
 * pendente do aparelho:
 * - código vazio: descarta o pendente e devolve null (sem convite);
 * - o mesmo código do pendente (os dois normalizados): `via: 'link'`, com a
 *   origem e o `receivedAt` do link;
 * - outro código (digitado no cadastro): `via: 'code'`, sem origem, com o
 *   `receivedAt` igual ao `boundAt` (chave nova a cada vez que amarra).
 * Um convite que já estava amarrado ao uid é trocado.
 */
export async function bindPendingInvite(
  uid: string,
  typedCode: string | null | undefined,
  now: number = Date.now(),
): Promise<BoundInvite | null> {
  const pending = await readPendingInvite(now);
  await clearPendingInvite();
  const code = typedCode?.trim() ? normalizeInviteCode(typedCode) : null;
  if (!code) return null;
  const boundAt = new Date(now).toISOString();
  const fromLink = pending !== null && pending.code === code;
  const receivedAt = fromLink ? pending.receivedAt : boundAt;
  const bound: BoundInvite = {
    uid,
    code,
    via: fromLink ? 'link' : 'code',
    origin: fromLink ? pending.origin : null,
    receivedAt,
    boundAt,
    idempotencyKey: claimIdempotencyKey(code, receivedAt),
  };
  const all = await readAllBound();
  all[uid] = bound;
  await writeAllBound(all);
  return bound;
}

/** O convite amarrado ao uid, se ainda vale (7 dias desde o `boundAt`); vencido, sai. */
export async function readBoundInvite(
  uid: string,
  now: number = Date.now(),
): Promise<BoundInvite | null> {
  const all = await readAllBound();
  if (!(uid in all)) return null;
  const bound = boundOf(uid, all[uid]);
  if (!bound || expired(bound.boundAt, BOUND_INVITE_TTL_MS, now)) {
    delete all[uid];
    await writeAllBound(all);
    return null;
  }
  return bound;
}

/**
 * Tira o convite amarrado ao uid. Com `idempotencyKey`, só se ainda for o
 * mesmo (outro pode ter sido amarrado no meio do envio).
 */
export async function clearBoundInvite(uid: string, idempotencyKey?: string): Promise<void> {
  const all = await readAllBound();
  const current = all[uid];
  if (!current) return;
  if (idempotencyKey !== undefined && current.idempotencyKey !== idempotencyKey) return;
  delete all[uid];
  await writeAllBound(all);
}
