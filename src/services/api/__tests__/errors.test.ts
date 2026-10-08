import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

import { ApiError, toApiError } from '../errors';

// O erro da API como o app lê: o tipo pelo status, o código e, desde o perfil
// novo (seção 28 de docs/arquitetura-api.md), o `details` do corpo.

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

function responseError(status: number, data: unknown): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    null,
    {
      data,
      status,
      statusText: '',
      headers: {},
      config,
    },
  );
}

describe('toApiError', () => {
  it('lê o details do corpo: o campo do profile_invalid', () => {
    const error = toApiError(
      responseError(400, {
        code: 'profile_invalid',
        message: 'Perfil fora do formato. Confira os campos.',
        details: { field: 'displayName', reason: 'too_long' },
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('validation');
    expect(error.code).toBe('profile_invalid');
    expect(error.details).toEqual({ field: 'displayName', reason: 'too_long' });
  });

  it('lê a ação do teto do dia no 429', () => {
    const error = toApiError(
      responseError(429, {
        code: 'too_many_requests',
        message: 'Limite do dia.',
        details: { limit: 5, action: 'name' },
      }),
    );
    expect(error.status).toBe(429);
    expect(error.details).toEqual({ limit: 5, action: 'name' });
  });

  it('sem details, ou com ele fora do formato, fica null', () => {
    expect(toApiError(responseError(409, { code: 'username_taken' })).details).toBeNull();
    expect(toApiError(responseError(400, { code: 'x', details: 'texto' })).details).toBeNull();
    expect(toApiError(responseError(400, { code: 'x', details: ['a'] })).details).toBeNull();
    expect(toApiError(responseError(400, { code: 'x', details: null })).details).toBeNull();
    expect(toApiError(responseError(500, undefined)).details).toBeNull();
  });

  it('sem resposta (rede) ou com o prazo do axios, sem details', () => {
    const network = toApiError(new AxiosError('Network Error', 'ERR_NETWORK', config));
    expect(network.kind).toBe('network');
    expect(network.details).toBeNull();
    const timeout = toApiError(new AxiosError('timeout', 'ECONNABORTED', config));
    expect(timeout.kind).toBe('timeout');
    expect(timeout.details).toBeNull();
  });

  it('o ApiError criado à mão continua sem details, e o que já é ApiError passa igual', () => {
    const error = new ApiError('timeout', 'prazo');
    expect(error.details).toBeNull();
    expect(toApiError(error)).toBe(error);
  });
});
