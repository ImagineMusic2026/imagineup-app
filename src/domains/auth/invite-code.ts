import { bindPendingInvite, clearBoundInvite } from '@/domains/invites';
import { ApiError } from '@/services/api';
import { markInviteSettled } from '@/stores/invite-settled';

import { isFinalInviteRejection, sendInviteClaim } from './api';
import { INVITE_CLAIM_WINDOW_MS } from './consts';

// O código de convite depois do cadastro (docs/arquitetura-api.md, 20.18):
// a tela "Código de convite", aberta pelos Ajustes nos 7 primeiros dias da
// conta, para quem pulou a pergunta do cadastro.

/**
 * A conta ainda aceita um código: o perfil nasceu há até 7 dias. Sem a data
 * (perfil que não carregou, fixtures), não.
 */
export function inviteWindowOpen(createdAt: string | null | undefined, now: number): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  return !Number.isNaN(created) && now - created <= INVITE_CLAIM_WINDOW_MS;
}

/** O que a tela mostra depois do envio. */
export type ApplyInviteOutcome =
  /** O servidor aceitou: quem convidou foi creditado, dentro dos limites dele. */
  | { status: 'claimed'; code: string }
  /** A conta já tinha um convite (no cadastro, por link ou noutro aparelho). */
  | { status: 'alreadyClaimed' }
  /** A conta passou dos 7 dias (o 409 `account_too_old`). */
  | { status: 'tooOld' }
  /** O fã conserta digitando: o código não existe, ou é o dele. */
  | { status: 'rejected'; reason: 'notFound' | 'self' }
  /** Outra recusa definitiva (conta suspensa, pedido inválido): nada a fazer. */
  | { status: 'failed' }
  /** Sem resposta certa (rede, servidor): o convite fica amarrado, e a sincronização manda depois. */
  | { status: 'pending' };

/**
 * Amarra o código digitado à conta (`via: 'code'`, ou `'link'` quando é o
 * do link guardado) e manda o claim, esperando a resposta:
 * - aceito ou já com convite: o convite sai do aparelho, e a conta fica
 *   marcada como resolvida;
 * - recusado de vez: o convite sai, e a recusa volta para a tela;
 * - incerto: o convite fica amarrado, com a mesma chave, para a
 *   sincronização (20.11), como no cadastro.
 */
export async function applyInviteCode(
  uid: string,
  code: string,
  now: number = Date.now(),
): Promise<ApplyInviteOutcome> {
  const bound = await bindPendingInvite(uid, code, now);
  if (!bound) return { status: 'failed' };
  try {
    const result = await sendInviteClaim(bound);
    await clearBoundInvite(uid, bound.idempotencyKey);
    markInviteSettled(uid);
    return result.status === 'already_claimed'
      ? { status: 'alreadyClaimed' }
      : { status: 'claimed', code: bound.code };
  } catch (error) {
    if (!isFinalInviteRejection(error)) return { status: 'pending' };
    await clearBoundInvite(uid, bound.idempotencyKey);
    if (!(error instanceof ApiError)) return { status: 'failed' };
    if (error.code === 'invite_not_found') return { status: 'rejected', reason: 'notFound' };
    if (error.code === 'invite_not_allowed') {
      return error.details?.reason === 'account_too_old'
        ? { status: 'tooOld' }
        : { status: 'rejected', reason: 'self' };
    }
    return { status: 'failed' };
  }
}
