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
} as const;

/** Erro único que telas e hooks tratam, venha de onde vier. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
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

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError<{ code?: string; message?: string }>(error)) {
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
    );
  }
  return new ApiError('unknown', error instanceof Error ? error.message : String(error));
}
