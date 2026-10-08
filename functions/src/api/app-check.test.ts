import { describe, expect, it, vi } from 'vitest';

import { APP_CHECK_MODE, checkAppCheck, type AppCheckMode } from './app-check';
import { ApiHttpError } from './errors';

const verify = vi.fn(async (token: string) => {
  if (token !== 'valido') throw new Error('token inválido');
});

const log = () => ({ warn: vi.fn() });

describe('App Check da api (27.5)', () => {
  it('desligado na função publicada, até a build das lojas mandar o token', () => {
    expect(APP_CHECK_MODE).toBe('off');
  });

  it('off: não confere nada, nem com o token inválido', async () => {
    const logger = log();
    verify.mockClear();
    await expect(checkAppCheck({ mode: 'off', verify }, 'outro', logger)).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each<[AppCheckMode, string | undefined, 'missing' | 'invalid' | null]>([
    ['monitor', undefined, 'missing'],
    ['monitor', '', 'missing'],
    ['monitor', 'outro', 'invalid'],
    ['monitor', 'valido', null],
  ])('%s com o token %j: %s, e o pedido segue', async (mode, token, problem) => {
    const logger = log();
    await expect(checkAppCheck({ mode, verify }, token, logger, { route: 'r' })).resolves.toBe(
      problem,
    );
    if (problem) {
      expect(logger.warn).toHaveBeenCalledWith('api: pedido sem App Check válido', {
        problem,
        route: 'r',
      });
    } else {
      expect(logger.warn).not.toHaveBeenCalled();
    }
  });

  it('enforce: sem token ou inválido lança o 403 app_check_failed com o motivo; válido passa', async () => {
    for (const [token, reason] of [
      [undefined, 'missing'],
      ['outro', 'invalid'],
    ] as const) {
      const error = await checkAppCheck({ mode: 'enforce', verify }, token, log()).catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(ApiHttpError);
      expect((error as ApiHttpError).status).toBe(403);
      expect((error as ApiHttpError).body()).toMatchObject({
        code: 'app_check_failed',
        details: { reason },
      });
    }
    await expect(checkAppCheck({ mode: 'enforce', verify }, 'valido', log())).resolves.toBeNull();
  });

  it('a falha ao buscar as chaves do Google: 503 unavailable no enforce, e só o log no monitor', async () => {
    const outage = vi.fn(async () => {
      throw Object.assign(new Error('Error fetching Json Web Keys'), {
        code: 'app-check/invalid-argument',
        cause: { code: 'key-fetch-error' },
      });
    });
    const error = await checkAppCheck({ mode: 'enforce', verify: outage }, 'qualquer', log()).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).status).toBe(503);
    expect((error as ApiHttpError).headers).toEqual({ 'Retry-After': '1' });
    const logger = log();
    await expect(
      checkAppCheck({ mode: 'monitor', verify: outage }, 'qualquer', logger),
    ).resolves.toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith('api: pedido sem App Check válido', {
      problem: 'unavailable',
    });
  });
});
