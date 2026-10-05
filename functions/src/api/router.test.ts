import { describe, expect, it } from 'vitest';

import { API_ROUTES } from './index';
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

describe('rotas das centrais (bloco 4)', () => {
  it('/me/centrals e /me/centrals/:artistId não se confundem', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/centrals')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/me/centrals' },
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/me/centrals/nenho')).toMatchObject({
      kind: 'match',
      route: { method: 'PUT', pattern: '/me/centrals/:artistId' },
      params: { artistId: 'nenho' },
    });
    expect(matchRoute(API_ROUTES, 'DELETE', '/me/centrals/nenho/')).toMatchObject({
      kind: 'match',
      route: { method: 'DELETE', pattern: '/me/centrals/:artistId' },
    });
  });

  it('GET /me/centrals/nenho é 405 com PUT e DELETE', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/centrals/nenho')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
  });

  it('a lista, a página e seguir', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/artists')).toMatchObject({ kind: 'match' });
    expect(matchRoute(API_ROUTES, 'GET', '/artists/nettobrito')).toMatchObject({
      kind: 'match',
      params: { artistId: 'nettobrito' },
    });
    expect(matchRoute(API_ROUTES, 'POST', '/me/artists')).toMatchObject({ kind: 'match' });
    expect(matchRoute(API_ROUTES, 'GET', '/me/artists')).toEqual({
      kind: 'method_not_allowed',
      allow: ['POST'],
    });
  });
});

describe('rotas do convite (bloco 5)', () => {
  it('/me/invite e /me/invite/links/:linkId não se confundem; o : chega decodificado', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/invite')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/me/invite' },
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/me/invite/links/post%3Ap-clipe')).toMatchObject({
      kind: 'match',
      route: { method: 'PUT', pattern: '/me/invite/links/:linkId' },
      params: { linkId: 'post:p-clipe' },
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/me/invite')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
  });

  it('GET /me/invite/links/x é 405 com PUT; GET no claim e na visita é 405 com POST', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/invite/links/invite')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/invites/claim')).toEqual({
      kind: 'method_not_allowed',
      allow: ['POST'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/invites/visit')).toEqual({
      kind: 'method_not_allowed',
      allow: ['POST'],
    });
    expect(matchRoute(API_ROUTES, 'POST', '/invites')).toEqual({ kind: 'not_found' });
  });
});
