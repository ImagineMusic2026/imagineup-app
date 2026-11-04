import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { writeAudit, type CallerAuth } from '../staff/service';
import { supportPanelError } from './errors';
import {
  isSupportKind,
  isSupportMessageId,
  statusAfter,
  SUPPORT_ACTIONS,
  type SupportAction,
  type SupportStatus,
} from './model';
import { supportMessageRef } from './store';

// A equipe marca a mensagem do Suporte como resolvida, ou reabre
// (docs/arquitetura-api.md, seção 38, 38.3): a callable resolveSupportMessage,
// com a seção `support` e edição (admin, ou editor com a seção; o Leitor só
// lê a lista). A resposta ao fã não passa por aqui: o app não tem notificação
// (fora do contrato), e quem quer resposta usa o "Fale com a equipe".

export type SupportResolutionInput = { id: string; action: SupportAction };

/** O corpo da callable (puro): o `id` no formato e a `action` da lista; senão `invalid-request` com o campo. */
export function parseSupportResolution(fields: Record<string, unknown>): SupportResolutionInput {
  if (!isSupportMessageId(fields.id)) throw supportPanelError('invalid-request', { field: 'id' });
  if (!(SUPPORT_ACTIONS as readonly unknown[]).includes(fields.action)) {
    throw supportPanelError('invalid-request', { field: 'action' });
  }
  return { id: fields.id, action: fields.action as SupportAction };
}

export type SupportPanelDeps = {
  db: Firestore;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
};

export type SupportResolutionResult = { ok: true; status: SupportStatus };

/**
 * O núcleo, na transação de quem chama (a callable e os testes): lê a
 * mensagem. Sem ela (o fã excluiu a conta), `message-not-found`. Já no estado
 * pedido: ok, sem gravar nem auditar. Resolver grava o `resolvedAt` e quem
 * resolveu; reabrir volta os dois a `null`. A auditoria vai na mesma
 * transação, sem `targetUid`, com o id da mensagem, o fã em `fanUid` e o tipo
 * (nunca o texto nem o aparelho).
 */
export async function applySupportResolution(
  tx: Transaction,
  db: Firestore,
  input: SupportResolutionInput,
  options: { actor: Pick<PanelActor, 'uid' | 'name'>; now: number },
): Promise<SupportResolutionResult> {
  const message = await tx.get(supportMessageRef(db, input.id));
  if (!message.exists) throw supportPanelError('message-not-found');
  const status = statusAfter(input.action);
  if (message.get('status') === status) return { ok: true, status };
  const at = Timestamp.fromMillis(options.now);
  const { uid, name } = options.actor;
  tx.update(
    message.ref,
    status === 'resolved'
      ? { status, resolvedAt: at, resolvedBy: { uid, name } }
      : { status, resolvedAt: null, resolvedBy: null },
  );
  const kind: unknown = message.get('kind');
  const fanUid: unknown = message.get('uid');
  writeAudit(
    tx,
    db,
    {
      action: status === 'resolved' ? 'support.message.resolved' : 'support.message.reopened',
      actorUid: uid,
      actorName: name,
      targetEmail: '',
      targetUid: null,
      details: {
        supportMessageId: input.id,
        fanUid: typeof fanUid === 'string' ? fanUid : null,
        kind: isSupportKind(kind) ? kind : null,
      },
    },
    at,
  );
  return { ok: true, status };
}

/**
 * resolveSupportMessage (38.3): `{ id, action: 'resolve' | 'reopen' }`, com a
 * seção `support` e edição, lida direto e de novo na transação. Sem login,
 * `unauthenticated`. Saída `{ ok: true, status }`.
 */
export async function resolveSupportMessage(
  deps: SupportPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<SupportResolutionResult> {
  const { db } = deps;
  await readPanelActor(directRead, db, caller, 'support', 'edit');
  const input = parseSupportResolution(requestFields(data));
  const now = (deps.now ?? Date.now)();
  return db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'support', 'edit');
    return applySupportResolution(tx, db, input, { actor, now });
  });
}

/** O `resolveSupportMessage` fora do painel, com um ator dado (o seed). Sem conferir o acesso. */
export function runSupportResolution(
  db: Firestore,
  input: SupportResolutionInput,
  actor: Pick<PanelActor, 'uid' | 'name'>,
  now: number = Date.now(),
): Promise<SupportResolutionResult> {
  return db.runTransaction((tx) => applySupportResolution(tx, db, input, { actor, now }));
}
