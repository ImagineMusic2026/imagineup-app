import { AgendaError } from '../agenda/model';
import { CentralError } from '../centrals/model';
import { ProfileEditError } from '../fan-profile/model';
import { InviteError } from '../invites/model';
import { DailyCapError, ModerationError } from '../moderation/model';
import { PointsError } from '../points/model';
import { PostError } from '../posts/model';
import { RewardError } from '../rewards/model';

// Erros da API, no formato que o toApiError do app lê: corpo
// { code, message, details? } e o status HTTP de onde sai o `kind`.
// Tabela em docs/arquitetura-api.md, seção 1 (Erros).

export type ApiErrorCode =
  | 'invalid_request'
  | 'idempotency_key_required'
  | 'comment_invalid'
  | 'username_invalid'
  | 'photo_invalid'
  | 'profile_invalid'
  | 'unauthenticated'
  | 'not_fan'
  | 'account_suspended'
  | 'not_found'
  | 'artist_not_found'
  | 'invite_not_found'
  | 'post_not_found'
  | 'event_not_found'
  | 'comment_not_found'
  | 'fan_not_found'
  | 'photo_not_found'
  | 'reward_not_found'
  | 'method_not_allowed'
  | 'insufficient_points'
  | 'sold_out'
  | 'redeem_limit_reached'
  | 'reward_changed'
  | 'invite_not_allowed'
  | 'block_list_full'
  | 'username_taken'
  | 'username_change_too_soon'
  | 'payload_too_large'
  | 'idempotency_key_reused'
  | 'too_many_requests'
  | 'rate_limited'
  | 'app_check_failed'
  | 'internal'
  | 'profile_not_ready'
  | 'unavailable';

export const API_ERRORS: Record<ApiErrorCode, { status: number; message: string }> = {
  invalid_request: { status: 400, message: 'Pedido inválido.' },
  idempotency_key_required: { status: 400, message: 'Falta a chave de idempotência.' },
  comment_invalid: {
    status: 400,
    message: 'Comentário vazio, longo demais ou com caracteres invisíveis.',
  },
  username_invalid: {
    status: 400,
    message: 'Este @ não vale. Use de 3 a 20 letras minúsculas e números.',
  },
  photo_invalid: { status: 400, message: 'Foto fora do formato. Escolha outra.' },
  profile_invalid: { status: 400, message: 'Perfil fora do formato. Confira os campos.' },
  unauthenticated: { status: 401, message: 'Entre na sua conta para continuar.' },
  app_check_failed: {
    status: 403,
    message: 'Não deu para confirmar este aparelho. Atualize o app e tente de novo.',
  },
  not_fan: { status: 403, message: 'Esta conta não é de fã.' },
  account_suspended: {
    status: 403,
    message: 'Sua conta está suspensa. Fale com a equipe do ImagineUP.',
  },
  not_found: { status: 404, message: 'Não encontrado.' },
  artist_not_found: { status: 404, message: 'Central não encontrada.' },
  invite_not_found: { status: 404, message: 'Convite não encontrado.' },
  post_not_found: { status: 404, message: 'Post não encontrado.' },
  event_not_found: { status: 404, message: 'Show não encontrado.' },
  comment_not_found: { status: 404, message: 'Comentário não encontrado.' },
  fan_not_found: { status: 404, message: 'Fã não encontrado.' },
  photo_not_found: { status: 404, message: 'Foto não encontrada. Envie de novo.' },
  reward_not_found: { status: 404, message: 'Recompensa não encontrada.' },
  method_not_allowed: { status: 405, message: 'Método não aceito nesta rota.' },
  insufficient_points: { status: 409, message: 'Saldo insuficiente.' },
  sold_out: { status: 409, message: 'Recompensa esgotada.' },
  redeem_limit_reached: {
    status: 409,
    message: 'Você chegou ao limite de resgates desta recompensa.',
  },
  reward_changed: {
    status: 409,
    message: 'O custo desta recompensa mudou. Confira antes de resgatar.',
  },
  invite_not_allowed: { status: 409, message: 'Este convite não vale para esta conta.' },
  block_list_full: { status: 409, message: 'Você chegou ao limite de fãs bloqueados.' },
  username_taken: { status: 409, message: 'Este @ já tem dono.' },
  username_change_too_soon: {
    status: 409,
    message: 'Você trocou o @ há pouco. Tente de novo mais tarde.',
  },
  payload_too_large: { status: 413, message: 'Pedido grande demais.' },
  idempotency_key_reused: { status: 422, message: 'Esta chave já foi usada em outro pedido.' },
  too_many_requests: { status: 429, message: 'Tentativas demais por hoje. Tente amanhã.' },
  rate_limited: {
    status: 429,
    message: 'Muitos pedidos seguidos. Espere alguns segundos e tente de novo.',
  },
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
 * Qualquer erro para o erro da API. Recusa do núcleo de pontos, das centrais,
 * do convite, do mural, da agenda, da moderação, da edição do perfil (bloco
 * 9) ou da loja (bloco 10) vira o código combinado (e
 * os tetos do dia, o 429 com Retry-After); disputa que sobrou das 5 tentativas vira 503 com Retry-After;
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
  if (error instanceof InviteError) {
    return { error: apiError(error.reason, error.details), unexpected: false };
  }
  if (error instanceof DailyCapError) {
    return {
      error: new ApiHttpError(
        'too_many_requests',
        { limit: error.limit, action: error.action },
        { 'Retry-After': String(error.retryAfter) },
      ),
      unexpected: false,
    };
  }
  if (
    error instanceof PostError ||
    error instanceof AgendaError ||
    error instanceof ProfileEditError ||
    error instanceof RewardError
  ) {
    return { error: apiError(error.reason, error.details), unexpected: false };
  }
  if (error instanceof ModerationError) {
    if (error.reason === 'own_comment' || error.reason === 'self') {
      return { error: apiError('invalid_request', { reason: error.reason }), unexpected: false };
    }
    return { error: apiError(error.reason, error.details), unexpected: false };
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
