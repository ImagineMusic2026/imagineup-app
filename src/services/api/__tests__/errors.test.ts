import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

import { ApiError, isAccountSuspended, isContentRefusal, toApiError } from '../errors';

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

// Os dois 429 (seção 29, frente F): o ritmo tenta de novo, o teto do dia nunca.
function limitedError(status: number, data: unknown, headers: Record<string, string>): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    null,
    { data, status, statusText: '', headers, config },
  );
}

describe('toApiError: o 429 e o Retry-After', () => {
  it('o rate_limited é o ritmo, com o Retry-After em ms', () => {
    const error = toApiError(
      limitedError(
        429,
        { code: 'rate_limited', message: 'Muitos pedidos.' },
        { 'retry-after': '3' },
      ),
    );
    expect(error.kind).toBe('rateLimited');
    expect(error.isRateLimited).toBe(true);
    expect(error.isDailyLimit).toBe(false);
    expect(error.retryAfterMs).toBe(3000);
    expect(error.code).toBe('rate_limited');
  });

  it('o 429 sem corpo JSON (a cota do Cloud Run) também é o ritmo', () => {
    const html = toApiError(limitedError(429, '<html>Rate exceeded.</html>', {}));
    expect(html.kind).toBe('rateLimited');
    expect(html.code).toBeNull();
    expect(html.retryAfterMs).toBeNull();
    const empty = toApiError(limitedError(429, undefined, { 'retry-after': '1' }));
    expect(empty.kind).toBe('rateLimited');
    expect(empty.retryAfterMs).toBe(1000);
  });

  it('o too_many_requests é o teto do dia, com o Retry-After até a meia-noite', () => {
    const error = toApiError(
      limitedError(
        429,
        { code: 'too_many_requests', details: { limit: 30, action: 'like' } },
        { 'retry-after': '43200' },
      ),
    );
    expect(error.kind).toBe('dailyLimit');
    expect(error.isDailyLimit).toBe(true);
    expect(error.isRateLimited).toBe(false);
    expect(error.retryAfterMs).toBe(43_200_000);
    expect(error.details).toEqual({ limit: 30, action: 'like' });
  });

  it.each([
    ['data HTTP', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['fração', '1.5'],
    ['negativo', '-1'],
    ['vazio', ''],
    ['texto', 'logo'],
  ])('o Retry-After fora do formato (%s) vira null', (_, value) => {
    const error = toApiError(limitedError(429, { code: 'rate_limited' }, { 'retry-after': value }));
    expect(error.retryAfterMs).toBeNull();
  });

  it('lê o Retry-After dos AxiosHeaders e do 503', () => {
    const headers = new AxiosHeaders({ 'Retry-After': '1' });
    const error = toApiError(
      new AxiosError('x', 'ERR_BAD_RESPONSE', config, null, {
        data: { code: 'unavailable' },
        status: 503,
        statusText: '',
        headers,
        config,
      }),
    );
    expect(error.kind).toBe('server');
    expect(error.retryAfterMs).toBe(1000);
  });

  it('o isRetryable continua sendo só o resultado incerto: nem o ritmo nem o teto entram', () => {
    expect(new ApiError('network', 'x').isRetryable).toBe(true);
    expect(new ApiError('timeout', 'x').isRetryable).toBe(true);
    expect(new ApiError('server', 'x', 503).isRetryable).toBe(true);
    expect(new ApiError('rateLimited', 'x', 429, 'rate_limited').isRetryable).toBe(false);
    expect(new ApiError('dailyLimit', 'x', 429, 'too_many_requests').isRetryable).toBe(false);
    expect(new ApiError('forbidden', 'x', 403, 'account_suspended').isRetryable).toBe(false);
    expect(new ApiError('validation', 'x', 400).isRetryable).toBe(false);
    expect(new ApiError('unknown', 'x').isRetryable).toBe(false);
  });

  it('o ApiError criado à mão fica sem Retry-After', () => {
    expect(new ApiError('rateLimited', 'x', 429).retryAfterMs).toBeNull();
  });
});

describe('isAccountSuspended', () => {
  it('só o 403 account_suspended da API', () => {
    expect(
      isAccountSuspended(
        toApiError(responseError(403, { code: 'account_suspended', message: 'Suspensa.' })),
      ),
    ).toBe(true);
    expect(isAccountSuspended(new ApiError('forbidden', 'x', 403, 'not_fan'))).toBe(false);
    expect(isAccountSuspended(new ApiError('forbidden', 'x', 403, null))).toBe(false);
    expect(isAccountSuspended(new ApiError('validation', 'x', 400, 'account_suspended'))).toBe(
      false,
    );
    expect(isAccountSuspended(new Error('account_suspended'))).toBe(false);
  });
});

// O filtro do que o fã publica (seção 30): o motivo `not_allowed` nos dois
// códigos de texto, também no erro que volta do disco como objeto do JSON.
describe('isContentRefusal', () => {
  const refused = (code: string, details: Record<string, unknown> | null) =>
    toApiError(responseError(400, { code, message: 'Fora dos Termos de uso.', details }));

  it.each([
    ['comment_invalid', { reason: 'not_allowed' }],
    ['profile_invalid', { field: 'bio', reason: 'not_allowed' }],
    ['profile_invalid', { field: 'socials.instagram', reason: 'not_allowed' }],
    // O nome, o texto de divulgação e a publicação do fã-clube (seção 34).
    ['fan_club_invalid', { field: 'pitch', reason: 'not_allowed' }],
  ])('o 400 %s com not_allowed, no ApiError e no objeto do JSON', (code, details) => {
    const error = refused(code, details);
    expect(isContentRefusal(error)).toBe(true);
    // O erro do comentário salvo no disco volta assim: sem a classe, com os campos.
    const fromDisk: unknown = JSON.parse(JSON.stringify(error));
    expect(fromDisk).not.toBeInstanceOf(ApiError);
    expect(isContentRefusal(fromDisk)).toBe(true);
  });

  it('outro motivo, outro status, outro código ou sem details: não é', () => {
    expect(isContentRefusal(refused('comment_invalid', { reason: 'too_long' }))).toBe(false);
    // O "oficial" no nome e o formato do fã-clube não são o filtro.
    expect(
      isContentRefusal(refused('fan_club_invalid', { field: 'name', reason: 'official' })),
    ).toBe(false);
    expect(isContentRefusal(refused('fan_club_invalid', { field: 'text', reason: 'format' }))).toBe(
      false,
    );
    expect(isContentRefusal(refused('fan_club_refused', { reason: 'not_allowed' }))).toBe(false);
    expect(
      isContentRefusal(refused('profile_invalid', { field: 'bio', reason: 'invisible' })),
    ).toBe(false);
    expect(isContentRefusal(refused('comment_invalid', null))).toBe(false);
    expect(isContentRefusal(refused('username_invalid', { reason: 'not_allowed' }))).toBe(false);
    expect(isContentRefusal(refused('invalid_request', { reason: 'not_allowed' }))).toBe(false);
    expect(
      isContentRefusal(
        new ApiError('validation', 'x', 422, 'comment_invalid', { reason: 'not_allowed' }),
      ),
    ).toBe(false);
    expect(isContentRefusal({ status: 400, code: 'comment_invalid', details: 'not_allowed' })).toBe(
      false,
    );
    expect(isContentRefusal({ status: 400, code: 'comment_invalid' })).toBe(false);
    expect(isContentRefusal(new Error('not_allowed'))).toBe(false);
    expect(isContentRefusal(null)).toBe(false);
    expect(isContentRefusal('comment_invalid')).toBe(false);
  });
});
