import type { Auth } from 'firebase-admin/auth';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { dayKey } from '../day';
import { type RandomDigits } from '../profile';
import {
  addStaffLimit,
  checkStaffLimit,
  EMAIL_LOOKUPS_DAILY_MAX,
  parseStaffLimit,
  readStaffLimit,
  staffLimitRef,
} from '../staff/limits';
import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { panelError, targetFanUid } from '../staff/panel-errors';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import {
  normalizeUsername,
  USERNAME_INPUT_MAX,
  USERNAME_PATTERN,
  UsernameReleaseError,
} from './model';
import { releaseUsernameIn } from './service';

// As ferramentas do painel sobre o perfil de um fã (bloco 11,
// docs/arquitetura-api.md, 26.4): a busca por e-mail da seção Fãs
// (`findFanByEmail`, só para quem edita, com teto por dia e auditoria sem o
// e-mail) e, na Moderação, trocar o @ por um automático (`resetFanUsername`)
// e tirar a foto (`clearFanPhoto`). Ninguém usa as da Moderação na própria
// conta de fã (`self`).

export type FanPanelDeps = {
  db: Firestore;
  /** Só a busca por e-mail usa (uma chamada por busca que passou do teto). */
  auth: Pick<Auth, 'getUserByEmail'>;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** O sorteio do @ automático; os testes fixam. */
  random?: RandomDigits;
};

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();

/** E-mail de até 254 caracteres com um `@`, em minúsculas e sem espaço; senão `invalid-request`. */
export function parseLookupEmail(value: unknown): string {
  if (typeof value !== 'string') throw panelError('invalid-request', { field: 'email' });
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  if (
    email.length < 3 ||
    email.length > 254 ||
    /\s/.test(email) ||
    parts.length !== 2 ||
    parts[0] === '' ||
    parts[1] === ''
  ) {
    throw panelError('invalid-request', { field: 'email' });
  }
  return email;
}

function auditFan(
  tx: Transaction,
  db: Firestore,
  action: AuditAction,
  actor: PanelActor,
  targetUid: string | null,
  details: Record<string, unknown>,
  now: number,
): void {
  writeAudit(
    tx,
    db,
    {
      action,
      actorUid: actor.uid,
      actorName: actor.name,
      // Nunca o e-mail do fã (26.4): o alvo é o uid.
      targetEmail: '',
      targetUid,
      details,
    },
    Timestamp.fromMillis(now),
  );
}

/** Código do Admin SDK de Auth quando o e-mail não tem conta (ou nem é e-mail para ele). */
const NO_ACCOUNT = new Set(['auth/user-not-found', 'auth/invalid-email']);

/**
 * findFanByEmail (26.4, decisão 9): só quem edita a seção Fãs. Antes do Auth,
 * o membro e o orçamento do dia, fora de transação: com 50 buscas no dia,
 * `lookup-daily-limit`, sem chamar o Auth. Depois, o `getUserByEmail` e o
 * perfil: sem conta, ou conta sem perfil de fã (só da equipe), `{ uid: null }`.
 * Por fim, uma transação curta relê o membro e o orçamento (de novo o teto),
 * soma a busca e grava a auditoria `fan.email.lookup` com `{ found }` e, quando
 * achou, o uid em `targetUid`; nunca o e-mail, nem o que foi digitado. Toda
 * busca conta, ache ou não: o teto existe contra a enumeração de e-mails.
 */
export async function findFanByEmail(
  deps: FanPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ uid: string | null }> {
  const { db } = deps;
  const first = await readPanelActor(directRead, db, caller, 'fans', 'edit');
  const email = parseLookupEmail(requestFields(data).email);
  const now = clock(deps);
  const used = parseStaffLimit((await staffLimitRef(db, first.uid, now).get()).data(), dayKey(now));
  const before = checkStaffLimit(used, { kind: 'email-lookup' });
  if (!before.ok) throw panelError('lookup-daily-limit', { max: EMAIL_LOOKUPS_DAILY_MAX });

  let uid: string | null = null;
  try {
    uid = (await deps.auth.getUserByEmail(email)).uid;
  } catch (error) {
    if (!NO_ACCOUNT.has((error as { code?: string } | null)?.code ?? '')) throw error;
  }
  if (uid !== null && !(await db.collection('users').doc(uid).get()).exists) uid = null;

  await db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'fans', 'edit');
    const limit = checkStaffLimit(await readStaffLimit(tx, db, actor.uid, now), {
      kind: 'email-lookup',
    });
    if (!limit.ok) throw panelError('lookup-daily-limit', { max: EMAIL_LOOKUPS_DAILY_MAX });
    addStaffLimit(tx, db, actor.uid, now, limit.next);
    auditFan(tx, db, 'fan.email.lookup', actor, uid, { found: uid !== null }, now);
  });
  return { uid };
}

/**
 * O @ pedido na troca (puro): o de agora do fã, em texto de até 64
 * caracteres, com ou sem o `@` e em qualquer caixa, no formato do @; senão
 * `invalid-request` com `field: 'username'`.
 */
export function parseCurrentUsername(value: unknown): string {
  if (typeof value !== 'string' || value.length > USERNAME_INPUT_MAX) {
    throw panelError('invalid-request', { field: 'username' });
  }
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    throw panelError('invalid-request', { field: 'username' });
  }
  return username;
}

/**
 * resetFanUsername (26.4, decisão 12): troca o @ de um fã por um automático
 * novo, sem prazo, e o antigo fica livre na hora. Numa transação: o membro, o
 * perfil (`fan-not-found`), o @ pedido conferido com o de agora
 * (`username-changed`: a tela velha não troca o @ errado) e o núcleo do
 * `releaseUsername` (a reserva de uma central é `username-of-central`). O
 * gatilho do perfil regrava o `searchKeys`. Auditoria `fan.username.reset`,
 * com o @ antigo e o novo (26.12).
 */
export async function resetFanUsername(
  deps: FanPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; username: string }> {
  const { db } = deps;
  const input = requestFields(data);
  const uid = targetFanUid(caller, input.uid);
  await readPanelActor(directRead, db, caller, 'moderation', 'edit');
  const username = parseCurrentUsername(input.username);
  const now = clock(deps);

  return db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'moderation', 'edit');
    const profile = await tx.get(db.collection('users').doc(uid));
    if (!profile.exists) throw panelError('fan-not-found');
    if (profile.get('username') !== username) throw panelError('username-changed');
    let released;
    try {
      released = await releaseUsernameIn(tx, db, username, {
        now,
        uid,
        ...(deps.random ? { random: deps.random } : {}),
      });
    } catch (error) {
      if (!(error instanceof UsernameReleaseError)) throw error;
      throw panelError(error.reason === 'central' ? 'username-of-central' : 'username-changed');
    }
    auditFan(
      tx,
      db,
      'fan.username.reset',
      actor,
      uid,
      { uid, previous: released.previous, username: released.username },
      now,
    );
    return { ok: true as const, username: released.username };
  });
}

/**
 * clearFanPhoto (26.4): tira a foto do perfil de um fã, a mesma gravação do
 * `DELETE /me/photo` (`photoURL` e `photoPath` null, `photoUpdatedAt`, nunca
 * `updatedAt`). O gatilho do perfil apaga o arquivo e a fila acerta as cópias
 * nos comentários. Sem foto: `{ ok: true }` sem gravar nem auditar. Auditoria
 * `fan.photo.removed`. O fã pode subir outra depois, se não estiver suspenso.
 */
export async function clearFanPhoto(
  deps: FanPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  const uid = targetFanUid(caller, requestFields(data).uid);
  await readPanelActor(directRead, db, caller, 'moderation', 'edit');
  const now = clock(deps);

  await db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'moderation', 'edit');
    const profile = await tx.get(db.collection('users').doc(uid));
    if (!profile.exists) throw panelError('fan-not-found');
    const has = (field: string) => {
      const value = profile.get(field);
      return typeof value === 'string' && value !== '';
    };
    if (!has('photoURL') && !has('photoPath')) return;
    tx.update(profile.ref, {
      photoURL: null,
      photoPath: null,
      photoUpdatedAt: Timestamp.fromMillis(now),
    });
    auditFan(tx, db, 'fan.photo.removed', actor, uid, { uid }, now);
  });
  return { ok: true };
}
