import { API_ERROR_CODES } from '@/services/api/errors';

/**
 * Os códigos de erro do fã-clube na `api` (34.3). Ficam no domínio, como o
 * `REDEEM_ERROR_CODES` da loja, porque o `API_ERROR_CODES` guarda só os que
 * mais de um domínio trata; o `fan_club_invalid` mora lá também, porque o
 * `isContentRefusal` o lê (seção 30).
 */
export const FAN_CLUB_ERROR_CODES = {
  /** 400: um campo fora da regra, com `details: { field, reason }` (e `problem` na foto). */
  invalid: API_ERROR_CODES.fanClubInvalid,
  /** 409: recusa de negócio, com `details: { reason }` (e `canReapplyAt` no `cooldown`). */
  refused: 'fan_club_refused',
  /** 404: o fã-clube que não existe ou que a pessoa não pode ver. */
  notFound: 'fan_club_not_found',
  /** 404: a publicação que não existe, fora do ar ou de outro autor. */
  postNotFound: 'fan_club_post_not_found',
} as const;

/**
 * Os `details.reason` do 409 `fan_club_refused`, os mesmos do `FanClubRefusal`
 * de `functions/src/fan-clubs/model.ts` (mudou um, mude o outro). O
 * `applications_closed` é a candidatura com o programa fechado (o
 * `FAN_CLUB_OPEN` desligado, 34.22), e o `contact_required`, o `PUT
 * /me/contact` com o `null` (decisão 14).
 */
export const FAN_CLUB_REFUSALS = [
  'applications_closed',
  'username_required',
  'not_member',
  'artist_closed',
  'already_applied',
  'has_fan_club',
  'cooldown',
  'too_many_rounds',
  'not_allowed',
  'contact_required',
  'club_not_active',
  'photos_not_allowed',
  'rules_outdated',
  'upload_missing',
  'too_many_pending',
  'own_fan_club',
  'follow_limit',
] as const;

export type FanClubRefusal = (typeof FAN_CLUB_REFUSALS)[number];

/**
 * Os campos do 400 `fan_club_invalid`, os do `FanClubInvalidField` do servidor:
 * os da candidatura (`socials` quando falta a rede, `adult` sem a
 * declaração e `rulesVersion` com a versão velha), o texto da publicação e a
 * foto e a miniatura que chegaram fora do teto.
 */
export const FAN_CLUB_INVALID_FIELDS = [
  'name',
  'pitch',
  'instagram',
  'tiktok',
  'socials',
  'whatsapp',
  'adult',
  'rulesVersion',
  'text',
  'photo',
  'thumb',
] as const;

export type FanClubInvalidField = (typeof FAN_CLUB_INVALID_FIELDS)[number];

/** O `details.reason` do `fan_club_invalid`: o formato, o filtro (seção 30) ou o "oficial" no nome. */
export type FanClubInvalidReason = 'format' | 'not_allowed' | 'official';

/** O nome do fã-clube: de 3 a 40 caracteres, sem a palavra "oficial" (decisão 10). */
export const FAN_CLUB_NAME_MIN = 3;
export const FAN_CLUB_NAME_MAX = 40;

/** "Como e onde você vai divulgar o fã-clube?": de 20 a 1.000 caracteres (decisão 8). */
export const FAN_CLUB_PITCH_MIN = 20;
export const FAN_CLUB_PITCH_MAX = 1_000;

/** O texto da publicação: de 1 a 1.000 caracteres (decisão 15). */
export const FAN_CLUB_POST_TEXT_MAX = 1_000;

/** No máximo 3 publicações em análise por fã-clube (decisão 11). */
export const FAN_CLUB_PENDING_MAX = 3;

/** As rodadas da candidatura (decisão 11). */
export const FAN_CLUB_ROUNDS_MAX = 3;

/** No máximo 50 fã-clubes seguidos por fã (decisão 34). */
export const FAN_CLUB_FOLLOWS_MAX = 50;
