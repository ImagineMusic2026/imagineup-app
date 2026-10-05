import * as logger from 'firebase-functions/logger';

import { createConfigSource } from '../points/config';
import { authenticate } from './auth';
import { ApiHttpError, apiError, toApiHttpError } from './errors';
import { parseIdempotencyKey, requestFingerprint, runIdempotent } from './idempotency';
import { matchRoute, normalizePath } from './router';
import { centralRoutes } from './routes/centrals';
import { meRoutes } from './routes/me';
import type { ApiDeps, ApiRequest, ApiResponse, ApiRoute, ResolvedDeps, RouteInput } from './types';

// API HTTP do app: uma função onRequest com roteador próprio, ID token do
// Firebase em toda rota e Idempotency-Key em toda rota que grava. O contrato
// é docs/arquitetura-api.md; os tipos das respostas, contract.ts.

export { apiError, ApiHttpError, API_ERRORS, type ApiErrorCode } from './errors';
export {
  canonicalJson,
  IDEMPOTENCY_KEY_PATTERN,
  idempotencyDocId,
  parseIdempotencyKey,
  requestFingerprint,
  runIdempotent,
} from './idempotency';
export { matchRoute } from './router';
export type * from './types';

/** Rotas de hoje. Cada bloco acrescenta as suas aqui. */
export const API_ROUTES: readonly ApiRoute[] = [...meRoutes, ...centralRoutes];

/** Corpo até 16 KiB, medido em req.rawBody. */
export const MAX_BODY_BYTES = 16 * 1024;

function send(
  res: ApiResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.status(status);
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.set(name, value);
  res.json(body);
}

function queryOf(req: ApiRequest): Record<string, unknown> {
  return typeof req.query === 'object' && req.query !== null ? req.query : {};
}

/**
 * O handler que o onRequest recebe. As dependências vêm de fora para os
 * testes trocarem o relógio, o sorteio do shard e a configuração; `routes`
 * troca a tabela (os testes de emulador acrescentam uma rota que grava).
 */
export function createApiHandler(deps: ApiDeps, routes: readonly ApiRoute[] = API_ROUTES) {
  const resolved: ResolvedDeps = {
    db: deps.db,
    auth: deps.auth,
    now: deps.now ?? Date.now,
    random: deps.random ?? Math.random,
    config: deps.config ?? createConfigSource(deps.db),
  };

  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    const started = Date.now();
    const method = req.method.toUpperCase();
    let route = 'unmatched';
    let uid: string | null = null;
    let status = 500;
    let replayed = false;

    try {
      const match = matchRoute(routes, method, req.path);
      if (match.kind === 'not_found') throw apiError('not_found');
      if (match.kind === 'invalid') throw apiError('invalid_request');
      if (match.kind === 'method_not_allowed') {
        throw new ApiHttpError('method_not_allowed', undefined, { Allow: match.allow.join(', ') });
      }
      const target = match.route;
      route = `${target.method} ${target.pattern}`;

      if ((req.rawBody?.length ?? 0) > MAX_BODY_BYTES) throw apiError('payload_too_large');
      uid = await authenticate(resolved.auth, req.get('Authorization'));
      const key = target.writes ? parseIdempotencyKey(req.get('Idempotency-Key')) : null;

      const input: RouteInput = { params: match.params, query: queryOf(req), body: req.body };
      target.validate?.(input);
      const now = resolved.now();
      const base = { ...input, uid, now, deps: resolved };

      if (!target.writes) {
        status = 200;
        send(res, status, await target.handle(base));
        return;
      }

      const { points } = await resolved.config.get();
      const callerUid = uid;
      const result = await runIdempotent(
        resolved,
        {
          uid: callerUid,
          key: key!,
          route,
          fingerprint: requestFingerprint(method, normalizePath(req.path), req.body),
          now,
          config: points,
        },
        ({ tx, fan, award }) => target.handle({ ...base, uid: callerUid, tx, fan, award }),
      );
      status = result.status;
      replayed = result.replayed;
      send(res, status, result.body, replayed ? { 'Idempotency-Replayed': 'true' } : {});
    } catch (error) {
      const { error: apiFailure, unexpected } = toApiHttpError(error);
      status = apiFailure.status;
      if (unexpected) {
        // Nunca o token, o corpo nem texto do fã: rota, uid e a mensagem do erro.
        logger.error('api: erro inesperado', {
          route,
          uid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      send(res, status, apiFailure.body(), apiFailure.headers);
    } finally {
      logger.info('api', { method, route, status, ms: Date.now() - started, uid, replayed });
    }
  };
}
