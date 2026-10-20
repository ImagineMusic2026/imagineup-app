import { isAxiosError } from 'axios';

/**
 * - `rateLimited`: pedidos seguidos demais (429 `rate_limited`, ou o 429 sem
 *   código da cota do Cloud Run): nada foi gravado, e tentar de novo depois do
 *   `Retry-After` é seguro (27.3);
 * - `dailyLimit`: o teto do dia da ação (429 `too_many_requests`): só amanhã.
 */
export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'rateLimited'
  | 'dailyLimit'
  | 'server'
  | 'unknown';

/**
 * Códigos que a API manda no corpo do erro (`code`) e que mais de um domínio
 * trata. Moram no contrato da API, e não nas fixtures: as fixtures imitam a
 * API, e os códigos ficam quando o ramo das fixtures sair.
 */
export const API_ERROR_CODES = {
  /** O saldo não cobre o gasto (resgate da 1h). */
  insufficientPoints: 'insufficient_points',
  /** A recompensa esgotou, foi encerrada ou o show dela fechou (resgate da 1h, bloco 10). */
  soldOut: 'sold_out',
  /** A conta suspensa pela equipe (403, bloco 11): a ação que cria ou soma é recusada. */
  accountSuspended: 'account_suspended',
  /** Pedidos seguidos demais (429, 27.3), com o `Retry-After`. */
  rateLimited: 'rate_limited',
  /** O teto do dia da ação (429), com `details.action` e o `Retry-After` até a meia-noite. */
  tooManyRequests: 'too_many_requests',
  /** O comentário fora da regra (400): vazio, longo, invisível ou fora dos Termos de uso. */
  commentInvalid: 'comment_invalid',
  /** Um campo do `PUT /me/profile` fora da regra (400), com o `details.field`. */
  profileInvalid: 'profile_invalid',
  /**
   * Um campo do fã-clube fora da regra (400, seção 34), com o `details.field`
   * e o `details.reason`. Mora aqui, e não só no `FAN_CLUB_ERROR_CODES` do
   * domínio, porque o `isContentRefusal` também o trata.
   */
  fanClubInvalid: 'fan_club_invalid',
} as const;

/**
 * O `details.reason` do texto recusado pelo filtro do que o fã publica (seção
 * 30 de docs/arquitetura-api.md), no `comment_invalid`, no `profile_invalid`
 * e no `fan_club_invalid` (seção 34).
 */
export const CONTENT_NOT_ALLOWED = 'not_allowed';

/** O `details` do corpo do erro: o campo do `profile_invalid`, a ação do teto do dia (429). */
export type ApiErrorDetails = Readonly<Record<string, unknown>>;

/** Erro único que telas e hooks tratam, venha de onde vier. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  /**
   * O objeto `details` do corpo do erro, ou `null` (sem corpo, ou o campo
   * ausente ou fora do formato). A tela de editar o perfil lê o campo do
   * `profile_invalid` e a ação do 429 (seção 28 de docs/arquitetura-api.md).
   */
  readonly details: ApiErrorDetails | null;
  /**
   * O `Retry-After` da resposta em ms (o 429 e o 503), ou `null` sem ele ou
   * fora do formato (só segundos inteiros). O do teto do dia vai até a
   * meia-noite: nunca vira atraso de nova tentativa (29.17).
   */
  readonly retryAfterMs: number | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    code: string | null = null,
    details: ApiErrorDetails | null = null,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
  }

  /**
   * Resultado incerto: o servidor pode ter gravado (rede, prazo, 5xx), e a
   * nova tentativa leva a mesma chave. O ritmo (`rateLimited`) não entra: nada
   * foi gravado, e quem tenta de novo nele é o `shouldRetry` do Query
   * (`services/query/client.ts`) e, no comentário, o `keepsAttempt`.
   */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }

  /** Pedidos seguidos demais (429 `rate_limited` ou sem código): tenta de novo depois do `Retry-After`. */
  get isRateLimited(): boolean {
    return this.kind === 'rateLimited';
  }

  /** O teto do dia da ação (429 `too_many_requests`): nunca tenta de novo. */
  get isDailyLimit(): boolean {
    return this.kind === 'dailyLimit';
  }
}

/** A conta suspensa pela equipe (403 `account_suspended`, 26.6). */
export function isAccountSuspended(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === API_ERROR_CODES.accountSuspended
  );
}

/**
 * O texto recusado pelo filtro do que o fã publica (400 `comment_invalid`,
 * `profile_invalid` ou `fan_club_invalid` com o `details.reason`
 * `not_allowed`, seções 30 e 34). Sem
 * `instanceof`: lê o `status`, o `code` e o `details` de qualquer objeto,
 * porque o erro do comentário que volta do disco é um objeto do JSON, com os
 * campos do `ApiError`, e não um `ApiError`.
 */
export function isContentRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code, details } = error as {
    status?: unknown;
    code?: unknown;
    details?: unknown;
  };
  if (status !== 400) return false;
  if (
    code !== API_ERROR_CODES.commentInvalid &&
    code !== API_ERROR_CODES.profileInvalid &&
    code !== API_ERROR_CODES.fanClubInvalid
  ) {
    return false;
  }
  const reason =
    typeof details === 'object' && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;
  return reason === CONTENT_NOT_ALLOWED;
}

function kindFromStatus(status: number, code: string | null): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  // O teto do dia pelo código; o resto do 429 (o `rate_limited` e o da cota do
  // Cloud Run, que vem sem corpo JSON) é o ritmo.
  if (status === 429) {
    return code === API_ERROR_CODES.tooManyRequests ? 'dailyLimit' : 'rateLimited';
  }
  if (status >= 500) return 'server';
  return 'unknown';
}

/** O `details` do corpo, só quando é um objeto. */
function detailsOf(value: unknown): ApiErrorDetails | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ApiErrorDetails)
    : null;
}

/** O código do corpo, só quando é texto (a cota do Cloud Run responde HTML). */
function codeOf(data: unknown): string | null {
  const code = typeof data === 'object' && data !== null ? (data as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

function messageOf(data: unknown): string | null {
  const message =
    typeof data === 'object' && data !== null ? (data as { message?: unknown }).message : null;
  return typeof message === 'string' ? message : null;
}

/**
 * O `Retry-After` em ms: só segundos inteiros (o formato que a API manda); a
 * data HTTP e o resto viram `null`. O adaptador do React Native entrega os
 * nomes dos cabeçalhos em minúsculas; o `get` cobre os `AxiosHeaders`.
 */
function retryAfterOf(headers: unknown): number | null {
  if (typeof headers !== 'object' || headers === null) return null;
  const reader = headers as { get?: unknown; [name: string]: unknown };
  const raw =
    typeof reader.get === 'function'
      ? (reader.get as (name: string) => unknown)('retry-after')
      : (reader['retry-after'] ?? reader['Retry-After']);
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) return null;
  return Number(text.trim()) * 1000;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError('timeout', error.message);
    }
    if (!error.response) return new ApiError('network', error.message);
    const { status, data, headers } = error.response;
    const code = codeOf(data);
    return new ApiError(
      kindFromStatus(status, code),
      messageOf(data) ?? error.message,
      status,
      code,
      detailsOf((data as { details?: unknown } | null | undefined)?.details),
      retryAfterOf(headers),
    );
  }
  return new ApiError('unknown', error instanceof Error ? error.message : String(error));
}
