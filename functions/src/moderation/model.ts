import { secondsUntil } from '../centrals/model';
import {
  NAME_CHANGES_PER_DAY,
  PHOTO_CHANGES_PER_DAY,
  PHOTO_UPLOADS_PER_DAY,
  PROFILE_SAVES_PER_DAY,
} from '../fan-profile/model';
import { dayKey, nextDayStart, type DailyActionKey, type DayStats } from '../points/model';

// Moderação mínima do bloco 6 e os tetos do dia das ações que gravam, puro:
// nada aqui lê ou grava o Firestore. Provisória até as regras da cliente
// (UP-48). Contrato em docs/arquitetura-api.md, 21.7 e 21.8.

/** Motivos da denúncia de um comentário (lista fechada; sem texto livre). */
export const REPORT_REASONS = ['spam', 'offensive', 'harassment', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Chave da contagem por motivo no item da fila: o motivo, ou `none` sem motivo. */
export type ReasonKey = ReportReason | 'none';

export const reasonKey = (reason: ReportReason | null): ReasonKey => reason ?? 'none';

/** Fãs que um fã pode bloquear (a lista mora num documento só). */
export const BLOCK_LIST_MAX = 1_000;

// Tetos do dia por fã, em dias de São Paulo (21.7). Contam ações, pagas ou
// não, e recusam com 429 antes de gravar; desfazer nunca é recusado. Nenhum
// fã de verdade chega perto. Desde o bloco 7, o painel ajusta em
// config/points.actionCaps (22.1, decisão 13): estes são o padrão do código.

/** Trocas para curtido por dia (também a de quem curte de novo depois de descurtir). */
export const LIKES_PER_DAY = 300;
/** Comentários por dia (os que rendem pontos são o limite de `comment`, 20). */
export const COMMENTS_PER_DAY = 100;
/** Trocas para "Eu vou" por dia. */
export const RSVPS_PER_DAY = 50;
/** Denúncias por dia. */
export const REPORTS_PER_DAY = 30;
/** Bloqueios por dia. */
export const BLOCKS_PER_DAY = 30;
/**
 * Resgates da loja por dia (bloco 10, 25.1, decisão 15): o saldo já segura
 * quem não tem pontos; o teto segura quem tem e esvaziaria várias recompensas
 * pequenas num dia. Conta só o resgate que gravou.
 */
export const REDEEMS_PER_DAY = 10;

/**
 * A ação que o teto conta, como vai no `details.action` do 429. `photo` é a
 * troca de foto do perfil (bloco 9, 24.1, decisão 11) e `redeem`, o resgate
 * da loja (bloco 10, 25.7), no mesmo molde; `upload`, a vaga de envio da
 * foto do perfil (proteção contra abuso, 27.4); `profile` e `name`, o
 * salvamento do perfil e a troca de nome do `PUT /me/profile` (seção 28,
 * decisão 9).
 */
export type CapAction =
  | 'like'
  | 'comment'
  | 'rsvp'
  | 'report'
  | 'block'
  | 'photo'
  | 'redeem'
  | 'upload'
  | 'profile'
  | 'name';

export const DAILY_CAPS: Record<CapAction, { key: DailyActionKey; limit: number }> = {
  like: { key: 'like_set', limit: LIKES_PER_DAY },
  comment: { key: 'comment_sent', limit: COMMENTS_PER_DAY },
  rsvp: { key: 'rsvp_set', limit: RSVPS_PER_DAY },
  report: { key: 'comment_report', limit: REPORTS_PER_DAY },
  block: { key: 'fan_block', limit: BLOCKS_PER_DAY },
  photo: { key: 'photo_set', limit: PHOTO_CHANGES_PER_DAY },
  redeem: { key: 'reward_redeem', limit: REDEEMS_PER_DAY },
  upload: { key: 'photo_upload', limit: PHOTO_UPLOADS_PER_DAY },
  profile: { key: 'profile_save', limit: PROFILE_SAVES_PER_DAY },
  name: { key: 'name_change', limit: NAME_CHANGES_PER_DAY },
};

/**
 * Ação acima do teto do dia. A API traduz para 429 `too_many_requests` com
 * `details: { limit, action }` e o `Retry-After` (em segundos) até a
 * meia-noite de São Paulo, como o `too_many_entries` do bloco 4.
 */
export class DailyCapError extends Error {
  readonly action: CapAction;
  readonly limit: number;
  readonly retryAfter: number;

  constructor(action: CapAction, limit: number, retryAfter: number) {
    super('Ações demais por hoje.');
    this.name = 'DailyCapError';
    this.action = action;
    this.limit = limit;
    this.retryAfter = retryAfter;
  }
}

/** Quantas vezes a ação já contou hoje, nos `days` da carteira lida. */
export function capCount(days: Record<string, DayStats>, action: CapAction, now: number): number {
  return days[dayKey(now)]?.count[DAILY_CAPS[action].key] ?? 0;
}

/** A recusa do teto quando a ação já chegou nele hoje, ou null. `limit` vem da configuração. */
export function dailyCapProblem(
  action: CapAction,
  countToday: number,
  now: number,
  limit: number = DAILY_CAPS[action].limit,
): DailyCapError | null {
  if (countToday < limit) return null;
  return new DailyCapError(action, limit, secondsUntil(nextDayStart(now), now));
}

export type ModerationErrorReason =
  'comment_not_found' | 'fan_not_found' | 'own_comment' | 'self' | 'block_list_full';

const MODERATION_MESSAGES: Record<ModerationErrorReason, string> = {
  comment_not_found: 'Comentário não encontrado.',
  fan_not_found: 'Fã não encontrado.',
  own_comment: 'O próprio comentário não se denuncia.',
  self: 'Não dá para bloquear a própria conta.',
  block_list_full: 'Você chegou ao limite de fãs bloqueados.',
};

/**
 * Recusa da moderação. A API traduz `comment_not_found` e `fan_not_found`
 * para os 404, `block_list_full` para o 409, e `own_comment` e `self` para o
 * 400 `invalid_request` com `details.reason`.
 */
export class ModerationError extends Error {
  readonly reason: ModerationErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: ModerationErrorReason, details?: Record<string, unknown>) {
    super(MODERATION_MESSAGES[reason]);
    this.name = 'ModerationError';
    this.reason = reason;
    this.details = details;
  }
}

/** Uid do Auth na rota do bloqueio: letras e números, até 128. */
const FAN_ID_PATTERN = /^[A-Za-z0-9]{1,128}$/;

export function isFanId(value: unknown): value is string {
  return typeof value === 'string' && FAN_ID_PATTERN.test(value);
}

/**
 * Corpo da denúncia: `{ reason }`, com um dos motivos ou null (ausente vale
 * null). Outro valor, ou corpo que não é objeto: undefined (400 na rota).
 */
export function parseReportReason(body: unknown): ReportReason | null | undefined {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'object' || Array.isArray(body)) return undefined;
  const reason = (body as { reason?: unknown }).reason;
  if (reason === undefined || reason === null) return null;
  return (REPORT_REASONS as readonly unknown[]).includes(reason)
    ? (reason as ReportReason)
    : undefined;
}

/** Id da denúncia: uma por fã e comentário (o id do comentário é único no banco). */
export function reportId(commentId: string, reporterUid: string): string {
  return `${commentId}_${reporterUid}`;
}

/** A lista de bloqueios lida (só uids no formato), sem repetir. */
export function blockedOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isFanId))];
}

/** Sem os comentários dos autores que o fã bloqueou. */
export function withoutBlocked<T extends { authorUid: string }>(
  items: readonly T[],
  blocked: ReadonlySet<string>,
): T[] {
  return blocked.size === 0 ? [...items] : items.filter((item) => !blocked.has(item.authorUid));
}

/** O que a fila guarda por motivo: as cinco chaves, contadas a partir de 0. */
export type ReasonCounts = Record<ReasonKey, number>;

export function emptyReasons(): ReasonCounts {
  return { spam: 0, offensive: 0, harassment: 0, other: 0, none: 0 };
}

/** A contagem por motivo lida (campo estranho vale 0). */
export function reasonsOf(value: unknown): ReasonCounts {
  const counts = emptyReasons();
  if (typeof value !== 'object' || value === null) return counts;
  for (const key of Object.keys(counts) as ReasonKey[]) {
    const n = (value as Record<string, unknown>)[key];
    counts[key] = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return counts;
}
