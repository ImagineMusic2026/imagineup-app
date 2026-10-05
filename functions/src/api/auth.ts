import type { Auth } from 'firebase-admin/auth';

import { ApiHttpError, apiError } from './errors';

export type TokenVerifier = Pick<Auth, 'verifyIdToken'>;

/** O token do `Authorization: Bearer <ID token>`; null sem cabeçalho ou fora do formato. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._-]+)\s*$/i.exec(header ?? '');
  return match ? match[1]! : null;
}

/**
 * Falha do servidor, não do token. O firebase-admin 14 devolve a falha ao
 * buscar as chaves públicas do Google como `auth/argument-error`, o mesmo
 * código do token inválido (token-verifier.js, mapJwtErrorToAuthError), com a
 * mensagem do erro da busca: a resposta do Google ("Error fetching public keys
 * for Google certs: ...") ou a rede ("Error while making request: ...").
 */
const KEY_FETCH_MESSAGE = /^(Error fetching public keys|Error while making request)/;

function isTransientAuthFailure(code: string, message: unknown): boolean {
  if (code === 'auth/internal-error') return true;
  return (
    code === 'auth/argument-error' && typeof message === 'string' && KEY_FETCH_MESSAGE.test(message)
  );
}

/** Quem fez o pedido, pelo ID token: o uid e o e-mail da conta (null sem e-mail). */
export type Caller = { uid: string; email: string | null };

/**
 * O uid e o e-mail do ID token do Firebase. O e-mail sai sempre do token,
 * nunca do corpo do pedido (a chave da pessoa do convite, bloco 5). Sem
 * token, malformado, vencido ou de outro projeto: 401, nunca 403 (o app
 * renova o token uma vez no 401 e repete).
 * Falha ao buscar as chaves do Google ou erro interno do Auth: 503 com
 * Retry-After, que o app tenta de novo; como 401, o app desistiria e
 * mandaria o fã entrar de novo. Sem `checkRevoked`: a conta excluída perde o
 * direito de gravar pelo perfil exigido em toda gravação (requireFan).
 */
export async function authenticate(
  auth: TokenVerifier,
  header: string | undefined,
): Promise<Caller> {
  const token = bearerToken(header);
  if (!token) throw apiError('unauthenticated');
  try {
    const decoded = await auth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' && decoded.email !== '' ? decoded.email : null,
    };
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && code.startsWith('auth/')) {
      if (isTransientAuthFailure(code, message)) {
        throw new ApiHttpError('unavailable', undefined, { 'Retry-After': '1' });
      }
      throw apiError('unauthenticated');
    }
    throw error;
  }
}
