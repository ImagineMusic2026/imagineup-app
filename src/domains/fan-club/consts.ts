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
  /**
   * 404: o comentário que não existe, que quem pede não vê ou de outra
   * publicação (seção 37, 37.3).
   */
  commentNotFound: 'fan_club_comment_not_found',
} as const;

/**
 * Os `details.reason` do 409 `fan_club_refused`, os mesmos do `FanClubRefusal`
 * de `functions/src/fan-clubs/model.ts` (mudou um, mude o outro). O
 * `applications_closed` é a candidatura com o programa fechado (o
 * `FAN_CLUB_OPEN` desligado, 34.22), e o `contact_required`, o `PUT
 * /me/contact` com o `null` (decisão 14). Da Fase 2 (seção 37, 37.3): o
 * `not_following` (comentar, reagir e pedir a sugestão do @ sem seguir e sem
 * ser o gestor) e o `staff_decided` (o gestor ocultando o que a equipe
 * reexibiu).
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
  'not_following',
  'staff_decided',
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

// --- A Fase 2: reações e comentários (seção 37) -------------------------------------

/**
 * As reações (R1 de 37.1), pela chave, na ordem da fileira: coração, fogo,
 * risada, espanto e aplauso. No dado vai a chave, nunca o emoji (37.2).
 */
export const FAN_CLUB_REACTIONS = ['heart', 'fire', 'laugh', 'wow', 'clap'] as const;

export type FanClubReaction = (typeof FAN_CLUB_REACTIONS)[number];

/**
 * O emoji de cada reação, só para desenhar: o leitor de tela ouve o nome
 * ("coração", "fogo"), nunca o emoji (37.9, item 2). O coração leva o seletor
 * de variação (U+FE0F), que o desenha colorido.
 */
export const FAN_CLUB_REACTION_EMOJI: Record<FanClubReaction, string> = {
  heart: '❤️',
  fire: '\u{1F525}',
  laugh: '\u{1F602}',
  wow: '\u{1F62E}',
  clap: '\u{1F44F}',
};

/** O texto do comentário: de 1 a 500 caracteres, como o do Mural (o `COMMENT_MAX`). */
export const FAN_CLUB_COMMENT_MAX = 500;

/** Os comentários por página, os de cima e as respostas (37.3). */
export const FAN_CLUB_COMMENTS_PAGE = 20;

/** Até 8 sugestões do @ (37.7). */
export const FAN_CLUB_MENTION_SUGGESTIONS_MAX = 8;

/**
 * A versão do aviso "o gestor vê que você é membro" que o botão de seguir
 * mostra (decisão 5 de 36.1; seção 37, "Estado"), igual à
 * `FAN_CLUB_MEMBER_NOTICE_VERSION` de `functions/src/fan-clubs/model.ts`. O
 * seguir manda a versão, e o vínculo novo guarda a marca. Muda junto com o
 * texto (`fanClub.page.memberNotice`): a versão que o servidor não conhece dá
 * 400.
 */
export const FAN_CLUB_MEMBER_NOTICE_VERSION = 'membros-2026-10';
