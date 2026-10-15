import { dayKey } from '../day';
import { parseLookupEmail } from '../fan-profile/panel';
import {
  addStaffLimit,
  checkStaffLimit,
  parseStaffLimit,
  readStaffLimit,
  staffLimitRef,
} from '../staff/limits';
import { requestFields } from '../staff/model';
import { directRead, readPanelAdmin, transactionRead } from '../staff/panel-actor';
import { panelError, targetFanUid } from '../staff/panel-errors';
import type { CallerAuth } from '../staff/service';
import {
  auditFanData,
  clock,
  fanAccount,
  isUserNotFound,
  requireRecentLogin,
  staffLimitError,
  type FanDataDeps,
} from './export';
import { sameEmail } from './model';

// A exclusão da conta de um fã pela LGPD (seção 32, decisões 11, 12, 13, 14
// e 15, 32.2 e 32.4 de docs/arquitetura-api.md): a callable
// `deleteFanAccount`, só de admin. É a exclusão do Auth: o `deleteUser`
// dispara o gatilho `deleteUserProfile`, que apaga os dados como na exclusão
// pelo app (seção 12, `deleteUserData`). A transação com o admin relido, o
// teto do dia e a auditoria vem antes do `deleteUser`: o registro de quem
// mandou excluir existe antes do ato sem volta.

/** O que a exclusão responde: a conta saiu agora, ou já tinha saído e os dados estão saindo. */
export type FanDeletionResult = { status: 'deleted' | 'pending' };

/**
 * deleteFanAccount (32.2 e 32.4), com as recusas nesta ordem: o login, o uid,
 * a própria conta (`self`), o e-mail, o acesso de admin, o login recente, a
 * conta da equipe (`fan-is-staff`, em qualquer status: o `deleteUserData`
 * apagaria o `staff/{uid}` sem a trava do último admin), a conta e o e-mail
 * dela e o teto do dia.
 *
 * - A conta do Auth que já saiu com o perfil ainda lá (a repetição depois do
 *   sucesso, ou o gatilho atrasado) responde `pending`, sem teto nem
 *   auditoria; sem conta e sem perfil, `fan-not-found`. A conta sem perfil
 *   (nem `staff/{uid}`) é excluída: também é dado pessoal.
 * - O uid que já está na lista do dia passa sem somar nem auditar de novo: o
 *   `deleteUser` que falhou depois da transação é tentado outra vez.
 * - O `auth/user-not-found` do `deleteUser` conta como feito (outra chamada
 *   chegou antes).
 */
export async function deleteFanAccount(
  deps: FanDataDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<FanDeletionResult> {
  const { db } = deps;
  const input = requestFields(data);
  const uid = targetFanUid(caller, input.uid);
  const email = parseLookupEmail(input.email);
  const admin = await readPanelAdmin(directRead, db, caller);
  const now = clock(deps);
  requireRecentLogin(caller, now);

  const staffRef = db.collection('staff').doc(uid);
  const [staff, profile] = await db.getAll(staffRef, db.collection('users').doc(uid));
  if (staff!.exists) throw panelError('fan-is-staff');
  const user = await fanAccount(deps.auth, uid);
  if (user === null) {
    if (profile!.exists) return { status: 'pending' };
    throw panelError('fan-not-found');
  }
  if (!sameEmail(user.email, email)) throw panelError('email-mismatch');
  const used = parseStaffLimit((await staffLimitRef(db, admin.uid, now).get()).data(), dayKey(now));
  const before = checkStaffLimit(used, { kind: 'account-deletion', uid });
  if (!before.ok) throw staffLimitError(before);

  await db.runTransaction(async (tx) => {
    const actor = await readPanelAdmin(transactionRead(tx), db, caller);
    if ((await tx.get(staffRef)).exists) throw panelError('fan-is-staff');
    const limit = checkStaffLimit(await readStaffLimit(tx, db, actor.uid, now), {
      kind: 'account-deletion',
      uid,
    });
    if (!limit.ok) throw staffLimitError(limit);
    if (limit.repeat) return;
    addStaffLimit(tx, db, actor.uid, now, limit.next);
    auditFanData(tx, db, 'fan.account.deleted', actor, uid, now);
  });

  try {
    await deps.auth.deleteUser(uid);
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }
  return { status: 'deleted' };
}
