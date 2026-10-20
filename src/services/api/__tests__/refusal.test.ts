import { t } from '@/i18n';

import { ApiError } from '../errors';
import { actionRefusal, dailyLimitKey, type RefusalAction } from '../refusal';

// A peça comum das recusas (seção 29 de docs/arquitetura-api.md, frentes E e
// F): cada superfície escolhe a frase por ela, e não pelo kind e pelo code soltos.

const suspended = new ApiError('forbidden', 'suspensa', 403, 'account_suspended');
const dailyLimit = new ApiError('dailyLimit', 'teto', 429, 'too_many_requests', {
  limit: 30,
  action: 'like',
});
const rateLimited = new ApiError('rateLimited', 'ritmo', 429, 'rate_limited', null, 2000);
const notFound = new ApiError('notFound', 'x', 404, 'post_not_found');
const network = new ApiError('network', 'x');
const RATE = 'Muitos pedidos seguidos. Espere alguns segundos e tente de novo.';
const SHORT = 'Sua conta está suspensa. Fale com a equipe do ImagineUP.';
const GONE = 'Este fã não está mais no ImagineUP.';

const phrase = (error: unknown, action: RefusalAction) => {
  const refusal = actionRefusal(error, action);
  return { type: refusal.type, text: t(refusal.key) };
};

describe('actionRefusal', () => {
  it.each<[RefusalAction, string, string, string]>([
    [
      'like',
      'Você chegou ao limite de curtidas de hoje. Tente amanhã.',
      SHORT,
      'Não deu para curtir o post. Tente de novo.',
    ],
    [
      'comment',
      'Você chegou ao limite de comentários de hoje. Tente amanhã.',
      'Sua conta está suspensa. Você não pode comentar.',
      'Não deu para enviar o comentário. O texto voltou para o campo.',
    ],
    [
      'rsvp',
      'Você chegou ao limite de presenças de hoje. Tente amanhã.',
      SHORT,
      'Não foi possível salvar sua presença. Tente de novo.',
    ],
    [
      'join',
      'Você chegou ao limite de entradas em centrais de hoje. Tente amanhã.',
      SHORT,
      'Não deu para entrar na central. Tente de novo.',
    ],
    [
      'follow',
      'Você chegou ao limite de entradas em centrais de hoje. Tente amanhã.',
      SHORT,
      'Não foi possível salvar agora. Tente de novo.',
    ],
    [
      'report',
      'Você chegou ao limite de denúncias de hoje. Tente amanhã.',
      SHORT,
      'Não deu para enviar a denúncia. Tente de novo.',
    ],
    [
      'redeem',
      'Você fez resgates demais hoje. Tente de novo amanhã.',
      'Sua conta está suspensa. Você não pode resgatar.',
      'Não deu para confirmar o resgate. Tente de novo.',
    ],
    [
      'profile',
      'Você salvou o perfil muitas vezes hoje. Tente amanhã.',
      SHORT,
      'Não deu para salvar. Tente de novo.',
    ],
    [
      'photo',
      'Você trocou a foto muitas vezes hoje. Tente amanhã.',
      SHORT,
      'Não deu para trocar a foto. Tente de novo.',
    ],
  ])('%s: o teto, o suspenso, o ritmo, o 404 e o genérico', (action, daily, refused, generic) => {
    expect(phrase(dailyLimit, action)).toEqual({ type: 'dailyLimit', text: daily });
    expect(phrase(suspended, action)).toEqual({ type: 'suspended', text: refused });
    expect(phrase(rateLimited, action)).toEqual({ type: 'rateLimited', text: RATE });
    // Sem frase própria do 404, o genérico (a ação cuida do 404 à parte).
    expect(phrase(notFound, action)).toEqual({ type: null, text: generic });
    expect(phrase(network, action)).toEqual({ type: null, text: generic });
    expect(phrase(new Error('x'), action)).toEqual({ type: null, text: generic });
    expect(t(dailyLimitKey(action))).toBe(daily);
  });

  it.each<[RefusalAction, string, string]>([
    [
      'reportFan',
      'Você chegou ao limite de denúncias de hoje. Tente amanhã.',
      'Não deu para enviar a denúncia. Tente de novo.',
    ],
    [
      'block',
      'Você chegou ao limite de bloqueios de hoje. Tente amanhã.',
      'Não deu para bloquear. Tente de novo.',
    ],
  ])(
    '%s (seção 29): o teto, o suspenso, o ritmo, o 404 próprio e o genérico',
    (action, daily, generic) => {
      expect(phrase(dailyLimit, action)).toEqual({ type: 'dailyLimit', text: daily });
      expect(phrase(suspended, action)).toEqual({ type: 'suspended', text: SHORT });
      expect(phrase(rateLimited, action)).toEqual({ type: 'rateLimited', text: RATE });
      expect(phrase(new ApiError('notFound', 'x', 404, 'fan_not_found'), action)).toEqual({
        type: null,
        text: GONE,
      });
      expect(phrase(network, action)).toEqual({ type: null, text: generic });
      expect(t(dailyLimitKey(action))).toBe(daily);
    },
  );

  it('desbloquear não tem teto do dia: o 429 do teto cai no genérico; o 404 tem frase própria', () => {
    const generic = 'Não deu para desbloquear. Tente de novo.';
    expect(phrase(dailyLimit, 'unblock')).toEqual({ type: null, text: generic });
    expect(phrase(rateLimited, 'unblock')).toEqual({ type: 'rateLimited', text: RATE });
    expect(phrase(notFound, 'unblock')).toEqual({ type: null, text: GONE });
    expect(phrase(network, 'unblock')).toEqual({ type: null, text: generic });
  });

  it('sair da central não tem teto do dia: o 429 do teto cai no genérico', () => {
    expect(phrase(dailyLimit, 'leave')).toEqual({
      type: null,
      text: 'Não deu para sair da central. Tente de novo.',
    });
    expect(phrase(rateLimited, 'leave')).toEqual({ type: 'rateLimited', text: RATE });
  });

  it('o convite do suspenso: o link sai sem os pontos', () => {
    expect(phrase(suspended, 'invite')).toEqual({
      type: 'suspended',
      text: 'Sua conta está suspensa. O link sai sem os pontos.',
    });
  });

  it('o 403 de outro código não é a conta suspensa', () => {
    expect(phrase(new ApiError('forbidden', 'x', 403, 'not_fan'), 'like').type).toBeNull();
  });

  it('o 429 classificado à mão pelo código, sem o kind, não é o teto (só o toApiError classifica)', () => {
    expect(phrase(new ApiError('unknown', 'x', 429, 'too_many_requests'), 'like').type).toBeNull();
  });
});

// O filtro do que o fã publica (seção 30): o tipo `content`, primeiro, só nas
// ações com a frase; o erro que volta do disco é um objeto do JSON.
describe('actionRefusal: o texto recusado pelo filtro', () => {
  const commentRefused = new ApiError('validation', 'fora', 400, 'comment_invalid', {
    reason: 'not_allowed',
  });
  const profileRefused = new ApiError('validation', 'fora', 400, 'profile_invalid', {
    field: 'bio',
    reason: 'not_allowed',
  });
  const fromDisk = (error: ApiError): unknown => JSON.parse(JSON.stringify(error));

  it('o comentário: a frase dos Termos de uso, também com o erro do disco', () => {
    const text =
      'Conforme os Termos de uso do ImagineUP, este comentário não pode ser publicado. Revise o texto.';
    expect(phrase(commentRefused, 'comment')).toEqual({ type: 'content', text });
    expect(phrase(fromDisk(commentRefused), 'comment')).toEqual({ type: 'content', text });
  });

  it('o perfil: a frase dos Termos de uso, também com o objeto do JSON', () => {
    const text = 'Conforme os Termos de uso do ImagineUP, este texto não pode ser usado.';
    expect(phrase(profileRefused, 'profile')).toEqual({ type: 'content', text });
    expect(phrase(fromDisk(profileRefused), 'profile')).toEqual({ type: 'content', text });
  });

  it('as ações sem a frase ficam com o genérico', () => {
    expect(phrase(commentRefused, 'like')).toEqual({
      type: null,
      text: 'Não deu para curtir o post. Tente de novo.',
    });
    expect(phrase(profileRefused, 'photo')).toEqual({
      type: null,
      text: 'Não deu para trocar a foto. Tente de novo.',
    });
  });

  it('outro motivo do mesmo código fica com o genérico, e o suspenso com a frase dele', () => {
    expect(
      phrase(
        new ApiError('validation', 'longo', 400, 'comment_invalid', { reason: 'too_long' }),
        'comment',
      ),
    ).toEqual({
      type: null,
      text: 'Não deu para enviar o comentário. O texto voltou para o campo.',
    });
    expect(phrase(suspended, 'comment')).toEqual({
      type: 'suspended',
      text: 'Sua conta está suspensa. Você não pode comentar.',
    });
    expect(phrase(suspended, 'profile')).toEqual({ type: 'suspended', text: SHORT });
  });
});

// As superfícies do fã-clube (seção 34, 34.9): o 403 do suspenso e o 429 do
// teto de cada uma, o 404 das que leem o fã-clube ou a publicação, e o texto
// barrado pelo filtro na candidatura e na publicação.
describe('actionRefusal: o fã-clube', () => {
  const clubNotFound = new ApiError('notFound', 'x', 404, 'fan_club_not_found');
  const postNotFound = new ApiError('notFound', 'x', 404, 'fan_club_post_not_found');
  const contentRefused = new ApiError('validation', 'x', 400, 'fan_club_invalid', {
    field: 'name',
    reason: 'not_allowed',
  });
  const CONTENT = 'Conforme os Termos de uso do ImagineUP, este texto não pode ser usado.';

  it.each<[RefusalAction, string, string, string]>([
    [
      'clubApply',
      'Você chegou ao limite de candidaturas de hoje. Tente amanhã.',
      'Sua conta está suspensa. Você não pode se candidatar a um fã-clube.',
      'Não deu para enviar a candidatura. Tente de novo.',
    ],
    [
      'clubUpload',
      'Você chegou ao limite de fotos de hoje no fã-clube. Tente amanhã.',
      'Sua conta está suspensa. Você não pode publicar no fã-clube.',
      'Não deu para enviar a foto. Tente de novo.',
    ],
    [
      'clubPost',
      'Você chegou ao limite de publicações de hoje. Tente amanhã.',
      'Sua conta está suspensa. Você não pode publicar no fã-clube.',
      'Não deu para enviar a publicação. Tente de novo.',
    ],
    [
      'clubReport',
      'Você chegou ao limite de denúncias de hoje. Tente amanhã.',
      SHORT,
      'Não deu para enviar a denúncia. Tente de novo.',
    ],
    [
      'clubFollow',
      'Você chegou ao limite de hoje para seguir fã-clubes e entrar em centrais. Tente amanhã.',
      'Sua conta está suspensa. Você não pode seguir fã-clubes.',
      'Não deu para seguir o fã-clube. Tente de novo.',
    ],
  ])('%s: o teto, o suspenso, o ritmo e o genérico', (action, daily, refused, generic) => {
    expect(phrase(dailyLimit, action)).toEqual({ type: 'dailyLimit', text: daily });
    expect(phrase(suspended, action)).toEqual({ type: 'suspended', text: refused });
    expect(phrase(rateLimited, action)).toEqual({ type: 'rateLimited', text: RATE });
    expect(phrase(network, action)).toEqual({ type: null, text: generic });
    expect(t(dailyLimitKey(action))).toBe(daily);
  });

  it.each<[RefusalAction, string]>([
    ['clubWithdraw', 'Não deu para desistir da candidatura. Tente de novo.'],
    ['clubRules', 'Não deu para aceitar o regulamento. Tente de novo.'],
    ['clubRemovePost', 'Não deu para tirar a publicação. Tente de novo.'],
    ['clubUnfollow', 'Não deu para deixar de seguir. Tente de novo.'],
  ])('%s não tem teto do dia: o 429 do teto cai no genérico', (action, generic) => {
    expect(phrase(dailyLimit, action)).toEqual({ type: null, text: generic });
    expect(phrase(rateLimited, action)).toEqual({ type: 'rateLimited', text: RATE });
    expect(phrase(network, action)).toEqual({ type: null, text: generic });
  });

  it('o 404: o fã-clube no seguir, a publicação no retirar e na denúncia', () => {
    const club = 'Este fã-clube não está disponível.';
    const post = 'Esta publicação não está mais disponível.';
    expect(phrase(clubNotFound, 'clubFollow')).toEqual({ type: null, text: club });
    expect(phrase(postNotFound, 'clubRemovePost')).toEqual({ type: null, text: post });
    expect(phrase(postNotFound, 'clubReport')).toEqual({ type: null, text: post });
  });

  it('o texto barrado pelo filtro: a frase dos Termos de uso na candidatura e na publicação', () => {
    expect(phrase(contentRefused, 'clubApply')).toEqual({ type: 'content', text: CONTENT });
    expect(phrase(contentRefused, 'clubPost')).toEqual({ type: 'content', text: CONTENT });
    // Seguir não manda texto: o mesmo erro fica com o genérico.
    expect(phrase(contentRefused, 'clubFollow').type).toBeNull();
  });

  it('desistir, retirar e deixar de seguir são livres para o suspenso: o 403 fica com a frase de sempre', () => {
    expect(phrase(suspended, 'clubWithdraw')).toEqual({ type: 'suspended', text: SHORT });
  });
});
