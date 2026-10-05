import { CentralError } from '../centrals/model';
import { PointsError } from '../points/model';

// Erros da API, no formato que o toApiError do app lê: corpo
// { code, message, details? } e o status HTTP de onde sai o `kind`.
// Tabela em docs/arquitetura-api.md, seção 1 (Erros).

export type ApiErrorCode =
  | 'invalid_request'
  | 'idempotency_key_required'
  | 'unauthenticated'
  | 'not_fan'
  | 'not_found'
  | 'artist_not_found'
  | 'method_not_allowed'
  | 'insufficient_points'
  | 'payload_too_large'
  | 'idempotency_key_reused'
  | 'too_many_requests'
  | 'internal'
  | 'profile_not_ready'
  | 'unavailable';

export const API_ERRORS: Record<ApiErrorCode, { status: number; message: string }> = {
  invalid_request: { status: 400, message: 'Pedido inválido.' },
  idempotency_key_required: { status: 400, message: 'Falta a chave de idempotência.' },
  unauthenticated: { status: 401, message: 'Entre na sua conta para continuar.' },
  not_fan: { status: 403, message: 'Esta conta não é de fã.' },
  not_found: { status: 404, message: 'Não encontrado.' },
  artist_not_found: { status: 404, message: 'Central não encontrada.' },
  method_not_allowed: { status: 405, message: 'Método não aceito nesta rota.' },
  insufficient_points: { status: 409, message: 'Saldo insuficiente.' },
  payload_too_large: { status: 413, message: 'Pedido grande demais.' },
  idempotency_key_reused: { status: 422, message: 'Esta chave já foi usada em outro pedido.' },
  too_many_requests: { status: 429, message: 'Tentativas demais por hoje. Tente amanhã.' },
  internal: { status: 500, message: 'Algo deu errado. Tente de novo.' },
  profile_not_ready: {
    status: 503,
    message: 'Seu perfil ainda está sendo criado. Tente de novo em instantes.',
  },
  unavailable: { status: 503, message: 'Serviço ocupado. Tente de novo.' },
};

export type ApiErrorBody = {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

/** Erro que vira a resposta do código dele. */
export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    details?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    super(API_ERRORS[code].message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.status = API_ERRORS[code].status;
    this.details = details;
    this.headers = headers;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { code: this.code, message: this.message };
    if (this.details) body.details = this.details;
    return body;
  }
}

export function apiError(code: ApiErrorCode, details?: Record<string, unknown>): ApiHttpError {
  return new ApiHttpError(code, details);
}

// Códigos gRPC de disputa ou Firestore fora do ar, depois das tentativas da transação.
const BUSY_CODES = new Set([4, 8, 10, 14]);

/**
 * Qualquer erro para o erro da API. Recusa do núcleo de pontos ou das
 * centrais vira o código combinado; disputa que sobrou das 5 tentativas vira 503 com Retry-After;
 * o resto é 500 (e vai para o log de erro).
 */
export function toApiHttpError(error: unknown): { error: ApiHttpError; unexpected: boolean } {
  if (error instanceof ApiHttpError) return { error, unexpected: false };
  if (error instanceof CentralError) {
    if (error.reason === 'too_many_entries') {
      const headers: Record<string, string> = error.retryAfter
        ? { 'Retry-After': String(error.retryAfter) }
        : {};
      return {
        error: new ApiHttpError('too_many_requests', error.details, headers),
        unexpected: false,
      };
    }
    return { error: apiError('artist_not_found', error.details), unexpected: false };
  }
  if (error instanceof PointsError) {
    if (error.reason === 'insufficient_points') {
      return { error: apiError('insufficient_points', error.details), unexpected: false };
    }
    if (error.reason === 'not_fan') return { error: apiError('not_fan'), unexpected: false };
    if (error.reason === 'profile_not_ready') {
      return { error: apiError('profile_not_ready'), unexpected: false };
    }
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number' && BUSY_CODES.has(code)) {
    return {
      error: new ApiHttpError('unavailable', undefined, { 'Retry-After': '1' }),
      unexpected: false,
    };
  }
  return { error: apiError('internal'), unexpected: true };
}
