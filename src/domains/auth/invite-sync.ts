import {
  bindPendingInvite,
  clearBoundInvite,
  clearPendingInvite,
  readBoundInvite,
  readPendingInvite,
  type BoundInvite,
  type PendingInvite,
} from '@/domains/invites';
import { useSessionStore } from '@/stores/session';

import {
  currentAccountTimes,
  isFinalInviteRejection,
  sendInviteClaim,
  sendInviteVisit,
} from './api';
import { AUTO_BIND_MAX_AGE_MS, FRESH_ACCOUNT_SIGN_IN_MS, VISIT_FRESH_MS } from './consts';

// Sincronização do convite (bloco 5, docs/arquitetura-api.md, 20.11): uma
// rodada manda o convite amarrado à conta da sessão e decide o que fazer com
// o convite pendente do aparelho. Quem dispara as rodadas é o useInviteSync.

/** `done`: nada ficou para depois; `retry`: falha de resultado incerto; `aborted`: a sessão mudou. */
export type InviteSyncOutcome = 'done' | 'retry' | 'aborted';

/** O que aconteceu com o convite amarrado: foi, foi recusado de vez, ou ficou para depois. */
export type BoundDelivery = 'sent' | 'rejected' | 'uncertain';

/**
 * A sessão confirmada ainda é desta conta, e ninguém segura as telas de conta
 * (o cadastro, a saída em fade): só então o convite dela vai.
 */
export function sessionIsFor(uid: string): boolean {
  const { status, user, authHolds } = useSessionStore.getState();
  return status === 'signedIn' && user?.uid === uid && authHolds === 0;
}

/**
 * Manda o convite amarrado. Sucesso ou recusa definitiva (a lista de
 * `isFinalInviteRejection`): ele sai do aparelho, se ainda for o mesmo. O
 * resto fica para a próxima rodada, com a mesma chave.
 */
export async function deliverBoundInvite(bound: BoundInvite): Promise<BoundDelivery> {
  try {
    await sendInviteClaim(bound);
  } catch (error) {
    if (!isFinalInviteRejection(error)) return 'uncertain';
    await clearBoundInvite(bound.uid, bound.idempotencyKey);
    return 'rejected';
  }
  await clearBoundInvite(bound.uid, bound.idempotencyKey);
  return 'sent';
}

/**
 * A conta da sessão nasceu neste aparelho depois de o link chegar, há até 7
 * dias, e ninguém entrou nela desde então (o último login até 1 min depois
 * da criação): o app fechou entre criar a conta e amarrar o convite, ou a
 * conta nasceu por um fluxo de entrar (Apple, Google). A conta criada noutro
 * aparelho, que entrou aqui, não leva o convite.
 */
export function isFreshAccountForLink(uid: string, pending: PendingInvite, now: number): boolean {
  const times = currentAccountTimes(uid);
  if (!times || times.createdAt === null) return false;
  if (times.createdAt < Date.parse(pending.receivedAt)) return false;
  if (now - times.createdAt > AUTO_BIND_MAX_AGE_MS) return false;
  return (
    times.lastSignInAt === null || times.lastSignInAt - times.createdAt <= FRESH_ACCOUNT_SIGN_IN_MS
  );
}

/**
 * Uma rodada, para a conta `uid`:
 * 1. o convite amarrado a ela (vencido sai sem envio) vai ao servidor;
 * 2. o convite pendente, sem dono: se a conta não tinha convite amarrado e
 *    nasceu aqui depois do link (`isFreshAccountForLink`), ele é amarrado a
 *    ela e vai como claim; senão, sai do aparelho e, se chegou há menos de
 *    24 h, vai como visita (sem esperar e sem nova tentativa).
 * O convite amarrado a outro uid nunca é enviado nem apagado aqui. Se a
 * sessão mudar no meio, a rodada para.
 */
export async function runInviteSyncRound(
  uid: string,
  now: () => number = Date.now,
): Promise<InviteSyncOutcome> {
  if (!sessionIsFor(uid)) return 'aborted';
  let retry = false;
  const bound = await readBoundInvite(uid, now());
  if (bound) {
    if (!sessionIsFor(uid)) return 'aborted';
    retry = (await deliverBoundInvite(bound)) === 'uncertain';
  }

  if (!sessionIsFor(uid)) return 'aborted';
  const pending = await readPendingInvite(now());
  if (pending && !sessionIsFor(uid)) return 'aborted';
  if (pending && !bound && isFreshAccountForLink(uid, pending, now())) {
    const fresh = await bindPendingInvite(uid, pending.code, now());
    if (fresh && sessionIsFor(uid) && (await deliverBoundInvite(fresh)) === 'uncertain') {
      retry = true;
    }
  } else if (pending) {
    await clearPendingInvite();
    if (now() - Date.parse(pending.receivedAt) < VISIT_FRESH_MS) {
      void sendInviteVisit(pending, uid).catch(() => undefined);
    }
  }
  return retry ? 'retry' : 'done';
}
