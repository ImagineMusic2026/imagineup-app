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
