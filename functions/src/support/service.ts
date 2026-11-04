import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import {
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import type { SupportMessageInput } from './model';
import { supportMessageRef, supportMessagesRef } from './store';

// A gravação da mensagem do Suporte (docs/arquitetura-api.md, seção 38,
// 38.2): na transação do runIdempotent do `POST /me/support`, na ordem de
// sempre (o teto, o planAwards sem lançamento e a gravação). Não vale ponto e
// não passa pelo filtro da seção 30: só a equipe lê.

export type SupportMessageOutcome = { plan: AwardPlan; id: string; created: boolean };

/**
 * Grava a mensagem nova com o status `open` e soma 1 no teto do dia
 * `support_message` (o 429 vem antes, sem gravar). O `id` fixo é só do seed:
 * com ele, a mensagem que já existe volta sem gravar nem contar no teto.
 */
export async function sendSupportMessage(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; input: SupportMessageInput; id?: string },
): Promise<SupportMessageOutcome> {
  const { fan, award, input } = options;
  const ref =
    options.id === undefined ? supportMessagesRef(db).doc() : supportMessageRef(db, options.id);
  if (options.id !== undefined && (await tx.get(ref)).exists) {
    const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
    return { plan, id: ref.id, created: false };
  }
  enforceDailyCap(fan, award, 'support');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  tx.create(ref, {
    uid: fan.uid,
    kind: input.kind,
    text: input.text,
    device: input.device,
    status: 'open',
    createdAt: Timestamp.fromMillis(award.now),
    resolvedAt: null,
    resolvedBy: null,
    schemaVersion: 1,
  });
  countDailyAction(plan, fan, award, 'support');
  return { plan, id: ref.id, created: true };
}

/** Mandar fora da API (seed, 38.10), com o id fixo: rodar de novo não grava outra. */
export function runSendSupportMessage(
  db: Firestore,
  uid: string,
  input: SupportMessageInput,
  id: string,
  options: RunOptions,
): Promise<SupportMessageOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    sendSupportMessage(tx, db, { fan, award, input, id }),
  );
}

/** Mensagens apagadas por página na exclusão de conta. */
const SUPPORT_DELETE_PAGE = 200;

/**
 * As mensagens do fã saem com a conta (38.4), pelo `deleteUserData`: em
 * páginas, cada uma num lote. Nada fica com a equipe: a auditoria só tem o id
 * e o tipo. Devolve quantas saíram.
 */
export async function removeSupportMessagesOf(db: Firestore, uid: string): Promise<number> {
  const query = supportMessagesRef(db).where('uid', '==', uid).limit(SUPPORT_DELETE_PAGE);
  let removed = 0;
  for (;;) {
    const page = await query.get();
    if (page.empty) return removed;
    const batch = db.batch();
    for (const doc of page.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += page.size;
  }
}
