import { apiError, ApiHttpError } from './errors';

// App Check na função api (proteção contra abuso, docs/arquitetura-api.md,
// 27.5): o token do aparelho no cabeçalho X-Firebase-AppCheck, conferido pelo
// firebase-admin. Desligado até a build das lojas mandar o token: o app de
// hoje usa o SDK JS do Firebase, que no React Native não tem atestado do
// aparelho (Play Integrity, App Attest), e o Expo Go não roda módulo nativo.
// Os três modos:
// - off: não lê o cabeçalho;
// - monitor: confere e só registra no log o pedido sem token ou com token
//   inválido, para medir antes de exigir;
// - enforce: recusa esses pedidos com 403 `app_check_failed`; a falha ao
//   buscar as chaves do Google é 503 `unavailable`, e o app tenta de novo.
// Trocar o modo é trocar APP_CHECK_MODE e publicar a api.

export type AppCheckMode = 'off' | 'monitor' | 'enforce';

/** O modo de hoje. Passa a `monitor` com a primeira build que manda o token. */
export const APP_CHECK_MODE: AppCheckMode = 'off';

export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

/** Confere o token (o `getAppCheck().verifyToken` na função; os testes trocam). Lança se não vale. */
export type AppCheckVerifier = (token: string) => Promise<unknown>;

export type AppCheckConfig = { mode: AppCheckMode; verify: AppCheckVerifier };

export type AppCheckProblem = 'missing' | 'invalid' | 'unavailable';

/**
 * A falha ao buscar as chaves públicas do App Check: o firebase-admin devolve
 * com o código de token inválido e a causa `key-fetch-error`. Como no ID token
 * (Armadilhas), é indisponibilidade do Google, e não do aparelho.
 */
function isKeyFetchFailure(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return cause?.code === 'key-fetch-error';
}

type Log = { warn: (message: string, data: Record<string, unknown>) => void };

/**
 * Confere o App Check do pedido pelo modo. Em `monitor`, o problema vai para o
 * log e o pedido segue; em `enforce`, lança o 403. Devolve o problema (ou
 * null) para quem chama registrar.
 */
export async function checkAppCheck(
  config: AppCheckConfig,
  token: string | undefined,
  log: Log,
  context: Record<string, unknown> = {},
): Promise<AppCheckProblem | null> {
  if (config.mode === 'off') return null;
  let problem: AppCheckProblem | null = null;
  if (!token) problem = 'missing';
  else {
    try {
      await config.verify(token);
    } catch (error) {
      problem = isKeyFetchFailure(error) ? 'unavailable' : 'invalid';
    }
  }
  if (!problem) return null;
  if (config.mode === 'enforce') {
    if (problem === 'unavailable') {
      throw new ApiHttpError('unavailable', undefined, { 'Retry-After': '1' });
    }
    throw apiError('app_check_failed', { reason: problem });
  }
  log.warn('api: pedido sem App Check válido', { problem, ...context });
  return problem;
}
