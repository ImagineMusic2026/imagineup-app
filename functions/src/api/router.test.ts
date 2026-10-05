import { describe, expect, it } from 'vitest';

import { matchRoute, normalizePath } from './router';

const routes = [
  { method: 'GET', pattern: '/me/wallet' },
  { method: 'GET', pattern: '/posts/:postId' },
  { method: 'PUT', pattern: '/posts/:postId/like' },
  { method: 'DELETE', pattern: '/posts/:postId/like' },
] as const;

describe('roteador', () => {
  it('casa o caminho fixo e o padrão com parâmetro', () => {
    expect(matchRoute(routes, 'GET', '/me/wallet')).toMatchObject({
      kind: 'match',
      route: routes[0],
      params: {},
    });
    expect(matchRoute(routes, 'PUT', '/posts/p-clipe/like')).toMatchObject({
      kind: 'match',
      route: routes[2],
      params: { postId: 'p-clipe' },
    });
  });

  it('a barra do fim sai antes de casar', () => {
    expect(normalizePath('/me/wallet/')).toBe('/me/wallet');
    expect(matchRoute(routes, 'GET', '/me/wallet/').kind).toBe('match');
  });

  it('o id passa pelo decodeURIComponent', () => {
    expect(matchRoute(routes, 'GET', '/posts/p%C3%A9')).toMatchObject({ params: { postId: 'pé' } });
  });

  it('caminho que não existe é 404, inclusive / e o nome da função na frente', () => {
    expect(matchRoute(routes, 'GET', '/').kind).toBe('not_found');
    expect(matchRoute(routes, 'GET', '').kind).toBe('not_found');
    expect(matchRoute(routes, 'GET', '/me/carteira').kind).toBe('not_found');
    expect(matchRoute(routes, 'GET', '/api/me/wallet').kind).toBe('not_found');
    expect(matchRoute(routes, 'GET', '/posts//like').kind).toBe('not_found');
  });

  it('caminho que existe com outro método é 405, com os métodos aceitos', () => {
    expect(matchRoute(routes, 'POST', '/me/wallet')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
    expect(matchRoute(routes, 'GET', '/posts/p1/like')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
  });

  it('barra codificada ou escape quebrado dentro de um id é inválido (400)', () => {
    expect(matchRoute(routes, 'GET', '/posts/a%2Fb').kind).toBe('invalid');
    expect(matchRoute(routes, 'PUT', '/posts/a%2fb/like').kind).toBe('invalid');
    expect(matchRoute(routes, 'GET', '/posts/%E0%A4%A').kind).toBe('invalid');
  });
});
