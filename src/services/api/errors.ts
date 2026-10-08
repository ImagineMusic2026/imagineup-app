import { isAxiosError } from 'axios';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
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
} as const;

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

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    code: string | null = null,
    details: ApiErrorDetails | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Erros de cliente (4xx) não melhoram tentando de novo. */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** O `details` do corpo, só quando é um objeto. */
function detailsOf(value: unknown): ApiErrorDetails | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ApiErrorDetails)
    : null;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError<{ code?: string; message?: string; details?: unknown }>(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError('timeout', error.message);
    }
    if (!error.response) return new ApiError('network', error.message);
    const { status, data } = error.response;
    return new ApiError(
      kindFromStatus(status),
      data?.message ?? error.message,
      status,
      data?.code ?? null,
      detailsOf(data?.details),
    );
  }
  return new ApiError('unknown', error instanceof Error ? error.message : String(error));
}
