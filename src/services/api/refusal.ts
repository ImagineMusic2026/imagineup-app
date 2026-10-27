import type { TranslationKey } from '@/i18n';

import { ApiError, isAccountSuspended, isContentRefusal } from './errors';

/**
 * A superfície que recusou: a frase sai dela, e nunca do `details.action` do
 * 429, que falta no teto de entrar em central (29.1, decisão 20).
 * - `follow`: seguir as centrais na escolha de artistas (1l), com o teto de
 *   entrar;
 * - `leave`: sair da central (livre para o suspenso, sem teto do dia);
 * - `report`: denunciar um comentário;
 * - `reportFan`: denunciar um perfil (o teto é o mesmo `report`, seção 29);
 * - `block` e `unblock`: bloquear e desbloquear um fã (livres para o
 *   suspenso; desbloquear não tem teto);
 * - as do fã-clube (seção 34): `clubApply`, a candidatura (o teto
 *   `fanclub_apply`); `clubWithdraw`, desistir dela; `clubRules`, o novo
 *   aceite do regulamento; `clubUpload`, a vaga da foto (o teto
 *   `fanclub_upload`); `clubPost`, publicar (o teto `fanclub_post`);
 *   `clubRemovePost`, retirar e tirar do ar; `clubReport`, denunciar uma
 *   publicação (o teto `report` de sempre); `clubFollow`, seguir (o teto
 *   `fanclub_follow` e, quando o seguir faz a entrada, o de entrar em
 *   central); `clubUnfollow`, deixar de seguir. Desistir, retirar e deixar de
 *   seguir são livres para o suspenso e não têm teto;
 * - as da Fase 2 do fã-clube (seção 37): `clubReact`, reagir e trocar de
 *   emoji (o teto `club_react`; tirar a reação nunca é recusado);
 *   `clubComment`, comentar e responder (o teto `club_comment`, com a frase
 *   do filtro); `clubCommentReport`, denunciar um comentário, e
 *   `clubCommentReview`, o "Pedir revisão" (os dois no teto `report` de
 *   sempre); `clubCommentHide`, o ocultar e o reexibir do gestor, sem teto.
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
  | 'invite'
  | 'clubApply'
  | 'clubWithdraw'
  | 'clubRules'
  | 'clubUpload'
  | 'clubPost'
  | 'clubRemovePost'
  | 'clubReport'
  | 'clubFollow'
  | 'clubUnfollow'
  | 'clubReact'
  | 'clubComment'
  | 'clubCommentReport'
  | 'clubCommentReview'
  | 'clubCommentHide';

/**
 * - `suspended`: 403 `account_suspended` (26.6);
 * - `dailyLimit`: o teto do dia da ação (429 `too_many_requests`);
 * - `rateLimited`: pedidos seguidos demais (429 `rate_limited` ou sem código),
 *   depois das novas tentativas;
 * - `content`: o texto fora dos Termos de uso (400 `comment_invalid`,
 *   `profile_invalid` ou `fan_club_invalid` com `not_allowed`, seções 30 e
 *   34), só nas ações com a frase.
 */
export type RefusalType = 'suspended' | 'dailyLimit' | 'rateLimited' | 'content';

export interface ActionRefusal {
  /** `null`: nenhuma das quatro; a frase é a da ação (o 404 dela, ou a genérica). */
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
  /** O texto recusado pelo filtro (seção 30); sem ela, o genérico. */
  content?: TranslationKey;
  generic: TranslationKey;
}

const PHRASES: Record<RefusalAction, ActionPhrases> = {
  like: { dailyLimit: 'errors.dailyLimit.like', generic: 'post.likeError' },
  comment: {
    dailyLimit: 'errors.dailyLimit.comment',
    suspended: 'suspension.comment',
    content: 'post.composer.contentRefused',
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
  profile: {
    dailyLimit: 'editProfile.tooManySaves',
    content: 'editProfile.contentRefused',
    generic: 'editProfile.error',
  },
  photo: { dailyLimit: 'editProfile.photo.tooMany', generic: 'editProfile.photo.error' },
  invite: { suspended: 'suspension.invite', generic: 'invite.noCode' },
  clubApply: {
    dailyLimit: 'fanClub.refusal.applyDailyLimit',
    suspended: 'fanClub.refusal.applySuspended',
    content: 'fanClub.refusal.contentRefused',
    generic: 'fanClub.refusal.applyError',
  },
  clubWithdraw: { generic: 'fanClub.refusal.withdrawError' },
  clubRules: { generic: 'fanClub.refusal.rulesError' },
  clubUpload: {
    dailyLimit: 'fanClub.refusal.uploadDailyLimit',
    suspended: 'fanClub.refusal.postSuspended',
    generic: 'fanClub.refusal.uploadError',
  },
  clubPost: {
    dailyLimit: 'fanClub.refusal.postDailyLimit',
    suspended: 'fanClub.refusal.postSuspended',
    content: 'fanClub.refusal.contentRefused',
    generic: 'fanClub.refusal.postError',
  },
  clubRemovePost: { notFound: 'fanClub.postNotFound', generic: 'fanClub.refusal.removePostError' },
  clubReport: {
    dailyLimit: 'errors.dailyLimit.report',
    notFound: 'fanClub.postNotFound',
    generic: 'post.moderation.reportError',
  },
  clubFollow: {
    dailyLimit: 'fanClub.refusal.followDailyLimit',
    suspended: 'fanClub.refusal.followSuspended',
    notFound: 'fanClub.notFound',
    generic: 'fanClub.refusal.followError',
  },
  clubUnfollow: { generic: 'fanClub.refusal.unfollowError' },
  clubReact: {
    dailyLimit: 'fanClub.refusal.reactDailyLimit',
    suspended: 'fanClub.refusal.reactSuspended',
    notFound: 'fanClub.postNotFound',
    generic: 'fanClub.refusal.reactError',
  },
  clubComment: {
    dailyLimit: 'fanClub.refusal.commentDailyLimit',
    suspended: 'suspension.comment',
    notFound: 'fanClub.postNotFound',
    content: 'post.composer.contentRefused',
    generic: 'post.composer.error',
  },
  clubCommentReport: {
    dailyLimit: 'errors.dailyLimit.report',
    notFound: 'fanClub.commentNotFound',
    generic: 'post.moderation.reportError',
  },
  clubCommentReview: {
    dailyLimit: 'fanClub.refusal.reviewDailyLimit',
    notFound: 'fanClub.commentNotFound',
    generic: 'fanClub.refusal.reviewError',
  },
  clubCommentHide: {
    notFound: 'fanClub.commentNotFound',
    generic: 'fanClub.refusal.hideError',
  },
};

/** A frase do teto do dia da ação (o `Alert` "Limite de hoje" e os avisos). */
export function dailyLimitKey(action: RefusalAction): TranslationKey {
  return PHRASES[action].dailyLimit ?? PHRASES[action].generic;
}

/**
 * Por que a ação foi recusada, e a frase: a peça comum de toda superfície
 * (29.11, frentes E e F), que não escolhe pelo `kind` e pelo `code` soltos.
 * O teto do dia de uma ação sem teto, como o do suspenso numa ação livre para
 * ele, fica com o genérico. O conteúdo vem primeiro e sem `instanceof`: o erro
 * do comentário que volta do disco é um objeto do JSON (seção 30).
 */
export function actionRefusal(error: unknown, action: RefusalAction): ActionRefusal {
  const phrases = PHRASES[action];
  if (phrases.content && isContentRefusal(error)) {
    return { type: 'content', key: phrases.content };
  }
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
