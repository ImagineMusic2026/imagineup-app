import type { TranslationKey, TranslationParams } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { formatDate } from '@/utils/date';

import {
  FAN_CLUB_ERROR_CODES,
  FAN_CLUB_INVALID_FIELDS,
  FAN_CLUB_REFUSALS,
  type FanClubInvalidField,
  type FanClubRefusal,
} from './consts';
import type {
  FanClubPostRejectReason,
  FanClubPostStatus,
  FanClubRejectReason,
  FanClubUnavailableReason,
} from './types';

// As frases do fã-clube por código (seção 34, 34.9): a recusa do servidor no
// campo dela ou no topo da tela, e os textos fixos dos motivos e dos status.
// As tabelas são `Record` dos tipos do contrato: o código novo sem frase
// quebra o typecheck.

/** Uma recusa do fã-clube como a tela mostra. */
export interface FanClubErrorText {
  /**
   * O campo da tela que recebe a frase (`fan_club_invalid`), ou null para o
   * topo. A miniatura recusada vem como `photo`: a tela tem um campo só para
   * a foto, e as duas saem da mesma escolha.
   */
  field: Exclude<FanClubInvalidField, 'thumb'> | null;
  key: TranslationKey;
  params?: TranslationParams;
}

/** O formato de cada campo; o texto barrado pelo filtro (`not_allowed`) tem a frase da seção 30. */
const INVALID_TEXTS: Record<FanClubInvalidField, TranslationKey> = {
  name: 'fanClub.errors.invalid.name',
  pitch: 'fanClub.errors.invalid.pitch',
  instagram: 'fanClub.errors.invalid.instagram',
  tiktok: 'fanClub.errors.invalid.tiktok',
  socials: 'fanClub.errors.invalid.socials',
  whatsapp: 'rewards.errors.whatsappInvalid',
  adult: 'fanClub.errors.invalid.adult',
  rulesVersion: 'fanClub.errors.invalid.rulesVersion',
  text: 'fanClub.errors.invalid.text',
  photo: 'fanClub.errors.invalid.photo',
  thumb: 'fanClub.errors.invalid.photo',
};

const REFUSED_TEXTS: Record<FanClubRefusal, TranslationKey> = {
  applications_closed: 'fanClub.errors.refused.applicationsClosed',
  username_required: 'fanClub.errors.refused.usernameRequired',
  not_member: 'fanClub.errors.refused.notMember',
  artist_closed: 'fanClub.errors.refused.artistClosed',
  already_applied: 'fanClub.errors.refused.alreadyApplied',
  has_fan_club: 'fanClub.errors.refused.hasFanClub',
  cooldown: 'fanClub.errors.refused.cooldown',
  too_many_rounds: 'fanClub.errors.refused.tooManyRounds',
  not_allowed: 'fanClub.errors.refused.notAllowed',
  contact_required: 'fanClub.errors.refused.contactRequired',
  club_not_active: 'fanClub.errors.refused.clubNotActive',
  photos_not_allowed: 'fanClub.errors.refused.photosNotAllowed',
  rules_outdated: 'fanClub.errors.refused.rulesOutdated',
  upload_missing: 'fanClub.errors.refused.uploadMissing',
  too_many_pending: 'fanClub.errors.refused.tooManyPending',
  own_fan_club: 'fanClub.errors.refused.ownFanClub',
  follow_limit: 'fanClub.errors.refused.followLimit',
  not_following: 'fanClub.errors.refused.notFollowing',
  staff_decided: 'fanClub.errors.refused.staffDecided',
};

const isInvalidField = (value: unknown): value is FanClubInvalidField =>
  (FAN_CLUB_INVALID_FIELDS as readonly unknown[]).includes(value);

const isRefusal = (value: unknown): value is FanClubRefusal =>
  (FAN_CLUB_REFUSALS as readonly unknown[]).includes(value);

/** O `fan_club_invalid` no campo: o "oficial" no nome, o filtro (seção 30) ou o formato. */
function invalidText(field: FanClubInvalidField, reason: unknown): FanClubErrorText {
  const shown = field === 'thumb' ? 'photo' : field;
  if (reason === 'not_allowed') return { field: shown, key: 'fanClub.refusal.contentRefused' };
  if (reason === 'official' && field === 'name') {
    return { field: shown, key: 'fanClub.errors.invalid.nameOfficial' };
  }
  return { field: shown, key: INVALID_TEXTS[field] };
}

/** O `fan_club_refused` no topo; o `cooldown` com a data do servidor, quando ela veio. */
function refusedText(reason: FanClubRefusal, canReapplyAt: unknown): FanClubErrorText {
  if (reason === 'cooldown') {
    const date = typeof canReapplyAt === 'string' ? formatDate(canReapplyAt) : '';
    return date
      ? { field: null, key: REFUSED_TEXTS.cooldown, params: { date } }
      : { field: null, key: 'fanClub.errors.refused.cooldownLater' };
  }
  return { field: null, key: REFUSED_TEXTS[reason] };
}

/**
 * A frase de uma recusa do fã-clube (os quatro códigos de 34.3 e o 404 do
 * comentário de 37.3): o 400 `fan_club_invalid` no campo dele, o 409
 * `fan_club_refused` no topo, com o motivo, e os três 404. Null para o resto (a rede, o 403 do suspenso, o 429
 * do teto e o motivo que o app ainda não conhece): a tela usa o
 * `actionRefusal` da ação, que dá a frase deles.
 */
export function fanClubErrorText(error: unknown): FanClubErrorText | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details ?? {};
  switch (error.code) {
    case FAN_CLUB_ERROR_CODES.invalid:
      return isInvalidField(details.field) ? invalidText(details.field, details.reason) : null;
    case FAN_CLUB_ERROR_CODES.refused:
      return isRefusal(details.reason) ? refusedText(details.reason, details.canReapplyAt) : null;
    case FAN_CLUB_ERROR_CODES.notFound:
      return { field: null, key: 'fanClub.notFound' };
    case FAN_CLUB_ERROR_CODES.postNotFound:
      return { field: null, key: 'fanClub.postNotFound' };
    case FAN_CLUB_ERROR_CODES.commentNotFound:
      return { field: null, key: 'fanClub.commentNotFound' };
    default:
      return null;
  }
}

/** O motivo da candidatura recusada, em texto fixo por código. */
export const REJECT_REASON_TEXTS: Record<FanClubRejectReason, TranslationKey> = {
  incomplete: 'fanClub.rejectReason.incomplete',
  not_fit: 'fanClub.rejectReason.notFit',
  artist_limit: 'fanClub.rejectReason.artistLimit',
  image_rights: 'fanClub.rejectReason.imageRights',
  rules: 'fanClub.rejectReason.rules',
  other: 'fanClub.rejectReason.other',
};

/** O status da publicação na `Pill` de "Minhas publicações". */
export const POST_STATUS_TEXTS: Record<FanClubPostStatus, TranslationKey> = {
  pending: 'fanClub.postStatus.pending',
  published: 'fanClub.postStatus.published',
  rejected: 'fanClub.postStatus.rejected',
  withdrawn: 'fanClub.postStatus.withdrawn',
  hidden: 'fanClub.postStatus.hidden',
  removed: 'fanClub.postStatus.removed',
};

/** O motivo da publicação recusada, em texto fixo por código. */
export const POST_REJECT_REASON_TEXTS: Record<FanClubPostRejectReason, TranslationKey> = {
  image_rights: 'fanClub.postRejectReason.imageRights',
  off_topic: 'fanClub.postRejectReason.offTopic',
  quality: 'fanClub.postRejectReason.quality',
  rules: 'fanClub.postRejectReason.rules',
  other: 'fanClub.postRejectReason.other',
};

/** Por que o fã-clube não aparece para os fãs: o aviso no topo do "Meu fã-clube". */
export const UNAVAILABLE_TEXTS: Record<FanClubUnavailableReason, TranslationKey> = {
  paused: 'fanClub.unavailable.paused',
  artist_off: 'fanClub.unavailable.artistOff',
  program_closed: 'fanClub.unavailable.programClosed',
  not_member: 'fanClub.unavailable.notMember',
  closed: 'fanClub.unavailable.closed',
};
