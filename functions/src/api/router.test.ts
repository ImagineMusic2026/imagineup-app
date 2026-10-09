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

describe('rotas do mural, da agenda e da moderação (bloco 6)', () => {
  it('o post, os comentários, a curtida e a denúncia não se confundem', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/posts/p-clipe')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/posts/:postId' },
      params: { postId: 'p-clipe' },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/posts/p-clipe/comments')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/posts/:postId/comments' },
    });
    expect(matchRoute(API_ROUTES, 'POST', '/posts/p-clipe/comments')).toMatchObject({
      kind: 'match',
      route: { method: 'POST', pattern: '/posts/:postId/comments' },
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/posts/p-clipe/like')).toMatchObject({
      kind: 'match',
      route: { method: 'PUT', pattern: '/posts/:postId/like' },
    });
    expect(
      matchRoute(API_ROUTES, 'POST', '/posts/p-clipe/comments/seed-c-clipe-bia/report'),
    ).toMatchObject({
      kind: 'match',
      route: { pattern: '/posts/:postId/comments/:commentId/report' },
      params: { postId: 'p-clipe', commentId: 'seed-c-clipe-bia' },
    });
  });

  it('GET /posts/x/like é 405 com PUT e DELETE; GET /me/blocks/x é 405', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/posts/p-clipe/like')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/me/blocks/uid-enzo')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
    expect(matchRoute(API_ROUTES, 'DELETE', '/posts/p-clipe/comments')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET', 'POST'],
    });
  });

  it('/artists/:artistId e /artists/:artistId/posts não se confundem', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/artists/nettobrito')).toMatchObject({
      route: { pattern: '/artists/:artistId' },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/artists/nettobrito/posts')).toMatchObject({
      route: { pattern: '/artists/:artistId/posts' },
      params: { artistId: 'nettobrito' },
    });
  });

  it('a agenda, as presenças e o "Eu vou"', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/agenda')).toMatchObject({ kind: 'match' });
    expect(matchRoute(API_ROUTES, 'GET', '/me/rsvps')).toMatchObject({ kind: 'match' });
    expect(matchRoute(API_ROUTES, 'PUT', '/events/sao-joao-irara/rsvp')).toMatchObject({
      kind: 'match',
      params: { eventId: 'sao-joao-irara' },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/events/sao-joao-irara/rsvp')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/feed')).toMatchObject({ kind: 'match' });
  });
});

describe('rotas das missões e das conquistas (bloco 7)', () => {
  it('/missions e /missions/daily não se confundem; POST /missions é 405', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/missions')).toMatchObject({
      kind: 'match',
      route: { pattern: '/missions' },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/missions/daily')).toMatchObject({
      kind: 'match',
      route: { pattern: '/missions/daily' },
    });
    expect(matchRoute(API_ROUTES, 'POST', '/missions')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
  });

  it('/me/achievements e /me/ledger convivem com as rotas de me', () => {
    for (const path of ['/me/achievements', '/me/ledger', '/me/wallet', '/me/progress']) {
      expect(matchRoute(API_ROUTES, 'GET', path)).toMatchObject({
        kind: 'match',
        route: { pattern: path },
      });
    }
  });
});

describe('rotas do ranking (bloco 8)', () => {
  it('/ranking/season e /ranking não se confundem; /me/rank convive com as rotas de me', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/ranking/season')).toMatchObject({
      kind: 'match',
      route: { pattern: '/ranking/season' },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/ranking')).toMatchObject({
      kind: 'match',
      route: { pattern: '/ranking' },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/me/rank')).toMatchObject({
      kind: 'match',
      route: { pattern: '/me/rank' },
    });
  });

  it('as três só leem: POST /ranking e PUT /me/rank são 405 com GET', () => {
    expect(matchRoute(API_ROUTES, 'POST', '/ranking')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/me/rank')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
  });
});

describe('rotas do perfil editável (bloco 9)', () => {
  it('/me/username e /me/username/availability não se confundem', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/username/availability')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/me/username/availability' },
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/me/username')).toMatchObject({
      kind: 'match',
      route: { method: 'PUT', pattern: '/me/username' },
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/me/username/availability')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
  });

  it('GET /me/username, GET /me/photo e POST /me/photo são 405', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/username')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/me/photo')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
    expect(matchRoute(API_ROUTES, 'POST', '/me/photo')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT', 'DELETE'],
    });
    expect(matchRoute(API_ROUTES, 'DELETE', '/me/photo')).toMatchObject({ kind: 'match' });
  });
});

describe('rotas do perfil novo (seção 28)', () => {
  it('PUT /me/profile e GET /fans/:fanId, com o id decodificado', () => {
    expect(matchRoute(API_ROUTES, 'PUT', '/me/profile')).toMatchObject({
      kind: 'match',
      route: { method: 'PUT', pattern: '/me/profile', writes: true },
    });
    expect(matchRoute(API_ROUTES, 'GET', '/fans/Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/fans/:fanId', writes: false },
      params: { fanId: 'Kq3vZ8wQb1TnUe0aRk5pL2mXy7Fd' },
    });
  });

  it('GET /me/profile e PUT /fans/:fanId são 405', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/me/profile')).toEqual({
      kind: 'method_not_allowed',
      allow: ['PUT'],
    });
    expect(matchRoute(API_ROUTES, 'PUT', '/fans/uidCamila')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/fans').kind).toBe('not_found');
    expect(matchRoute(API_ROUTES, 'GET', '/fans/a%2Fb').kind).toBe('invalid');
  });
});

describe('rotas da loja (bloco 10)', () => {
  it('/rewards e /rewards/:rewardId/redeem não se confundem', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/rewards')).toMatchObject({
      kind: 'match',
      route: { method: 'GET', pattern: '/rewards' },
      params: {},
    });
    expect(matchRoute(API_ROUTES, 'POST', '/rewards/meet-netto/redeem')).toMatchObject({
      kind: 'match',
      route: { method: 'POST', pattern: '/rewards/:rewardId/redeem' },
      params: { rewardId: 'meet-netto' },
    });
  });

  it('GET /rewards/x/redeem é 405 com POST; POST /rewards é 405 com GET', () => {
    expect(matchRoute(API_ROUTES, 'GET', '/rewards/camisa/redeem')).toEqual({
      kind: 'method_not_allowed',
      allow: ['POST'],
    });
    expect(matchRoute(API_ROUTES, 'POST', '/rewards')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
    expect(matchRoute(API_ROUTES, 'GET', '/rewards/camisa').kind).toBe('not_found');
  });
});
