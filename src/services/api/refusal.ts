import type { TranslationKey } from '@/i18n';

import { ApiError, isAccountSuspended } from './errors';

/**
 * A superfície que recusou: a frase sai dela, e nunca do `details.action` do
 * 429, que falta no teto de entrar em central (29.1, decisão 20).
 * - `follow`: seguir as centrais na escolha de artistas (1l), com o teto de
 *   entrar;
 * - `leave`: sair da central (livre para o suspenso, sem teto do dia);
 * - `report`: denunciar um comentário;
 * - `reportFan`: denunciar um perfil (o teto é o mesmo `report`, seção 29);
 * - `block` e `unblock`: bloquear e desbloquear um fã (livres para o
 *   suspenso; desbloquear não tem teto).
 */
export type RefusalAction =
  | 'like'
  | 'comment'
  | 'rsvp'
  | 'join'
  | 'follow'
  | 'leave'
  | 'report'
  | 'reportFan'
  | 'block'
  | 'unblock'
  | 'redeem'
  | 'profile'
  | 'photo'
  | 'invite';

/**
 * - `suspended`: 403 `account_suspended` (26.6);
 * - `dailyLimit`: o teto do dia da ação (429 `too_many_requests`);
 * - `rateLimited`: pedidos seguidos demais (429 `rate_limited` ou sem código),
 *   depois das novas tentativas.
 */
export type RefusalType = 'suspended' | 'dailyLimit' | 'rateLimited';

export interface ActionRefusal {
  /** `null`: nenhuma das três; a frase é a da ação (o 404 dela, ou a genérica). */
  type: RefusalType | null;
  key: TranslationKey;
}

interface ActionPhrases {
  /** Sem ela, a ação não tem teto do dia: o 429 dela cai no genérico. */
  dailyLimit?: TranslationKey;
  /** Sem ela, a do suspenso de sempre (`suspension.short`). */
  suspended?: TranslationKey;
  /** O 404 com frase própria; sem ela, o genérico. */
  notFound?: TranslationKey;
  generic: TranslationKey;
}

const PHRASES: Record<RefusalAction, ActionPhrases> = {
  like: { dailyLimit: 'errors.dailyLimit.like', generic: 'post.likeError' },
  comment: {
    dailyLimit: 'errors.dailyLimit.comment',
    suspended: 'suspension.comment',
    generic: 'post.composer.error',
  },
  rsvp: { dailyLimit: 'errors.dailyLimit.rsvp', generic: 'agenda.rsvp.error' },
  join: { dailyLimit: 'errors.dailyLimit.join', generic: 'artist.join.error' },
  follow: { dailyLimit: 'errors.dailyLimit.join', generic: 'onboarding.chooseArtists.saveError' },
  leave: { generic: 'artist.leave.error' },
  report: { dailyLimit: 'errors.dailyLimit.report', generic: 'post.moderation.reportError' },
  reportFan: {
    dailyLimit: 'errors.dailyLimit.report',
    notFound: 'fanProfile.notFound',
    generic: 'fanPage.reportSheet.error',
  },
  block: {
    dailyLimit: 'errors.dailyLimit.block',
    notFound: 'fanProfile.notFound',
    generic: 'post.moderation.blockError',
  },
  unblock: { notFound: 'fanProfile.notFound', generic: 'fanPage.unblockError' },
  redeem: {
    dailyLimit: 'rewards.errors.dailyLimit',
    suspended: 'suspension.redeem',
    generic: 'rewards.errors.failed',
  },
  profile: { dailyLimit: 'editProfile.tooManySaves', generic: 'editProfile.error' },
  photo: { dailyLimit: 'editProfile.photo.tooMany', generic: 'editProfile.photo.error' },
  invite: { suspended: 'suspension.invite', generic: 'invite.noCode' },
};

/** A frase do teto do dia da ação (o `Alert` "Limite de hoje" e os avisos). */
export function dailyLimitKey(action: RefusalAction): TranslationKey {
  return PHRASES[action].dailyLimit ?? PHRASES[action].generic;
}

/**
 * Por que a ação foi recusada, e a frase: a peça comum de toda superfície
 * (29.11, frentes E e F), que não escolhe pelo `kind` e pelo `code` soltos.
 * O teto do dia de uma ação sem teto, como o do suspenso numa ação livre para
 * ele, fica com o genérico.
 */
export function actionRefusal(error: unknown, action: RefusalAction): ActionRefusal {
  const phrases = PHRASES[action];
  if (isAccountSuspended(error)) {
    return { type: 'suspended', key: phrases.suspended ?? 'suspension.short' };
  }
  if (error instanceof ApiError) {
    if (error.isDailyLimit && phrases.dailyLimit) {
      return { type: 'dailyLimit', key: phrases.dailyLimit };
    }
    if (error.isRateLimited) return { type: 'rateLimited', key: 'errors.rateLimited' };
    if (error.kind === 'notFound' && phrases.notFound) {
      return { type: null, key: phrases.notFound };
    }
  }
  return { type: null, key: phrases.generic };
}
